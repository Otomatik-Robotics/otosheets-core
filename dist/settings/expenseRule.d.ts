import { z } from 'zod';
export declare const ExpenseRuleSchema: z.ZodObject<{
    id: z.ZodString;
    vendorPattern: z.ZodString;
    condition: z.ZodString;
    amountThreshold: z.ZodNumber;
    action: z.ZodString;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    id: z.ZodString;
    vendorPattern: z.ZodString;
    condition: z.ZodString;
    amountThreshold: z.ZodNumber;
    action: z.ZodString;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    id: z.ZodString;
    vendorPattern: z.ZodString;
    condition: z.ZodString;
    amountThreshold: z.ZodNumber;
    action: z.ZodString;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">>;
export type ExpenseRule = z.infer<typeof ExpenseRuleSchema>;
//# sourceMappingURL=expenseRule.d.ts.map