import { z } from 'zod';
import { isEnvelopeKind, isRefusedKind } from '../envelope/registry';
export const SignatureRequestInput = z.object({
    clientRequestKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
    title: z.string().trim().min(1).max(300),
    signerEmail: z.string().trim().email().max(320).transform(v => v.toLowerCase()),
    signerName: z.string().trim().max(200).default(''),
    message: z.string().trim().max(5000).default(''),
    kind: z.string().refine(v => isEnvelopeKind(v) && !isRefusedKind(v), 'Unsupported document kind'),
}).strict();
export type SignatureRequestInput = z.input<typeof SignatureRequestInput>;
