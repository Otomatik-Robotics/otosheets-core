import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from './migrate';
import type { PgDb } from './client';
import { UserPgRepo } from '../user/repo.pg';
import { OrgPgRepo } from '../org/repo.pg';
import { MembershipPgRepo } from '../membership/repo.pg';
import { TeamPgRepo } from '../team/repo.pg';

let db: PgDb;
let pglite: PGlite;

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = {
        exec: async (statement: string) => {
            const res = await pglite.query(statement);
            return { rows: res.rows as any[] };
        },
    };
    const ran = await runMigrations(executor);
    expect(ran).toContain('0001_identity.sql');
    // Idempotent: second run applies nothing
    expect(await runMigrations(executor)).toEqual([]);
    db = drizzle(pglite) as unknown as PgDb;
});

describe('OrgPgRepo', () => {
    const repo = () => new OrgPgRepo(db);

    it('creates and reads an org with DTO-shaped output', async () => {
        await repo().createOrg('org_1', { name: 'Acme Plumbing', gstRegistered: true, taxRate: 10, seatLimit: 3 });
        const org = await repo().getOrg('org_1');
        expect(org).toMatchObject({
            orgId: 'org_1',
            name: 'Acme Plumbing',
            gstRegistered: true,
            taxRate: 10,               // NUMERIC comes back as a number
            seatLimit: 3,
            subscriptionTier: 'free',  // column default applied
            currency: 'AUD',
        });
        // ISO strings, not Date objects — DTO contract
        expect(typeof org!.createdAt).toBe('string');
        expect(org!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('updates and bumps updatedAt', async () => {
        const before = await repo().getOrg('org_1');
        await new Promise((r) => setTimeout(r, 5));
        await repo().updateOrg('org_1', { name: 'Acme Group', abn: '12345678901' });
        const after = await repo().getOrg('org_1');
        expect(after!.name).toBe('Acme Group');
        expect(after!.abn).toBe('12345678901');
        expect(Date.parse(after!.updatedAt)).toBeGreaterThan(Date.parse(before!.updatedAt));
    });

    it('finds by slug', async () => {
        await repo().updateOrg('org_1', { slug: 'acme' });
        expect((await repo().getOrgBySlug('acme'))?.orgId).toBe('org_1');
        expect(await repo().getOrgBySlug('nope')).toBeNull();
    });

    it('rejects unknown attributes loudly', async () => {
        await expect(repo().updateOrg('org_1', { notAColumn: 1 })).rejects.toThrow(/unknown attribute/);
    });

    describe('setBusinessProfileIdIfUnset — atomic active-profile claim', () => {
        it('first claim wins; a second concurrent claim loses and defers to the winner', async () => {
            await repo().createOrg('org_claim', { name: 'Claimant Co' });

            const first = await repo().setBusinessProfileIdIfUnset('org_claim', 'bp-A');
            expect(first).toEqual({ won: true, businessProfileId: 'bp-A' });

            // A racing caller that already minted its own candidate must not
            // overwrite the winner — it loses and gets told the winner's id.
            const second = await repo().setBusinessProfileIdIfUnset('org_claim', 'bp-B');
            expect(second).toEqual({ won: false, businessProfileId: 'bp-A' });

            expect((await repo().getOrg('org_claim'))?.businessProfileId).toBe('bp-A');
        });

        it('re-claiming with the same id is idempotent (still reports the winner)', async () => {
            await repo().createOrg('org_claim2', { name: 'Idempotent Co' });
            await repo().setBusinessProfileIdIfUnset('org_claim2', 'bp-X');
            const again = await repo().setBusinessProfileIdIfUnset('org_claim2', 'bp-X');
            expect(again).toEqual({ won: false, businessProfileId: 'bp-X' });
        });
    });
});

describe('UserPgRepo', () => {
    const repo = () => new UserPgRepo(db);

    it('creates, reads by id/email/slug, deletes', async () => {
        await repo().createUser('user_1', {
            email: 'leon@example.com', fullName: 'Leon T', slug: 'leon',
            categoryRules: { fuel: 'VEHICLE' },
        });
        expect((await repo().getUser('user_1'))?.fullName).toBe('Leon T');
        expect((await repo().getUserByEmail('leon@example.com'))?.userId).toBe('user_1');
        expect((await repo().getUserBySlug('leon'))?.userId).toBe('user_1');
        expect((await repo().getUser('user_1'))?.categoryRules).toEqual({ fuel: 'VEHICLE' }); // jsonb round-trip

        await repo().deleteUser('user_1');
        expect(await repo().getUser('user_1')).toBeNull();
    });

    it('upsert is last-writer-wins on updatedAt', async () => {
        await repo().createUser('user_lww', { email: 'lww@example.com', fullName: 'Original' });
        const current = await repo().getUser('user_lww');

        // A stale mirror copy must not clobber the fresher row
        await repo().upsertUser({
            ...current!, fullName: 'Stale Copy',
            updatedAt: new Date(Date.parse(current!.updatedAt) - 60_000).toISOString(),
        });
        expect((await repo().getUser('user_lww'))?.fullName).toBe('Original');

        // A fresher copy wins
        await repo().upsertUser({
            ...current!, fullName: 'Fresh Copy',
            updatedAt: new Date(Date.parse(current!.updatedAt) + 60_000).toISOString(),
        });
        expect((await repo().getUser('user_lww'))?.fullName).toBe('Fresh Copy');
    });
});

describe('MembershipPgRepo', () => {
    const repo = () => new MembershipPgRepo(db);

    it('CRUD + list + invite token lookup', async () => {
        await repo().createMembership('org_1', 'user_a', { membershipId: 'm_1', role: 'owner', status: 'ACTIVE' });
        await repo().createMembership('org_1', 'invite_b', {
            membershipId: 'm_2', role: 'member', inviteToken: 'tok_123', inviteEmail: 'b@example.com',
        });

        expect((await repo().getMembership('org_1', 'user_a'))?.role).toBe('owner');
        expect(await repo().listOrgMembers('org_1')).toHaveLength(2);
        expect(await repo().listUserOrgs('user_a')).toHaveLength(1);
        expect((await repo().getByInviteToken('tok_123'))?.inviteEmail).toBe('b@example.com');

        await repo().updateMembership('org_1', 'invite_b', { status: 'ACTIVE', inviteToken: null });
        expect((await repo().getMembership('org_1', 'invite_b'))?.status).toBe('ACTIVE');
        expect(await repo().getByInviteToken('tok_123')).toBeNull();

        await repo().deleteMembership('org_1', 'invite_b');
        expect(await repo().listOrgMembers('org_1')).toHaveLength(1);
    });
});

describe('TeamPgRepo', () => {
    const repo = () => new TeamPgRepo(db);

    it('memberIds round-trip through the junction table', async () => {
        await repo().createTeam('org_1', 'team_1', { name: 'Crew A', memberIds: ['m_1', 'm_2'], createdBy: 'user_a' });
        const team = await repo().getTeam('org_1', 'team_1');
        expect(team?.memberIds).toEqual(['m_1', 'm_2']);

        await repo().updateTeam('org_1', 'team_1', { name: 'Crew Alpha', memberIds: ['m_2', 'm_3'] });
        const updated = await repo().getTeam('org_1', 'team_1');
        expect(updated?.name).toBe('Crew Alpha');
        expect(updated?.memberIds).toEqual(['m_2', 'm_3']);

        const all = await repo().listTeams('org_1');
        expect(all).toHaveLength(1);
        expect(all[0].memberIds).toEqual(['m_2', 'm_3']);

        await repo().deleteTeam('org_1', 'team_1');
        expect(await repo().getTeam('org_1', 'team_1')).toBeNull();
    });
});
