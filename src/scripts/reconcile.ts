/**
 * Reconciliation check for the migration promotion gates (plan §6.3): compares
 * DynamoDB vs Postgres row counts per entity, plus money-sum totals for the
 * financial tables. A clean run (all MATCH) is a precondition for promoting a
 * domain from dual_dynamo → dual_pg. Read-only; exits 2 on any mismatch.
 *
 * Usage:
 *   export AWS_PROFILE=sandbox AWS_REGION=ap-southeast-2
 *   export ORGANIZATIONS_TABLE=... USERS_TABLE=... MEMBERSHIPS_TABLE=... TEAMS_TABLE=...
 *   export CLIENTS_TABLE=... INVOICES_TABLE=... INVOICE_PAYMENTS_TABLE=...
 *   export DATABASE_URL="postgresql://app_rw:...@.../neondb?sslmode=require"
 *   node dist/scripts/reconcile.js [identity|billing-core|all]
 */
import { sql } from 'drizzle-orm';
import { getPg } from '../pg/client';
import { ddb } from '../ddbClient';
import { Tables } from '../tables';

type Check = { label: string; dynamoTable: string; pgTable: string; sumAttr?: string; pgSumCol?: string };

const DOMAINS: Record<string, Check[]> = {
    identity: [
        { label: 'orgs', dynamoTable: Tables.ORGANIZATIONS, pgTable: 'orgs' },
        { label: 'users', dynamoTable: Tables.USERS, pgTable: 'users' },
        { label: 'memberships', dynamoTable: Tables.MEMBERSHIPS, pgTable: 'memberships' },
        { label: 'teams', dynamoTable: Tables.TEAMS, pgTable: 'teams' },
    ],
    'billing-core': [
        { label: 'clients', dynamoTable: Tables.CLIENTS, pgTable: 'clients' },
        { label: 'invoices', dynamoTable: Tables.INVOICES, pgTable: 'invoices', sumAttr: 'totalAmount', pgSumCol: 'total_amount' },
        { label: 'payments', dynamoTable: Tables.INVOICE_PAYMENTS, pgTable: 'invoice_payments', sumAttr: 'amount', pgSumCol: 'amount' },
    ],
};

async function dynamoCountAndSum(tableName: string, sumAttr?: string): Promise<{ count: number; sum: number }> {
    let count = 0, sum = 0;
    let exclusiveStartKey: Record<string, any> | undefined;
    do {
        const page = await ddb.scan({
            TableName: tableName,
            ...(sumAttr ? { ProjectionExpression: '#a', ExpressionAttributeNames: { '#a': sumAttr } } : { Select: 'COUNT' }),
            ExclusiveStartKey: exclusiveStartKey,
        });
        count += sumAttr ? (page.Items?.length ?? 0) : (page.Count ?? 0);
        if (sumAttr) for (const it of page.Items ?? []) sum += Number(it[sumAttr] ?? 0);
        exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return { count, sum: Math.round(sum * 100) / 100 };
}

async function run(domainArg: string): Promise<void> {
    const db = getPg();
    const domains = domainArg === 'all' ? Object.keys(DOMAINS) : [domainArg];
    let mismatches = 0;

    for (const domain of domains) {
        const checks = DOMAINS[domain];
        if (!checks) { console.error(`unknown domain: ${domain}`); process.exit(1); }
        console.log(`\n=== ${domain} ===`);
        for (const c of checks) {
            const dyn = await dynamoCountAndSum(c.dynamoTable, c.sumAttr);
            const pgCount = Number((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${c.pgTable}`))).rows?.[0]?.n ?? 0);
            const countOk = dyn.count === pgCount;
            if (!countOk) mismatches++;
            let line = `${c.label.padEnd(12)} count: dynamo=${dyn.count} pg=${pgCount} ${countOk ? 'MATCH' : 'MISMATCH'}`;
            if (c.pgSumCol) {
                const pgSum = Math.round(Number((await db.execute(sql.raw(`SELECT coalesce(sum(${c.pgSumCol}),0)::float AS s FROM ${c.pgTable}`))).rows?.[0]?.s ?? 0) * 100) / 100;
                const sumOk = Math.abs(dyn.sum - pgSum) < 0.01;
                if (!sumOk) mismatches++;
                line += ` | sum: dynamo=${dyn.sum} pg=${pgSum} ${sumOk ? 'MATCH' : 'MISMATCH'}`;
            }
            console.log(line);
        }
    }

    console.log(`\n${mismatches === 0 ? '✓ reconciliation clean — promotion gate satisfied' : `✗ ${mismatches} mismatch(es) — do not promote`}`);
    if (mismatches > 0) process.exitCode = 2;
}

if (require.main === module) {
    run(process.argv[2] || 'all').catch((err) => { console.error('reconcile failed:', err); process.exit(1); });
}
