import * as fs from 'fs';
import * as path from 'path';

/**
 * Minimal SQL migration runner for the checked-in files in `drizzle/`.
 *
 * Files run in filename order; each applied file is recorded in `_migrations`
 * so re-runs are no-ops. Statements within a file are split on the drizzle
 * `--> statement-breakpoint` marker because the Neon HTTP driver (and PGlite's
 * exec path used in tests) execute one statement at a time. Migrations must
 * therefore be additive/idempotent per the plan's expand–contract rule —
 * `CREATE ... IF NOT EXISTS` — so a partially applied file heals on re-run.
 *
 * `CONCURRENTLY` statements are supported naturally (never wrapped in a
 * transaction, since execution is per-statement).
 */
export interface SqlExecutor {
    /** Execute one SQL statement; only `rows` of SELECTs are ever inspected. */
    exec(statement: string): Promise<{ rows?: any[] }>;
}

export function splitStatements(sqlFile: string): string[] {
    return sqlFile
        .split(/-->\s*statement-breakpoint/g)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

export function migrationsDir(): string {
    // dist/pg/migrate.js → ../../drizzle ; src/pg/migrate.ts (tests) → same shape
    return path.resolve(__dirname, '..', '..', 'drizzle');
}

export async function runMigrations(executor: SqlExecutor, dir: string = migrationsDir()): Promise<string[]> {
    await executor.exec(
        'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const { rows } = await executor.exec('SELECT name FROM _migrations');
    const applied = new Set((rows ?? []).map((r: any) => r.name));

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const ran: string[] = [];
    for (const file of files) {
        if (applied.has(file)) continue;
        const sqlFile = fs.readFileSync(path.join(dir, file), 'utf-8');
        for (const statement of splitStatements(sqlFile)) {
            await executor.exec(statement);
        }
        await executor.exec(
            `INSERT INTO _migrations (name) VALUES ('${file.replace(/'/g, "''")}') ON CONFLICT (name) DO NOTHING`,
        );
        ran.push(file);
    }
    return ran;
}

/** CLI entrypoint: `node dist/pg/migrate.js` with MIGRATION_DATABASE_URL (or DATABASE_URL). */
export async function migrateCli(): Promise<void> {
    const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) must be set');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(url);
    const executor: SqlExecutor = {
        exec: async (statement: string) => {
            const rows = await sql.query(statement);
            return { rows: Array.isArray(rows) ? rows : (rows as any)?.rows };
        },
    };
    const ran = await runMigrations(executor);
    console.log(ran.length ? `Applied migrations: ${ran.join(', ')}` : 'No pending migrations');
}

if (require.main === module) {
    migrateCli().catch((err) => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
}
