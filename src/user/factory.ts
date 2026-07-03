import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { User } from './schema';
import { UserDynamoRepo, type IUserRepo } from './repo';
import { UserPgRepo } from './repo.pg';

const DOMAIN = 'identity' as const;
const ENTITY = 'user';

/**
 * State-machine router (plan §6.1): resolves the identity domain's backend
 * per call, so SSM flag flips take effect without a deploy. Mirror writes are
 * full-entity upserts from a fresh primary read and never fail the request.
 */
export class RoutingUserRepo implements IUserRepo {
    constructor(private dynamo: IUserRepo, private pg: IUserRepo) {}

    private pick(route: Route): IUserRepo {
        return route.primary === 'dynamo' ? this.dynamo : this.pg;
    }

    private mirrorOf(route: Route): IUserRepo | undefined {
        if (!route.mirror) return undefined;
        return route.mirror === 'dynamo' ? this.dynamo : this.pg;
    }

    private async mirrorEntity(route: Route, userId: string, op: string): Promise<void> {
        const mirror = this.mirrorOf(route);
        if (!mirror) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { userId } }, async () => {
            const fresh = await this.pick(route).getUser(userId);
            if (fresh) await mirror.upsertUser(fresh);
        });
    }

    async getUser(userId: string): Promise<User | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getUser(userId);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getUser' }, result, () => this.pg.getUser(userId));
        }
        return result;
    }

    async getUserByEmail(email: string): Promise<User | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getUserByEmail(email);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getUserByEmail' }, result, () => this.pg.getUserByEmail(email));
        }
        return result;
    }

    async getUserBySlug(slug: string): Promise<User | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getUserBySlug(slug);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getUserBySlug' }, result, () => this.pg.getUserBySlug(slug));
        }
        return result;
    }

    async createUser(userId: string, data: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).createUser(userId, data);
        await this.mirrorEntity(route, userId, 'createUser');
    }

    async updateUser(userId: string, updates: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).updateUser(userId, updates);
        await this.mirrorEntity(route, userId, 'updateUser');
    }

    async deleteUser(userId: string): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).deleteUser(userId);
        const mirror = this.mirrorOf(route);
        if (mirror) {
            await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteUser', key: { userId } }, () => mirror.deleteUser(userId));
        }
    }

    async upsertUser(user: User): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).upsertUser(user);
        const mirror = this.mirrorOf(route);
        if (mirror) {
            await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertUser', key: { userId: user.userId } }, () => mirror.upsertUser(user));
        }
    }
}

/**
 * Drop-in continuation of the historical class: `new UserRepo(ddb)` keeps its
 * name and constructor signature everywhere (plan §5.3) but now routes per
 * the identity cutover flag. Behaviour is byte-identical while the flag is
 * 'dynamo' (the default).
 */
export class UserRepo extends RoutingUserRepo {
    constructor(dynamoDb: IDdb) {
        super(new UserDynamoRepo(dynamoDb), new UserPgRepo());
    }
}

let singleton: IUserRepo | undefined;

/** Preferred accessor — handlers get flag-routed behaviour transparently. */
export function getUserRepo(): IUserRepo {
    if (!singleton) singleton = new UserRepo(ddb);
    return singleton;
}
