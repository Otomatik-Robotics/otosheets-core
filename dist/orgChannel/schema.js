"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgChannelCreateRequestSchema = exports.OrgChannelStoredSchema = void 0;
const zod_1 = require("zod");
exports.OrgChannelStoredSchema = zod_1.z.object({
    orgId: zod_1.z.string(),
    channelId: zod_1.z.string(),
    name: zod_1.z.string(),
    type: zod_1.z.string(),
    teamId: zod_1.z.string().nullish(),
    memberIds: zod_1.z.array(zod_1.z.string()).nullish(),
    lastRead: zod_1.z.any().nullish(),
    createdBy: zod_1.z.string().nullish(),
    createdAt: zod_1.z.string(),
});
exports.OrgChannelCreateRequestSchema = zod_1.z.object({
    name: zod_1.z.string(),
    type: zod_1.z.string(),
    teamId: zod_1.z.string().nullish(),
    memberIds: zod_1.z.array(zod_1.z.string()).nullish(),
});
//# sourceMappingURL=schema.js.map