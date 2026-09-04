import { describe, it, expect } from 'vitest';
import {
    basPeriodFor, parsePeriod, previousPeriod, nextPeriod, fyOf, fyRange,
    fyLabel, fyStartYear, basPeriod, periodsInFy,
} from './period';

describe('fy helpers', () => {
    it('labels a financial year by its two calendar years', () => {
        expect(fyLabel(2026)).toBe('FY26/27');
        expect(fyLabel(2029)).toBe('FY29/30');
        expect(fyLabel(2099)).toBe('FY99/00');
    });

    it('fyStartYear parses the label and rejects non-consecutive years', () => {
        expect(fyStartYear('FY26/27')).toBe(2026);
        expect(fyStartYear('FY99/00')).toBe(2099);
        expect(fyStartYear('FY26/28')).toBeNull();
        expect(fyStartYear('2026-27')).toBeNull();
        expect(fyStartYear('')).toBeNull();
    });

    it('fyOf puts July onward in the new year and Jan–Jun in the old one', () => {
        expect(fyOf('2026-07-01')).toBe('FY26/27');
        expect(fyOf('2026-12-31')).toBe('FY26/27');
        expect(fyOf('2027-01-01')).toBe('FY26/27');
        expect(fyOf('2027-06-30')).toBe('FY26/27');
        expect(fyOf('2026-06-30')).toBe('FY25/26');
        expect(fyOf('2026-08-15T10:30:00.000Z')).toBe('FY26/27'); // full ISO accepted
    });

    it('fyRange spans 1 July – 30 June', () => {
        expect(fyRange('FY26/27')).toEqual({ start: '2026-07-01', end: '2027-06-30' });
        expect(fyRange('nope')).toBeNull();
    });

    it('rejects malformed dates loudly', () => {
        expect(() => fyOf('15/08/2026')).toThrow(/YYYY-MM-DD/);
        expect(() => basPeriodFor('2026-13-01')).toThrow(/month/);
    });
});

describe('basPeriodFor', () => {
    it('Q1 Jul–Sep due 28 Oct', () => {
        expect(basPeriodFor('2026-08-15')).toEqual({
            period: 'FY26/27-Q1', fy: 'FY26/27', quarter: 1,
            periodStart: '2026-07-01', periodEnd: '2026-09-30', dueDate: '2026-10-28',
        });
        expect(basPeriodFor('2026-07-01').period).toBe('FY26/27-Q1');
        expect(basPeriodFor('2026-09-30').period).toBe('FY26/27-Q1');
    });

    it('Q2 Oct–Dec due 28 Feb of the next calendar year', () => {
        expect(basPeriodFor('2026-11-02')).toEqual({
            period: 'FY26/27-Q2', fy: 'FY26/27', quarter: 2,
            periodStart: '2026-10-01', periodEnd: '2026-12-31', dueDate: '2027-02-28',
        });
    });

    it('Q3 Jan–Mar due 28 Apr, still in the same FY', () => {
        expect(basPeriodFor('2027-02-10')).toEqual({
            period: 'FY26/27-Q3', fy: 'FY26/27', quarter: 3,
            periodStart: '2027-01-01', periodEnd: '2027-03-31', dueDate: '2027-04-28',
        });
    });

    it('Q4 Apr–Jun due 28 Jul', () => {
        expect(basPeriodFor('2027-05-20')).toEqual({
            period: 'FY26/27-Q4', fy: 'FY26/27', quarter: 4,
            periodStart: '2027-04-01', periodEnd: '2027-06-30', dueDate: '2027-07-28',
        });
        expect(basPeriodFor('2027-06-30').period).toBe('FY26/27-Q4');
        expect(basPeriodFor('2027-07-01').period).toBe('FY27/28-Q1');
    });
});

describe('parsePeriod', () => {
    it('round-trips a period id and returns null on rubbish', () => {
        expect(parsePeriod('FY26/27-Q1')).toEqual(basPeriodFor('2026-08-01'));
        expect(parsePeriod('FY26/27-Q4')).toEqual(basPeriodFor('2027-05-01'));
        expect(parsePeriod('FY26/27-Q5')).toBeNull();
        expect(parsePeriod('FY26/28-Q1')).toBeNull();
        expect(parsePeriod('Q1')).toBeNull();
        expect(parsePeriod('')).toBeNull();
    });

    it('basPeriod builds any quarter directly', () => {
        expect(basPeriod('FY25/26', 2)?.dueDate).toBe('2026-02-28');
        expect(basPeriod('bad', 2)).toBeNull();
    });
});

describe('previousPeriod / nextPeriod', () => {
    it('step within a year', () => {
        expect(previousPeriod('FY26/27-Q3')?.period).toBe('FY26/27-Q2');
        expect(nextPeriod('FY26/27-Q2')?.period).toBe('FY26/27-Q3');
    });

    it('roll across the financial-year boundary', () => {
        expect(previousPeriod('FY26/27-Q1')?.period).toBe('FY25/26-Q4');
        expect(nextPeriod('FY26/27-Q4')?.period).toBe('FY27/28-Q1');
        expect(nextPeriod('FY26/27-Q4')?.periodStart).toBe('2027-07-01');
    });

    it('accept an info object and reject rubbish', () => {
        const q1 = parsePeriod('FY26/27-Q1')!;
        expect(nextPeriod(q1)?.period).toBe('FY26/27-Q2');
        expect(previousPeriod('nope')).toBeNull();
        expect(nextPeriod('nope')).toBeNull();
    });

    it('walking four steps forward then back lands on the start', () => {
        let p = parsePeriod('FY26/27-Q2')!;
        for (let i = 0; i < 4; i++) p = nextPeriod(p)!;
        expect(p.period).toBe('FY27/28-Q2');
        for (let i = 0; i < 4; i++) p = previousPeriod(p)!;
        expect(p.period).toBe('FY26/27-Q2');
    });
});

describe('periodsInFy', () => {
    it('lists the four quarters in order', () => {
        expect(periodsInFy('FY26/27')?.map((p) => p.period)).toEqual([
            'FY26/27-Q1', 'FY26/27-Q2', 'FY26/27-Q3', 'FY26/27-Q4',
        ]);
        expect(periodsInFy('x')).toBeNull();
    });
});
