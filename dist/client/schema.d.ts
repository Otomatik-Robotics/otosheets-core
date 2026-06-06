import { z } from 'zod';
export declare const ClientContactSchema: z.ZodObject<{
    firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    isPrimary: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    email?: string | null | undefined;
    firstName?: string | null | undefined;
    lastName?: string | null | undefined;
    phone?: string | null | undefined;
    isPrimary?: boolean | undefined;
}, {
    email?: string | null | undefined;
    firstName?: string | null | undefined;
    lastName?: string | null | undefined;
    phone?: string | null | undefined;
    isPrimary?: boolean | undefined;
}>;
export type ClientContact = z.infer<typeof ClientContactSchema>;
export declare const ClientBaseSchema: z.ZodObject<{
    clientId: z.ZodString;
    isCompany: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    name: z.ZodString;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    abn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    contacts: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        isPrimary: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }>, "many">>>;
    /** @deprecated Use contacts array instead */
    contact: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        isPrimary: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }>>>;
    /** @deprecated Use contacts array instead */
    contactPerson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    convertedFromLeadId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    convertedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    updatedAt: string;
    clientId: string;
    email?: string | null | undefined;
    firstName?: string | null | undefined;
    lastName?: string | null | undefined;
    phone?: string | null | undefined;
    abn?: string | null | undefined;
    isCompany?: boolean | null | undefined;
    address?: string | null | undefined;
    contacts?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }[] | null | undefined;
    contact?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    } | null | undefined;
    contactPerson?: string | null | undefined;
    convertedFromLeadId?: string | null | undefined;
    convertedAt?: string | null | undefined;
}, {
    name: string;
    createdAt: string;
    updatedAt: string;
    clientId: string;
    email?: string | null | undefined;
    firstName?: string | null | undefined;
    lastName?: string | null | undefined;
    phone?: string | null | undefined;
    abn?: string | null | undefined;
    isCompany?: boolean | null | undefined;
    address?: string | null | undefined;
    contacts?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }[] | null | undefined;
    contact?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    } | null | undefined;
    contactPerson?: string | null | undefined;
    convertedFromLeadId?: string | null | undefined;
    convertedAt?: string | null | undefined;
}>;
export type ClientBase = z.infer<typeof ClientBaseSchema>;
export declare const ClientStoredSchema: z.ZodObject<{
    clientId: z.ZodString;
    isCompany: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    name: z.ZodString;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    abn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    contacts: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        isPrimary: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }>, "many">>>;
    /** @deprecated Use contacts array instead */
    contact: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        isPrimary: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }>>>;
    /** @deprecated Use contacts array instead */
    contactPerson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    convertedFromLeadId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    convertedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
} & {
    orgId: z.ZodString;
    createdBy: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    clientId: string;
    email?: string | null | undefined;
    firstName?: string | null | undefined;
    lastName?: string | null | undefined;
    phone?: string | null | undefined;
    abn?: string | null | undefined;
    isCompany?: boolean | null | undefined;
    address?: string | null | undefined;
    contacts?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }[] | null | undefined;
    contact?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    } | null | undefined;
    contactPerson?: string | null | undefined;
    convertedFromLeadId?: string | null | undefined;
    convertedAt?: string | null | undefined;
}, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    clientId: string;
    email?: string | null | undefined;
    firstName?: string | null | undefined;
    lastName?: string | null | undefined;
    phone?: string | null | undefined;
    abn?: string | null | undefined;
    isCompany?: boolean | null | undefined;
    address?: string | null | undefined;
    contacts?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }[] | null | undefined;
    contact?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    } | null | undefined;
    contactPerson?: string | null | undefined;
    convertedFromLeadId?: string | null | undefined;
    convertedAt?: string | null | undefined;
}>;
export type Client = z.infer<typeof ClientStoredSchema>;
export declare const ClientCreateRequestSchema: z.ZodObject<{
    isCompany: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    abn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    contacts: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        isPrimary: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }>, "many">>>;
    /** @deprecated Use contacts array instead */
    contact: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        firstName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        lastName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        isPrimary: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }, {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }>>>;
    /** @deprecated Use contacts array instead */
    contactPerson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name?: string | null | undefined;
    email?: string | null | undefined;
    firstName?: string | null | undefined;
    lastName?: string | null | undefined;
    phone?: string | null | undefined;
    abn?: string | null | undefined;
    isCompany?: boolean | null | undefined;
    address?: string | null | undefined;
    contacts?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }[] | null | undefined;
    contact?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    } | null | undefined;
    contactPerson?: string | null | undefined;
}, {
    name?: string | null | undefined;
    email?: string | null | undefined;
    firstName?: string | null | undefined;
    lastName?: string | null | undefined;
    phone?: string | null | undefined;
    abn?: string | null | undefined;
    isCompany?: boolean | null | undefined;
    address?: string | null | undefined;
    contacts?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    }[] | null | undefined;
    contact?: {
        email?: string | null | undefined;
        firstName?: string | null | undefined;
        lastName?: string | null | undefined;
        phone?: string | null | undefined;
        isPrimary?: boolean | undefined;
    } | null | undefined;
    contactPerson?: string | null | undefined;
}>;
export type ClientCreateRequest = z.infer<typeof ClientCreateRequestSchema>;
/** Returns the primary contact from a client's contacts array, with fallback to legacy `contact` field. */
export declare function getPrimaryContact(client: {
    contacts?: ClientContact[] | null;
    contact?: ClientContact | null;
}): ClientContact | null;
/** Returns the email to use for a client — primary contact email for companies, top-level email for individuals. */
export declare function getClientEmail(client: {
    isCompany?: boolean | null;
    email?: string | null;
    contacts?: ClientContact[] | null;
    contact?: ClientContact | null;
}): string | null;
/** Returns the phone to use for a client — primary contact phone for companies, top-level phone for individuals. */
export declare function getClientPhone(client: {
    isCompany?: boolean | null;
    phone?: string | null;
    contacts?: ClientContact[] | null;
    contact?: ClientContact | null;
}): string | null;
//# sourceMappingURL=schema.d.ts.map