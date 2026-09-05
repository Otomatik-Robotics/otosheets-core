import { EnvelopePgRepo } from './repo.pg';

/**
 * Postgres-only, so there is no routing wrapper to build: there is no DynamoDB
 * implementation to route to and `envelope` is deliberately absent from the
 * DataDomain union, which is the cutover state machine for dual-written domains
 * only. The singleton keeps the connection warm per Lambda container.
 */
let singleton: EnvelopePgRepo | null = null;

export function getEnvelopeRepo(): EnvelopePgRepo {
    if (!singleton) singleton = new EnvelopePgRepo();
    return singleton;
}
