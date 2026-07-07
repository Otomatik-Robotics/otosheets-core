import { z } from 'zod';

/**
 * One consented bank account pulled from an open-banking provider (Fiskil / CDR).
 * Born in Postgres — the connection/consent secrets (Fiskil end-user id, tokens)
 * live in the integrations table; only the relational account record lives here.
 * Never store the full account number — `accountNumberMasked` is last-4 only.
 */
export const BankAccountSchema = z.object({
    accountId: z.string(),               // provider account id — deterministic PK
    userId: z.string(),
    organizationId: z.string().nullish(),
    provider: z.string(),                // 'fiskil'
    consentId: z.string().nullish(),
    institutionId: z.string().nullish(),
    institutionName: z.string().nullish(),
    name: z.string().nullish(),
    productName: z.string().nullish(),
    productCategory: z.string().nullish(),
    accountNumberMasked: z.string().nullish(),
    bsb: z.string().nullish(),
    openStatus: z.string().nullish(),
    status: z.enum(['ACTIVE', 'DISCONNECTED']),
    lastSyncedAt: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string().nullish(),
});
export type BankAccount = z.infer<typeof BankAccountSchema>;
