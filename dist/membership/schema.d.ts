import { z } from 'zod';
export declare const MembershipStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    userId: z.ZodString;
    membershipId: z.ZodString;
    role: z.ZodString;
    status: z.ZodDefault<z.ZodString>;
    inviteName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    inviteToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    inviteExpiresAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    inviteEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    invitePhone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    invitedBy: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    invitedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    joinedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    availability: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    calendarConnection: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    userId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    membershipId: string;
    role: string;
    inviteName?: string | null | undefined;
    inviteToken?: string | null | undefined;
    inviteExpiresAt?: string | null | undefined;
    inviteEmail?: string | null | undefined;
    invitePhone?: string | null | undefined;
    invitedBy?: string | null | undefined;
    invitedAt?: string | null | undefined;
    joinedAt?: string | null | undefined;
    availability?: any;
    calendarConnection?: any;
}, {
    userId: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    membershipId: string;
    role: string;
    status?: string | undefined;
    inviteName?: string | null | undefined;
    inviteToken?: string | null | undefined;
    inviteExpiresAt?: string | null | undefined;
    inviteEmail?: string | null | undefined;
    invitePhone?: string | null | undefined;
    invitedBy?: string | null | undefined;
    invitedAt?: string | null | undefined;
    joinedAt?: string | null | undefined;
    availability?: any;
    calendarConnection?: any;
}>;
export type Membership = z.infer<typeof MembershipStoredSchema>;
export declare const MembershipCreateRequestSchema: z.ZodObject<{
    role: z.ZodString;
    inviteName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    inviteEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    invitePhone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    role: string;
    inviteName?: string | null | undefined;
    inviteEmail?: string | null | undefined;
    invitePhone?: string | null | undefined;
}, {
    role: string;
    inviteName?: string | null | undefined;
    inviteEmail?: string | null | undefined;
    invitePhone?: string | null | undefined;
}>;
export type MembershipCreateRequest = z.infer<typeof MembershipCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map