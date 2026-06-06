import { z } from 'zod';
export declare const CommonQuestionSchema: z.ZodObject<{
    q: z.ZodString;
    a: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    q: z.ZodString;
    a: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    q: z.ZodString;
    a: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export type CommonQuestion = z.infer<typeof CommonQuestionSchema>;
export declare const BusinessProfileSchema: z.ZodObject<{
    about: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    serviceAreas: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    targetCustomers: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    uniqueSellingPoints: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    commonQuestions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        q: z.ZodString;
        a: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        q: z.ZodString;
        a: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        q: z.ZodString;
        a: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    chatbotTone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    chatbotInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    businessName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    businessEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    website: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    suburb: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    state: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    postcode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    abn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    acn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    gstRegistered: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    bankDetails: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    about: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    serviceAreas: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    targetCustomers: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    uniqueSellingPoints: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    commonQuestions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        q: z.ZodString;
        a: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        q: z.ZodString;
        a: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        q: z.ZodString;
        a: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    chatbotTone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    chatbotInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    businessName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    businessEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    website: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    suburb: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    state: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    postcode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    abn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    acn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    gstRegistered: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    bankDetails: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    about: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    serviceAreas: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    targetCustomers: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    uniqueSellingPoints: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    commonQuestions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        q: z.ZodString;
        a: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        q: z.ZodString;
        a: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        q: z.ZodString;
        a: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    chatbotTone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    chatbotInstructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    businessName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    businessEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    website: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    suburb: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    state: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    postcode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    abn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    acn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    gstRegistered: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    bankDetails: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;
//# sourceMappingURL=businessProfile.d.ts.map