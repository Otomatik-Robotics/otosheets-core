import { getOrgRepo } from '../org/factory';
import { getBusinessProfileRepo } from './factory';
import { BusinessProfile, ResolvedBusinessProfile } from './schema';

/** Apply tax defaults so consumers never need a fallback chain. */
function withDefaults(p: BusinessProfile): ResolvedBusinessProfile {
    return {
        ...p,
        taxLabel: p.taxLabel ?? 'GST',
        taxRate: p.taxRate ?? 10,
        gstRegistered: p.gstRegistered ?? false,
    };
}

/**
 * The single read entry point for business identity. Resolves the org's active
 * profile (`org.business_profile_id`) and returns it with tax defaults applied.
 *
 * Replaces the old `inv.* || business.* || tradeSettings.* || 10` fallback
 * chains scattered across invoice/PDF/storefront/chatbot/statements consumers.
 *
 * Post-backfill every org has an active profile; if one is somehow missing this
 * synthesises a minimal profile from the org record so callers still render.
 */
export async function resolveBusinessProfile(orgId: string): Promise<ResolvedBusinessProfile> {
    const org = await getOrgRepo().getOrg(orgId);
    const profileId = (org as any)?.businessProfileId;

    if (profileId) {
        const profile = await getBusinessProfileRepo().getById(profileId);
        if (profile) return withDefaults(profile);
    }

    // Defensive fallback — synthesise from the org so consumers still work.
    const now = new Date().toISOString();
    return withDefaults({
        businessProfileId: profileId ?? '',
        orgId,
        businessName: (org as any)?.tradeName ?? (org as any)?.name ?? null,
        legalName: (org as any)?.legalName ?? null,
        tradeName: (org as any)?.tradeName ?? null,
        abn: (org as any)?.abn ?? null,
        brandColor: (org as any)?.brandColor ?? null,
        logoKey: (org as any)?.logoUrl ?? null,
        createdAt: now,
        updatedAt: now,
    } as BusinessProfile);
}
