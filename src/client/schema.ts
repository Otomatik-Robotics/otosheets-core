import { z } from 'zod';

export const ClientContactSchema = z.object({
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
});
export type ClientContact = z.infer<typeof ClientContactSchema>;

export const ClientBaseSchema = z.object({
    clientId: z.string(),
    isCompany: z.boolean().nullish(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    name: z.string(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    abn: z.string().nullish(),
    address: z.string().nullish(),
    contact: ClientContactSchema.nullish(),
    /** @deprecated Use contact.firstName + contact.lastName instead */
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
    isCompany: z.boolean().nullish(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    name: z.string().nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    abn: z.string().nullish(),
    address: z.string().nullish(),
    contact: ClientContactSchema.nullish(),
    contactPerson: z.string().nullish(),
});
export type ClientCreateRequest = z.infer<typeof ClientCreateRequestSchema>;
