"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamCreateRequestSchema = exports.TeamStoredSchema = void 0;
const zod_1 = require("zod");
exports.TeamStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    teamId: zod_1.z.string(),
    name: zod_1.z.string(),
    memberIds: zod_1.z.array(zod_1.z.string()).default([]),
    createdBy: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
});
exports.TeamCreateRequestSchema = zod_1.z.object({
    name: zod_1.z.string(),
    memberIds: zod_1.z.array(zod_1.z.string()).optional(),
});
//# sourceMappingURL=schema.js.map