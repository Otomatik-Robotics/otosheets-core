/**
 * Documents (envelopes): the tier rules, and the recipient role rules.
 *
 * The tier engine lives here rather than in a handler on purpose. Drafting and
 * uploading are two different entry points, and a refusal list inside either one
 * is the tier engine built twice and badly. `kind` is a required enumerated
 * choice; `tier` is a pure lookup from it and is never accepted from a caller.
 *
 * The per-kind data itself moved to `registry.ts`, and these functions now read
 * it. There is deliberately no second tier table here: two copies is how a
 * tier 2 kind eventually ships as tier 0.
 */

import {
    CONTRACT_TYPES, ENVELOPE_KINDS, tryContractType,
    type DraftMode, type EnvelopeAnswers, type EnvelopeKind, type EnvelopeTier,
} from './registry';

/*
 * The tier gate moved to registry.ts, and is re-exported here.
 *
 * It is a pure lookup over the registry with no imports of its own, and the
 * BROWSER needs it: a type grid has to know which kinds are refused, and it
 * cannot reach for this file, because schema.ts is on the path that pulls the
 * repos and with them a database driver. Living beside the data it reads also
 * removes the last way a second tier table could appear.
 */
export {
    isEnvelopeKind, tierForKind, isRefusedKind,
    draftModesForKind, canDraftKind, canDraftFromQuestionnaire,
} from './registry';

export type EnvelopeStatus =
    | 'draft' | 'in_review' | 'out_for_signing' | 'completed' | 'declined' | 'voided' | 'expired';

export type RecipientRole = 'signer' | 'reviewer' | 'viewer';

export type RecipientStatus =
    | 'pending' | 'dispatched' | 'opened' | 'signed' | 'declined' | 'reviewed' | 'bounced' | 'revoked';

export type ReviewVerdict = 'approved' | 'changes_proposed' | 'rejected';

export type FieldType = 'signature' | 'initial' | 'date' | 'text';

export type ArtifactKind = 'original' | 'sealed' | 'certificate';

export type AccessCodeChannel = 'sms' | 'spoken' | 'email' | 'none';

/**
 * Only a signer may hold a field, and only a reviewer may return a verdict.
 * Expressed as functions so both the repo and the handlers ask the same
 * question. The inherited implementation kept role as a label used only for an
 * audit string, which is why its reviewers could sign.
 */
export function canHoldFields(role: RecipientRole): boolean {
    return role === 'signer';
}
export function canSign(role: RecipientRole): boolean {
    return role === 'signer';
}
export function canReturnVerdict(role: RecipientRole): boolean {
    return role === 'reviewer';
}

export interface EnvelopeDTO {
    envelopeId: string;
    orgId: string;
    businessProfileId?: string | null;
    createdBy: string;
    title: string;
    kind: EnvelopeKind;
    tier: EnvelopeTier;
    status: EnvelopeStatus;
    currentVersionNo: number;
    holdSignersForReview: boolean;

    // What the document was drafted FROM. Persisted so a regenerate can prefill
    // rather than asking everything again, and so the chain has a record of the
    // jurisdiction a contract was actually drafted under. Null on an upload.
    answers?: EnvelopeAnswers | null;
    /** An AU state or territory code. Validate with isAustralianJurisdiction from the registry. */
    jurisdiction?: string | null;
    /** YYYY-MM-DD. When the document takes effect, which is neither when it was created nor when it was signed. */
    effectiveDate?: string | null;

    completedAt?: string | null;
    voidedAt?: string | null;
    voidedReason?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface EnvelopeRecipientDTO {
    recipientId: string;
    envelopeId: string;
    role: RecipientRole;
    orderNo: number;
    name?: string | null;
    email: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
    accessCodeChannel?: AccessCodeChannel | null;
    status: RecipientStatus;
    dispatchedAt?: string | null;
    firstOpenedAt?: string | null;
    completedAt?: string | null;
    sesMessageId?: string | null;
    bouncedAt?: string | null;
    bounceType?: string | null;
    bounceReason?: string | null;
    verdict?: ReviewVerdict | null;
    verdictAt?: string | null;
    verdictNote?: string | null;
    createdAt: string;
    updatedAt: string;
}
