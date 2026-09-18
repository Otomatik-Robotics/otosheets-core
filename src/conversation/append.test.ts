import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import type { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { ConversationRepo, type AppendConversationTurnInput } from './repo';

// Evaluate the repository's actual conditions and update expressions. Writes are
// synchronous/atomic here; reads return independent snapshots, as Dynamo does.
function expression(source: string, row: Record<string, any>, names: Record<string, string>, values: Record<string, any>) {
    const tokens = source.match(/:[\w]+|#[\w]+|[A-Za-z_]\w*|<>|=|\+|\(|\)|,/g) ?? [];
    let index = 0;
    const next = () => tokens[index++];
    const consume = (token: string) => { if (next() !== token) throw new Error(`Invalid fixture expression: ${source}`); };
    const value = (): any => {
        const token = next();
        if (token?.startsWith(':')) return values[token];
        if (token?.startsWith('#')) return row[names[token]];
        if (token === 'list_append') {
            consume('('); const a = value(); consume(','); const b = value(); consume(')');
            if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('list_append requires lists');
            return [...a, ...b];
        }
        throw new Error(`Unexpected value token ${token}`);
    };
    const atom = (): boolean => {
        if (tokens[index] === '(') { next(); const result = or(); consume(')'); return result; }
        if (tokens[index] === 'NOT') { next(); return !atom(); }
        if (['attribute_exists', 'attribute_not_exists', 'contains'].includes(tokens[index])) {
            const fn = next(); consume('('); const a = value();
            if (fn === 'contains') { consume(','); const b = value(); consume(')'); return a instanceof Set ? a.has(b) : !!a?.includes(b); }
            consume(')'); return fn === 'attribute_exists' ? a !== undefined : a === undefined;
        }
        const a = value(); consume('='); return isDeepStrictEqual(a, value());
    };
    const and = (): boolean => { let result = atom(); while (tokens[index] === 'AND') { next(); const right = atom(); result = result && right; } return result; };
    const or = (): boolean => { let result = and(); while (tokens[index] === 'OR') { next(); const right = and(); result = result || right; } return result; };
    return {
        condition: () => { const result = or(); expect(index).toBe(tokens.length); return result; },
        update: () => {
            consume('SET'); const updated = { ...row };
            do {
                const name = names[next()]; consume('='); let result = value();
                if (tokens[index] === '+') { next(); result += value(); }
                updated[name] = structuredClone(result);
                if (tokens[index] !== ',') break; next();
            } while (index < tokens.length);
            if (tokens[index] === 'ADD') {
                next(); const name = names[next()], added = value();
                updated[name] = new Set([...(row[name] ?? []), ...added]);
            }
            expect(index).toBe(tokens.length);
            return updated;
        },
    };
}
const conflict = () => Object.assign(new Error('Condition failed'), { name: 'ConditionalCheckFailedException' });
function fixture(seed?: Record<string, any>) {
    let row = seed ? structuredClone(seed) : undefined;
    let beforeUpdate: (() => void) | undefined;
    let afterUpdate: (() => void) | undefined;
    const db = {
        getItem: vi.fn(async () => ({ Item: row ? structuredClone(row) : undefined })),
        update: vi.fn(async (_table: string, key: Record<string, string>, params: Record<string, any>) => {
            const callback = beforeUpdate; beforeUpdate = undefined; callback?.();
            const { ExpressionAttributeNames: names, ExpressionAttributeValues: values } = params;
            const used = `${params.ConditionExpression} ${params.UpdateExpression}`.match(/#[\w]+|:[\w]+/g) ?? [];
            for (const alias of [...Object.keys(names), ...Object.keys(values)]) expect(used).toContain(alias);
            if (!expression(params.ConditionExpression, row ?? {}, names, values).condition()) throw conflict();
            row = { ...key, ...expression(params.UpdateExpression, row ?? {}, names, values).update() };
            const after = afterUpdate; afterUpdate = undefined; after?.();
            return {};
        }),
    };
    return {
        db, repo: new ConversationRepo(db as unknown as IDdb), get row() { return row!; },
        beforeWrite(callback: () => void) { beforeUpdate = callback; },
        afterWrite(callback: () => void) { afterUpdate = callback; },
    };
}
const args = (mid: string, overrides: Partial<AppendConversationTurnInput> = {}): AppendConversationTurnInput => ({
    organizationId: 'org-1', leadId: 'lead-1', title: 'Email — Jane', source: 'email',
    turn: { mid, role: 'user', content: `Message ${mid}`, at: '2026-09-18T00:00:00.000Z' }, ...overrides,
});
const existing = (overrides: Record<string, any> = {}) => ({
    userId: 'owner', conversationId: 'desk#lead-1', organizationId: 'org-1', leadId: 'lead-1',
    title: 'Existing title', source: 'email', messages: [args('old').turn], messageCount: 1,
    createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z', ...overrides,
});
const append = (state: ReturnType<typeof fixture>, input: AppendConversationTurnInput) => state.repo.appendConversationTurn('owner', 'desk#lead-1', input);

describe('atomic conversation turns', () => {
    it('creates once under concurrent distinct first turns and preserves both sides', async () => {
        const state = fixture();
        const results = await Promise.all([
            append(state, args('inbound', { attrs: { email: { subject: 'Hello', lastMessageId: '<inbound>' } } })),
            append(state, args('outbound', { turn: { ...args('outbound').turn, role: 'assistant', by: 'owner' } })),
        ]);
        expect(results).toEqual([{ appended: true }, { appended: true }]);
        expect(state.row.messages.map((turn: any) => turn.mid)).toEqual(['inbound', 'outbound']);
        expect(state.row).toMatchObject({ organizationId: 'org-1', leadId: 'lead-1', messageCount: 2, title: 'Email — Jane', source: 'email', email: { lastMessageId: '<inbound>' } });
        expect(state.row.messageIds).toEqual(new Set(['inbound', 'outbound']));
        expect(state.db.getItem).toHaveBeenCalledWith(Tables.CONVERSATIONS, { userId: 'owner', conversationId: 'desk#lead-1' }, { ConsistentRead: true });
    });

    it('allows one winner for concurrent duplicate first turns and never rewrites replay attrs', async () => {
        const state = fixture();
        const results = await Promise.all([
            append(state, args('same', { attrs: { email: { lastMessageId: 'original' } } })),
            append(state, args('same', { attrs: { email: { lastMessageId: 'replay' } } })),
        ]);
        expect(results.filter(result => result.appended)).toHaveLength(1);
        expect(state.row.messages).toHaveLength(1);
        const snapshot = structuredClone(state.row);
        expect(await append(state, args('same', { attrs: { email: { lastMessageId: 'later replay' } } }))).toEqual({ appended: false });
        expect(state.row).toEqual(snapshot);
        expect(state.row.email.lastMessageId).toBe('original');
    });

    it('retains concurrent distinct turns on an indexed row, with an atomic count', async () => {
        const state = fixture(existing({ messageIds: new Set(['old']) }));
        await Promise.all(Array.from({ length: 12 }, (_, i) => append(state, args(`m${i}`))));
        expect(state.row.messages).toHaveLength(13);
        expect(new Set(state.row.messages.map((turn: any) => turn.mid)).size).toBe(13);
        expect(state.row.messageIds.size).toBe(13);
        expect(state.row.messageCount).toBe(13);
        expect(state.db.update).toHaveBeenCalledTimes(12);
    });

    it('deduplicates concurrent turns on an indexed row', async () => {
        const state = fixture(existing({ messageIds: new Set(['old']) }));
        const results = await Promise.all(Array.from({ length: 6 }, () => append(state, args('new'))));
        expect(results.filter(result => result.appended)).toHaveLength(1);
        expect(state.row.messages.map((turn: any) => turn.mid)).toEqual(['old', 'new']);
        expect(state.row.messageCount).toBe(2);
    });

    it('does not append or touch attrs when replaying an unindexed historical turn', async () => {
        const state = fixture(existing({ email: { lastMessageId: 'newer' } }));
        const snapshot = structuredClone(state.row);
        expect(await append(state, args('old', { attrs: { email: { lastMessageId: 'older' } } }))).toEqual({ appended: false });
        expect(state.row).toEqual(snapshot);
        expect(state.db.update).not.toHaveBeenCalled();
    });

    it('initializes historical IDs using the exact messages preimage and retries a same-timestamp append', async () => {
        const state = fixture(existing({ messageCount: 999 }));
        state.beforeWrite(() => { state.row.messages.push(args('racing').turn); });
        expect(await append(state, args('new'))).toEqual({ appended: true });
        expect(state.row.messages.map((turn: any) => turn.mid)).toEqual(['old', 'racing', 'new']);
        expect(state.row.messageIds).toEqual(new Set(['old', 'racing', 'new']));
        expect(state.row.messageCount).toBe(3);
        expect(state.db.update).toHaveBeenCalledTimes(2);
        expect(state.row.title).toBe('Existing title');
        expect(state.row.createdAt).toBe('2026-09-17T00:00:00.000Z');
    });

    it('retains distinct concurrent turns during historical migration', async () => {
        const state = fixture(existing());
        await Promise.all([append(state, args('a')), append(state, args('b'))]);
        expect(state.row.messages.map((turn: any) => turn.mid)).toEqual(['old', 'a', 'b']);
        expect(state.row.messageCount).toBe(3);
        expect(state.row.messageIds).toEqual(new Set(['old', 'a', 'b']));
    });

    it.each([undefined, null])('binds a legacy unassigned lead and handles empty historical messages (%s)', async value => {
        const seed = existing();
        if (value === undefined) { delete (seed as any).leadId; delete (seed as any).messages; }
        else { seed.leadId = value as any; seed.messages = value as any; }
        const state = fixture(seed);
        expect(await append(state, args('new'))).toEqual({ appended: true });
        expect(state.row).toMatchObject({ leadId: 'lead-1', messageCount: 1, messages: [args('new').turn] });
    });

    it.each([{ organizationId: 'other' }, { leadId: 'other' }])('rejects foreign scope before writes, including duplicate mids: %j', async scope => {
        const state = fixture(existing(scope));
        await expect(append(state, args('old'))).rejects.toThrow('does not belong');
        expect(state.db.update).not.toHaveBeenCalled();
    });

    it('guards scope again at the atomic write when an unbound lead is claimed concurrently', async () => {
        const seed = existing(); delete (seed as any).leadId;
        const state = fixture(seed);
        state.beforeWrite(() => { state.row.leadId = 'other'; });
        await expect(append(state, args('new'))).rejects.toThrow('does not belong to this lead');
        expect(state.row.messages.map((turn: any) => turn.mid)).toEqual(['old']);
    });

    it('does not overwrite a foreign conversation created after an absent read', async () => {
        const state = fixture();
        state.db.getItem.mockResolvedValueOnce({ Item: undefined });
        // The row exists at update time, but the first read reported absence.
        await append(state, args('original', { organizationId: 'foreign' }));
        state.db.getItem.mockResolvedValueOnce({ Item: undefined });
        await expect(append(state, args('new'))).rejects.toThrow('does not belong to this organisation');
        expect(state.row.messages.map((turn: any) => turn.mid)).toEqual(['original']);
    });

    it('propagates read/write failures and replays an ambiguous successful commit safely', async () => {
        const state = fixture();
        state.db.getItem.mockRejectedValueOnce(new Error('read unavailable'));
        await expect(append(state, args('new'))).rejects.toThrow('read unavailable');
        expect(state.db.update).not.toHaveBeenCalled();
        state.db.update.mockRejectedValueOnce(new Error('write unavailable'));
        await expect(append(state, args('new'))).rejects.toThrow('write unavailable');
        state.afterWrite(() => { throw new Error('connection lost after commit'); });
        await expect(append(state, args('new'))).rejects.toThrow('connection lost after commit');
        expect(await append(state, args('new'))).toEqual({ appended: false });
        expect(state.row.messages).toHaveLength(1);
    });

    it('bounds conditional retry exhaustion instead of reporting false success', async () => {
        const state = fixture(existing());
        state.db.update.mockRejectedValue(conflict());
        await expect(append(state, args('new'))).rejects.toThrow('retry the same turn');
        expect(state.db.update).toHaveBeenCalledTimes(8);
        expect(state.row.messages).toHaveLength(1);
    });

    it('rejects protected attrs and invalid identities before touching storage', async () => {
        const state = fixture();
        await expect(append(state, args(''))).rejects.toThrow('identity');
        await expect(append(state, args('new', { attrs: { organizationId: 'other' } }))).rejects.toThrow('protected');
        await expect(append(state, args('new', { attrs: { messages: [] } }))).rejects.toThrow('protected');
        expect(state.db.getItem).not.toHaveBeenCalled();
    });

    it('merges new email attrs atomically while keeping unrelated thread fields', async () => {
        const state = fixture(existing({ messageIds: new Set(['old']), custom: { keep: true }, email: { lastMessageId: 'old' } }));
        await append(state, args('new', { attrs: { email: { subject: 'Updated', lastMessageId: 'new' }, ignored: undefined } }));
        expect(state.row).toMatchObject({ custom: { keep: true }, email: { subject: 'Updated', lastMessageId: 'new' }, source: 'email', title: 'Existing title' });
        expect(state.row).not.toHaveProperty('ignored');
    });
});
