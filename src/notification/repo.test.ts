import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NotificationPgRepo } from './repo.pg';
import { NotificationDynamoRepo } from './repo.dynamo';
import { NotificationRepo } from './repo';
import { notificationStorageMode, resetNotificationStorageCache } from './storage';
import { setPgForTesting } from '../pg/client';
import { splitStatements } from '../pg/migrate';
import type { IDdb } from '../ddbPort';
import type { Notification } from './schema';

const ssm = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-ssm', () => ({ SSMClient: class { send = ssm.send; }, GetParameterCommand: class { constructor(public input: unknown) {} } }));
const pg = new PGlite();
const db = drizzle(pg);
const repo = new NotificationPgRepo(db);
const content = { type: 'email_received', title: 'Reply', body: 'New reply', meta: { invoiceId: 'i1' } };
beforeAll(async () => {
    const statements = splitStatements(readFileSync(resolve('drizzle/0058_notifications.sql'), 'utf8'));
    // Exercise partial/repeated migration recovery against real Postgres semantics.
    for (let i = 0; i < 2; i++) for (const statement of statements) await pg.exec(statement);
    setPgForTesting(db);
});
afterEach(async () => {
    vi.unstubAllEnvs(); vi.restoreAllMocks(); resetNotificationStorageCache(); ssm.send.mockReset();
    await pg.exec('DELETE FROM notifications');
});
afterAll(async () => { setPgForTesting(undefined); await pg.close(); });

describe('Postgres notifications', () => {
    it('preserves original read state and content on concurrent/repeated creates', async () => {
        await Promise.all(Array.from({ length: 5 }, () => repo.createNotificationOnce('u1', 'n1', content)));
        const original = await repo.getNotification('u1', 'n1');
        await repo.markRead('u1', 'n1');
        await repo.createNotification('u1', 'n1', { ...content, title: 'Changed' });
        expect(await repo.getNotification('u1', 'n1')).toEqual({ ...original, read: true });
        expect(await repo.listNotifications('u1')).toHaveLength(1);
    });
    it('cannot replace caller scope using data fields or mutate another recipient', async () => {
        await repo.createNotification('u1', 'n1', { ...content, userId: 'u2', notificationId: 'n2', read: true, ttl: 0 });
        expect(await repo.getNotification('u2', 'n1')).toBeNull();
        await repo.markRead('u2', 'n1');
        await repo.deleteNotification('u2', 'n1');
        expect(await repo.getNotification('u1', 'n1')).toMatchObject({ userId: 'u1', notificationId: 'n1', read: false });
        expect(await repo.listNotifications('u2')).toEqual([]);
    });
    it('pages by descending ID without duplicates and binds tokens to recipient', async () => {
        for (const id of ['a', 'b', 'c']) await repo.createNotification('u1', id, content);
        const first = await repo.listNotificationsPage('u1', { limit: 2 });
        expect(first.items.map(n => n.notificationId)).toEqual(['c', 'b']);
        const second = await repo.listNotificationsPage('u1', { limit: 2, nextToken: first.nextToken });
        expect(second.items.map(n => n.notificationId)).toEqual(['a']);
        expect(second.nextToken).toBeUndefined();
        await expect(repo.listNotificationsPage('u2', { nextToken: first.nextToken })).rejects.toThrow('Invalid notification nextToken');
        await expect(repo.listNotificationsPage('u1', { limit: 201 })).rejects.toThrow();
        await expect(repo.listNotificationsPage('u1', { nextToken: '' })).rejects.toThrow();
    });
    it('preserves sparse legacy attributes and never overwrites a target during backfill', async () => {
        const legacy = { ...content, userId: 'u1', notificationId: 'n1', read: false, createdAt: '2026-01-01', extra: 'legacy', organizationId: null } as Notification;
        await repo.importNotification(legacy);
        expect(await repo.getNotification('u1', 'n1')).toEqual(legacy);
        await repo.markRead('u1', 'n1');
        await repo.importNotification(legacy);
        expect(await repo.getNotification('u1', 'n1')).toEqual({ ...legacy, read: true });
    });
    it('hides expired rows immediately and cleans only bounded batches', async () => {
        const base = { ...content, userId: 'u1', read: false, createdAt: '2026-01-01' };
        const now = Math.floor(Date.now() / 1000);
        for (const [notificationId, ttl] of [['a', now - 1], ['b', now], ['c', now + 1000]] as const) {
            await repo.importNotification({ ...base, notificationId, ttl });
        }
        await repo.importNotification({ ...base, notificationId: 'd' });
        expect(await repo.getNotification('u1', 'a')).toBeNull();
        expect((await repo.listNotifications('u1')).map(n => n.notificationId)).toEqual(['d', 'c']);
        expect(await repo.deleteExpired(1)).toBe(1);
        expect(await repo.deleteExpired(1)).toBe(1);
        expect(await repo.deleteExpired(1)).toBe(0);
        expect((await pg.query('SELECT * FROM notifications')).rows).toHaveLength(2);
    });
});

describe('routing and Dynamo compatibility', () => {
    it('defaults to Dynamo, uses Pg without Dynamo access and blocks maintenance', async () => {
        vi.stubEnv('DATA_BACKEND_SSM_PREFIX', '');
        const getItem = vi.fn().mockResolvedValue({ Item: { userId: 'u1', notificationId: 'n1' } });
        const routed = new NotificationRepo({ getItem } as unknown as IDdb);
        expect(await routed.getNotification('u1', 'n1')).toMatchObject({ userId: 'u1' });
        vi.stubEnv('DATA_BACKEND_NOTIFICATIONS', 'pg');
        await routed.createNotificationOnce('u1', 'n2', content);
        expect(await routed.getNotification('u1', 'n2')).toMatchObject(content);
        expect(getItem).toHaveBeenCalledTimes(1);
        vi.stubEnv('DATA_BACKEND_NOTIFICATIONS', 'maintenance');
        await expect(routed.createNotificationOnce('u1', 'n3', content)).rejects.toThrow('migration');
        vi.stubEnv('DATA_BACKEND_NOTIFICATIONS', 'dual_pg');
        await expect(routed.getNotification('u1', 'n2')).rejects.toThrow('Invalid');
    });
    it('fails closed for SSM access/errors and invalid values; only missing flags default', async () => {
        vi.stubEnv('DATA_BACKEND_SSM_PREFIX', '/otosheets/dev/data-backend');
        ssm.send.mockRejectedValueOnce(Object.assign(new Error('Denied'), { name: 'AccessDeniedException' }));
        await expect(notificationStorageMode()).rejects.toThrow('Denied');
        ssm.send.mockResolvedValueOnce({ Parameter: { Value: 'dual_pg' } });
        await expect(notificationStorageMode()).rejects.toThrow('Invalid');
        ssm.send.mockRejectedValueOnce({ name: 'ParameterNotFound' });
        expect(await notificationStorageMode()).toBe('dynamo');
        resetNotificationStorageCache();
        ssm.send.mockResolvedValueOnce({ Parameter: { Value: 'pg' } });
        expect(await notificationStorageMode()).toBe('pg');
    });
    it('Dynamo create once protects keys and handles only duplicate conditions', async () => {
        const transactWrite = vi.fn().mockResolvedValue({});
        const dynamo = new NotificationDynamoRepo({ transactWrite } as unknown as IDdb);
        await dynamo.createNotificationOnce('u1', 'n1', { ...content, userId: 'other' });
        expect(transactWrite.mock.calls[0][0][0].Put).toMatchObject({ Item: { userId: 'u1' }, ConditionExpression: 'attribute_not_exists(notificationId)' });
        transactWrite.mockRejectedValueOnce({ name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
        await expect(dynamo.createNotificationOnce('u1', 'n1', content)).resolves.toBeUndefined();
        transactWrite.mockRejectedValueOnce(new Error('Unavailable'));
        await expect(dynamo.createNotificationOnce('u1', 'n1', content)).rejects.toThrow('Unavailable');
    });
    it('Dynamo page preserves a continuation even when expiry filters the entire page', async () => {
        const query = vi.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: { userId: 'u1', notificationId: 'n1' } });
        const dynamo = new NotificationDynamoRepo({ query } as unknown as IDdb);
        const page = await dynamo.listNotificationsPage('u1', { limit: 1 });
        expect(page.items).toEqual([]);
        expect(page.nextToken).toBeTruthy();
        await dynamo.listNotificationsPage('u1', { nextToken: page.nextToken });
        expect(query.mock.calls[1][0].ExclusiveStartKey).toEqual({ userId: 'u1', notificationId: 'n1' });
    });
});
