"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarConnectionSchema = void 0;
const zod_1 = require("zod");
exports.CalendarConnectionSchema = zod_1.z.object({
    provider: zod_1.z.string(),
    email: zod_1.z.string(),
    name: zod_1.z.string().nullish(),
    accessToken: zod_1.z.string().nullish(),
    refreshToken: zod_1.z.string().nullish(),
    tokenExpiresAt: zod_1.z.string().nullish(),
    calendarId: zod_1.z.string().default('primary'),
    calendarIds: zod_1.z.array(zod_1.z.string()).nullish(),
    connectedAt: zod_1.z.string(),
    status: zod_1.z.string().default('active'),
    watchHistoryId: zod_1.z.string().nullish(),
    watchExpiration: zod_1.z.string().nullish(),
}).passthrough();
//# sourceMappingURL=calendarConnection.js.map