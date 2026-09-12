import { getOrgRepo } from '../org/factory';
import { getIdentityRepo } from './repo.pg';
import type { OrgIdentity, ResolvedOrgIdentity } from './schema';

/**
 * Apply tax defaults so consumers never need a fallback chain.
 *
 * `connectSensitive` is dropped here on purpose: this is the shared read entry
 * point for rendering consumers (invoice PDFs, chat agents, the settings GET),
 * none of which may see the encrypted DOB + bank blob even as ciphertext. The
 * one owner-gated forwarding path reads it straight off `IdentityRepo.get()`.
 */
function withDefaults(identity: OrgIdentity): ResolvedOrgIdentity {
    const { connectSensitive: _sensitive, ...rest } = identity;
    return {
        ...rest,
        taxLabel: identity.taxLabel ?? 'GST',
        taxRate: identity.taxRate ?? 10,
        gstRegistered: identity.gstRegistered ?? false,
    };
}

/**
 * The single read entry point for business identity: the organisation's own
 * row, with tax defaults applied. An organisation that somehow has no row
 * still renders, from nothing.
 */
export async function resolveOrgIdentity(orgId: string): Promise<ResolvedOrgIdentity> {
    const identity = await getIdentityRepo().get(orgId);
    if (identity) return withDefaults(identity);
    const org = await getOrgRepo().getOrg(orgId);
    const now = new Date().toISOString();
    return withDefaults({
        orgId,
        businessName: (org as any)?.tradeName ?? (org as any)?.name ?? null,
        legalName: (org as any)?.legalName ?? null,
        tradeName: (org as any)?.tradeName ?? null,
        abn: (org as any)?.abn ?? null,
        brandColor: (org as any)?.brandColor ?? null,
        logoKey: (org as any)?.logoUrl ?? null,
        createdAt: now,
        updatedAt: now,
    } as OrgIdentity);
}
