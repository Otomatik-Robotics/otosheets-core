import {
    DynamoDBDocumentClient,
    GetCommand,
    GetCommandOutput,
    PutCommand,
    PutCommandOutput,
    UpdateCommand,
    UpdateCommandOutput,
    DeleteCommand,
    DeleteCommandOutput,
    QueryCommand,
    QueryCommandInput,
    QueryCommandOutput,
    ScanCommand,
    ScanCommandInput,
    ScanCommandOutput,
    BatchGetCommand,
    BatchGetCommandOutput,
    BatchWriteCommand,
    BatchWriteCommandInput,
    BatchWriteCommandOutput,
    TransactWriteCommand,
    TransactWriteCommandInput,
    TransactWriteCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { IDdb } from './ddbPort';
import { Key } from './types';

export class DynamoDbAdapter implements IDdb {
    private client: DynamoDBDocumentClient;

    constructor(client: DynamoDBDocumentClient) {
        this.client = client;
    }

    async getItem(tableName: string, key: Key): Promise<GetCommandOutput> {
        return this.client.send(new GetCommand({ TableName: tableName, Key: key }));
    }

    async put<T extends Record<string, any>>(tableName: string, item: T): Promise<PutCommandOutput> {
        return this.client.send(new PutCommand({ TableName: tableName, Item: item }));
    }

    async update(tableName: string, key: Key, params: Record<string, any>): Promise<UpdateCommandOutput> {
        return this.client.send(new UpdateCommand({ TableName: tableName, Key: key, ...params }));
    }

    async delete(tableName: string, key: Key): Promise<DeleteCommandOutput> {
        return this.client.send(new DeleteCommand({ TableName: tableName, Key: key }));
    }

    async query(params: QueryCommandInput): Promise<QueryCommandOutput> {
        return this.client.send(new QueryCommand(params));
    }

    async scan(params: ScanCommandInput): Promise<ScanCommandOutput> {
        return this.client.send(new ScanCommand(params));
    }

    async batchGet(requestItems: Record<string, { Keys: Key[] }>): Promise<BatchGetCommandOutput> {
        return this.client.send(new BatchGetCommand({ RequestItems: requestItems }));
    }

    async batchWrite(requestItems: BatchWriteCommandInput['RequestItems']): Promise<BatchWriteCommandOutput> {
        return this.client.send(new BatchWriteCommand({ RequestItems: requestItems }));
    }

    async transactWrite(items: TransactWriteCommandInput['TransactItems']): Promise<TransactWriteCommandOutput> {
        return this.client.send(new TransactWriteCommand({ TransactItems: items }));
    }
}
