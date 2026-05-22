import { z } from 'zod';

const DynamicSectionSchema = z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    enabled: z.boolean().default(true),
});

export const WelcomeEmailTemplateStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(),
    templateId: z.string(),
    name: z.string(),
    subject: z.string(),
    htmlBody: z.string(),
    dynamicSections: z.array(DynamicSectionSchema).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.string().optional(),
    updatedBy: z.string().optional(),
});
export type WelcomeEmailTemplate = z.infer<typeof WelcomeEmailTemplateStoredSchema>;
export type DynamicSection = z.infer<typeof DynamicSectionSchema>;
