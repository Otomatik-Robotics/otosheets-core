import { z } from 'zod';
export const SETUP_CHECKLIST_ITEMS = Object.freeze([
    Object.freeze({ id: 'abn', label: 'ABN registered' }),
    Object.freeze({ id: 'gst', label: 'GST registered (if turnover ≥ $75k)' }),
    Object.freeze({ id: 'bank', label: 'Business bank account opened' }),
    Object.freeze({ id: 'insurance', label: 'Business insurance in place' }),
]);
export const ProfileChecklistChange = z.object({
    itemId: z.enum(['abn','gst','bank','insurance']), done: z.boolean(), expectedRevision: z.number().int().min(0).max(2147483646),
}).strict();
export type ProfileChecklistChange = z.infer<typeof ProfileChecklistChange>;
export interface ProfileChecklistItem { id: string; label: string; done: boolean; revision: number; doneBy: string | null; doneAt: string | null; updatedBy: string | null; updatedAt: string | null }
