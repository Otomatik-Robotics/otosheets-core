"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobCreateRequestSchema = exports.JobStoredSchema = exports.JobBaseSchema = exports.JobPhotoSchema = exports.JobMaterialSchema = void 0;
const zod_1 = require("zod");
exports.JobMaterialSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    quantity: zod_1.z.number().nullish(),
    unitCost: zod_1.z.number().nullish(),
});
exports.JobPhotoSchema = zod_1.z.object({
    id: zod_1.z.string(),
    s3Key: zod_1.z.string(),
    phase: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
});
exports.JobBaseSchema = zod_1.z.object({
    jobId: zod_1.z.string(),
    clientId: zod_1.z.string().nullish(),
    title: zod_1.z.string(),
    description: zod_1.z.string().nullish(),
    status: zod_1.z.string().default('SCHEDULED'),
    address: zod_1.z.string().nullish(),
    lat: zod_1.z.number().nullish(),
    lng: zod_1.z.number().nullish(),
    scheduledDate: zod_1.z.string().nullish(),
    scheduledTime: zod_1.z.string().nullish(),
    estimatedDuration: zod_1.z.number().nullish(),
    assignedMembers: zod_1.z.array(zod_1.z.string()).nullish(),
    assignedTeams: zod_1.z.array(zod_1.z.string()).nullish(),
    scope: zod_1.z.string().nullish(),
    jobType: zod_1.z.string().nullish(),
    leadId: zod_1.z.string().nullish(),
    geofence: zod_1.z.any().nullish(),
    materials: zod_1.z.array(exports.JobMaterialSchema).default([]),
    photos: zod_1.z.array(exports.JobPhotoSchema).default([]),
    startedAt: zod_1.z.string().nullish(),
    completedAt: zod_1.z.string().nullish(),
    signatureKey: zod_1.z.string().nullish(),
    handoverNotes: zod_1.z.string().nullish(),
    handoverToken: zod_1.z.string().nullish(),
    locationPings: zod_1.z.any().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.JobStoredSchema = exports.JobBaseSchema.extend({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    createdBy: zod_1.z.string(),
    scheduledDateSk: zod_1.z.string().nullish(),
});
exports.JobCreateRequestSchema = zod_1.z.object({
    title: zod_1.z.string(),
    clientId: zod_1.z.string().nullish(),
    description: zod_1.z.string().nullish(),
    status: zod_1.z.string().optional(),
    address: zod_1.z.string().nullish(),
    lat: zod_1.z.number().nullish(),
    lng: zod_1.z.number().nullish(),
    scheduledDate: zod_1.z.string().nullish(),
    scheduledTime: zod_1.z.string().nullish(),
    estimatedDuration: zod_1.z.number().nullish(),
    assignedMembers: zod_1.z.array(zod_1.z.string()).nullish(),
    assignedTeams: zod_1.z.array(zod_1.z.string()).nullish(),
    scope: zod_1.z.string().nullish(),
    jobType: zod_1.z.string().nullish(),
    leadId: zod_1.z.string().nullish(),
    geofence: zod_1.z.any().nullish(),
    materials: zod_1.z.array(exports.JobMaterialSchema).optional(),
    photos: zod_1.z.array(exports.JobPhotoSchema).optional(),
});
//# sourceMappingURL=schema.js.map