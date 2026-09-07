import { createHash } from 'node:crypto';

export interface WorkflowInputRequest {
    requestId: string;
    nodeId: string;
    requestedAt: string;
    fields: Array<{ path: string; type: 'string' | 'number' }>;
}
export interface WorkflowInputSubmission {
    requestId: string;
    submissionKey: string;
    actorUserId: string;
    answers: Record<string, unknown>;
}
const reserved = new Set(['orgId', 'userId', 'connectionUserId', 'workflowId', 'runKey', 'requestedBy', 'source', '__proto__', 'prototype', 'constructor']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: string) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

export function inputSubmissionFingerprint(submission: WorkflowInputSubmission) {
    if (!validId(submission.requestId) || !validId(submission.submissionKey) || !submission.actorUserId || !object(submission.answers) || Object.keys(submission.answers).length > 50) throw new Error('Invalid workflow input submission');
    const entries = Object.entries(submission.answers).sort(([a], [b]) => a.localeCompare(b));
    if (entries.some(([, value]) => !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)))) throw new Error('Answers must be text, numbers or booleans');
    if (JSON.stringify(entries).length > 32000) throw new Error('Workflow answers are too large');
    return createHash('sha256').update(JSON.stringify([submission.requestId, submission.actorUserId, entries])).digest('hex');
}

/** Answers may fill only the requested paths; they never replace scope or whole parent records. */
export function mergeWorkflowAnswers(input: unknown, request: WorkflowInputRequest, answers: Record<string, unknown>): Record<string, unknown> {
    if (!object(input) || !Array.isArray(request.fields) || !request.fields.length || request.fields.length > 50) throw new Error('Invalid workflow input request');
    const paths = request.fields.map(field => field.path);
    if (new Set(paths).size !== paths.length || Object.keys(answers).length !== paths.length || Object.keys(answers).some(path => !paths.includes(path))) throw new Error('Supply exactly the requested fields');
    const merged = structuredClone(input);
    for (const field of request.fields) {
        const parts = field.path.split('.');
        if (field.path.length > 200 || parts.some(part => !/^[\w-]+$/.test(part) || reserved.has(part))) throw new Error('Protected workflow input path');
        const value = answers[field.path];
        if (!['string', 'number'].includes(field.type) || value === undefined || value === null || (typeof value === 'string' && !value.trim()) ||
            !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)) || (field.type === 'number' && typeof value !== 'number')) throw new Error(`Invalid answer for ${field.path}`);
        let target = merged;
        for (const part of parts.slice(0, -1)) {
            const existing = Object.prototype.hasOwnProperty.call(target, part) ? target[part] : undefined;
            if (existing !== undefined && existing !== null && !object(existing)) throw new Error(`Input path conflicts at ${field.path}`);
            if (!object(existing)) Object.defineProperty(target, part, { value: {}, enumerable: true, writable: true, configurable: true });
            target = target[part] as Record<string, unknown>;
        }
        const last = parts.at(-1)!;
        if (object(target[last]) || Array.isArray(target[last])) throw new Error(`Input path conflicts at ${field.path}`);
        Object.defineProperty(target, last, { value, enumerable: true, writable: true, configurable: true });
    }
    return merged;
}
