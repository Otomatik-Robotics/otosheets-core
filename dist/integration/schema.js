"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationStoredSchema = void 0;
const zod_1 = require("zod");
exports.IntegrationStoredSchema = zod_1.z.object({
    ownerId: zod_1.z.string(),
    provider: zod_1.z.string(),
    ownerType: zod_1.z.enum(['personal', 'org']),
    scope: zod_1.z.string().nullish(),
    credentials: zod_1.z.any().nullish(),
    config: zod_1.z.any().nullish(),
    syncSettings: zod_1.z.any().nullish(),
    connectedBy: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
//# sourceMappingURL=schema.js.map