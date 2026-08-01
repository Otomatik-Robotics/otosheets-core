import { z } from 'zod';

/**
 * How much we actually know about a stored address.
 *
 * The platform used to conflate "we geocoded it" with "it is a real address".
 * `geocodeAddress` asked the place index for one result and kept whatever came
 * back — so a typo became a confident pin on the wrong house, and a lookup that
 * failed outright became a `console.warn` and a record with no coordinates and
 * nothing to say so. Both are silent, and both surface as a crew that cannot
 * clock on or a van at the wrong door.
 *
 * Making the outcome an explicit, persisted value is the fix: every write path
 * that accepts an address records what the lookup concluded, and the UI (and
 * the agent) can tell the difference between "checked" and "never looked".
 *
 *  - `verified`      — the place index returned a confident match; the stored
 *                      address is the provider's canonical label and the
 *                      coordinates are trustworthy.
 *  - `approximate`   — a match came back but below the confidence threshold.
 *                      The user's own text is kept verbatim; the coordinates
 *                      are a best guess and must not be treated as exact.
 *  - `not_found`     — the lookup ran and returned nothing usable. No
 *                      coordinates. The address is whatever was typed.
 *  - `lookup_failed` — the lookup itself errored (throttling, outage, missing
 *                      index). Distinct from `not_found` because it is OUR
 *                      fault and is worth retrying; `not_found` is not.
 *  - `unverified`    — never looked up. Legacy rows and paths that deliberately
 *                      skip verification.
 */
export const ADDRESS_STATUSES = [
    'verified',
    'approximate',
    'not_found',
    'lookup_failed',
    'unverified',
] as const;

export const AddressStatusSchema = z.enum(ADDRESS_STATUSES);
export type AddressStatus = z.infer<typeof AddressStatusSchema>;

/** True when the coordinates on a record may be used for routing/geofencing. */
export function addressCoordsUsable(status?: AddressStatus | null): boolean {
    return status === 'verified' || status === 'approximate';
}

/**
 * The address fields every address-bearing entity carries, so jobs and bookings
 * stay the same shape and one lookup seam can fill either.
 */
export const AddressFieldsSchema = z.object({
    address: z.string().nullish(),
    lat: z.number().nullish(),
    lng: z.number().nullish(),
    addressStatus: AddressStatusSchema.nullish(),
});
export type AddressFields = z.infer<typeof AddressFieldsSchema>;
