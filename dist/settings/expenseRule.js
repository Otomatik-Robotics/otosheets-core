"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpenseRuleSchema = void 0;
const zod_1 = require("zod");
exports.ExpenseRuleSchema = zod_1.z.object({
    id: zod_1.z.string(),
    vendorPattern: zod_1.z.string(),
    condition: zod_1.z.string(),
    amountThreshold: zod_1.z.number(),
    action: zod_1.z.string(),
    category: zod_1.z.string().nullish(),
    label: zod_1.z.string().nullish(),
    enabled: zod_1.z.boolean().default(true),
}).passthrough();
//# sourceMappingURL=expenseRule.js.map