"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientCreateRequestSchema = exports.ClientStoredSchema = exports.ClientBaseSchema = exports.ClientContactSchema = void 0;
exports.getPrimaryContact = getPrimaryContact;
exports.getClientEmail = getClientEmail;
exports.getClientPhone = getClientPhone;
const zod_1 = require("zod");
exports.ClientContactSchema = zod_1.z.object({
    firstName: zod_1.z.string().nullish(),
    lastName: zod_1.z.string().nullish(),
    email: zod_1.z.string().nullish(),
    phone: zod_1.z.string().nullish(),
    isPrimary: zod_1.z.boolean().optional(),
});
exports.ClientBaseSchema = zod_1.z.object({
    clientId: zod_1.z.string(),
    isCompany: zod_1.z.boolean().nullish(),
    firstName: zod_1.z.string().nullish(),
    lastName: zod_1.z.string().nullish(),
    name: zod_1.z.string(),
    email: zod_1.z.string().nullish(),
    phone: zod_1.z.string().nullish(),
    abn: zod_1.z.string().nullish(),
    address: zod_1.z.string().nullish(),
    contacts: zod_1.z.array(exports.ClientContactSchema).nullish(),
    /** @deprecated Use contacts array instead */
    contact: exports.ClientContactSchema.nullish(),
    /** @deprecated Use contacts array instead */
    contactPerson: zod_1.z.string().nullish(),
    convertedFromLeadId: zod_1.z.string().nullish(),
    convertedAt: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.ClientStoredSchema = exports.ClientBaseSchema.extend({
    orgId: zod_1.z.string(),
    createdBy: zod_1.z.string(),
});
exports.ClientCreateRequestSchema = zod_1.z.object({
    isCompany: zod_1.z.boolean().nullish(),
    firstName: zod_1.z.string().nullish(),
    lastName: zod_1.z.string().nullish(),
    name: zod_1.z.string().nullish(),
    email: zod_1.z.string().nullish(),
    phone: zod_1.z.string().nullish(),
    abn: zod_1.z.string().nullish(),
    address: zod_1.z.string().nullish(),
    contacts: zod_1.z.array(exports.ClientContactSchema).nullish(),
    /** @deprecated Use contacts array instead */
    contact: exports.ClientContactSchema.nullish(),
    /** @deprecated Use contacts array instead */
    contactPerson: zod_1.z.string().nullish(),
});
/** Returns the primary contact from a client's contacts array, with fallback to legacy `contact` field. */
function getPrimaryContact(client) {
    if (client.contacts?.length) {
        return client.contacts.find(c => c.isPrimary) ?? client.contacts[0] ?? null;
    }
    return client.contact ?? null;
}
/** Returns the email to use for a client — primary contact email for companies, top-level email for individuals. */
function getClientEmail(client) {
    if (client.isCompany) {
        const primary = getPrimaryContact(client);
        return primary?.email ?? null;
    }
    return client.email ?? null;
}
/** Returns the phone to use for a client — primary contact phone for companies, top-level phone for individuals. */
function getClientPhone(client) {
    if (client.isCompany) {
        const primary = getPrimaryContact(client);
        return primary?.phone ?? null;
    }
    return client.phone ?? null;
}
//# sourceMappingURL=schema.js.map