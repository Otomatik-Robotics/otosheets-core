import { z } from 'zod';
export declare const PipelineSourceSchema: z.ZodObject<{
    id: z.ZodString;
    sourceType: z.ZodString;
    channelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    channelName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    addedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    sourceType: string;
    addedAt: string;
    channelId?: string | null | undefined;
    channelName?: string | null | undefined;
}, {
    id: string;
    sourceType: string;
    addedAt: string;
    channelId?: string | null | undefined;
    channelName?: string | null | undefined;
}>;
export type PipelineSource = z.infer<typeof PipelineSourceSchema>;
export declare const PipelineBaseSchema: z.ZodObject<{
    pipelineId: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stages: z.ZodArray<z.ZodString, "many">;
    isDefault: z.ZodDefault<z.ZodBoolean>;
    sources: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sourceType: z.ZodString;
        channelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        channelName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        addedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }, {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }>, "many">>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    updatedAt: string;
    pipelineId: string;
    stages: string[];
    isDefault: boolean;
    sources: {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }[];
    description?: string | null | undefined;
}, {
    name: string;
    createdAt: string;
    updatedAt: string;
    pipelineId: string;
    stages: string[];
    description?: string | null | undefined;
    isDefault?: boolean | undefined;
    sources?: {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }[] | undefined;
}>;
export type PipelineBase = z.infer<typeof PipelineBaseSchema>;
export declare const PipelineStoredSchema: z.ZodObject<{
    pipelineId: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stages: z.ZodArray<z.ZodString, "many">;
    isDefault: z.ZodDefault<z.ZodBoolean>;
    sources: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sourceType: z.ZodString;
        channelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        channelName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        addedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }, {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }>, "many">>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
} & {
    orgId: z.ZodString;
    createdBy: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    pipelineId: string;
    stages: string[];
    isDefault: boolean;
    sources: {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }[];
    description?: string | null | undefined;
}, {
    name: string;
    createdAt: string;
    updatedAt: string;
    orgId: string;
    createdBy: string;
    pipelineId: string;
    stages: string[];
    description?: string | null | undefined;
    isDefault?: boolean | undefined;
    sources?: {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }[] | undefined;
}>;
export type Pipeline = z.infer<typeof PipelineStoredSchema>;
export declare const PipelineCreateRequestSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stages: z.ZodArray<z.ZodString, "many">;
    isDefault: z.ZodOptional<z.ZodBoolean>;
    sources: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sourceType: z.ZodString;
        channelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        channelName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        addedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }, {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    stages: string[];
    description?: string | null | undefined;
    isDefault?: boolean | undefined;
    sources?: {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }[] | undefined;
}, {
    name: string;
    stages: string[];
    description?: string | null | undefined;
    isDefault?: boolean | undefined;
    sources?: {
        id: string;
        sourceType: string;
        addedAt: string;
        channelId?: string | null | undefined;
        channelName?: string | null | undefined;
    }[] | undefined;
}>;
export type PipelineCreateRequest = z.infer<typeof PipelineCreateRequestSchema>;
//# sourceMappingURL=schema.d.ts.map