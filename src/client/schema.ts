import { z } from 'zod';

export const ClientBaseSchema = z.object({
    clientId: z.string(),
    name: z.string(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    abn: z.string().nullish(),
    address: z.string().nullish(),
    contactPerson: z.string().nullish(),
    convertedFromLeadId: z.string().nullish(),
    convertedAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ClientBase = z.infer<typeof ClientBaseSchema>;

export const ClientStoredSchema = ClientBaseSchema.extend({
    orgId: z.string(),
    createdBy: z.string(),
});
export type Client = z.infer<typeof ClientStoredSchema>;

export const ClientCreateRequestSchema = z.object({
    name: z.string(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    abn: z.string().nullish(),
    address: z.string().nullish(),
    contactPerson: z.string().nullish(),
});
export type ClientCreateRequest = z.infer<typeof ClientCreateRequestSchema>;
