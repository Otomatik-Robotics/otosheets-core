/**
 * Documents (envelopes): types, and the tier rules.
 *
 * The tier engine lives here rather than in a handler on purpose. Drafting and
 * uploading are two different entry points, and a refusal list inside either one
 * is the tier engine built twice and badly. `kind` is a required enumerated
 * choice; `tier` is a pure lookup from it and is never accepted from a caller.
 */

export const ENVELOPE_KINDS = [
    // Tier 0, sales. Freely drafted.
    'proposal',
    'quote_cover',
    'scope_of_works',
    'capability_statement',
    // Tier 1, standard. Review offered, drafting held back pending policy.
    'subcontractor_agreement',
    'service_agreement',
    'nda',
    'deposit_terms',
    'variation_terms',
    // Tier 2, regulated. Refused outright: these are the Australian cases where
    // a contract is voidable without independent advice.
    'employment',
    'guarantor',
    'prenuptial',
    'small_business_loan',
] as const;
export type EnvelopeKind = typeof ENVELOPE_KINDS[number];

export type EnvelopeTier = 0 | 1 | 2;

const KIND_TIER: Record<EnvelopeKind, EnvelopeTier> = {
    proposal: 0,
    quote_cover: 0,
    scope_of_works: 0,
    capability_statement: 0,
    subcontractor_agreement: 1,
    service_agreement: 1,
    nda: 1,
    deposit_terms: 1,
    variation_terms: 1,
    employment: 2,
    guarantor: 2,
    prenuptial: 2,
    small_business_loan: 2,
};

export function isEnvelopeKind(v: unknown): v is EnvelopeKind {
    return typeof v === 'string' && (ENVELOPE_KINDS as readonly string[]).includes(v);
}

/** The only way a tier is ever set. Throws rather than defaulting, so an unknown kind cannot land as tier 0. */
export function tierForKind(kind: string): EnvelopeTier {
    if (!isEnvelopeKind(kind)) throw new Error(`Unknown document kind: ${kind}`);
    return KIND_TIER[kind];
}

/** Tier 2 is refused at both entry points. Fails closed on an unknown kind. */
export function isRefusedKind(kind: string): boolean {
    try {
        return tierForKind(kind) >= 2;
    } catch {
        return true;
    }
}

/** Drafting is tier 0 only for now: tier 1 is where review is offered, which is an unanswered policy question. */
export function canDraftKind(kind: string): boolean {
    try {
        return tierForKind(kind) === 0;
    } catch {
        return false;
    }
}

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
