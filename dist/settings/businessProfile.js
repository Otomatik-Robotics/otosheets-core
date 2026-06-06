"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessProfileSchema = exports.CommonQuestionSchema = void 0;
const zod_1 = require("zod");
exports.CommonQuestionSchema = zod_1.z.object({
    q: zod_1.z.string(),
    a: zod_1.z.string(),
}).passthrough();
exports.BusinessProfileSchema = zod_1.z.object({
    about: zod_1.z.string().nullish(),
    serviceAreas: zod_1.z.array(zod_1.z.string()).nullish(),
    targetCustomers: zod_1.z.array(zod_1.z.string()).nullish(),
    uniqueSellingPoints: zod_1.z.array(zod_1.z.string()).nullish(),
    commonQuestions: zod_1.z.array(exports.CommonQuestionSchema).nullish(),
    chatbotTone: zod_1.z.string().nullish(),
    chatbotInstructions: zod_1.z.string().nullish(),
    businessName: zod_1.z.string().nullish(),
    businessEmail: zod_1.z.string().nullish(),
    phone: zod_1.z.string().nullish(),
    website: zod_1.z.string().nullish(),
    address: zod_1.z.string().nullish(),
    suburb: zod_1.z.string().nullish(),
    state: zod_1.z.string().nullish(),
    postcode: zod_1.z.string().nullish(),
    abn: zod_1.z.string().nullish(),
    acn: zod_1.z.string().nullish(),
    gstRegistered: zod_1.z.boolean().nullish(),
    bankDetails: zod_1.z.string().nullish(),
}).passthrough();
//# sourceMappingURL=businessProfile.js.map