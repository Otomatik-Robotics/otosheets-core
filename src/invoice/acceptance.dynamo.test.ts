import { describe, expect, it } from 'vitest';
import type { IDdb } from '../ddbPort';
import { InvoiceDynamoRepo } from './repo';
import { QuoteConversionConflictError, QuoteUnavailableError, type ConvertQuoteInput } from './acceptance';

// Small expression interpreter, rather than a stub that always grants writes:
// the actual Dynamo conditions govern whether each simulated transaction commits.
function expression(source: string, row: any, names: any, values: any) {
    const tokens = source.match(/:[\w]+|#[\w]+|[A-Za-z_]\w*|<>|=|\(|\)|,/g) ?? [];
    let index = 0;
    const next = () => tokens[index++];
    const expectToken = (token: string) => { if (next() !== token) throw new Error(`Invalid fixture expression ${source}`); };
    const value = (): any => {
        const token = next();
        if (token?.startsWith(':')) return values[token];
        if (token?.startsWith('#')) return row[names[token]];
        if (token === 'list_append' || token === 'if_not_exists') {
            expectToken('('); const a = value(); expectToken(','); const b = value(); expectToken(')');
            return token === 'list_append' ? [...a, ...b] : a === undefined ? b : a;
        }
        return row[token];
    };
    const atom = (): boolean => {
        if (tokens[index] === '(') { next(); const result = or(); expectToken(')'); return result; }
        if (['attribute_exists', 'attribute_not_exists', 'contains'].includes(tokens[index])) {
            const fn = next(); expectToken('('); const a = value();
            if (fn === 'contains') { expectToken(','); const b = value(); expectToken(')'); return !!a?.includes(b); }
            expectToken(')'); return fn === 'attribute_exists' ? a !== undefined : a === undefined;
        }
        if (tokens[index] === 'NOT') { next(); return !atom(); }
        const a = value(), operator = next();
        if (operator === 'IN') {
            expectToken('('); const options = [value()];
            while (tokens[index] === ',') { next(); options.push(value()); }
            expectToken(')'); return options.includes(a);
        }
        const same = JSON.stringify(a) === JSON.stringify(value());
        return operator === '=' ? same : operator === '<>' ? !same : false;
    };
    const and = (): boolean => { let result = atom(); while (tokens[index] === 'AND') { next(); const right = atom(); result = result && right; } return result; };
    const or = (): boolean => { let result = and(); while (tokens[index] === 'OR') { next(); const right = and(); result = result || right; } return result; };
    return { condition: or, assign: () => {
        expectToken('SET'); const updated = { ...row };
        do { const key = next(); expectToken('='); updated[names[key]] = value(); if (tokens[index] !== ',') break; next(); } while (index < tokens.length);
        if (tokens[index] === 'REMOVE') { next(); while (index < tokens.length) { const key = next(); if (key !== ',') delete updated[names[key]]; } }
        return updated;
    } };
}
function fixture() {
    const rows = new Map<string, any>();
    const key = (item: any) => `${item.orgId}|${item.sk}`;
    const copy = (item: any) => item ? structuredClone(item) : item;
    const fail = (name = 'ConditionalCheckFailedException') => { throw Object.assign(new Error('Condition failed'), { name, CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] }); };
    let beforeTransaction: (() => void) | undefined;
    const db = {
        async getItem(_table: string, id: any) { return { Item: copy(rows.get(key(id))) }; },
        async put(_table: string, item: any) { rows.set(key(item), copy(item)); return {}; },
        async query(params: any) { return { Items: [...rows.values()].filter(row => row.orgId === params.ExpressionAttributeValues[':orgId'] && row.invoiceId === params.ExpressionAttributeValues[':invoiceId']).map(copy) }; },
        async scan(params: any) { return { Items: [...rows.values()].filter(row => expression(params.FilterExpression, row, params.ExpressionAttributeNames, params.ExpressionAttributeValues).condition()).slice(0, params.Limit).map(copy) }; },
        async update(_table: string, id: any, params: any) {
            const row = rows.get(key(id)) ?? {};
            if (!expression(params.ConditionExpression, row, params.ExpressionAttributeNames, params.ExpressionAttributeValues).condition()) fail();
            rows.set(key(id), expression(params.UpdateExpression, row, params.ExpressionAttributeNames, params.ExpressionAttributeValues).assign());
            return {};
        },
        async transactWrite(items: any[]) {
            beforeTransaction?.(); beforeTransaction = undefined;
            const pending: Array<[string, any]> = [];
            for (const item of items) {
                const operation = item.Update ?? item.Put ?? item.Delete;
                const id = operation.Key ?? operation.Item, row = rows.get(key(id)) ?? {};
                if (!expression(operation.ConditionExpression, row, operation.ExpressionAttributeNames ?? {}, operation.ExpressionAttributeValues ?? {}).condition()) fail('TransactionCanceledException');
                pending.push([key(id), item.Delete ? null : item.Put ? copy(item.Put.Item) : expression(operation.UpdateExpression, row, operation.ExpressionAttributeNames, operation.ExpressionAttributeValues).assign()]);
            }
            for (const [id, row] of pending) row === null ? rows.delete(id) : rows.set(id, row);
            return {};
        },
    };
    return { rows, repo: new InvoiceDynamoRepo(db as unknown as IDdb), onTransaction: (callback: () => void) => { beforeTransaction = callback; } };
}
const token = 'a'.repeat(64), today = new Date().toISOString().slice(0, 10), now = new Date().toISOString();
const input: ConvertQuoteInput = { orgId: 'org', ownerId: 'owner', quoteId: 'quote', invoiceId: 'invoice', invoiceNumber: 'INV-1', now, today, dueDate: '2099-01-01', tokenHash: token };
async function seeded(overrides: any = {}) {
    const state = fixture();
    await state.repo.createInvoice('org', 'owner', 'quote', { invoiceNumber: 'QUO-1', isQuote: true, status: 'SENT', dueDate: '2099-01-01', date: today, subtotal: 50, gstAmount: 5, totalAmount: 55, taxRate: 0.1, gstMode: 'EXCLUSIVE', items: [{ id: 'q-line', description: 'Scope', quantity: 1, unitPrice: 50, total: 50, sortOrder: 0, cost: 12, priceBookItemId: 'book-line' }], ...overrides });
    await state.repo.issueQuoteAcceptanceToken('org', 'owner', 'quote', token);
    return state;
}

describe('Dynamo quote acceptance conditions', () => {
    it('atomically creates one draft invoice, replays without overwriting later edits, and returns one notification winner', async () => {
        const { repo } = await seeded();
        const accepted = await repo.convertQuote(input);
        expect(accepted.invoice).toMatchObject({ status: 'DRAFT', totalAmount: 55, sourceQuoteId: 'quote', createdBy: 'owner' });
        expect(accepted.invoice.items[0]).toMatchObject({ cost: 12, priceBookItemId: 'book-line' });
        await repo.updateInvoice('org', 'owner', 'invoice', { notes: 'New invoice details' });
        const replay = await repo.convertQuote({ ...input, invoiceId: 'another', invoiceNumber: 'INV-2' });
        expect(replay.alreadyConverted).toBe(true);
        expect(replay.invoice).toMatchObject({ invoiceId: 'invoice', notes: 'New invoice details' });
        expect(await repo.getInvoice('org', 'owner', 'another')).toBeNull();
        expect(await repo.listPendingQuoteAcceptances()).toHaveLength(1);
        expect(await repo.markQuoteAcceptancePublished('org', 'owner', 'quote', accepted.quote.quoteAcceptedEventId!)).toBe(true);
        expect(await repo.markQuoteAcceptancePublished('org', 'owner', 'quote', accepted.quote.quoteAcceptedEventId!)).toBe(false);
        expect(await repo.listPendingQuoteAcceptances()).toHaveLength(0);
    });
    it('supports multiple private tokens, keeps them on resend and removes them on financial edits', async () => {
        const { repo } = await seeded();
        await repo.issueQuoteAcceptanceToken('org', 'owner', 'quote', token);
        await repo.issueQuoteAcceptanceToken('org', 'owner', 'quote', 'b'.repeat(64));
        await repo.updateInvoice('org', 'owner', 'quote', { status: 'SENT' });
        expect((await repo.getInvoiceForMirror('org', 'owner', 'quote'))?.quoteAcceptanceTokenHashes).toHaveLength(2);
        expect(await repo.getInvoice('org', 'owner', 'quote')).not.toHaveProperty('quoteAcceptanceTokenHashes');
        expect((await repo.findInvoiceByIdInOrg('org', 'quote'))?.invoice).not.toHaveProperty('quoteAcceptanceTokenHashes');
        expect(await repo.getQuoteForAcceptance('org', 'quote', token)).not.toBeNull();
        await repo.updateInvoice('org', 'owner', 'quote', { dueDate: '2099-02-02' });
        expect(await repo.getQuoteForAcceptance('org', 'quote', token)).toBeNull();
    });
    it('rejects a void racing the conversion transaction without writing the invoice', async () => {
        const { repo, rows, onTransaction } = await seeded();
        onTransaction(() => { rows.get('org|owner#quote').status = 'VOID'; });
        await expect(repo.convertQuote(input)).rejects.toThrow(QuoteUnavailableError);
        expect(await repo.getInvoice('org', 'owner', 'invoice')).toBeNull();
    });
    it('rejects a changed item even when its updatedAt millisecond has not changed', async () => {
        const { repo, rows, onTransaction } = await seeded();
        onTransaction(() => { rows.get('org|owner#quote').items[0].description = 'Changed scope'; });
        await expect(repo.convertQuote(input)).rejects.toThrow(QuoteConversionConflictError);
        expect(await repo.getInvoice('org', 'owner', 'invoice')).toBeNull();
    });
    it('never overwrites an existing invoice on a proposed ID collision', async () => {
        const { repo } = await seeded();
        await repo.createInvoice('org', 'owner', 'invoice', { invoiceNumber: 'OLD', status: 'PAID', items: [] });
        await expect(repo.convertQuote(input)).rejects.toThrow(QuoteConversionConflictError);
        expect((await repo.getInvoice('org', 'owner', 'quote'))?.status).toBe('SENT');
        expect((await repo.getInvoice('org', 'owner', 'invoice'))?.status).toBe('PAID');
    });
    it('allows one of two concurrent customers to convert and rejects stale owner updates', async () => {
        const { repo } = await seeded();
        const results = await Promise.all([repo.convertQuote(input), repo.convertQuote({ ...input, invoiceId: 'second' })]);
        expect(results.filter(row => !row.alreadyConverted)).toHaveLength(1);
        expect(results[0].invoice.invoiceId).toBe(results[1].invoice.invoiceId);
        await expect(repo.updateInvoice('org', 'owner', 'quote', { status: 'SENT' })).rejects.toThrow();
        await expect(repo.updateInvoice('org', 'owner', 'quote', { notes: 'Stale' })).rejects.toThrow();
    });
    it('rejects expired or unknown customer capabilities', async () => {
        const { repo } = await seeded({ dueDate: '2000-01-01' });
        expect(await repo.getQuoteForAcceptance('org', 'quote', token)).not.toBeNull();
        await expect(repo.convertQuote(input)).rejects.toThrow(QuoteUnavailableError);
        await expect(repo.convertQuote({ ...input, tokenHash: 'b'.repeat(64) })).rejects.toThrow(QuoteUnavailableError);
        expect(await repo.getInvoice('org', 'owner', 'invoice')).toBeNull();
    });
    it('conditionally protects the converted quote against a stale delete', async () => {
        const { repo } = await seeded();
        await repo.convertQuote(input);
        await expect(repo.deleteInvoice('org', 'owner', 'quote')).rejects.toThrow(QuoteConversionConflictError);
        expect((await repo.getInvoice('org', 'owner', 'quote'))?.status).toBe('CONVERTED');
    });
});
