"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrandingSchema = void 0;
const zod_1 = require("zod");
exports.BrandingSchema = zod_1.z.object({
    primaryColor: zod_1.z.string().default('#4f46e5'),
    accentColor: zod_1.z.string().default('#7c3aed'),
    template: zod_1.z.string().nullish(),
    logoKey: zod_1.z.string().nullish(),
    logoUrl: zod_1.z.string().nullish(),
    footerText: zod_1.z.string().nullish(),
    paymentInstructions: zod_1.z.string().nullish(),
}).passthrough();
//# sourceMappingURL=branding.js.map