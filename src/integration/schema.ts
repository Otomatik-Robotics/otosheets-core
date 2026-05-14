import { z } from 'zod';

export const IntegrationStoredSchema = z.object({
    ownerId: z.string(),
    provider: z.string(),
    ownerType: z.enum(['personal', 'org']),
    scope: z.string().nullish(),
    credentials: z.any().nullish(),
    config: z.any().nullish(),
    syncSettings: z.any().nullish(),
    connectedBy: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Integration = z.infer<typeof IntegrationStoredSchema>;
