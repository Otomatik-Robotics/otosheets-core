import { z } from 'zod';
export declare const TeamStoredSchema: z.ZodObject<{
    orgId: z.ZodString;
    teamId: z.ZodString;
    name: z.ZodString;
    memberIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    createdBy: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    orgId: string;
    teamId: string;
    memberIds: string[];
    createdBy?: string | null | undefined;
}, {
    name: string;
    createdAt: string;
    orgId: string;
    teamId: string;
    memberIds?: string[] | undefined;
    createdBy?: string | null | undefined;
}>;
export type Team = z.infer<typeof TeamStoredSchema>;
export declare const TeamCreateRequestSchema: z.ZodObject<{
    name: z.ZodString;
    memberIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    memberIds?: string[] | undefined;
}, {
    name: string;
    memberIds?: string[] | undefined;
}>;
export type TeamCreateRequest = z.infer<typeof TeamCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map