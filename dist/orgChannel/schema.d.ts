import { z } from 'zod';
export declare const OrgChannelStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    channelId: z.ZodString;
    name: z.ZodString;
    type: z.ZodString;
    teamId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    memberIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    lastRead: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
    createdBy: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    type: string;
    createdAt: string;
    orgId: string;
    channelId: string;
    teamId?: string | null | undefined;
    memberIds?: string[] | null | undefined;
    createdBy?: string | null | undefined;
    lastRead?: any;
}, {
    name: string;
    type: string;
    createdAt: string;
    orgId: string;
    channelId: string;
    teamId?: string | null | undefined;
    memberIds?: string[] | null | undefined;
    createdBy?: string | null | undefined;
    lastRead?: any;
}>;
export type OrgChannel = z.infer<typeof OrgChannelStoredSchema>;
export declare const OrgChannelCreateRequestSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodString;
    teamId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    memberIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    type: string;
    teamId?: string | null | undefined;
    memberIds?: string[] | null | undefined;
}, {
    name: string;
    type: string;
    teamId?: string | null | undefined;
    memberIds?: string[] | null | undefined;
}>;
export type OrgChannelCreateRequest = z.infer<typeof OrgChannelCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map