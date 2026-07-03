import { z } from 'zod';

/** Sparse-GSI marker: present only while the post is queued for publishing. */
export const SOCIAL_POST_DUE_KEY = 'QUEUED';

export const SocialPostSchema = z.object({
    orgId: z.string(),
    postId: z.string(),
    platform: z.enum(['facebook', 'instagram']),
    caption: z.string(),
    /** Meta page the post publishes to (from the connected user's metaPages). */
    pageId: z.string().optional(),
    /** Instagram business account id (required for platform=instagram). */
    igUserId: z.string().optional(),
    /** S3 key in the storefront assets bucket (IG requires media; FB optional). */
    mediaKey: z.string().optional(),
    scheduledAt: z.string(),
    status: z.enum(['draft', 'queued', 'published', 'failed']),
    /** Sparse GSI pk — set to SOCIAL_POST_DUE_KEY only while status === 'queued'. */
    dueKey: z.string().optional(),
    publishedExternalId: z.string().optional(),
    publishedAt: z.string().optional(),
    attempts: z.number().int().default(0),
    lastError: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
// Explicit interface (not z.infer): consumers may be on a different zod major,
// and inferred generic types don't survive the declaration-file boundary.
export interface SocialPost {
    orgId: string;
    postId: string;
    platform: 'facebook' | 'instagram';
    caption: string;
    pageId?: string;
    igUserId?: string;
    mediaKey?: string;
    scheduledAt: string;
    status: 'draft' | 'queued' | 'published' | 'failed';
    dueKey?: string;
    publishedExternalId?: string;
    publishedAt?: string;
    attempts: number;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
}
