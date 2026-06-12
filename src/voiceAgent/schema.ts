import { z } from 'zod';

/**
 * Tools a voice agent may be granted. Toggles feed the AI prompt generator and
 * (later) map to mid-call tool integrations on the voice provider.
 */
export const VOICE_AGENT_TOOLS = [
    'offer_bookings',
    'quote_pricing',
    'qualify_needs',
    'take_message',
    'schedule_callback',
] as const;
export type VoiceAgentTool = (typeof VOICE_AGENT_TOOLS)[number];

export const VoiceAgentStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(), // AGENT#{agentId}
    agentId: z.string(),
    name: z.string(),
    /** The user's plain-language description of what this agent should do */
    intent: z.string().nullish(),
    /** Generated (or hand-edited) system prompt the voice agent runs with */
    systemPrompt: z.string(),
    /** Tool toggles, keyed by VoiceAgentTool */
    tools: z.record(z.string(), z.boolean()).default({}),
    /** TTS voice the agent speaks with — provider + that provider's voice id (e.g. vapi / "Savannah"). Null = provider default. */
    voiceProvider: z.string().nullish(),
    voiceId: z.string().nullish(),
    /** Allocated outbound number (Vapi phone-number id + E.164) from the org's purchased numbers */
    phoneNumberId: z.string().nullish(),
    phoneNumber: z.string().nullish(),
    createdBy: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type VoiceAgent = z.infer<typeof VoiceAgentStoredSchema>;
