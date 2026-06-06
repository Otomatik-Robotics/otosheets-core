import { z } from 'zod';
declare const DynamicSectionSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    content: z.ZodString;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id: string;
    title: string;
    content: string;
    enabled: boolean;
}, {
    id: string;
    title: string;
    content: string;
    enabled?: boolean | undefined;
}>;
export declare const WelcomeEmailTemplateStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    sk: z.ZodString;
    templateId: z.ZodString;
    name: z.ZodString;
    subject: z.ZodString;
    htmlBody: z.ZodString;
    dynamicSections: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        content: z.ZodString;
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        title: string;
        content: string;
        enabled: boolean;
    }, {
        id: string;
        title: string;
        content: string;
        enabled?: boolean | undefined;
    }>, "many">>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    createdBy: z.ZodOptional<z.ZodString>;
    updatedBy: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    sk: string;
    templateId: string;
    subject: string;
    htmlBody: string;
    createdBy?: string | undefined;
    updatedBy?: string | undefined;
    dynamicSections?: {
        id: string;
        title: string;
        content: string;
        enabled: boolean;
    }[] | undefined;
}, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    sk: string;
    templateId: string;
    subject: string;
    htmlBody: string;
    createdBy?: string | undefined;
    updatedBy?: string | undefined;
    dynamicSections?: {
        id: string;
        title: string;
        content: string;
        enabled?: boolean | undefined;
    }[] | undefined;
}>;
export type WelcomeEmailTemplate = z.infer<typeof WelcomeEmailTemplateStoredSchema>;
export type DynamicSection = z.infer<typeof DynamicSectionSchema>;
export {};
//# sourceMappingURL=schema.d.ts.map