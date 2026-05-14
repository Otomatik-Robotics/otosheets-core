"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDbAdapter = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
class DynamoDbAdapter {
    client;
    constructor(client) {
        this.client = client;
    }
    async getItem(tableName, key) {
        return this.client.send(new lib_dynamodb_1.GetCommand({ TableName: tableName, Key: key }));
    }
    async put(tableName, item) {
        return this.client.send(new lib_dynamodb_1.PutCommand({ TableName: tableName, Item: item }));
    }
    async update(tableName, key, params) {
        return this.client.send(new lib_dynamodb_1.UpdateCommand({ TableName: tableName, Key: key, ...params }));
    }
    async delete(tableName, key) {
        return this.client.send(new lib_dynamodb_1.DeleteCommand({ TableName: tableName, Key: key }));
    }
    async query(params) {
        return this.client.send(new lib_dynamodb_1.QueryCommand(params));
    }
    async batchGet(requestItems) {
        return this.client.send(new lib_dynamodb_1.BatchGetCommand({ RequestItems: requestItems }));
    }
    async batchWrite(requestItems) {
        return this.client.send(new lib_dynamodb_1.BatchWriteCommand({ RequestItems: requestItems }));
    }
    async transactWrite(items) {
        return this.client.send(new lib_dynamodb_1.TransactWriteCommand({ TransactItems: items }));
    }
}
exports.DynamoDbAdapter = DynamoDbAdapter;
//# sourceMappingURL=ddbAdapter.js.map