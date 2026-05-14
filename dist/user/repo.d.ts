import { IDdb } from '../ddbPort';
import { User } from './schema';
export declare class UserRepo {
    private ddb;
    constructor(ddb: IDdb);
    getUser(userId: string): Promise<User | null>;
    getUserByEmail(email: string): Promise<User | null>;
    getUserBySlug(slug: string): Promise<User | null>;
    createUser(userId: string, data: Record<string, any>): Promise<void>;
    updateUser(userId: string, updates: Record<string, any>): Promise<void>;
    deleteUser(userId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map