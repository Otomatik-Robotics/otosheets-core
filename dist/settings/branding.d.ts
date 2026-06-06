import { z } from 'zod';
export declare const BrandingSchema: z.ZodObject<{
    primaryColor: z.ZodDefault<z.ZodString>;
    accentColor: z.ZodDefault<z.ZodString>;
    template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    primaryColor: z.ZodDefault<z.ZodString>;
    accentColor: z.ZodDefault<z.ZodString>;
    template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    primaryColor: z.ZodDefault<z.ZodString>;
    accentColor: z.ZodDefault<z.ZodString>;
    template: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logoKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    footerText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    paymentInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type Branding = z.infer<typeof BrandingSchema>;
//# sourceMappingURL=branding.d.ts.map