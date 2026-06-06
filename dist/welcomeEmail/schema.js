"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WelcomeEmailTemplateStoredSchema = void 0;
const zod_1 = require("zod");
const DynamicSectionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    title: zod_1.z.string(),
    content: zod_1.z.string(),
    enabled: zod_1.z.boolean().default(true),
});
exports.WelcomeEmailTemplateStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(),
    templateId: zod_1.z.string(),
    name: zod_1.z.string(),
    subject: zod_1.z.string(),
    htmlBody: zod_1.z.string(),
    dynamicSections: zod_1.z.array(DynamicSectionSchema).optional(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
    createdBy: zod_1.z.string().optional(),
    updatedBy: zod_1.z.string().optional(),
});
//# sourceMappingURL=schema.js.map