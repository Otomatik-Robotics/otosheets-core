/**
 * DomainPurchase — the agent-purchase state machine for domains bought
 * through Otosheets (Route 53 Domains, customer as registrant of record).
 *
 * DynamoDB-only entity (keyed/ephemeral state machine — fetched by key and
 * polled, never joined or reported on), so it stays on DynamoDB permanently.
 * Table `expense-app-domain-purchases-{env}`, PK `orgId`, SK `purchaseId`,
 * sparse GSI `PendingOperationsIndex` (`pendingKey` / `purchaseId`).
 *
 * Status machine (all transitions are conditional writes):
 *
 *   pending_payment → registering → registered → delegated → released
 *                          └───────────→ failed_refunded
 *
 * - pending_payment  record created; Stripe charge in flight/settled
 * - registering      RegisterDomain submitted, operation polling
 * - registered       registrar operation SUCCESSFUL; hosted zone + alias exist
 * - delegated        registrar NS point at our hosted zone (site pipeline owns
 *                    the rest: cert → CloudFront attach)
 * - released         transfer lock off + auth code delivered to the owner
 *                    (DNS/alias/site are deliberately left untouched)
 * - failed_refunded  registrar operation failed; Stripe charge refunded
 *
 * Explicit interfaces are exported alongside the Zod schemas because
 * `z.infer` types do not survive the generated `.d.ts` boundary across Zod
 * majors (same rule as the site/launchRun/socialPost entities).
 */
import { z } from 'zod';

export type DomainPurchaseStatus =
    | 'pending_payment'
    | 'registering'
    | 'registered'
    | 'delegated'
    | 'released'
    | 'failed_refunded';

export const DomainPurchaseStatusSchema = z.enum([
    'pending_payment',
    'registering',
    'registered',
    'delegated',
    'released',
    'failed_refunded',
]);

/** Registrant of record — ALWAYS the customer, never Otosheets (invariant #1). */
export interface RegistrantContact {
    firstName: string;
    lastName: string;
    /** Business/legal entity name — the auDA licensee for .au domains. */
    organizationName?: string;
    email: string;
    phone: string;
    addressLine1: string;
    city: string;
    state: string;
    zipCode: string;
    /** ISO 3166-1 alpha-2, e.g. 'AU'. */
    countryCode: string;
}

export const RegistrantContactSchema = z.object({
    firstName: z.string(),
    lastName: z.string(),
    organizationName: z.string().optional(),
    email: z.string(),
    phone: z.string(),
    addressLine1: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    countryCode: z.string(),
});

export interface DomainPurchaseQuote {
    /** Route 53 registration price (USD, as returned by ListPrices). */
    registrationUsd: number;
    /** Renewal price (USD) — display only; renewals bill later. */
    renewalUsd: number;
    /** What the customer is charged, in AUD cents (pass-through + buffer). */
    amountAudCents: number;
    /** USD→AUD rate used at quote time. */
    fxRate: number;
    /** Buffer multiplier applied on top of the converted price. */
    buffer: number;
}

export const DomainPurchaseQuoteSchema = z.object({
    registrationUsd: z.number(),
    renewalUsd: z.number(),
    amountAudCents: z.number(),
    fxRate: z.number(),
    buffer: z.number(),
});

export interface DomainPurchase {
    orgId: string;
    /** Deterministic: 'dp-' + sha256(orgId + '#' + domain) — never a fresh ULID. */
    purchaseId: string;
    domain: string;
    /** Everything after the first label, e.g. 'com.au'. */
    tld: string;
    status: DomainPurchaseStatus;
    /** Canonical site row (Sites table PK) the domain attaches to on success. */
    siteHost: string;
    registrantContact: RegistrantContact;
    /** Customer ABN — RegisterDomain ExtraParams AU_ID_NUMBER for .au TLDs. */
    abn?: string;
    quote: DomainPurchaseQuote;

    /** Stripe PaymentIntent id (idempotency key: purchase-{orgId}-{domain}). */
    stripePaymentIntentId?: string;
    /** Conditional single-flight claim around the (non-idempotent) RegisterDomain call. */
    registerClaimedAt?: string;
    /** Route 53 Domains operation id, stored conditionally once. */
    operationId?: string;

    hostedZoneId?: string;
    nsRecords?: string[];
    registeredAt?: string;
    delegatedAt?: string;
    /** Registrar-transfer eligibility (ICANN 60-day gTLD lock; .au per auDA). */
    earliestTransferAt?: string;

    releasedAt?: string;
    /** Conditional sent-marker — claimed BEFORE the auth-code email is sent. */
    authCodeEmailSentAt?: string;

    refundId?: string;
    failedAt?: string;
    lastError?: string;

    createdAt: string;
    updatedAt: string;

    /**
     * Sparse-GSI attribute (PendingOperationsIndex). Present ('PENDING') while
     * status is registering/registered so the watcher polls only in-flight
     * purchases; removed on every terminal/settled transition.
     */
    pendingKey?: string;
}

export const DomainPurchaseSchema = z.object({
    orgId: z.string(),
    purchaseId: z.string(),
    domain: z.string(),
    tld: z.string(),
    status: DomainPurchaseStatusSchema,
    siteHost: z.string(),
    registrantContact: RegistrantContactSchema,
    abn: z.string().optional(),
    quote: DomainPurchaseQuoteSchema,

    stripePaymentIntentId: z.string().optional(),
    registerClaimedAt: z.string().optional(),
    operationId: z.string().optional(),

    hostedZoneId: z.string().optional(),
    nsRecords: z.array(z.string()).optional(),
    registeredAt: z.string().optional(),
    delegatedAt: z.string().optional(),
    earliestTransferAt: z.string().optional(),

    releasedAt: z.string().optional(),
    authCodeEmailSentAt: z.string().optional(),

    refundId: z.string().optional(),
    failedAt: z.string().optional(),
    lastError: z.string().optional(),

    createdAt: z.string(),
    updatedAt: z.string(),

    pendingKey: z.string().optional(),
});

/** Sparse-GSI partition value — present only while the watcher owes work. */
export const DOMAIN_PURCHASE_PENDING_KEY = 'PENDING';

/** Statuses the watcher still has work to do for (sparse-GSI membership). */
export const PENDING_STATUSES: DomainPurchaseStatus[] = ['registering', 'registered'];

/** GSI name for the sparse pending-operations index the watcher sweeps. */
export const PENDING_OPERATIONS_INDEX = 'PendingOperationsIndex';
