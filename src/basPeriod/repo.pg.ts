import { and, eq, desc, lt, or, sql, isNotNull } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { basPeriods } from '../pg/schema/bookkeeping';
import type { BasPeriodDTO, BasLodgementInput, BasReminderKind } from './schema';
import type { BasPeriodInfo } from './period';

function toDto(row: typeof basPeriods.$inferSelect): BasPeriodDTO {
    const dto: Record<string, unknown> = {
        orgId: row.orgId,
        period: row.period,
        fy: row.fy,
        quarter: row.quarter,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        dueDate: row.dueDate,
        lodgedAt: row.lodgedAt ? row.lodgedAt.toISOString() : null,
        figures: row.figures ?? null,
        confidence: row.confidence ?? null,
        reasons: row.reasons ?? null,
        reminderBeforeAt: row.reminderBeforeAt ? row.reminderBeforeAt.toISOString() : null,
        reminderDueAt: row.reminderDueAt ? row.reminderDueAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
    if (row.lodgedBy != null) dto.lodgedBy = row.lodgedBy;
    return dto as unknown as BasPeriodDTO;
}

export type BasLodgeResult = 'lodged' | 'already_lodged';

export interface ListBasPeriodsParams {
    limit?: number;
    /** Already-decoded cursor `{ periodEnd, period }` from a prior page. */
    exclusiveStartKey?: Record<string, any>;
}

export interface BasPeriodsPage {
    items: BasPeriodDTO[];
    lastEvaluatedKey?: Record<string, any>;
}

const clampLimit = (n: number | undefined, max: number): number => Math.min(Math.max(n ?? 20, 1), max);

/**
 * BasPeriodPgRepo — Postgres-only (no Dynamo mirror; see pg/schema/bookkeeping.ts).
 *
 * A row exists only once something happened to the quarter: it was lodged, or
 * a reminder went out. Both writers upsert on (org_id, period) with a
 * conditional SET, so every one of them is safe to run twice — the lodge
 * button, a replayed webhook, a double-fired cron.
 */
export class BasPeriodPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async get(orgId: string, period: string): Promise<BasPeriodDTO | null> {
        const rows = await this.db.select().from(basPeriods)
            .where(and(eq(basPeriods.orgId, orgId), eq(basPeriods.period, period)))
            .limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }

    /** Newest quarter first (by period_end), keyset-paginated. */
    async list(orgId: string, opts?: ListBasPeriodsParams): Promise<BasPeriodsPage> {
        const limit = clampLimit(opts?.limit, 100);
        const conds: any[] = [eq(basPeriods.orgId, orgId)];
        const k = opts?.exclusiveStartKey;
        if (k?.periodEnd && k?.period) {
            conds.push(or(
                lt(basPeriods.periodEnd, String(k.periodEnd)),
                and(eq(basPeriods.periodEnd, String(k.periodEnd)), lt(basPeriods.period, String(k.period))),
            ));
        }
        const rows = await this.db.select().from(basPeriods).where(and(...conds))
            .orderBy(desc(basPeriods.periodEnd), desc(basPeriods.period))
            .limit(limit);
        const last = rows[rows.length - 1];
        return {
            items: rows.map(toDto),
            lastEvaluatedKey: rows.length === limit && last
                ? { orgId, periodEnd: last.periodEnd, period: last.period }
                : undefined,
        };
    }

    /**
     * Mark the quarter lodged with a snapshot of its figures. Upserts the row
     * and sets lodged_at only when it is still NULL — a second lodge (retry,
     * double-tap) returns 'already_lodged' and leaves the first snapshot alone.
     */
    async markLodged(orgId: string, input: BasLodgementInput): Promise<BasLodgeResult> {
        const now = new Date();
        const rows = await this.db.insert(basPeriods)
            .values({
                orgId, period: input.period, fy: input.fy, quarter: input.quarter,
                periodStart: input.periodStart, periodEnd: input.periodEnd, dueDate: input.dueDate,
                lodgedAt: now, lodgedBy: input.lodgedBy,
                figures: input.figures, confidence: input.confidence, reasons: input.reasons,
                createdAt: now, updatedAt: now,
            })
            .onConflictDoUpdate({
                target: [basPeriods.orgId, basPeriods.period],
                set: {
                    lodgedAt: now, lodgedBy: input.lodgedBy,
                    figures: input.figures, confidence: input.confidence, reasons: input.reasons,
                    updatedAt: now,
                },
                setWhere: sql`${basPeriods.lodgedAt} IS NULL`,
            })
            .returning({ period: basPeriods.period });
        return rows.length > 0 ? 'lodged' : 'already_lodged';
    }

    /** Reopen a lodged quarter: clears the lodgement and its snapshot. False when it wasn't lodged. */
    async unlodge(orgId: string, period: string): Promise<boolean> {
        const rows = await this.db.update(basPeriods)
            .set({ lodgedAt: null, lodgedBy: null, figures: null, confidence: null, reasons: null, updatedAt: new Date() })
            .where(and(eq(basPeriods.orgId, orgId), eq(basPeriods.period, period), isNotNull(basPeriods.lodgedAt)))
            .returning({ period: basPeriods.period });
        return rows.length > 0;
    }

    /**
     * Stamp a reminder as sent — the cron's idempotency guard. Upserts the row
     * and sets reminder_{kind}_at = now() only when it is still NULL; returns
     * true only when THIS call set it, so a double-fired cron sends once.
     */
    async stampReminder(orgId: string, info: BasPeriodInfo, kind: BasReminderKind): Promise<boolean> {
        const now = new Date();
        const col = kind === 'before' ? basPeriods.reminderBeforeAt : basPeriods.reminderDueAt;
        const rows = await this.db.insert(basPeriods)
            .values({
                orgId, period: info.period, fy: info.fy, quarter: info.quarter,
                periodStart: info.periodStart, periodEnd: info.periodEnd, dueDate: info.dueDate,
                reminderBeforeAt: kind === 'before' ? now : null,
                reminderDueAt: kind === 'due' ? now : null,
                createdAt: now, updatedAt: now,
            })
            .onConflictDoUpdate({
                target: [basPeriods.orgId, basPeriods.period],
                set: kind === 'before'
                    ? { reminderBeforeAt: now, updatedAt: now }
                    : { reminderDueAt: now, updatedAt: now },
                setWhere: sql`${col} IS NULL`,
            })
            .returning({ period: basPeriods.period });
        return rows.length > 0;
    }

    /** Lodged quarters, most recently lodged first. */
    async listLodged(orgId: string, limit?: number): Promise<BasPeriodDTO[]> {
        const { items } = await this.listLodgedPaginated(orgId, { limit });
        return items;
    }

    /**
     * Lodged quarters, most recently lodged first, keyset paginated.
     *
     * The filter belongs in the query: paging every period row and dropping
     * the unlodged ones afterwards returns short pages, and can return an
     * empty one while lodged quarters are still waiting behind it.
     */
    async listLodgedPaginated(
        orgId: string,
        opts: { limit?: number; exclusiveStartKey?: Record<string, any> } = {},
    ): Promise<{ items: BasPeriodDTO[]; lastEvaluatedKey?: Record<string, any> }> {
        const limit = clampLimit(opts.limit, 100);
        const conds: any[] = [eq(basPeriods.orgId, orgId), isNotNull(basPeriods.lodgedAt)];
        const cursor = opts.exclusiveStartKey;
        if (cursor?.lodgedAt && cursor?.period) {
            const at = new Date(cursor.lodgedAt);
            conds.push(or(
                lt(basPeriods.lodgedAt, at),
                and(eq(basPeriods.lodgedAt, at), lt(basPeriods.period, String(cursor.period))),
            ));
        }
        const rows = await this.db.select().from(basPeriods)
            .where(and(...conds))
            .orderBy(desc(basPeriods.lodgedAt), desc(basPeriods.period))
            .limit(limit + 1);
        const page = rows.slice(0, limit);
        const items = page.map(toDto);
        const more = rows.length > limit;
        const last = page[page.length - 1];
        return more && last?.lodgedAt
            ? { items, lastEvaluatedKey: { orgId, lodgedAt: last.lodgedAt.toISOString(), period: last.period } }
            : { items };
    }
}
