"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentStoredSchema = void 0;
const zod_1 = require("zod");
exports.DocumentStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    sk: zod_1.z.string(), // DOC#{documentId}
    documentId: zod_1.z.string(),
    name: zod_1.z.string(), // Display name (editable)
    description: zod_1.z.string().default(''),
    category: zod_1.z.string().default('general'), // contract, proposal, letter, invoice, report, general
    s3Key: zod_1.z.string(), // PDF location in S3
    sizeBytes: zod_1.z.number().optional(),
    sourceTemplateId: zod_1.z.string().optional(), // template that generated this (if any)
    sourceTemplateName: zod_1.z.string().optional(),
    variables: zod_1.z.record(zod_1.z.string()).optional(), // variables used during generation
    createdBy: zod_1.z.string(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string().optional(),
});
//# sourceMappingURL=schema.js.map