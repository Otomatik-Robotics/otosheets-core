import { z } from 'zod';

/**
 * Tools a voice agent may be granted. Toggles feed the AI prompt generator and
 * (later) map to mid-call tool integrations on the voice provider.
 */
export const VOICE_AGENT_TOOLS = [
    'offer_bookings',
    'qualify_needs',
    'take_message',
    'schedule_callback',
] as const;
export type VoiceAgentTool = (typeof VOICE_AGENT_TOOLS)[number];

/**
 * An agent's avatar — either a curated lucide icon (with a colour theme) or a
 * custom uploaded image. Purely cosmetic; null/absent = the default Bot icon.
 * For `image`, `imageKey` is the S3 object key; the backend presigns a GET URL
 * (`imageUrl`) on read — it is never persisted.
 */
export const VoiceAgentAvatarSchema = z.object({
    type: z.enum(['icon', 'image']),
    /** lucide icon key, when type === 'icon' */
    icon: z.string().nullish(),
    /** colour-theme key (e.g. 'indigo'), when type === 'icon' */
    color: z.string().nullish(),
    /** S3 object key, when type === 'image' */
    imageKey: z.string().nullish(),
    /** Presigned GET URL — derived on read, never stored */
    imageUrl: z.string().nullish(),
});
export type VoiceAgentAvatar = z.infer<typeof VoiceAgentAvatarSchema>;

/**
 * An agent either places calls (`outbound`) or answers them (`inbound`).
 * Outbound agents may share a number; an inbound agent owns its number's SIP
 * line one-to-one. Legacy rows have no value → treated as `outbound` on read.
 */
export const VOICE_AGENT_DIRECTIONS = ['inbound', 'outbound'] as const;
export type VoiceAgentDirection = (typeof VOICE_AGENT_DIRECTIONS)[number];
export const VoiceAgentDirectionSchema = z.enum(VOICE_AGENT_DIRECTIONS);

export const VoiceAgentStoredSchema = z.object({
    orgId: z.string(),
    sk: z.string(), // AGENT#{agentId}
    agentId: z.string(),
    name: z.string(),
    /** Inbound = answers calls (ring-owner-first, AI takes over); outbound = places calls. Default outbound. */
    direction: VoiceAgentDirectionSchema.nullish(),
    /** The user's plain-language description of what this agent should do */
    intent: z.string().nullish(),
    /** Generated (or hand-edited) system prompt the voice agent runs with */
    systemPrompt: z.string(),
    /** Tool toggles, keyed by VoiceAgentTool */
    tools: z.record(z.string(), z.boolean()).default({}),
    /** Cosmetic avatar — curated icon+colour or an uploaded image. Null = default Bot icon. */
    avatar: VoiceAgentAvatarSchema.nullish(),
    /** TTS voice the agent speaks with — provider + that provider's voice id (e.g. vapi / "Savannah"). Null = provider default. */
    voiceProvider: z.string().nullish(),
    voiceId: z.string().nullish(),
    /** Allocated outbound number (Vapi phone-number id + E.164) from the org's purchased numbers */
    phoneNumberId: z.string().nullish(),
    phoneNumber: z.string().nullish(),
    /**
     * Lead pipeline this agent works. Outbound agents call leads that land in
     * this pipeline; inbound agents file the leads they capture here. When unset
     * the backend resolves it to the org's default ("General") pipeline on write,
     * so a stored agent always carries a concrete pipelineId.
     */
    pipelineId: z.string().nullish(),
    // ─── Inbound-only settings (carried on the agent; replaces the per-org inboundRouting) ───
    /** E.164 number an inbound call rings first (the owner's mobile) before the AI takes over. */
    ownerNumber: z.string().nullish(),
    /** Seconds to ring the owner before the AI agent answers (5–60). */
    ringTimeoutSeconds: z.number().int().nullish(),
    /** SMS copy sent when an inbound caller isn't reached and text-back is preferred. */
    textBackMessage: z.string().nullish(),
    /** Record + transcribe answered calls (opt-in; consent disclosure required). */
    recordCalls: z.boolean().nullish(),
    /** Vapi assistant id provisioned for an inbound agent (for in-place re-provisioning). */
    assistantId: z.string().nullish(),
    /** Deterministic SIP URI this inbound agent answers on (mirrors its number's sipUri). */
    sipUri: z.string().nullish(),
    createdBy: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type VoiceAgent = z.infer<typeof VoiceAgentStoredSchema>;
