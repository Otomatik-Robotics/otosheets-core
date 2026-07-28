import {
    PutCommandOutput,
    UpdateCommandOutput,
    QueryCommandOutput,
    GetCommandOutput,
    DeleteCommandOutput,
    BatchGetCommandOutput,
    QueryCommandInput,
    ScanCommandInput,
    ScanCommandOutput,
    TransactWriteCommandInput,
    TransactWriteCommandOutput,
    BatchWriteCommandInput,
    BatchWriteCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { Key } from './types';

export interface IDdb {
    /**
     * `options.ConsistentRead` is opt-in and off by default (an eventually
     * consistent read is half the RCU and lower latency). Pass it when the read
     * gates something — e.g. a usage meter checked before spending — where
     * reading a replica that has not yet seen its own write means the gate
     * silently fails open.
     */
    getItem(tableName: string, key: Key, options?: { ConsistentRead?: boolean }): Promise<GetCommandOutput>;
    put<T extends Record<string, any>>(tableName: string, item: T): Promise<PutCommandOutput>;
    update(tableName: string, key: Key, params: Record<string, any>): Promise<UpdateCommandOutput>;
    delete(tableName: string, key: Key): Promise<DeleteCommandOutput>;
    query(params: QueryCommandInput): Promise<QueryCommandOutput>;
    scan(params: ScanCommandInput): Promise<ScanCommandOutput>;
    batchGet(params: Record<string, { Keys: Key[] }>): Promise<BatchGetCommandOutput>;
    batchWrite(params: BatchWriteCommandInput['RequestItems']): Promise<BatchWriteCommandOutput>;
    transactWrite(params: TransactWriteCommandInput['TransactItems']): Promise<TransactWriteCommandOutput>;
}
