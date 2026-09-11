import { and, eq } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { envelopes, envelopeVersions, envelopeTemplates } from '../pg/schema/envelopes';
import { businessProfiles } from '../pg/schema/businessProfile';

/** Exact file-reference authority; never resolves or changes a business profile. */
export class EnvelopeFilePgRepo {
    private readonly scope: Readonly<{ orgId: string; businessProfileId: string }>;
    constructor(orgId: string, businessProfileId: string, private readonly injected?: PgDb) {
        if (!orgId?.trim() || !businessProfileId?.trim()) throw new Error('Envelope file scope is required');
        this.scope = Object.freeze({ orgId, businessProfileId });
    }
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getVersion(envelopeId: string, versionId: string) {
        const rows = await this.db.select({ version: envelopeVersions }).from(envelopeVersions)
            .innerJoin(envelopes, eq(envelopes.envelopeId, envelopeVersions.envelopeId))
            .innerJoin(businessProfiles, and(eq(businessProfiles.businessProfileId, envelopes.businessProfileId), eq(businessProfiles.orgId, envelopes.orgId)))
            .where(and(eq(envelopes.orgId, this.scope.orgId), eq(envelopes.businessProfileId, this.scope.businessProfileId),
                eq(envelopes.envelopeId, envelopeId), eq(envelopeVersions.versionId, versionId)))
            .limit(1);
        return rows[0]?.version ?? null;
    }

    async getTemplate(templateId: string) {
        const rows = await this.db.select({ template: envelopeTemplates }).from(envelopeTemplates)
            .innerJoin(businessProfiles, and(eq(businessProfiles.businessProfileId, envelopeTemplates.businessProfileId), eq(businessProfiles.orgId, envelopeTemplates.orgId)))
            .where(and(eq(envelopeTemplates.orgId, this.scope.orgId), eq(envelopeTemplates.businessProfileId, this.scope.businessProfileId), eq(envelopeTemplates.templateId, templateId)))
            .limit(1);
        return rows[0]?.template ?? null;
    }
}
