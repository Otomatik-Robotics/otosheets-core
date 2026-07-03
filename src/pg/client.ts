import type { PgDatabase } from 'drizzle-orm/pg-core';

/**
 * Postgres client access for repos.
 *
 * `PgDb` is the loose database type every pg repo is written against, so the
 * same repo code runs on the Neon HTTP driver in Lambda and on PGlite in
 * tests (injected via the repo constructor).
 *
 * The Neon singleton is created lazily on first use — Lambdas that never
 * touch a pg-backed domain (flag still 'dynamo') never load the driver and
 * never need DATABASE_URL. The consumer (backend) resolves the Neon secret at
 * cold start and sets DATABASE_URL; core deliberately knows nothing about
 * Secrets Manager.
 */
export type PgDb = PgDatabase<any, any, any>;

let singleton: PgDb | undefined;

export function getPg(): PgDb {
    if (!singleton) {
        const url = process.env.DATABASE_URL;
        if (!url) {
            throw new Error(
                'DATABASE_URL is not set — a pg-backed data backend was selected but the Neon secret has not been resolved',
            );
        }
        // Lazy requires keep the driver out of cold starts on dynamo-only Lambdas.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { neon } = require('@neondatabase/serverless');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { drizzle } = require('drizzle-orm/neon-http');
        singleton = drizzle(neon(url)) as PgDb;
    }
    return singleton;
}

/** Test seam — inject a PGlite-backed drizzle instance, or reset with undefined. */
export function setPgForTesting(db: PgDb | undefined): void {
    singleton = db;
}
