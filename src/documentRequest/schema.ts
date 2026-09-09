import { z } from 'zod';
const identity = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const DocumentRequestInput = z.object({
    clientRequestKey: identity,
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(5000).default(''),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
        const date = new Date(v); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === v;
    }, 'Invalid date'),
    docType: z.enum(['GENERAL', 'BANK_STATEMENT', 'EXPENSE_DOC']).default('GENERAL'),
}).strict();
export type DocumentRequestInput = z.input<typeof DocumentRequestInput>;
export const DOCUMENT_REQUEST_FILE_TYPES = Object.freeze({
    'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/csv': 'csv',
} as const);
export const DocumentRequestFileInput = z.object({
    clientFileKey: identity,
    fileName: z.string().trim().min(1).max(255).refine(v => !/[\x00-\x1f\x7f/\\]/.test(v), 'Invalid file name'),
    contentType: z.enum(Object.keys(DOCUMENT_REQUEST_FILE_TYPES) as [keyof typeof DOCUMENT_REQUEST_FILE_TYPES, ...Array<keyof typeof DOCUMENT_REQUEST_FILE_TYPES>]),
    sizeBytes: z.number().int().min(1).max(25 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DocumentRequestFileInput = z.input<typeof DocumentRequestFileInput>;
