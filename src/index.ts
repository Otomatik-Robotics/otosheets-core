// Core infrastructure
export { DynamoDbAdapter } from './ddbAdapter';
export type { IDdb } from './ddbPort';
export type { Key, BatchReadItem, BatchReadItems, PaginatedResult } from './types';
export { Tables } from './tables';
export * from './keys';

// Pre-built singleton (consumers can also construct their own DynamoDbAdapter)
export { ddb, docClient } from './ddbClient';

// Postgres migration machinery — docs/POSTGRES_MIGRATION_PLAN.md
export { dataBackend, resolveRoute, resetDataBackendCache } from './dataBackend';
export type { DataBackendState, DataDomain, Route } from './dataBackend';
export { mirrorWrite, shadowRead, normalizeForDiff } from './dualWrite';
export type { RepairMessage } from './dualWrite';
export { getPg, setPgForTesting } from './pg/client';
export type { PgDb } from './pg/client';
export { runMigrations, migrationsDir, splitStatements } from './pg/migrate';
export type { SqlExecutor } from './pg/migrate';
export * from './pg/cursor';
export * as pgSchema from './pg/schema';

// Entity modules — each exports Repo class + Zod schema + inferred type
export * from './user';
export * from './org';
export * from './identity';
export * from './membership';
export * from './team';
export * from './integration';
export * from './invoice';
export * from './invoicePayment';
export * from './client';
export * from './clientOverview';
export * from './leadReporting';
export * from './address';
export * from './callTrigger';
export * from './job';
export * from './booking';
export * from './receipt';
export * from './trip';
export * from './lead';
export * from './pipeline';
export * from './pipelineInsights';
export * from './callRecord';
export * from './voiceAgent';
export * from './voiceCredit';
export * from './conversation';
export * from './compliance';
export * from './notification';
export * from './usage';
export * from './limits';
export * from './priceBook';
export * from './site';
export * from './form';


export * from "./smsDelivery";
export * from './inboundEmail';

export * from './smsResponse';

export * from './websocketAdmission';

export * from './pushDevice';




