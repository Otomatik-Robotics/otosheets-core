import type { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk } from '../keys';
import type { InvoiceDynamoRepo } from './repo';
import type { Invoice } from './schema';
import { availableQuote, checkTokenHash, conversionUpdates, convertedInvoice, publicInvoice, validateConversion,
    QuoteConversionConflictError, QuoteUnavailableError, type ConvertQuoteInput, type QuoteConversionResult, type PendingQuoteAcceptance, type PrivateInvoice } from './acceptance';

export async function issueToken(ddb: IDdb, orgId: string, ownerId: string, quoteId: string, tokenHash: string): Promise<void> {
    checkTokenHash(tokenHash);
    try {
        await ddb.update(Tables.INVOICES, { orgId, sk: sk(ownerId, quoteId) }, {
            UpdateExpression: 'SET #tokens = list_append(if_not_exists(#tokens, :empty), :token), #updatedAt = :now',
            ConditionExpression: '#isQuote = :true AND #status IN (:draft, :sent) AND attribute_not_exists(#converted) AND (attribute_not_exists(#tokens) OR NOT contains(#tokens, :hash))',
            ExpressionAttributeNames: { '#tokens': 'quoteAcceptanceTokenHashes', '#isQuote': 'isQuote', '#status': 'status', '#converted': 'convertedInvoiceId', '#updatedAt': 'updatedAt' },
            ExpressionAttributeValues: { ':empty': [], ':token': [tokenHash], ':hash': tokenHash, ':true': true, ':draft': 'DRAFT', ':sent': 'SENT', ':now': new Date().toISOString() },
        });
    } catch (error: any) {
        if (error?.name !== 'ConditionalCheckFailedException') throw error;
        const { Item } = await ddb.getItem(Tables.INVOICES, { orgId, sk: sk(ownerId, quoteId) }, { ConsistentRead: true });
        if (Item?.isQuote && ['DRAFT', 'SENT'].includes(Item.status) && Item.quoteAcceptanceTokenHashes?.includes(tokenHash)) return;
        throw new QuoteUnavailableError();
    }
}

export async function resolveQuote(repo: InvoiceDynamoRepo, orgId: string, quoteId: string, tokenHash: string): Promise<PendingQuoteAcceptance | null> {
    checkTokenHash(tokenHash);
    const found = await repo.findInvoiceByIdInOrg(orgId, quoteId);
    if (!found) return null;
    const quote = await repo.getInvoiceForMirror(orgId, found.ownerId, quoteId);
    return availableQuote(quote, tokenHash) ? { quote: publicInvoice(quote), ownerId: found.ownerId } : null;
}

export async function convert(ddb: IDdb, repo: InvoiceDynamoRepo, input: ConvertQuoteInput): Promise<QuoteConversionResult> {
    const read = () => repo.getInvoiceForMirror(input.orgId, input.ownerId, input.quoteId);
    const quote = await read();
    validateConversion(input, quote);
    const existingResult = async (converted: PrivateInvoice): Promise<QuoteConversionResult> => {
        const invoice = await repo.getInvoiceForMirror(input.orgId, input.ownerId, converted.convertedInvoiceId!);
        if (!invoice || invoice.sourceQuoteId !== input.quoteId) throw new QuoteConversionConflictError('The converted invoice is unavailable.');
        return { quote: publicInvoice(converted), invoice: publicInvoice(invoice), alreadyConverted: true };
    };
    if (quote.status === 'CONVERTED') return existingResult(quote);
    const invoice = convertedInvoice(quote, input), updates = conversionUpdates(input);
    const names: Record<string, string> = { '#isQuote': 'isQuote', '#status': 'status', '#converted': 'convertedInvoiceId', '#updatedAt': 'updatedAt' };
    const values: Record<string, any> = { ':true': true, ':previousStatus': quote.status, ':status': 'CONVERTED', ':invoiceId': input.invoiceId, ':now': input.now };
    const checks = ['#isQuote = :true', '#status = :previousStatus', 'attribute_not_exists(#converted)'];
    if (quote.updatedAt) { checks.push('#updatedAt = :previousAt'); values[':previousAt'] = quote.updatedAt; }
    else checks.push('attribute_not_exists(#updatedAt)');
    // Compare the agreed fields too: an edit in the same millisecond must not
    // sneak through an updatedAt-only check and create a stale invoice.
    for (const key of ['items', 'clientId', 'dueDate', 'subtotal', 'gstMode', 'gstAmount', 'totalAmount', 'taxRate', 'taxLabel', 'notes']) {
        names[`#read_${key}`] = key;
        if ((quote as any)[key] === undefined) checks.push(`attribute_not_exists(#read_${key})`);
        else { checks.push(`#read_${key} = :read_${key}`); values[`:read_${key}`] = (quote as any)[key]; }
    }
    const sets = ['#status = :status', '#converted = :invoiceId', '#updatedAt = :now'];
    if (input.tokenHash !== undefined) {
        names['#tokens'] = 'quoteAcceptanceTokenHashes'; values[':hash'] = input.tokenHash;
        checks.push('contains(#tokens, :hash)');
        names['#acceptedAt'] = 'quoteAcceptedAt'; names['#eventId'] = 'quoteAcceptedEventId';
        values[':eventId'] = updates.quoteAcceptedEventId;
        sets.push('#acceptedAt = :now', '#eventId = :eventId');
    }
    try {
        await ddb.transactWrite([
            { Update: { TableName: Tables.INVOICES, Key: { orgId: input.orgId, sk: sk(input.ownerId, input.quoteId) },
                UpdateExpression: `SET ${sets.join(', ')}`, ConditionExpression: checks.join(' AND '),
                ExpressionAttributeNames: names, ExpressionAttributeValues: values } },
            { Put: { TableName: Tables.INVOICES, Item: invoice, ConditionExpression: 'attribute_not_exists(sk)' } },
        ]);
    } catch (error: any) {
        if (error?.name !== 'TransactionCanceledException') throw error;
        const current = await read();
        validateConversion(input, current);
        if (current.status === 'CONVERTED' && current.convertedInvoiceId) return existingResult(current);
        throw new QuoteConversionConflictError();
    }
    return { quote: publicInvoice({ ...quote, ...updates }), invoice, alreadyConverted: false };
}

export async function pending(ddb: IDdb, requestedLimit: number): Promise<PendingQuoteAcceptance[]> {
    const limit = Math.max(1, Math.min(100, requestedLimit)), items: PendingQuoteAcceptance[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
        const page = await ddb.scan({ TableName: Tables.INVOICES, ConsistentRead: true,
            FilterExpression: 'attribute_exists(#accepted) AND attribute_not_exists(#published)',
            ExpressionAttributeNames: { '#accepted': 'quoteAcceptedAt', '#published': 'quoteAcceptancePublishedAt' },
            Limit: limit - items.length, ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        });
        for (const row of page.Items ?? []) items.push({ quote: publicInvoice(row as PrivateInvoice), ownerId: row.sk.split('#')[0] });
        lastKey = page.LastEvaluatedKey;
    } while (lastKey && items.length < limit);
    return items;
}

export async function published(ddb: IDdb, orgId: string, ownerId: string, quoteId: string, eventId: string): Promise<boolean> {
    try {
        await ddb.update(Tables.INVOICES, { orgId, sk: sk(ownerId, quoteId) }, {
            UpdateExpression: 'SET #published = :now, #updatedAt = :now',
            ConditionExpression: '#eventId = :eventId AND attribute_exists(#accepted) AND attribute_not_exists(#published)',
            ExpressionAttributeNames: { '#published': 'quoteAcceptancePublishedAt', '#eventId': 'quoteAcceptedEventId', '#accepted': 'quoteAcceptedAt', '#updatedAt': 'updatedAt' },
            ExpressionAttributeValues: { ':now': new Date().toISOString(), ':eventId': eventId },
        });
        return true;
    } catch (error: any) {
        if (error?.name !== 'ConditionalCheckFailedException') throw error;
        const { Item } = await ddb.getItem(Tables.INVOICES, { orgId, sk: sk(ownerId, quoteId) }, { ConsistentRead: true });
        if (Item?.quoteAcceptedEventId !== eventId || !Item?.quoteAcceptancePublishedAt) throw new QuoteUnavailableError();
        return false;
    }
}
