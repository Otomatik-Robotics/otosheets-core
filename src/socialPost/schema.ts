import { z } from 'zod';

/** Sparse-GSI marker: present only while the post is queued for publishing. */
export const SOCIAL_POST_DUE_KEY = 'QUEUED';

export const SocialPostSchema = z.object({
    orgId: z.string(),
    postId: z.string(),
    platform: z.enum(['facebook', 'instagram']),
    caption: z.string(),
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
export type SocialPost = z.infer<typeof SocialPostSchema>;
