import { z } from 'zod';

export const BookingStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    bookingId: z.string(),
    createdBy: z.string(),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    clientName: z.string(),
    clientPhone: z.string().nullish(),
    clientEmail: z.string().nullish(),
    serviceType: z.string().nullish(),
    suburb: z.string().nullish(),
    notes: z.string().nullish(),
    status: z.string().default('CONFIRMED'),
    source: z.string(),
    sourceName: z.string().nullish(),
    dateSk: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Booking = z.infer<typeof BookingStoredSchema>;

export const BookingCreateRequestSchema = z.object({
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    clientName: z.string(),
    clientPhone: z.string().nullish(),
    clientEmail: z.string().nullish(),
    serviceType: z.string().nullish(),
    suburb: z.string().nullish(),
    notes: z.string().nullish(),
    source: z.string(),
    sourceName: z.string().nullish(),
});
export type BookingCreateRequest = z.infer<typeof BookingCreateRequestSchema>;
