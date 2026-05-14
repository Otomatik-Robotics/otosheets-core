"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientCreateRequestSchema = exports.ClientStoredSchema = void 0;
const zod_1 = require("zod");
exports.ClientStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    clientId: zod_1.z.string(),
    createdBy: zod_1.z.string(),
    name: zod_1.z.string(),
    email: zod_1.z.string().nullish(),
    abn: zod_1.z.string().nullish(),
    address: zod_1.z.string().nullish(),
    contactPerson: zod_1.z.string().nullish(),
    convertedFromLeadId: zod_1.z.string().nullish(),
    convertedAt: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.ClientCreateRequestSchema = zod_1.z.object({
    name: zod_1.z.string(),
    email: zod_1.z.string().nullish(),
    abn: zod_1.z.string().nullish(),
    address: zod_1.z.string().nullish(),
    contactPerson: zod_1.z.string().nullish(),
});
//# sourceMappingURL=schema.js.map