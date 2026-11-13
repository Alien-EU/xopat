import { generateText, jsonSchema, tool } from "ai";

/**
 * Server half of the MCP chat: ONE model call per request, with the viewer tools declared
 * but NOT executed (no `execute`). The browser owns the agent loop and the MCP tools; this
 * file only turns a vendor-neutral request into an AI SDK call against a provider from the
 * chat module's registry, so API keys stay on the server.
 *
 * Modelled on `runVisionInference` (modules/vercel-ai-chat-sdk/server/inference.server.ts):
 * same provider resolution, same ownership/context gates via `resolveProviderRuntime`.
 */

const STEP_TIMEOUT_MS = 180_000;

export const policy = {
    modelStep: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: STEP_TIMEOUT_MS, maxBodyBytes: 16 * 1024 * 1024, maxConcurrency: 4, queueLimit: 16 },
    },
} as const;

type ToolResult = { isError: boolean; text: string; images?: Array<{ mimeType: string; data: string }> };
type AgentMessage =
    | { role: "user"; text: string }
    | { role: "assistant"; text: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> | string }> }
    | { role: "tool"; toolCallId: string; toolName: string; result: ToolResult };

interface ModelStepInput {
    providerId: string;
    modelId?: string | null;
    system: string;
    messages: AgentMessage[];
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    toolChoice?: "auto" | "required" | "none";
    temperature?: number;
    maxOutputTokens?: number;
}

/**
 * Vendor-neutral conversation → AI SDK 7 ModelMessage[].
 *
 * Images returned by a tool (screenshot) cannot travel inside a tool message on the
 * OpenAI chat-completions wire format, so they are attached as a user message right after
 * the tool results of that step. That is the common workaround and works on every
 * vision-capable OpenAI-compatible endpoint.
 */
function toModelMessages(messages: AgentMessage[]): any[] {
    const out: any[] = [];
    let pendingImages: Array<{ toolName: string; mimeType: string; data: string }> = [];
    const flushImages = () => {
        if (!pendingImages.length) return;
        out.push({
            role: "user",
            content: [
                { type: "text", text: `Image(s) returned by: ${[...new Set(pendingImages.map((i) => i.toolName))].join(", ")}` },
                ...pendingImages.map((i) => ({ type: "file", mediaType: i.mimeType, data: i.data })),
            ],
        });
        pendingImages = [];
    };

    for (const m of messages) {
        if (m.role !== "tool") flushImages();
        if (m.role === "user") {
            out.push({ role: "user", content: String(m.text ?? "") });
        } else if (m.role === "assistant") {
            const content: any[] = [];
            if (m.text) content.push({ type: "text", text: m.text });
            for (const call of m.toolCalls || []) {
                content.push({
                    type: "tool-call",
                    toolCallId: call.id,
                    toolName: call.name,
                    // Invalid JSON from the model is replayed as a wrapper object, so the model can
                    // see what it sent next to the error that follows.
                    input: typeof call.arguments === "string" ? { invalid_json: call.arguments } : call.arguments,
                });
            }
            if (content.length) out.push({ role: "assistant", content });
        } else if (m.role === "tool") {
            out.push({
                role: "tool",
                content: [{
                    type: "tool-result",
                    toolCallId: m.toolCallId,
                    toolName: m.toolName,
                    output: m.result.isError
                        ? { type: "error-text", value: m.result.text || "Error" }
                        : { type: "text", value: m.result.text || "(no output)" },
                }],
            });
            for (const img of m.result.images || []) pendingImages.push({ toolName: m.toolName, ...img });
        }
    }
    flushImages();
    return out;
}

function num(v: unknown): number | null {
    return Number.isFinite(Number(v)) ? Number(v) : null;
}

export async function modelStep(ctx: any, input: ModelStepInput) {
    const XS = (globalThis as any).XOPAT_SERVER;
    if (!XS) throw new Error("XOPAT_SERVER helpers are not available.");
    if (!input?.providerId) throw new Error("modelStep requires a providerId (pick a provider in the chat).");

    // Reuse the chat module's registry: same instance (it lives on globalThis), same gates.
    const ChatServerRegistry = await XS.importServerExport(ctx, "module:vercel-ai-chat-sdk/server/chatRegistry.server.ts", "ChatServerRegistry");
    const resolveUserScope = await XS.importServerExport(ctx, "module:vercel-ai-chat-sdk/server/chatRegistry.server.ts", "resolveUserScope");
    let userScope: string | null = null;
    try { userScope = resolveUserScope(ctx); } catch { userScope = null; }

    const registry = ChatServerRegistry.instance();
    const runtime = await registry.resolveProviderRuntime(input.providerId, { ctx, userScope });
    const adapter = registry.getAdapter(runtime.type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);
    const modelId = input.modelId || runtime.instance.defaultModelId || runtime.type.defaultModelId || "";
    if (!modelId) throw new Error(`No model selected and provider '${runtime.instance.id}' has no default model.`);

    const model = await adapter.resolveModel({
        ctx,
        providerId: runtime.instance.id,
        providerTypeId: runtime.type.id,
        modelId,
        contextId: runtime.instance.contextId || null,
        type: runtime.type,
        instance: runtime.instance,
        config: runtime.config,
        secrets: runtime.secrets,
    });

    const tools: Record<string, any> = {};
    for (const t of input.tools || []) {
        // No `execute`: the SDK returns the call and stops; the browser runs the tool over MCP.
        tools[t.name] = tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema as any) });
    }
    const hasTools = Object.keys(tools).length > 0;

    const result: any = await generateText({
        model,
        instructions: input.system || undefined,
        messages: toModelMessages(input.messages || []),
        ...(hasTools ? { tools, toolChoice: input.toolChoice || "auto" } : {}),
        ...(Number.isFinite(input.temperature) ? { temperature: input.temperature } : {}),
        ...(Number.isFinite(input.maxOutputTokens) ? { maxOutputTokens: input.maxOutputTokens } : {}),
        abortSignal: ctx?.signal,
        maxRetries: 1,
    });

    const toolCalls = (Array.isArray(result?.toolCalls) ? result.toolCalls : []).map((c: any) => {
        const raw = c?.input ?? c?.args;
        let args: Record<string, unknown> | string;
        if (typeof raw === "string") {
            // The SDK keeps unparsable input as text (`invalid: true`). Hand it to the loop as
            // is: whether to repair, reject or forward it is a guardrail decision, not ours.
            try { args = JSON.parse(raw); } catch { args = raw; }
        } else {
            args = raw && typeof raw === "object" ? raw : {};
        }
        return { id: String(c?.toolCallId ?? ""), name: String(c?.toolName ?? ""), arguments: args };
    });

    const u = result?.usage || {};
    return {
        text: typeof result?.text === "string" ? result.text : "",
        toolCalls,
        finishReason: typeof result?.finishReason === "string" ? result.finishReason : null,
        usage: { inputTokens: num(u.inputTokens), outputTokens: num(u.outputTokens) },
    };
}
