// Core infrastructure
export { DynamoDbAdapter } from './ddbAdapter';
export type { IDdb } from './ddbPort';
export type { Key, BatchReadItem, BatchReadItems, PaginatedResult } from './types';
export { Tables } from './tables';
export * from './keys';

// Pre-built singleton (consumers can also construct their own DynamoDbAdapter)
export { ddb, docClient } from './ddbClient';

// Entity modules — each exports Repo class + Zod schema + inferred type
export * from './user';
export * from './org';
export * from './membership';
export * from './team';
export * from './integration';
export * from './accountingSync';
export * from './invoice';
export * from './invoicePayment';
export * from './client';
export * from './job';
export * from './booking';
export * from './timeEntry';
export * from './receipt';
export * from './trip';
export * from './statement';
export * from './lead';
export * from './pipeline';
export * from './callRecord';
export * from './voiceAgent';
export * from './voiceCredit';
export * from './conversation';
export * from './compliance';
export * from './onboardingWorkflow';
export * from './welcomeEmail';
export * from './onboardingRun';
export * from './notification';
export * from './orgChannel';
export * from './document';
export * from './availabilityRule';
export * from './timeOff';
export * from './rotation';
export * from './rosterEntry';
export * from './usage';
export * from './limits';
