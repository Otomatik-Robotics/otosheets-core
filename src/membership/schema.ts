import { z } from 'zod';

export const MembershipStoredSchema = z.object({
    orgId: z.string(),
    userId: z.string(),
    membershipId: z.string(),
    role: z.string(),
    status: z.string().default('PENDING'),
    inviteName: z.string().nullish(),
    inviteToken: z.string().nullish(),
    inviteExpiresAt: z.string().nullish(),
    inviteEmail: z.string().nullish(),
    invitePhone: z.string().nullish(),
    invitedBy: z.string().nullish(),
    invitedAt: z.string().nullish(),
    joinedAt: z.string().nullish(),
    availability: z.any().nullish(),
    calendarConnection: z.any().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Membership = z.infer<typeof MembershipStoredSchema>;

export const MembershipCreateRequestSchema = z.object({
    role: z.string(),
    inviteName: z.string().nullish(),
    inviteEmail: z.string().nullish(),
    invitePhone: z.string().nullish(),
});
export type MembershipCreateRequest = z.infer<typeof MembershipCreateRequestSchema>;
