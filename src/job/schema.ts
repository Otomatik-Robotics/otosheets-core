import { z } from 'zod';

export const JobMaterialSchema = z.object({
    id: z.string(),
    name: z.string(),
    quantity: z.number().nullish(),
    unitCost: z.number().nullish(),
});
export type JobMaterial = z.infer<typeof JobMaterialSchema>;

export const JobPhotoSchema = z.object({
    id: z.string(),
    s3Key: z.string(),
    phase: z.string().nullish(),
    createdAt: z.string(),
});
export type JobPhoto = z.infer<typeof JobPhotoSchema>;

export const JobStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    jobId: z.string(),
    createdBy: z.string(),
    clientId: z.string().nullish(),
    title: z.string(),
    description: z.string().nullish(),
    status: z.string().default('SCHEDULED'),
    address: z.string().nullish(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    scheduledDate: z.string().nullish(),
    scheduledTime: z.string().nullish(),
    estimatedDuration: z.number().nullish(),
    assignedMembers: z.array(z.string()).nullish(),
    assignedTeams: z.array(z.string()).nullish(),
    scope: z.string().nullish(),
    jobType: z.string().nullish(),
    leadId: z.string().nullish(),
    geofence: z.any().nullish(),
    materials: z.array(JobMaterialSchema).default([]),
    photos: z.array(JobPhotoSchema).default([]),
    startedAt: z.string().nullish(),
    completedAt: z.string().nullish(),
    signatureKey: z.string().nullish(),
    handoverNotes: z.string().nullish(),
    handoverToken: z.string().nullish(),
    locationPings: z.any().nullish(),
    scheduledDateSk: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Job = z.infer<typeof JobStoredSchema>;

export const JobCreateRequestSchema = z.object({
    title: z.string(),
    clientId: z.string().nullish(),
    description: z.string().nullish(),
    status: z.string().optional(),
    address: z.string().nullish(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    scheduledDate: z.string().nullish(),
    scheduledTime: z.string().nullish(),
    estimatedDuration: z.number().nullish(),
    assignedMembers: z.array(z.string()).nullish(),
    assignedTeams: z.array(z.string()).nullish(),
    scope: z.string().nullish(),
    jobType: z.string().nullish(),
    leadId: z.string().nullish(),
    geofence: z.any().nullish(),
    materials: z.array(JobMaterialSchema).optional(),
    photos: z.array(JobPhotoSchema).optional(),
});
export type JobCreateRequest = z.infer<typeof JobCreateRequestSchema>;
