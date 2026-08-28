import { z } from 'zod';

/*
 * NOTE: types here are EXPLICIT interfaces, not z.infer — core compiles its
 * d.ts against zod v3 while consumers may resolve `z` to zod v4 (the order
 * module set this precedent; follow it).
 */

/**
 * Every input a form can carry, plus two author-side block types:
 * `section` breaks the form into steps (the stepper derives its pages from
 * them; the deck shows the title as an interstitial) and `content` renders
 * read-only copy or media between questions.
 */
export type FormFieldType =
    | 'text' | 'textarea' | 'tel' | 'email' | 'number' | 'date'
    | 'select' | 'checkboxes'
    | 'currency' | 'percentage' | 'link' | 'embed' | 'attachment'
    | 'section' | 'content';
export const FormFieldTypeSchema = z.enum([
    'text', 'textarea', 'tel', 'email', 'number', 'date',
    'select', 'checkboxes',
    'currency', 'percentage', 'link', 'embed', 'attachment',
    'section', 'content',
]);

/** Grid width. Layout rule: textarea/embed/attachment/section/content are always full. */
export type FormFieldWidth = 'half' | 'full';
export const FormFieldWidthSchema = z.enum(['half', 'full']);

/** What this answer means for the lead's identity, whatever the field is named. */
export type FormFieldIdentity = 'name' | 'phone' | 'email' | 'suburb' | 'service';
export const FormFieldIdentitySchema = z.enum(['name', 'phone', 'email', 'suburb', 'service']);

export interface FormField {
    /** Wire key — the answers object is keyed by this. Stable once created. */
    key: string;
    type: FormFieldType;
    label: string;
    required?: boolean;
    placeholder?: string | null;
    /** Choices for select/checkboxes. */
    options?: string[] | null;
    width?: FormFieldWidth | null;
    help?: string | null;
    /** Identity role — lets any field feed the lead's name/phone/email/suburb/service. */
    identity?: FormFieldIdentity | null;
    /** content/section blocks: display copy. */
    body?: string | null;
    /** content blocks: image or video URL rendered with the copy. */
    mediaUrl?: string | null;
}
export const FormFieldSchema = z.object({
    key: z.string().min(1).max(60),
    type: FormFieldTypeSchema,
    label: z.string().max(200),
    required: z.boolean().optional(),
    placeholder: z.string().max(200).nullish(),
    options: z.array(z.string().max(200)).max(50).nullish(),
    width: FormFieldWidthSchema.nullish(),
    help: z.string().max(400).nullish(),
    identity: FormFieldIdentitySchema.nullish(),
    body: z.string().max(4000).nullish(),
    mediaUrl: z.string().max(600).nullish(),
});

export type FormStyle = 'scroll' | 'deck' | 'steps';
export const FormStyleSchema = z.enum(['scroll', 'deck', 'steps']);

/**
 * Where submissions land: `pipeline` ingests a lead (the default); `inbox`
 * stores the submission and notifies, but creates no lead — checklists,
 * feedback and warranty forms don't belong in a sales pipeline.
 */
export type FormDestination = 'pipeline' | 'inbox';
export const FormDestinationSchema = z.enum(['pipeline', 'inbox']);

export type FormStatus = 'draft' | 'live' | 'archived';
export const FormStatusSchema = z.enum(['draft', 'live', 'archived']);

/** Per-form branding. Unset values inherit the org's logo and brand colour. */
export interface FormBrand {
    /** A pasted link to a hosted logo. */
    logoUrl?: string | null;
    /** An UPLOADED logo: the private S3 key under forms/{orgId}/{formId}/ —
     *  served to the public page through the form's /logo redirect route. */
    logoKey?: string | null;
    /** Actions: buttons, progress, the success mark. #rrggbb. */
    primary?: string | null;
    /** Accents: selected choices, step markers. #rrggbb. */
    secondary?: string | null;
    /** The public page's background. #rrggbb; unset = the default light grey. */
    background?: string | null;
}
export const FormBrandSchema = z.object({
    logoUrl: z.string().max(600).nullish(),
    logoKey: z.string().max(400).nullish(),
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
    secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
});

export interface FormDef {
    formId: string;
    orgId: string;
    businessProfileId?: string | null;
    createdBy: string;
    name: string;
    /** Public URL segment — unique per org: /f/{orgSlug}/{formSlug}. */
    slug: string;
    style: FormStyle;
    destination: FormDestination;
    /** Explicit pipeline for `pipeline` destinations; null = org default. */
    pipelineId?: string | null;
    status: FormStatus;
    fields: FormField[];
    brand?: FormBrand | null;
    intro?: string | null;
    successMessage?: string | null;
    createdAt: string;
    updatedAt: string;
}
export const FormDefSchema = z.object({
    formId: z.string(),
    orgId: z.string(),
    businessProfileId: z.string().nullish(),
    createdBy: z.string(),
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(60),
    style: FormStyleSchema,
    destination: FormDestinationSchema,
    pipelineId: z.string().nullish(),
    status: FormStatusSchema,
    fields: z.array(FormFieldSchema).max(80),
    brand: FormBrandSchema.nullish(),
    intro: z.string().max(600).nullish(),
    successMessage: z.string().max(600).nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export interface FormSubmissionAttachment {
    key: string;
    name: string;
    size?: number | null;
    contentType?: string | null;
}
export const FormSubmissionAttachmentSchema = z.object({
    key: z.string().max(400),
    name: z.string().max(200),
    size: z.number().nullish(),
    contentType: z.string().max(120).nullish(),
});

export interface FormSubmissionContact {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
}

export interface FormSubmission {
    /** Client-minted ULID — the retry dedupe wall. */
    submissionId: string;
    formId: string;
    orgId: string;
    /** Structured answers keyed by field key — never folded into a description string. */
    answers: Record<string, unknown>;
    attachments?: FormSubmissionAttachment[] | null;
    contact?: FormSubmissionContact | null;
    leadId?: string | null;
    pipelineId?: string | null;
    attribution?: Record<string, unknown> | null;
    createdAt: string;
}
export const FormSubmissionSchema = z.object({
    submissionId: z.string(),
    formId: z.string(),
    orgId: z.string(),
    answers: z.record(z.string(), z.unknown()),
    attachments: z.array(FormSubmissionAttachmentSchema).nullish(),
    contact: z.object({
        name: z.string().nullish(),
        phone: z.string().nullish(),
        email: z.string().nullish(),
    }).nullish(),
    leadId: z.string().nullish(),
    pipelineId: z.string().nullish(),
    attribution: z.record(z.string(), z.unknown()).nullish(),
    createdAt: z.string(),
});

/** Field types whose grid width is always full, whatever the author set. */
export const FULL_WIDTH_FIELD_TYPES: readonly FormFieldType[] =
    ['textarea', 'embed', 'attachment', 'section', 'content'];

/** Display blocks — rendered, never answered; excluded from validation and answers. */
export const DISPLAY_FIELD_TYPES: readonly FormFieldType[] = ['section', 'content'];

export function isInputField(f: Pick<FormField, 'type'>): boolean {
    return !DISPLAY_FIELD_TYPES.includes(f.type);
}

/** The effective grid width for a field — the layout rules, in one place. */
export function fieldWidth(f: Pick<FormField, 'type' | 'width'>): FormFieldWidth {
    if (FULL_WIDTH_FIELD_TYPES.includes(f.type)) return 'full';
    return f.width === 'full' ? 'full' : 'half';
}

export function sanitizeFormSlug(raw: string): string {
    return String(raw ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}
