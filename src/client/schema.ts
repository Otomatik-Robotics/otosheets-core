import { z } from 'zod';

export const ClientStoredSchema = z.object({
    orgId: z.string(),
    clientId: z.string(),
    createdBy: z.string(),
    name: z.string(),
    email: z.string().nullish(),
    abn: z.string().nullish(),
    address: z.string().nullish(),
    contactPerson: z.string().nullish(),
    convertedFromLeadId: z.string().nullish(),
    convertedAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Client = z.infer<typeof ClientStoredSchema>;

export const ClientCreateRequestSchema = z.object({
    name: z.string(),
    email: z.string().nullish(),
    abn: z.string().nullish(),
    address: z.string().nullish(),
    contactPerson: z.string().nullish(),
});
export type ClientCreateRequest = z.infer<typeof ClientCreateRequestSchema>;
