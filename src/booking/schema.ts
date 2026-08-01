import { z } from 'zod';
import { AddressStatusSchema } from '../address/schema';

export const BookingBaseSchema = z.object({
    bookingId: z.string(),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    clientName: z.string(),
    clientPhone: z.string().nullish(),
    clientEmail: z.string().nullish(),
    serviceType: z.string().nullish(),
    suburb: z.string().nullish(),
    // Where the appointment actually is. `suburb` alone was the entire location
    // record for every booking taken by phone, chat or DM — no street, no
    // coordinates, nothing dispatch could route on. `addressStatus` says whether
    // the place index confirmed it; see AddressStatusSchema for the states.
    address: z.string().nullish(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    addressStatus: AddressStatusSchema.nullish(),
    notes: z.string().nullish(),
    status: z.string().default('CONFIRMED'),
    source: z.string(),
    sourceName: z.string().nullish(),
    // Lead linkage — lets a cancelled booking resolve back to its originating
    // lead + pipeline (e.g. for voice rebooking). Nullish for manual/standalone
    // bookings and legacy records created before this field existed.
    leadId: z.string().nullish(),
    pipelineId: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type BookingBase = z.infer<typeof BookingBaseSchema>;

export const BookingStoredSchema = BookingBaseSchema.extend({
    orgId: z.string(),
    businessProfileId: z.string().nullish(),   // profile scope
    sk: z.string(),
    createdBy: z.string(),
    dateSk: z.string().nullish(),
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
    address: z.string().nullish(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    addressStatus: AddressStatusSchema.nullish(),
    notes: z.string().nullish(),
    source: z.string(),
    sourceName: z.string().nullish(),
    leadId: z.string().nullish(),
    pipelineId: z.string().nullish(),
});
export type BookingCreateRequest = z.infer<typeof BookingCreateRequestSchema>;
