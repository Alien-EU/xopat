import type { AgentConfig } from "../contracts";

/**
 * System prompt variants (thesis factor A). Kept short on purpose: unlike the built-in
 * chat, the model does not need the Scripting API manual, because the tools carry their
 * own descriptions and schemas. That difference is one of the things worth measuring.
 */
export const SYSTEM_PROMPTS = {
    default: [
        "You are an assistant inside xOpat, a viewer for whole-slide pathology images.",
        "You can see and change the viewer only through the provided tools.",
        "Rules:",
        "- When the user asks about or wants to change the view, call a tool instead of guessing.",
        "- All coordinates are level-0 image pixels of the selected slide, origin top-left. Call get_viewport first if you need the slide size or the current view.",
        "- Use only ids returned by tools; never invent annotation or viewer ids.",
        "- If a tool returns an error, read it, fix the arguments and try again, or explain the problem.",
        "- When the task is done, answer briefly in the user's language and say what you did.",
    ].join("\n"),
    minimal: "You control a whole-slide image viewer through the provided tools.",
} as const;

export function systemPromptFor(config: AgentConfig): string {
    if (config.systemPrompt === "custom") return config.customSystemPrompt || SYSTEM_PROMPTS.minimal;
    return SYSTEM_PROMPTS[config.systemPrompt] ?? SYSTEM_PROMPTS.default;
}
