import { z } from 'zod';

/**
 * Order — a storefront shop order (table `expense-app-orders-{env}`, PK `orgId`,
 * SK `orderId`). The `orderId` is **deterministic** (`ord-{stripeSessionId}`) so a
 * webhook replay lands on the same row and the conditional create no-ops.
 *
 * DynamoDB-only. Each paid order is **dual-written as a paid invoice** by the webhook,
 * which is what carries shop revenue into the Postgres ledger / reporting / reconciliation
 * — this row owns the fulfilment lifecycle the invoice doesn't model.
 *
 * `OrgCreatedIndex` GSI (PK `orgId`, SK `createdAt`) backs newest-first, cursor-paginated
 * listing without an in-memory sort. A per-org `COUNTER` item (orderId = `COUNTER`) holds
 * the sequential `orderNumber` seed (atomic ADD).
 *
 * Explicit interfaces (not z.infer) — see the product schema note.
 */

export const ORDER_STATUSES = [
    'pending', 'paid', 'fulfilled', 'shipped', 'cancelled', 'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Special SK for the per-org order-number counter item. */
export const ORDER_COUNTER_SK = 'COUNTER';
/** GSI: newest-first order listing per org. */
export const ORDER_ORG_CREATED_INDEX = 'OrgCreatedIndex';

export const OrderLineSchema = z.object({
    productId: z.string(),
    variantId: z.string().optional(),
    /** Immutable transaction facts — captured at purchase time (like an invoice line). */
    title: z.string(),
    variantLabel: z.string().optional(),
    unitPriceCents: z.number().int().nonnegative(),
    qty: z.number().int().positive(),
});
export interface OrderLine {
    productId: string;
    variantId?: string;
    title: string;
    variantLabel?: string;
    unitPriceCents: number;
    qty: number;
}

export const OrderAddressSchema = z.object({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    state: z.string().optional(),
    postcode: z.string(),
    country: z.string(),
});
export interface OrderAddress {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postcode: string;
    country: string;
}

export const OrderSchema = z.object({
    orgId: z.string(),
    orderId: z.string(),
    orderNumber: z.number().int().nonnegative(),
    businessProfileId: z.string().nullish(),
    status: z.enum(ORDER_STATUSES),
    buyer: z.object({
        name: z.string(),
        email: z.string(),
        phone: z.string().optional(),
    }),
    shippingAddress: OrderAddressSchema.optional(),
    shippingOption: z.object({ label: z.string(), amountCents: z.number().int().nonnegative() }).optional(),
    lines: z.array(OrderLineSchema),
    subtotalCents: z.number().int().nonnegative(),
    shippingCents: z.number().int().nonnegative().default(0),
    taxCents: z.number().int().nonnegative().default(0),
    totalCents: z.number().int().nonnegative(),
    currency: z.string().default('AUD'),
    stripeSessionId: z.string(),
    stripePaymentIntentId: z.string().optional(),
    linkedInvoiceId: z.string().optional(),
    fulfilment: z.object({
        trackingUrl: z.string().optional(),
        note: z.string().optional(),
        fulfilledAt: z.string().optional(),
        shippedAt: z.string().optional(),
    }).optional(),
    refund: z.object({
        amountCents: z.number().int().nonnegative(),
        refundedAt: z.string(),
        stripeRefundId: z.string().optional(),
    }).optional(),
    /** Conditional email marker — claimed before the buyer receipt is sent. */
    receiptSentAt: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export interface Order {
    orgId: string;
    orderId: string;
    orderNumber: number;
    businessProfileId?: string | null;
    status: OrderStatus;
    buyer: { name: string; email: string; phone?: string };
    shippingAddress?: OrderAddress;
    shippingOption?: { label: string; amountCents: number };
    lines: OrderLine[];
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    currency: string;
    stripeSessionId: string;
    stripePaymentIntentId?: string;
    linkedInvoiceId?: string;
    fulfilment?: { trackingUrl?: string; note?: string; fulfilledAt?: string; shippedAt?: string };
    refund?: { amountCents: number; refundedAt: string; stripeRefundId?: string };
    receiptSentAt?: string;
    createdAt: string;
    updatedAt: string;
}

/** Deterministic order id from the Stripe checkout session id (webhook-replay safe). */
export function orderIdFromSession(sessionId: string): string {
    return `ord-${sessionId}`;
}
