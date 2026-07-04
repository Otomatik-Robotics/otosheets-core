import { and, eq, sql, desc, inArray, lt, or } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { clients, clientContacts } from '../pg/schema/billingCore';
import { toRow, fromRow } from '../pg/rows';
import { keysetFromStartKey, keysetStartKey } from '../pg/cursor';
import { PaginatedResult } from '../types';
import { Client, ClientContact } from './schema';
import type { IClientRepo } from './repo';

const NUMERIC_KEYS: string[] = []; // paymentLinkUsageCount is integer (already number)

/** Contacts live in a child table; the DTO carries them as an ordered array. */
export class ClientPgRepo implements IClientRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    private async contactsByClient(clientIds: string[]): Promise<Map<string, ClientContact[]>> {
        const map = new Map<string, ClientContact[]>();
        if (clientIds.length === 0) return map;
        const rows = await this.db.select().from(clientContacts)
            .where(inArray(clientContacts.clientId, clientIds))
            .orderBy(clientContacts.sortOrder);
        for (const r of rows as any[]) {
            const list = map.get(r.clientId) ?? [];
            const c: ClientContact = {};
            if (r.firstName != null) c.firstName = r.firstName;
            if (r.lastName != null) c.lastName = r.lastName;
            if (r.email != null) c.email = r.email;
            if (r.phone != null) c.phone = r.phone;
            if (r.isPrimary != null) c.isPrimary = r.isPrimary;
            list.push(c);
            map.set(r.clientId, list);
        }
        return map;
    }

    private async replaceContacts(clientId: string, contacts?: ClientContact[] | null): Promise<void> {
        await this.db.delete(clientContacts).where(eq(clientContacts.clientId, clientId));
        if (Array.isArray(contacts) && contacts.length > 0) {
            await this.db.insert(clientContacts).values(contacts.map((c, i) => ({
                contactId: `${clientId}#${i}`,
                clientId,
                firstName: c.firstName ?? null,
                lastName: c.lastName ?? null,
                email: c.email ?? null,
                phone: c.phone ?? null,
                isPrimary: c.isPrimary ?? null,
                sortOrder: i,
            })));
        }
    }

    private toClient(row: any, contacts: ClientContact[]): Client {
        const dto = fromRow<Client>(row, NUMERIC_KEYS);
        if (contacts.length > 0) (dto as any).contacts = contacts;
        return dto;
    }

    async getClient(orgId: string, clientId: string): Promise<Client | null> {
        const rows = await this.db.select().from(clients)
            .where(and(eq(clients.orgId, orgId), eq(clients.clientId, clientId))).limit(1);
        if (!rows[0]) return null;
        const contacts = (await this.contactsByClient([clientId])).get(clientId) ?? [];
        return this.toClient(rows[0], contacts);
    }

    async listClients(orgId: string): Promise<Client[]> {
        const rows = await this.db.select().from(clients).where(eq(clients.orgId, orgId));
        const contacts = await this.contactsByClient(rows.map((r: any) => r.clientId));
        return rows.map((r: any) => this.toClient(r, contacts.get(r.clientId) ?? []));
    }

    async listClientsPaginated(params: {
        orgId: string; limit?: number; exclusiveStartKey?: Record<string, any>;
        search?: string; dateFrom?: string; dateTo?: string;
    }): Promise<PaginatedResult<Client>> {
        const { orgId, limit = 20, exclusiveStartKey, search, dateFrom, dateTo } = params;
        const conds: any[] = [eq(clients.orgId, orgId)];
        if (search) {
            const like = `%${search}%`;
            conds.push(or(
                sql`${clients.name} ILIKE ${like}`,
                sql`${clients.email} ILIKE ${like}`,
                sql`${clients.abn} ILIKE ${like}`,
            ));
        }
        if (dateFrom) conds.push(sql`${clients.createdAt} >= ${new Date(dateFrom)}`);
        if (dateTo) conds.push(sql`${clients.createdAt} <= ${new Date(dateTo)}`);

        const cursor = keysetFromStartKey(exclusiveStartKey, 'clientId');
        if (cursor) {
            conds.push(or(
                lt(clients.createdAt, new Date(cursor.createdAt)),
                and(eq(clients.createdAt, new Date(cursor.createdAt)), lt(clients.clientId, cursor.id)),
            ));
        }

        const rows = await this.db.select().from(clients)
            .where(and(...conds))
            .orderBy(desc(clients.createdAt), desc(clients.clientId))
            .limit(limit);

        const contactsMap = await this.contactsByClient(rows.map((r: any) => r.clientId));
        const items = rows.map((r: any) => this.toClient(r, contactsMap.get(r.clientId) ?? []));
        const last = rows[rows.length - 1] as any;
        const lastEvaluatedKey = rows.length === limit && last
            ? keysetStartKey({ createdAt: (last.createdAt as Date).toISOString(), id: last.clientId })
            : undefined;
        return { items, lastEvaluatedKey };
    }

    async findClientByEmail(orgId: string, email: string): Promise<Client | null> {
        const rows = await this.db.select().from(clients)
            .where(and(eq(clients.orgId, orgId), eq(clients.email, email.toLowerCase()))).limit(1);
        if (!rows[0]) return null;
        const contacts = (await this.contactsByClient([rows[0].clientId])).get(rows[0].clientId) ?? [];
        return this.toClient(rows[0], contacts);
    }

    async countClients(orgId: string): Promise<number> {
        const r = await this.db.select({ n: sql<number>`count(*)::int` }).from(clients).where(eq(clients.orgId, orgId));
        return r[0]?.n ?? 0;
    }

    async listClientEmails(orgId: string): Promise<Array<{ clientId: string; email: string; name: string }>> {
        const rows = await this.db.select({ clientId: clients.clientId, email: clients.email, name: clients.name })
            .from(clients).where(eq(clients.orgId, orgId));
        return (rows as any[]).filter(c => c.email).map(c => ({ clientId: c.clientId, email: c.email, name: c.name || '' }));
    }

    async createClient(orgId: string, clientId: string, data: Record<string, any>): Promise<void> {
        const now = new Date();
        const { contacts, ...rest } = data;
        await this.db.insert(clients).values({ ...toRow(clients, rest, 'client'), orgId, clientId, createdAt: now, updatedAt: now } as any);
        if (Array.isArray(contacts)) await this.replaceContacts(clientId, contacts);
    }

    async updateClient(orgId: string, clientId: string, updates: Record<string, any>): Promise<void> {
        const { contacts, ...rest } = updates;
        if (Object.keys(rest).length > 0) {
            await this.db.update(clients)
                .set({ ...toRow(clients, rest, 'client'), updatedAt: new Date() } as any)
                .where(and(eq(clients.orgId, orgId), eq(clients.clientId, clientId)));
        }
        if (contacts !== undefined) await this.replaceContacts(clientId, contacts);
    }

    async batchGetClients(orgId: string, clientIds: string[]): Promise<Client[]> {
        if (clientIds.length === 0) return [];
        const rows = await this.db.select().from(clients)
            .where(and(eq(clients.orgId, orgId), inArray(clients.clientId, clientIds)));
        const contacts = await this.contactsByClient(rows.map((r: any) => r.clientId));
        return rows.map((r: any) => this.toClient(r, contacts.get(r.clientId) ?? []));
    }

    async deleteClient(orgId: string, clientId: string): Promise<void> {
        await this.db.delete(clients).where(and(eq(clients.orgId, orgId), eq(clients.clientId, clientId)));
    }

    async incrementPaymentLinkUsage(orgId: string, clientId: string): Promise<void> {
        await this.db.update(clients)
            .set({ paymentLinkUsageCount: sql`coalesce(${clients.paymentLinkUsageCount}, 0) + 1` })
            .where(and(eq(clients.orgId, orgId), eq(clients.clientId, clientId)));
    }

    async getTopByUsage(orgId: string, limit = 3): Promise<Client[]> {
        const rows = await this.db.select().from(clients)
            .where(eq(clients.orgId, orgId))
            .orderBy(sql`${clients.paymentLinkUsageCount} DESC NULLS LAST`)
            .limit(limit);
        const contacts = await this.contactsByClient(rows.map((r: any) => r.clientId));
        return rows.map((r: any) => this.toClient(r, contacts.get(r.clientId) ?? []));
    }

    /** Full-entity mirror upsert — last-writer-wins on updatedAt (§6.1). */
    async upsertClient(client: Client): Promise<void> {
        const { contacts, ...rest } = client as Record<string, any>;
        const row = toRow(clients, rest, 'client');
        await this.db.insert(clients).values(row as any)
            .onConflictDoUpdate({ target: clients.clientId, set: row as any, setWhere: sql`${clients.updatedAt} <= excluded.updated_at` });
        await this.replaceContacts(client.clientId, (contacts as ClientContact[]) ?? []);
    }
}
