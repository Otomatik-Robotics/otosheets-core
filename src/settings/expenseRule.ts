import { z } from 'zod';

export const ExpenseRuleSchema = z.object({
    id: z.string(),
    vendorPattern: z.string(),
    condition: z.string(),
    amountThreshold: z.number(),
    action: z.string(),
    category: z.string().nullish(),
    label: z.string().nullish(),
    enabled: z.boolean().default(true),
}).passthrough();
export type ExpenseRule = z.infer<typeof ExpenseRuleSchema>;
