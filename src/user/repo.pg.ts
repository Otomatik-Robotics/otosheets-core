import { eq, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { users } from '../pg/schema/identity';
import { toRow, fromRow } from '../pg/rows';
import { User } from './schema';
import type { IUserRepo } from './repo';

export class UserPgRepo implements IUserRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    async getUser(userId: string): Promise<User | null> {
        const rows = await this.db.select().from(users).where(eq(users.userId, userId)).limit(1);
        return rows[0] ? fromRow<User>(rows[0]) : null;
    }

    async getUserByEmail(email: string): Promise<User | null> {
        const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
        return rows[0] ? fromRow<User>(rows[0]) : null;
    }

    async getUserBySlug(slug: string): Promise<User | null> {
        const rows = await this.db.select().from(users).where(eq(users.slug, slug)).limit(1);
        return rows[0] ? fromRow<User>(rows[0]) : null;
    }

    async createUser(userId: string, data: Record<string, any>): Promise<void> {
        const now = new Date();
        await this.db.insert(users).values({
            ...toRow(users, data, 'user'),
            userId,
            createdAt: now,
            updatedAt: now,
        } as any);
    }

    async updateUser(userId: string, updates: Record<string, any>): Promise<void> {
        await this.db.update(users)
            .set({ ...toRow(users, updates, 'user'), updatedAt: new Date() } as any)
            .where(eq(users.userId, userId));
    }

    async deleteUser(userId: string): Promise<void> {
        await this.db.delete(users).where(eq(users.userId, userId));
    }

    /** Full-entity mirror upsert — last-writer-wins on updatedAt (§6.1). */
    async upsertUser(user: User): Promise<void> {
        const row = toRow(users, user as Record<string, any>, 'user');
        await this.db.insert(users)
            .values(row as any)
            .onConflictDoUpdate({
                target: users.userId,
                set: row as any,
                setWhere: sql`${users.updatedAt} <= excluded.updated_at`,
            });
    }
}
