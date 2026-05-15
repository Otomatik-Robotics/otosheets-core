import { z } from 'zod';

export const CalendarConnectionSchema = z.object({
    provider: z.string(),
    email: z.string(),
    name: z.string().nullish(),
    accessToken: z.string().nullish(),
    refreshToken: z.string().nullish(),
    tokenExpiresAt: z.string().nullish(),
    calendarId: z.string().default('primary'),
    calendarIds: z.array(z.string()).nullish(),
    connectedAt: z.string(),
    status: z.string().default('active'),
    watchHistoryId: z.string().nullish(),
    watchExpiration: z.string().nullish(),
}).passthrough();
export type CalendarConnection = z.infer<typeof CalendarConnectionSchema>;
