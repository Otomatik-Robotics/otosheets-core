"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatementCreateRequestSchema = exports.StatementStoredSchema = exports.StatementBaseSchema = void 0;
const zod_1 = require("zod");
exports.StatementBaseSchema = zod_1.z.object({
    statementId: zod_1.z.string(),
    fy: zod_1.z.string(),
    fileName: zod_1.z.string(),
    fileType: zod_1.z.string().nullish(),
    s3Key: zod_1.z.string(),
    createdAt: zod_1.z.string(),
});
exports.StatementStoredSchema = exports.StatementBaseSchema.extend({
    userId: zod_1.z.string(),
    sk: zod_1.z.string(),
    organizationId: zod_1.z.string().nullish(),
});
exports.StatementCreateRequestSchema = zod_1.z.object({
    fy: zod_1.z.string(),
    fileName: zod_1.z.string(),
    fileType: zod_1.z.string().nullish(),
    s3Key: zod_1.z.string(),
    organizationId: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map