"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.docClient = exports.ddb = exports.Tables = exports.DynamoDbAdapter = void 0;
// Core infrastructure
var ddbAdapter_1 = require("./ddbAdapter");
Object.defineProperty(exports, "DynamoDbAdapter", { enumerable: true, get: function () { return ddbAdapter_1.DynamoDbAdapter; } });
var tables_1 = require("./tables");
Object.defineProperty(exports, "Tables", { enumerable: true, get: function () { return tables_1.Tables; } });
__exportStar(require("./keys"), exports);
// Pre-built singleton (consumers can also construct their own DynamoDbAdapter)
var ddbClient_1 = require("./ddbClient");
Object.defineProperty(exports, "ddb", { enumerable: true, get: function () { return ddbClient_1.ddb; } });
Object.defineProperty(exports, "docClient", { enumerable: true, get: function () { return ddbClient_1.docClient; } });
// Entity modules — each exports Repo class + Zod schema + inferred type
__exportStar(require("./user"), exports);
__exportStar(require("./org"), exports);
__exportStar(require("./membership"), exports);
__exportStar(require("./team"), exports);
__exportStar(require("./integration"), exports);
__exportStar(require("./invoice"), exports);
__exportStar(require("./invoicePayment"), exports);
__exportStar(require("./client"), exports);
__exportStar(require("./job"), exports);
__exportStar(require("./booking"), exports);
__exportStar(require("./timeEntry"), exports);
__exportStar(require("./receipt"), exports);
__exportStar(require("./trip"), exports);
__exportStar(require("./statement"), exports);
__exportStar(require("./lead"), exports);
__exportStar(require("./pipeline"), exports);
__exportStar(require("./ad"), exports);
__exportStar(require("./conversation"), exports);
__exportStar(require("./compliance"), exports);
__exportStar(require("./onboardingWorkflow"), exports);
__exportStar(require("./welcomeEmail"), exports);
__exportStar(require("./onboardingRun"), exports);
__exportStar(require("./notification"), exports);
__exportStar(require("./orgChannel"), exports);
__exportStar(require("./document"), exports);
__exportStar(require("./availabilityRule"), exports);
__exportStar(require("./timeOff"), exports);
__exportStar(require("./rotation"), exports);
__exportStar(require("./rosterEntry"), exports);
//# sourceMappingURL=index.js.map