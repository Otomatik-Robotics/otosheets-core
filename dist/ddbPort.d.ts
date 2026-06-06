import { PutCommandOutput, UpdateCommandOutput, QueryCommandOutput, GetCommandOutput, DeleteCommandOutput, BatchGetCommandOutput, QueryCommandInput, TransactWriteCommandInput, TransactWriteCommandOutput, BatchWriteCommandInput, BatchWriteCommandOutput } from '@aws-sdk/lib-dynamodb';
import { Key } from './types';
export interface IDdb {
    getItem(tableName: string, key: Key): Promise<GetCommandOutput>;
    put<T extends Record<string, any>>(tableName: string, item: T): Promise<PutCommandOutput>;
    update(tableName: string, key: Key, params: Record<string, any>): Promise<UpdateCommandOutput>;
    delete(tableName: string, key: Key): Promise<DeleteCommandOutput>;
    query(params: QueryCommandInput): Promise<QueryCommandOutput>;
    batchGet(params: Record<string, {
        Keys: Key[];
    }>): Promise<BatchGetCommandOutput>;
    batchWrite(params: BatchWriteCommandInput['RequestItems']): Promise<BatchWriteCommandOutput>;
    transactWrite(params: TransactWriteCommandInput['TransactItems']): Promise<TransactWriteCommandOutput>;
}
//# sourceMappingURL=ddbPort.d.ts.map