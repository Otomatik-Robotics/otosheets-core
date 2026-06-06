"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.docClient = exports.ddb = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const ddbAdapter_1 = require("./ddbAdapter");
const rawClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: { removeUndefinedValues: true },
});
exports.docClient = docClient;
exports.ddb = new ddbAdapter_1.DynamoDbAdapter(docClient);
//# sourceMappingURL=ddbClient.js.map