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

/**
 * Drop top-level attributes whose value is `null`/`undefined` before a put.
 *
 * DynamoDB rejects a PutItem when a GSI *key* attribute is present but NULL —
 * a GSI key must be a scalar of the indexed type or entirely ABSENT. The
 * dual-write mirror copies the full Postgres DTO, which carries explicit nulls
 * for unset columns (e.g. `inviteToken` on an OWNER membership, `slug` on a
 * fresh user/org, `paymentLinkUsageCount` on a normal client). Left in, those
 * nulls land on GSI key attributes and DynamoDB rejects the whole item —
 * silently, because mirrorWrite swallows the error. Stripping nulls turns them
 * into absent attributes, which is how DynamoDB represents "unset" anyway and
 * how these repos already treat null↔undefined (see normalizeForDiff). Shallow
 * only: GSI keys are always top-level scalars, and nested nulls are harmless.
 */
function stripNullAttrs<T extends Record<string, any>>(item: T): T {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(item)) {
        if (v !== null && v !== undefined) out[k] = v;
    }
    return out as T;
}

export class DynamoDbAdapter implements IDdb {
    private client: DynamoDBDocumentClient;

    constructor(client: DynamoDBDocumentClient) {
        this.client = client;
    }

    async getItem(
        tableName: string,
        key: Key,
        options?: { ConsistentRead?: boolean },
    ): Promise<GetCommandOutput> {
        return this.client.send(
            new GetCommand({ TableName: tableName, Key: key, ConsistentRead: options?.ConsistentRead }),
        );
    }

    async put<T extends Record<string, any>>(tableName: string, item: T): Promise<PutCommandOutput> {
        return this.client.send(new PutCommand({ TableName: tableName, Item: stripNullAttrs(item) }));
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
