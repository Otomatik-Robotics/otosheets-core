import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { BookingPgRepo } from './repo.pg';

let db: PgDb;
let repo: BookingPgRepo;
let pglite: PGlite;

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
    repo = new BookingPgRepo(db);
});

/**
 * The address columns landed in 0038 so a booking taken by phone, website chat
 * or DM can hold somewhere to actually go — `suburb` used to be the whole
 * location record. These assert the round trip end to end (migration → Drizzle
 * column → DTO), because a missing column here fails silently: `dtoToRow` maps
 * by key, so an unmapped field is simply dropped on the way in.
 */
describe('BookingPgRepo — address', () => {
    it('round-trips a verified address with coordinates', async () => {
        await repo.createBooking('org_1', 'user_1', 'b1', {
            date: '2026-08-06', startTime: '14:30', endTime: '15:30',
            clientName: 'Priya Raman', serviceType: 'Quote visit', status: 'CONFIRMED',
            source: 'voice_agent',
            address: '14 Marion St, Leichhardt NSW 2040, Australia',
            lat: -33.8836, lng: 151.1553,
            addressStatus: 'verified',
        });

        const got = await repo.getBooking('org_1', 'user_1', 'b1');
        expect(got?.address).toBe('14 Marion St, Leichhardt NSW 2040, Australia');
        expect(got?.lat).toBeCloseTo(-33.8836, 4);
        expect(got?.lng).toBeCloseTo(151.1553, 4);
        expect(got?.addressStatus).toBe('verified');
    });

    it('keeps a booking with no address at all — the status reads as never-looked-up', async () => {
        await repo.createBooking('org_1', 'user_1', 'b2', {
            date: '2026-08-07', startTime: '09:00', endTime: '10:00',
            clientName: 'Tom Nguyen', status: 'CONFIRMED', source: 'manual',
        });
        const got = await repo.getBooking('org_1', 'user_1', 'b2');
        expect(got?.address).toBeUndefined();
        expect(got?.addressStatus).toBeUndefined();
    });

    it('a later lookup can upgrade an unresolved address in place', async () => {
        await repo.createBooking('org_1', 'user_1', 'b3', {
            date: '2026-08-08', startTime: '11:00', endTime: '12:00',
            clientName: 'Jo Byrne', status: 'CONFIRMED', source: 'website_agent',
            address: '14 marrion st leichardt', addressStatus: 'not_found',
        });
        await repo.updateBooking('org_1', 'user_1', 'b3', {
            address: '14 Marion St, Leichhardt NSW 2040, Australia',
            lat: -33.8836, lng: 151.1553, addressStatus: 'verified',
        } as any);

        const got = await repo.getBooking('org_1', 'user_1', 'b3');
        expect(got?.addressStatus).toBe('verified');
        expect(got?.lat).toBeCloseTo(-33.8836, 4);
    });
});
