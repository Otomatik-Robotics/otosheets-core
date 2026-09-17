import { describe, expect, it, vi } from 'vitest';
import type { IInvoiceRepo } from './repo';
import { RoutingInvoiceRepo } from './factory';
import type { ConvertQuoteInput } from './acceptance';
const route = vi.hoisted(() => ({ primary: 'pg', mirror: 'dynamo' }));
vi.mock('../dataBackend', () => ({ resolveRoute: async () => route }));
vi.mock('../dualWrite', () => ({ mirrorWrite: async (_context: unknown, write: () => Promise<void>) => write() }));
const input: ConvertQuoteInput = { orgId: 'org', ownerId: 'owner', quoteId: 'q', invoiceId: 'i', invoiceNumber: 'INV-1', now: '2026-01-01T00:00:00Z', today: '2026-01-01', dueDate: '2026-02-01' };
function repositories() {
    const quote = { invoiceId: 'q', orgId: 'org', sk: 'owner#q', quoteAcceptanceTokenHashes: ['a'.repeat(64)] };
    const invoice = { invoiceId: 'i', orgId: 'org', sk: 'owner#i' };
    const primary = { convertQuote: vi.fn(async () => ({ quote, invoice, alreadyConverted: false })), issueQuoteAcceptanceToken: vi.fn(),
        getInvoiceForMirror: vi.fn(async (_org: string, _owner: string, id: string) => id === 'q' ? quote : invoice),
        markQuoteAcceptancePublished: vi.fn(async () => true), getQuoteForAcceptance: vi.fn(async () => ({ quote, ownerId: 'owner' })), listPendingQuoteAcceptances: vi.fn(async () => []) };
    const mirror = { upsertInvoice: vi.fn(), convertQuote: vi.fn(), issueQuoteAcceptanceToken: vi.fn(), markQuoteAcceptancePublished: vi.fn() };
    const repo = new RoutingInvoiceRepo(mirror as unknown as IInvoiceRepo, primary as unknown as IInvoiceRepo);
    return { primary, mirror, repo, quote, invoice };
}
describe('routed quote acceptance', () => {
    it('runs conversion only on the authoritative store and mirrors both complete entities', async () => {
        const { repo, primary, mirror, quote, invoice } = repositories();
        await repo.convertQuote(input);
        expect(primary.convertQuote).toHaveBeenCalledExactlyOnceWith(input);
        expect(mirror.convertQuote).not.toHaveBeenCalled();
        expect(mirror.upsertInvoice.mock.calls).toEqual([[quote], [invoice]]);
        expect(primary.getInvoiceForMirror.mock.calls).toEqual([['org', 'owner', 'q'], ['org', 'owner', 'i']]);
    });
    it('preserves private capabilities on token issue and publication mirror writes', async () => {
        const { repo, primary, mirror, quote } = repositories();
        await repo.issueQuoteAcceptanceToken('org', 'owner', 'q', 'a'.repeat(64));
        expect(mirror.upsertInvoice).toHaveBeenLastCalledWith(quote);
        expect(await repo.markQuoteAcceptancePublished('org', 'owner', 'q', 'event')).toBe(true);
        expect(primary.markQuoteAcceptancePublished).toHaveBeenCalledExactlyOnceWith('org', 'owner', 'q', 'event');
        expect(mirror.markQuoteAcceptancePublished).not.toHaveBeenCalled();
    });
});
