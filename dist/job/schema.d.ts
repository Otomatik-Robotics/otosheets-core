import { z } from 'zod';
export declare const JobMaterialSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    quantity: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    unitCost: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    id: string;
    quantity?: number | null | undefined;
    unitCost?: number | null | undefined;
}, {
    name: string;
    id: string;
    quantity?: number | null | undefined;
    unitCost?: number | null | undefined;
}>;
export type JobMaterial = z.infer<typeof JobMaterialSchema>;
export declare const JobPhotoSchema: z.ZodObject<{
    id: z.ZodString;
    s3Key: z.ZodString;
    phase: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    createdAt: string;
    id: string;
    s3Key: string;
    phase?: string | null | undefined;
}, {
    createdAt: string;
    id: string;
    s3Key: string;
    phase?: string | null | undefined;
}>;
export type JobPhoto = z.infer<typeof JobPhotoSchema>;
export declare const JobBaseSchema: z.ZodObject<{
    jobId: z.ZodString;
    clientId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodDefault<z.ZodString>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    lat: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    lng: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    scheduledDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    scheduledTime: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    estimatedDuration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    assignedMembers: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    assignedTeams: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    scope: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    jobType: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    leadId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    geofence: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    materials: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        quantity: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        unitCost: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }, {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }>, "many">>;
    photos: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        s3Key: z.ZodString;
        phase: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }, {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }>, "many">>;
    startedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    completedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    signatureKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    handoverNotes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    handoverToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    locationPings: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: string;
    createdAt: string;
    updatedAt: string;
    jobId: string;
    title: string;
    materials: {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }[];
    photos: {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }[];
    scope?: string | null | undefined;
    description?: string | null | undefined;
    clientId?: string | null | undefined;
    address?: string | null | undefined;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    scheduledDate?: string | null | undefined;
    scheduledTime?: string | null | undefined;
    estimatedDuration?: number | null | undefined;
    assignedMembers?: string[] | null | undefined;
    assignedTeams?: string[] | null | undefined;
    jobType?: string | null | undefined;
    leadId?: string | null | undefined;
    geofence?: any;
    startedAt?: string | null | undefined;
    completedAt?: string | null | undefined;
    signatureKey?: string | null | undefined;
    handoverNotes?: string | null | undefined;
    handoverToken?: string | null | undefined;
    locationPings?: any;
}, {
    createdAt: string;
    updatedAt: string;
    jobId: string;
    title: string;
    status?: string | undefined;
    scope?: string | null | undefined;
    description?: string | null | undefined;
    clientId?: string | null | undefined;
    address?: string | null | undefined;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    scheduledDate?: string | null | undefined;
    scheduledTime?: string | null | undefined;
    estimatedDuration?: number | null | undefined;
    assignedMembers?: string[] | null | undefined;
    assignedTeams?: string[] | null | undefined;
    jobType?: string | null | undefined;
    leadId?: string | null | undefined;
    geofence?: any;
    materials?: {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }[] | undefined;
    photos?: {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }[] | undefined;
    startedAt?: string | null | undefined;
    completedAt?: string | null | undefined;
    signatureKey?: string | null | undefined;
    handoverNotes?: string | null | undefined;
    handoverToken?: string | null | undefined;
    locationPings?: any;
}>;
export type JobBase = z.infer<typeof JobBaseSchema>;
export declare const JobStoredSchema: z.ZodObject<{
    jobId: z.ZodString;
    clientId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodDefault<z.ZodString>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    lat: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    lng: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    scheduledDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    scheduledTime: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    estimatedDuration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    assignedMembers: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    assignedTeams: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    scope: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    jobType: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    leadId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    geofence: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    materials: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        quantity: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        unitCost: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }, {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }>, "many">>;
    photos: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        s3Key: z.ZodString;
        phase: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }, {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }>, "many">>;
    startedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    completedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    signatureKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    handoverNotes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    handoverToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    locationPings: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
} & {
    orgId: z.ZodString;
    sk: z.ZodString;
    createdBy: z.ZodString;
    scheduledDateSk: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    sk: string;
    jobId: string;
    title: string;
    materials: {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }[];
    photos: {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }[];
    scope?: string | null | undefined;
    description?: string | null | undefined;
    clientId?: string | null | undefined;
    address?: string | null | undefined;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    scheduledDate?: string | null | undefined;
    scheduledTime?: string | null | undefined;
    estimatedDuration?: number | null | undefined;
    assignedMembers?: string[] | null | undefined;
    assignedTeams?: string[] | null | undefined;
    jobType?: string | null | undefined;
    leadId?: string | null | undefined;
    geofence?: any;
    startedAt?: string | null | undefined;
    completedAt?: string | null | undefined;
    signatureKey?: string | null | undefined;
    handoverNotes?: string | null | undefined;
    handoverToken?: string | null | undefined;
    locationPings?: any;
    scheduledDateSk?: string | null | undefined;
}, {
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    sk: string;
    jobId: string;
    title: string;
    status?: string | undefined;
    scope?: string | null | undefined;
    description?: string | null | undefined;
    clientId?: string | null | undefined;
    address?: string | null | undefined;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    scheduledDate?: string | null | undefined;
    scheduledTime?: string | null | undefined;
    estimatedDuration?: number | null | undefined;
    assignedMembers?: string[] | null | undefined;
    assignedTeams?: string[] | null | undefined;
    jobType?: string | null | undefined;
    leadId?: string | null | undefined;
    geofence?: any;
    materials?: {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }[] | undefined;
    photos?: {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }[] | undefined;
    startedAt?: string | null | undefined;
    completedAt?: string | null | undefined;
    signatureKey?: string | null | undefined;
    handoverNotes?: string | null | undefined;
    handoverToken?: string | null | undefined;
    locationPings?: any;
    scheduledDateSk?: string | null | undefined;
}>;
export type Job = z.infer<typeof JobStoredSchema>;
export declare const JobCreateRequestSchema: z.ZodObject<{
    title: z.ZodString;
    clientId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    lat: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    lng: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    scheduledDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    scheduledTime: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    estimatedDuration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    assignedMembers: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    assignedTeams: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    scope: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    jobType: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    leadId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    geofence: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    materials: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        quantity: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        unitCost: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }, {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }>, "many">>;
    photos: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        s3Key: z.ZodString;
        phase: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }, {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    title: string;
    status?: string | undefined;
    scope?: string | null | undefined;
    description?: string | null | undefined;
    clientId?: string | null | undefined;
    address?: string | null | undefined;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    scheduledDate?: string | null | undefined;
    scheduledTime?: string | null | undefined;
    estimatedDuration?: number | null | undefined;
    assignedMembers?: string[] | null | undefined;
    assignedTeams?: string[] | null | undefined;
    jobType?: string | null | undefined;
    leadId?: string | null | undefined;
    geofence?: any;
    materials?: {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }[] | undefined;
    photos?: {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }[] | undefined;
}, {
    title: string;
    status?: string | undefined;
    scope?: string | null | undefined;
    description?: string | null | undefined;
    clientId?: string | null | undefined;
    address?: string | null | undefined;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    scheduledDate?: string | null | undefined;
    scheduledTime?: string | null | undefined;
    estimatedDuration?: number | null | undefined;
    assignedMembers?: string[] | null | undefined;
    assignedTeams?: string[] | null | undefined;
    jobType?: string | null | undefined;
    leadId?: string | null | undefined;
    geofence?: any;
    materials?: {
        name: string;
        id: string;
        quantity?: number | null | undefined;
        unitCost?: number | null | undefined;
    }[] | undefined;
    photos?: {
        createdAt: string;
        id: string;
        s3Key: string;
        phase?: string | null | undefined;
    }[] | undefined;
}>;
export type JobCreateRequest = z.infer<typeof JobCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map