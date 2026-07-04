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
    /** Legacy single-image key. Prefer `mediaKeys`; kept for back-compat reads. */
    mediaKey: z.string().optional(),
    /** Ordered S3 keys for the post's images (carousel / multi-photo). IG allows up
     *  to 10 and requires at least one; FB posts them as a multi-photo post. */
    mediaKeys: z.array(z.string()).optional(),
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
    mediaKeys?: string[];
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
