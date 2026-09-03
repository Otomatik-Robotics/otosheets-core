import { z } from 'zod';

/**
 * A call trigger: "when THIS happens, THAT agent calls, with THIS mission."
 *
 * Outbound calling used to imply its own use case. `booking.cancelled` reached
 * the dialer through a bespoke consumer, the mission prompt was a hardcoded
 * function (`appendRebookDirective`), and the telephony adapter branched on a
 * `goal: 'rebook'` string in five places. Creating an outbound agent therefore
 * implied it rebooked — and the only way to add a second campaign was to ship
 * code in two repos.
 *
 * Inverting that: the trigger is a ROW. It names the event to listen for, the
 * agent to run it, the mission as DATA, and the conduct policy. Rebooking
 * becomes the first row rather than a special case, and an invoice chase or a
 * post-job review ask is authored, not coded.
 */

/**
 * How the agent should CONDUCT the call — deliberately about behaviour, never
 * about which event fired. The provider reads these flags and nothing else, so
 * adding a campaign never touches telephony code.
 */
export const CallPolicySchema = z.object({
    /**
     * We already know who we're calling (an existing customer about their own
     * record), so the agent leads with the reason instead of "am I speaking
     * with…?". False for cold-ish follow-ups where identity matters.
     */
    knownCustomer: z.boolean().default(false),
    /** Ask the person to confirm who they are before discussing anything. */
    verifyIdentity: z.boolean().default(true),
    /** Leave the callback message on voicemail rather than hanging up. */
    allowVoicemail: z.boolean().default(true),
    /** Keep it short — no small talk, get to the point. */
    brief: z.boolean().default(false),
});
export type CallPolicy = z.infer<typeof CallPolicySchema>;

export const CallTriggerBaseSchema = z.object({
    triggerId: z.string(),
    /** Owner-facing name, e.g. "Cancellation win-back". Shown on the Front Desk. */
    name: z.string(),
    /**
     * The past-tense domain event this listens for (`booking.cancelled`,
     * `invoice.overdue`, `job.completed`…). Matched against the event bus.
     */
    eventType: z.string(),
    /** Which outbound agent runs it. Explicit — an agent does nothing until wired. */
    agentId: z.string(),
    /**
     * The mission, appended to the agent's own system prompt at dial time.
     * Interpolated over the resolved context: `{{booking.date}}`, `{{lead.clientName}}`.
     */
    directive: z.string(),
    /** Opening line template. Null → the agent's standard disclosure opener. */
    firstMessage: z.string().nullish(),
    policy: CallPolicySchema,
    enabled: z.boolean().default(true),
    /** Scope to one pipeline. Null = every pipeline opted into voice. */
    pipelineId: z.string().nullish(),
    /**
     * Lead stage to move the card into when this trigger queues a call, for
     * funnel visibility (the win-back uses REBOOK). Null = the default CALLING.
     */
    queuedStage: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type CallTriggerBase = z.infer<typeof CallTriggerBaseSchema>;

export const CallTriggerStoredSchema = CallTriggerBaseSchema.extend({
    orgId: z.string(),
    sk: z.string(),
    createdBy: z.string().nullish(),
});
export type CallTrigger = z.infer<typeof CallTriggerStoredSchema>;

/** The seeded cancellation win-back — today's hardcoded rebook behaviour, as data. */
export const REBOOK_TRIGGER_DEFAULTS = {
    name: 'Cancellation win-back',
    eventType: 'booking.cancelled',
    queuedStage: 'REBOOK',
    policy: { knownCustomer: true, verifyIdentity: false, allowVoicemail: true, brief: true } as CallPolicy,
    firstMessage:
        "Hi {{lead.firstName}} — I'm sorry to let you know your appointment has been cancelled. "
        + 'I can help you book another time though — let me find what’s available for you.',
    directive:
        'This is a rebooking call to {{lead.clientName}}, an existing customer. '
        + 'Their booking{{#booking.serviceType}} for {{booking.serviceType}}{{/booking.serviceType}} '
        + 'on {{booking.date}} at {{booking.startTime}} was just cancelled.\n'
        + 'Be direct and get to the point fast. You already know who they are — do NOT ask their name, '
        + 'do NOT verify their identity, and do NOT ask them to repeat any details. '
        + 'Open by telling them their booking was cancelled, then immediately use the check_availability tool '
        + 'and offer a couple of the open times it returns; use create_booking to lock in the new slot once they pick one. '
        + 'Do NOT offer {{booking.date}} at {{booking.startTime}} again — that exact slot is the one that was cancelled. '
        + 'Keep it brief — no small talk or chit-chat. If they don’t want to rebook now, thank them and end the call gracefully.',
} as const;
