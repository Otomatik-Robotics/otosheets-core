import { IDdb } from '../ddbPort';
import { Trip } from './schema';
export declare class TripRepo {
    private ddb;
    constructor(ddb: IDdb);
    getTrip(orgId: string, userId: string, tripId: string): Promise<Trip | null>;
    listAllOrgTrips(orgId: string): Promise<Trip[]>;
    listUserTrips(orgId: string, userId: string): Promise<Trip[]>;
    listTripsByDate(orgId: string, from: string, to: string): Promise<Trip[]>;
    createTrip(orgId: string, userId: string, tripId: string, data: Record<string, any>): Promise<void>;
    deleteTrip(orgId: string, userId: string, tripId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map