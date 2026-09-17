import type { Invoice } from './schema';

export interface ConvertQuoteInput {
    orgId: string;
    ownerId: string;
    quoteId: string;
    invoiceId: string;
    invoiceNumber: string;
    now: string;
    today: string;
    dueDate: string;
    /** Present only for the customer capability; an authenticated owner omits it. */
    tokenHash?: string;
}
export interface QuoteConversionResult { quote: Invoice; invoice: Invoice; alreadyConverted: boolean }
export interface PendingQuoteAcceptance { quote: Invoice; ownerId: string }
export type PrivateInvoice = Invoice & { quoteAcceptanceTokenHashes?: string[] | null };

export class QuoteUnavailableError extends Error {
    constructor(message = 'This quote is unavailable or has expired.') { super(message); this.name = 'QuoteUnavailableError'; }
}
export class QuoteConversionConflictError extends Error {
    constructor(message = 'The quote changed. Refresh it and try again.') { super(message); this.name = 'QuoteConversionConflictError'; }
}

/** Capabilities never escape through ordinary list/detail DTOs. */
export function publicInvoice(invoice: PrivateInvoice): Invoice {
    const { quoteAcceptanceTokenHashes: _tokens, ...publicFields } = invoice;
    return publicFields;
}
export function checkTokenHash(tokenHash: string): void {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new QuoteUnavailableError();
}
export function hasQuoteToken(quote: PrivateInvoice, tokenHash: string): boolean {
    return /^[a-f0-9]{64}$/.test(tokenHash) && Array.isArray(quote.quoteAcceptanceTokenHashes)
        && quote.quoteAcceptanceTokenHashes.includes(tokenHash);
}
/** Lookup authenticates the capability. The caller applies the business's local date;
 * conversion rechecks expiry atomically using that same authoritative date. */
export function availableQuote(quote: PrivateInvoice | null, tokenHash: string): quote is PrivateInvoice {
    return !!quote?.isQuote && hasQuoteToken(quote, tokenHash)
        && (quote.status === 'CONVERTED' && !!quote.convertedInvoiceId
            || quote.status === 'SENT');
}
export function validateConversion(input: ConvertQuoteInput, quote: PrivateInvoice | null): asserts quote is PrivateInvoice {
    if (!quote?.isQuote || quote.orgId !== input.orgId || quote.invoiceId !== input.quoteId
        || quote.sk.split('#')[0] !== input.ownerId) throw new QuoteUnavailableError();
    if (input.tokenHash !== undefined && !hasQuoteToken(quote, input.tokenHash)) throw new QuoteUnavailableError();
    if (quote.status === 'CONVERTED' && quote.convertedInvoiceId) return;
    if (quote.status === 'CONVERTED') throw new QuoteConversionConflictError('This quote was already converted.');
    if (input.tokenHash !== undefined) {
        if (quote.status !== 'SENT' || !quote.dueDate || quote.dueDate.slice(0, 10) < input.today) throw new QuoteUnavailableError();
    } else if (!['DRAFT', 'SENT', 'ACCEPTED'].includes(quote.status)) throw new QuoteUnavailableError();
    if (!input.invoiceId || input.invoiceId === input.quoteId || !input.invoiceNumber
        || !/^\d{4}-\d{2}-\d{2}$/.test(input.today) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
        || !Number.isFinite(Date.parse(input.now))) throw new QuoteConversionConflictError('Invalid conversion details.');
}
/** Agreed values are copied, never recalculated using today's tax or price book. */
export function convertedInvoice(quote: Invoice, input: ConvertQuoteInput): Invoice {
    const fields: Record<string, unknown> = {};
    for (const key of ['clientId', 'subtotal', 'gstMode', 'gstAmount', 'totalAmount', 'taxRate', 'taxLabel', 'notes']) {
        if ((quote as any)[key] !== undefined) fields[key] = (quote as any)[key];
    }
    return {
        ...fields,
        invoiceId: input.invoiceId, orgId: input.orgId, sk: `${input.ownerId}#${input.invoiceId}`,
        createdBy: input.ownerId, invoiceNumber: input.invoiceNumber,
        date: input.today, dueDate: input.dueDate, dueDateSk: `${input.dueDate}#${input.invoiceId}`,
        status: 'DRAFT', isQuote: false, isPaymentLink: false, isRecurring: false, paidAmount: 0,
        sourceQuoteId: quote.invoiceId,
        items: (quote.items ?? []).map((item, index) => ({ ...item, id: `${input.invoiceId}#${index}`, sortOrder: index })),
        createdAt: input.now, updatedAt: input.now,
    } as Invoice;
}
export function conversionUpdates(input: ConvertQuoteInput): Partial<Invoice> {
    return {
        status: 'CONVERTED', convertedInvoiceId: input.invoiceId, updatedAt: input.now,
        ...(input.tokenHash !== undefined ? {
            quoteAcceptedAt: input.now, quoteAcceptedEventId: `quote-accepted:${input.orgId}:${input.quoteId}`,
        } : {}),
    };
}
/** State changes with financial side effects can only pass through the atomic conversion method. */
export function protectQuoteUpdates(updates: Record<string, any>): void {
    if (['quoteAcceptanceTokenHashes', 'convertedInvoiceId', 'sourceQuoteId', 'quoteAcceptedAt', 'quoteAcceptedEventId', 'quoteAcceptancePublishedAt']
        .some(key => key in updates)) throw new QuoteConversionConflictError('Quote acceptance fields cannot be edited.');
    if (updates.status === 'CONVERTED' || updates.status === 'ACCEPTED') throw new QuoteConversionConflictError('Use quote conversion to accept this quote.');
}
export function invalidatesQuoteTokens(updates: Record<string, any>): boolean {
    return ['items', 'clientId', 'date', 'dueDate', 'subtotal', 'gstMode', 'gstAmount', 'totalAmount', 'taxRate', 'taxLabel', 'notes', 'invoiceNumber']
        .some(key => key in updates);
}
