import { z } from 'zod';

export const TripBaseSchema = z.object({
    tripId: z.string(),
    startTime: z.string().nullish(),
    endTime: z.string().nullish(),
    startAddress: z.string().nullish(),
    endAddress: z.string().nullish(),
    distanceKm: z.number(),
    purpose: z.string().default('UNVERIFIED'),
    notes: z.string().nullish(),
    coordinates: z.any().nullish(),
    date: z.string(),
    jobId: z.string().nullish(),
    createdAt: z.string(),
});
export type TripBase = z.infer<typeof TripBaseSchema>;

export const TripStoredSchema = TripBaseSchema.extend({
    orgId: z.string(),
    sk: z.string(),
    createdBy: z.string(),
    dateSk: z.string().nullish(),
});
export type Trip = z.infer<typeof TripStoredSchema>;

export const TripCreateRequestSchema = z.object({
    startTime: z.string().nullish(),
    endTime: z.string().nullish(),
    startAddress: z.string().nullish(),
    endAddress: z.string().nullish(),
    distanceKm: z.number(),
    purpose: z.string().optional(),
    notes: z.string().nullish(),
    coordinates: z.any().nullish(),
    date: z.string(),
    jobId: z.string().nullish(),
});
export type TripCreateRequest = z.infer<typeof TripCreateRequestSchema>;
