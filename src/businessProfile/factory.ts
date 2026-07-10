import { BusinessProfilePgRepo } from './repo.pg';

/**
 * Business profiles are Postgres-native (no Dynamo mirror, no routing wrapper) —
 * so the "repo" is just the pg impl. Kept as a named class + singleton to match
 * the `get{Entity}Repo()` convention used across the SDK.
 */
export class BusinessProfileRepo extends BusinessProfilePgRepo {}

let singleton: BusinessProfileRepo | undefined;

export function getBusinessProfileRepo(): BusinessProfileRepo {
    if (!singleton) singleton = new BusinessProfileRepo();
    return singleton;
}
