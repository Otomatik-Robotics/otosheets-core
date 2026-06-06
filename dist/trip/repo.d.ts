import { IDdb } from '../ddbPort';
import { Trip } from './schema';
import { PaginatedResult } from '../types';
export declare class TripRepo {
    private ddb;
    constructor(ddb: IDdb);
    getTrip(orgId: string, userId: string, tripId: string): Promise<Trip | null>;
    findTripByIdInOrg(orgId: string, tripId: string): Promise<{
        trip: Trip;
        ownerId: string;
    } | null>;
    listAllOrgTrips(orgId: string): Promise<Trip[]>;
    listOrgTripsPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        search?: string;
        purpose?: string;
        dateFrom?: string;
        dateTo?: string;
    }): Promise<PaginatedResult<Trip>>;
    listUserTrips(orgId: string, userId: string): Promise<Trip[]>;
    listTripsByDate(orgId: string, from: string, to: string): Promise<Trip[]>;
    createTrip(orgId: string, userId: string, tripId: string, data: Record<string, any>): Promise<void>;
    deleteTrip(orgId: string, userId: string, tripId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map