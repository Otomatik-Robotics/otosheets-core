import { z } from 'zod';
export declare const FollowUpStepSchema: z.ZodObject<{
    name: z.ZodString;
    daysAfterDue: z.ZodNumber;
    tone: z.ZodString;
    subject: z.ZodString;
    body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    name: z.ZodString;
    daysAfterDue: z.ZodNumber;
    tone: z.ZodString;
    subject: z.ZodString;
    body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    name: z.ZodString;
    daysAfterDue: z.ZodNumber;
    tone: z.ZodString;
    subject: z.ZodString;
    body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type FollowUpStep = z.infer<typeof FollowUpStepSchema>;
export declare const FollowUpSequenceSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    stages: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        daysAfterDue: z.ZodNumber;
        tone: z.ZodString;
        subject: z.ZodString;
        body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        name: z.ZodString;
        daysAfterDue: z.ZodNumber;
        tone: z.ZodString;
        subject: z.ZodString;
        body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        name: z.ZodString;
        daysAfterDue: z.ZodNumber;
        tone: z.ZodString;
        subject: z.ZodString;
        body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    minDaysBetweenReminders: z.ZodDefault<z.ZodNumber>;
    maxReminders: z.ZodDefault<z.ZodNumber>;
    autoChase: z.ZodDefault<z.ZodBoolean>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    stages: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        daysAfterDue: z.ZodNumber;
        tone: z.ZodString;
        subject: z.ZodString;
        body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        name: z.ZodString;
        daysAfterDue: z.ZodNumber;
        tone: z.ZodString;
        subject: z.ZodString;
        body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        name: z.ZodString;
        daysAfterDue: z.ZodNumber;
        tone: z.ZodString;
        subject: z.ZodString;
        body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    minDaysBetweenReminders: z.ZodDefault<z.ZodNumber>;
    maxReminders: z.ZodDefault<z.ZodNumber>;
    autoChase: z.ZodDefault<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    stages: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        daysAfterDue: z.ZodNumber;
        tone: z.ZodString;
        subject: z.ZodString;
        body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        name: z.ZodString;
        daysAfterDue: z.ZodNumber;
        tone: z.ZodString;
        subject: z.ZodString;
        body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        name: z.ZodString;
        daysAfterDue: z.ZodNumber;
        tone: z.ZodString;
        subject: z.ZodString;
        body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    minDaysBetweenReminders: z.ZodDefault<z.ZodNumber>;
    maxReminders: z.ZodDefault<z.ZodNumber>;
    autoChase: z.ZodDefault<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">>;
export type FollowUpSequence = z.infer<typeof FollowUpSequenceSchema>;
//# sourceMappingURL=followUpSequence.d.ts.map