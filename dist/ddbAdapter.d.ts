import { DynamoDBDocumentClient, GetCommandOutput, PutCommandOutput, UpdateCommandOutput, DeleteCommandOutput, QueryCommandInput, QueryCommandOutput, BatchGetCommandOutput, BatchWriteCommandInput, BatchWriteCommandOutput, TransactWriteCommandInput, TransactWriteCommandOutput } from '@aws-sdk/lib-dynamodb';
import { IDdb } from './ddbPort';
import { Key } from './types';
export declare class DynamoDbAdapter implements IDdb {
    private client;
    constructor(client: DynamoDBDocumentClient);
    getItem(tableName: string, key: Key): Promise<GetCommandOutput>;
    put<T extends Record<string, any>>(tableName: string, item: T): Promise<PutCommandOutput>;
    update(tableName: string, key: Key, params: Record<string, any>): Promise<UpdateCommandOutput>;
    delete(tableName: string, key: Key): Promise<DeleteCommandOutput>;
    query(params: QueryCommandInput): Promise<QueryCommandOutput>;
    batchGet(requestItems: Record<string, {
        Keys: Key[];
    }>): Promise<BatchGetCommandOutput>;
    batchWrite(requestItems: BatchWriteCommandInput['RequestItems']): Promise<BatchWriteCommandOutput>;
    transactWrite(items: TransactWriteCommandInput['TransactItems']): Promise<TransactWriteCommandOutput>;
}
//# sourceMappingURL=ddbAdapter.d.ts.map