import { IDdb } from '../ddbPort';
import { Booking } from './schema';
import { PaginatedResult } from '../types';
export declare class BookingRepo {
    private ddb;
    constructor(ddb: IDdb);
    getBooking(orgId: string, userId: string, bookingId: string): Promise<Booking | null>;
    findBookingByIdInOrg(orgId: string, bookingId: string): Promise<{
        booking: Booking;
        ownerId: string;
    } | null>;
    listAllOrgBookings(orgId: string): Promise<Booking[]>;
    listOrgBookingsPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        status?: string;
    }): Promise<PaginatedResult<Booking>>;
    deleteBooking(orgId: string, userId: string, bookingId: string): Promise<void>;
    listBookingsByDate(orgId: string, from: string, to: string): Promise<Booking[]>;
    createBooking(orgId: string, userId: string, bookingId: string, data: Record<string, any>): Promise<void>;
    updateBooking(orgId: string, userId: string, bookingId: string, updates: Record<string, any>): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map