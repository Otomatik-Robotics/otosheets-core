import { z } from 'zod';

export const ClientContactSchema = z.object({
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    isPrimary: z.boolean().optional(),
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
    contacts: z.array(ClientContactSchema).nullish(),
    /** @deprecated Use contacts array instead */
    contact: ClientContactSchema.nullish(),
    /** @deprecated Use contacts array instead */
    contactPerson: z.string().nullish(),
    convertedFromLeadId: z.string().nullish(),
    convertedAt: z.string().nullish(),
    paymentLinkUsageCount: z.number().optional(),
    archived: z.boolean().nullish(),
    archivedAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ClientBase = z.infer<typeof ClientBaseSchema>;

export const ClientStoredSchema = ClientBaseSchema.extend({
    orgId: z.string(),
    businessProfileId: z.string().nullish(),   // profile scope
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
    contacts: z.array(ClientContactSchema).nullish(),
    /** @deprecated Use contacts array instead */
    contact: ClientContactSchema.nullish(),
    /** @deprecated Use contacts array instead */
    contactPerson: z.string().nullish(),
});
export type ClientCreateRequest = z.infer<typeof ClientCreateRequestSchema>;

/** Returns the primary contact from a client's contacts array, with fallback to legacy `contact` field. */
export function getPrimaryContact(client: { contacts?: ClientContact[] | null; contact?: ClientContact | null }): ClientContact | null {
    if (client.contacts?.length) {
        return client.contacts.find(c => c.isPrimary) ?? client.contacts[0] ?? null;
    }
    return client.contact ?? null;
}

/** Returns the email to use for a client — primary contact email for companies, top-level email for individuals. */
export function getClientEmail(client: { isCompany?: boolean | null; email?: string | null; contacts?: ClientContact[] | null; contact?: ClientContact | null }): string | null {
    if (client.isCompany) {
        const primary = getPrimaryContact(client);
        return primary?.email ?? null;
    }
    return client.email ?? null;
}

/** Returns the phone to use for a client — primary contact phone for companies, top-level phone for individuals. */
export function getClientPhone(client: { isCompany?: boolean | null; phone?: string | null; contacts?: ClientContact[] | null; contact?: ClientContact | null }): string | null {
    if (client.isCompany) {
        const primary = getPrimaryContact(client);
        return primary?.phone ?? null;
    }
    return client.phone ?? null;
}
