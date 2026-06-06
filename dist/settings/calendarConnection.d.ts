import { z } from 'zod';
export declare const CalendarConnectionSchema: z.ZodObject<{
    provider: z.ZodString;
    email: z.ZodString;
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accessToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    refreshToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tokenExpiresAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    calendarId: z.ZodDefault<z.ZodString>;
    calendarIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    connectedAt: z.ZodString;
    status: z.ZodDefault<z.ZodString>;
    watchHistoryId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    watchExpiration: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    provider: z.ZodString;
    email: z.ZodString;
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accessToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    refreshToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tokenExpiresAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    calendarId: z.ZodDefault<z.ZodString>;
    calendarIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    connectedAt: z.ZodString;
    status: z.ZodDefault<z.ZodString>;
    watchHistoryId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    watchExpiration: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    provider: z.ZodString;
    email: z.ZodString;
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accessToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    refreshToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tokenExpiresAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    calendarId: z.ZodDefault<z.ZodString>;
    calendarIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    connectedAt: z.ZodString;
    status: z.ZodDefault<z.ZodString>;
    watchHistoryId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    watchExpiration: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type CalendarConnection = z.infer<typeof CalendarConnectionSchema>;
//# sourceMappingURL=calendarConnection.d.ts.map