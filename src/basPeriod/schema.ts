import { z } from 'zod';
import type { BasReason } from '../basReporting/schema';

/*
 * NOTE: types here are EXPLICIT interfaces, not z.infer — core compiles its
 * d.ts against zod v3 while consumers may resolve `z` to zod v4.
 */

/**
 * The figures snapshotted when a quarter is lodged. Typed loosely: the set
 * grows as the BAS view does (gstCollected, gstPaid, netGst, mileageDeduction,
 * depreciation, invoiceCount, receiptCount, tripKm, salesExGst, expensesExGst…)
 * and an old snapshot must keep reading back without a migration.
 */
export type BasFigures = Record<string, number>;
export const BasFiguresSchema = z.record(z.string(), z.number());

export interface BasPeriodDTO {
    orgId: string;
    /** `FY26/27-Q1` */
    period: string;
    fy: string;
    quarter: number;
    /** YYYY-MM-DD */
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    /** ISO; null while the quarter is open. */
    lodgedAt: string | null;
    lodgedBy?: string | null;
    /** Snapshot at lodgement; null while open (and cleared by unlodge). */
    figures: BasFigures | null;
    /** 50 | 75 | 90 | 100 at lodgement. */
    confidence: number | null;
    reasons: BasReason[] | null;
    /** ISO; when each reminder was sent — the cron's idempotency markers. */
    reminderBeforeAt: string | null;
    reminderDueAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export const BasReasonSchema = z.object({
    code: z.enum([
        'NO_STATEMENT', 'INVOICES_UNATTRIBUTED', 'MONTH_MISSING', 'BANK_ROWS_UNRECONCILED',
        'CREDITS_UNMATCHED', 'RECEIPTS_UNREVIEWED', 'ASSETS_NO_FIRST_USE',
    ]),
    count: z.number(),
    detail: z.string().optional(),
});
export const BasPeriodSchema = z.object({
    orgId: z.string(),
    period: z.string(),
    fy: z.string(),
    quarter: z.number().int().min(1).max(4),
    periodStart: z.string(),
    periodEnd: z.string(),
    dueDate: z.string(),
    lodgedAt: z.string().nullable(),
    lodgedBy: z.string().nullish(),
    figures: BasFiguresSchema.nullable(),
    confidence: z.number().nullable(),
    reasons: z.array(BasReasonSchema).nullable(),
    reminderBeforeAt: z.string().nullable(),
    reminderDueAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** What `markLodged` needs: the period's calendar facts plus the lodgement snapshot. */
export interface BasLodgementInput {
    period: string;
    fy: string;
    quarter: number;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    lodgedBy: string;
    figures: BasFigures;
    confidence: number;
    reasons: BasReason[];
}

export type BasReminderKind = 'before' | 'due';
