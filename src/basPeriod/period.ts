/**
 * Australian BAS quarter arithmetic — pure, no store.
 *
 * The financial year runs 1 July – 30 June and is labelled by its two calendar
 * years: `FY26/27` starts 1 July 2026. Quarters and their ATO lodgement dates:
 *
 *   Q1  Jul–Sep  due 28 Oct
 *   Q2  Oct–Dec  due 28 Feb
 *   Q3  Jan–Mar  due 28 Apr
 *   Q4  Apr–Jun  due 28 Jul
 *
 * A period id is `FY26/27-Q1`. All dates are YYYY-MM-DD strings; nothing here
 * ever builds a JS Date, so there is no timezone to get wrong.
 */

export type BasQuarter = 1 | 2 | 3 | 4;

export interface BasPeriodInfo {
    /** `FY26/27-Q1` */
    period: string;
    /** `FY26/27` */
    fy: string;
    quarter: BasQuarter;
    /** YYYY-MM-DD, inclusive. */
    periodStart: string;
    periodEnd: string;
    /** YYYY-MM-DD — the ATO lodgement date. */
    dueDate: string;
}

const FY_RE = /^FY(\d{2})\/(\d{2})$/;
const PERIOD_RE = /^FY(\d{2})\/(\d{2})-Q([1-4])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `2026` → `FY26/27`. */
export function fyLabel(startYear: number): string {
    return `FY${pad2(startYear % 100)}/${pad2((startYear + 1) % 100)}`;
}

/** `FY26/27` → 2026; null when malformed or the two years don't run consecutively. */
export function fyStartYear(fy: string): number | null {
    const m = FY_RE.exec(fy);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if ((a + 1) % 100 !== b) return null;
    return 2000 + a;
}

function ymOf(dateIso: string): { year: number; month: number } {
    const m = DATE_RE.exec(dateIso);
    if (!m) throw new Error(`basPeriod: not a YYYY-MM-DD date: ${dateIso}`);
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new Error(`basPeriod: month out of range in ${dateIso}`);
    return { year, month };
}

/** The financial year a date falls in: 2026-08-15 → `FY26/27`; 2027-02-10 → `FY26/27`. */
export function fyOf(dateIso: string): string {
    const { year, month } = ymOf(dateIso);
    return fyLabel(month >= 7 ? year : year - 1);
}

/** Inclusive bounds of a financial year, or null when the label is malformed. */
export function fyRange(fy: string): { start: string; end: string } | null {
    const y = fyStartYear(fy);
    if (y === null) return null;
    return { start: `${y}-07-01`, end: `${y + 1}-06-30` };
}

/** One quarter of one financial year, fully described. Null when the label is malformed. */
export function basPeriod(fy: string, quarter: BasQuarter): BasPeriodInfo | null {
    const y = fyStartYear(fy);
    if (y === null) return null;
    const base = { period: `${fy}-Q${quarter}`, fy, quarter };
    switch (quarter) {
        case 1: return { ...base, periodStart: `${y}-07-01`, periodEnd: `${y}-09-30`, dueDate: `${y}-10-28` };
        case 2: return { ...base, periodStart: `${y}-10-01`, periodEnd: `${y}-12-31`, dueDate: `${y + 1}-02-28` };
        case 3: return { ...base, periodStart: `${y + 1}-01-01`, periodEnd: `${y + 1}-03-31`, dueDate: `${y + 1}-04-28` };
        case 4: return { ...base, periodStart: `${y + 1}-04-01`, periodEnd: `${y + 1}-06-30`, dueDate: `${y + 1}-07-28` };
    }
}

/** The BAS quarter a date falls in. Throws on a malformed date (a system input, never user text). */
export function basPeriodFor(dateIso: string): BasPeriodInfo {
    const { month } = ymOf(dateIso);
    const quarter: BasQuarter = month >= 7 && month <= 9 ? 1 : month >= 10 ? 2 : month <= 3 ? 3 : 4;
    return basPeriod(fyOf(dateIso), quarter)!;
}

/** `FY26/27-Q1` → the full period, or null when malformed (safe on user input). */
export function parsePeriod(period: string): BasPeriodInfo | null {
    const m = PERIOD_RE.exec(period);
    if (!m) return null;
    return basPeriod(`FY${m[1]}/${m[2]}`, Number(m[3]) as BasQuarter);
}

/** The quarter before. Q1 rolls back into the prior financial year's Q4. */
export function previousPeriod(period: string | BasPeriodInfo): BasPeriodInfo | null {
    const info = typeof period === 'string' ? parsePeriod(period) : period;
    if (!info) return null;
    const y = fyStartYear(info.fy);
    if (y === null) return null;
    return info.quarter === 1
        ? basPeriod(fyLabel(y - 1), 4)
        : basPeriod(info.fy, (info.quarter - 1) as BasQuarter);
}

/** The quarter after. Q4 rolls forward into the next financial year's Q1. */
export function nextPeriod(period: string | BasPeriodInfo): BasPeriodInfo | null {
    const info = typeof period === 'string' ? parsePeriod(period) : period;
    if (!info) return null;
    const y = fyStartYear(info.fy);
    if (y === null) return null;
    return info.quarter === 4
        ? basPeriod(fyLabel(y + 1), 1)
        : basPeriod(info.fy, (info.quarter + 1) as BasQuarter);
}

/** All four quarters of a financial year in order, or null when the label is malformed. */
export function periodsInFy(fy: string): BasPeriodInfo[] | null {
    if (fyStartYear(fy) === null) return null;
    return ([1, 2, 3, 4] as BasQuarter[]).map((q) => basPeriod(fy, q)!);
}
