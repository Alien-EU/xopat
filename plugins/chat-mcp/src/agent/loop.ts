import type {
    AgentConfig, AgentEvent, AgentMessage, ModelAdapter, StopReason, ToolCall, ToolResult, ToolSpec,
    TraceEntry, TurnOutcome,
} from "../contracts";
import type { ListedTool } from "../mcp/client";
import { checkToolCall } from "./guardrails";
import { systemPromptFor } from "./prompts";

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
    systemPrompt: "default",
    toolDescriptions: "full",
    enabledTools: [],
    guardrails: true,
    feedback: true,
    maxSteps: 8,
    maxRepeatedCalls: 3,
    sendImages: false,
    historyWindow: 0,
};

/** The data layer as the loop needs it: MCP tool list with both description variants + call. */
export interface LoopTools {
    listToolsDetailed(): Promise<ListedTool[]>;
    callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}

/**
 * The agent loop: a plain ReAct-style "model → tool calls → results → model" cycle.
 *
 *   for step in 1..maxSteps:
 *       response = model.complete(system, history, tools)
 *       if response has no tool calls: return its text           (answered)
 *       for each call: guardrail? → MCP tools/call → feedback policy → append result
 *
 * Deliberately small and explicit, because for the thesis the loop is the object under
 * study: each AgentConfig switch maps to one visible branch below, and every decision is
 * emitted as an AgentEvent (shown in the UI, stored in the trace, exportable as JSON).
 * Library loops (AI SDK `stopWhen`, LangGraph, OpenAI Agents) hide exactly these
 * decisions — retries, input repair, validation — which would confound the measurements.
 */
export class AgentLoop {
    constructor(
        private readonly model: ModelAdapter,
        private readonly tools: LoopTools,
        private readonly config: AgentConfig = DEFAULT_AGENT_CONFIG,
    ) {}

    async run(
        userText: string,
        history: AgentMessage[] = [],
        options: { signal?: AbortSignal; onEvent?: (event: AgentEvent) => void } = {},
    ): Promise<TurnOutcome> {
        const cfg = this.config;
        const trace: TraceEntry[] = [];
        const emit = (event: AgentEvent) => {
            trace.push({ t: Date.now(), event });
            try { options.onEvent?.(event); } catch (e) { console.warn("[chat-mcp] event listener failed", e); }
        };
        const messages: AgentMessage[] = [...history, { role: "user", text: userText }];

        const listed = await this.tools.listToolsDetailed();
        const offered = listed.filter((t) => !cfg.enabledTools.length || cfg.enabledTools.includes(t.name));
        const specs: ToolSpec[] = offered.map((t) => ({
            name: t.name,
            description: cfg.toolDescriptions === "short" ? t.shortDescription : t.description,
            inputSchema: t.inputSchema,
        }));
        const byName = new Map(specs.map((s) => [s.name, s]));
        const system = systemPromptFor(cfg);

        emit({ type: "turn-start", userText, config: cfg, model: this.model.describe(), tools: specs.map((s) => s.name) });

        let lastText = "";
        let lastCallKey = "";
        let repeats = 0;
        const finish = (step: number, reason: StopReason, text: string): TurnOutcome => {
            emit({ type: "final", step, text, reason });
            return { text, reason, steps: step, messages, trace };
        };

        for (let step = 1; step <= cfg.maxSteps; step++) {
            if (options.signal?.aborted) return finish(step - 1, "aborted", lastText);

            const window = windowed(messages, cfg.historyWindow);
            emit({ type: "model-request", step, messages: window.length, tools: specs.length });
            let response;
            try {
                response = await this.model.complete({
                    system,
                    messages: window,
                    tools: specs,
                    toolChoice: "auto",
                    temperature: cfg.temperature,
                    maxOutputTokens: cfg.maxOutputTokens,
                    signal: options.signal,
                });
            } catch (error: any) {
                if (options.signal?.aborted) return finish(step - 1, "aborted", lastText);
                emit({ type: "error", step, message: String(error?.message || error) });
                return finish(step, "error", lastText);
            }
            emit({ type: "model-response", step, response });
            lastText = response.text || lastText;
            messages.push({ role: "assistant", text: response.text, toolCalls: response.toolCalls });

            if (!response.toolCalls.length) return finish(step, "answered", response.text);

            let stopForRepeat = false;
            for (const call of response.toolCalls) {
                emit({ type: "tool-call", step, call });
                const result = await this.execute(call, byName, step, emit, options.signal, () => {
                    const key = `${call.name} ${JSON.stringify(call.arguments)}`;
                    repeats = key === lastCallKey ? repeats + 1 : 1;
                    lastCallKey = key;
                    return repeats >= cfg.maxRepeatedCalls;
                });
                if (result === "repeated") {
                    stopForRepeat = true;
                    messages.push({ role: "tool", toolCallId: call.id, toolName: call.name,
                        result: { isError: true, text: "Not executed: the same call was repeated too many times." } });
                    continue;
                }
                messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, result });
            }
            if (stopForRepeat) return finish(step, "repeated-call", lastText);
        }
        return finish(cfg.maxSteps, "max-steps", lastText);
    }

    private async execute(
        call: ToolCall,
        byName: Map<string, ToolSpec>,
        step: number,
        emit: (e: AgentEvent) => void,
        signal: AbortSignal | undefined,
        isRepeat: () => boolean,
    ): Promise<ToolResult | "repeated"> {
        const cfg = this.config;
        const started = performance.now();
        let result: ToolResult;

        const problem = cfg.guardrails ? checkToolCall(call, byName) : null;
        if (problem) {
            emit({ type: "guardrail", step, call, problem });
            result = { isError: true, text: `Error: ${problem}` };
        } else {
            // A repeated call is counted only when it would really run.
            if (isRepeat()) return "repeated";
            const args = typeof call.arguments === "string" ? {} : call.arguments;
            result = await this.tools.callTool(call.name, args, signal);
        }

        if (result.isError && !cfg.feedback) {
            // Feedback loop OFF: the model learns only that it failed, not why.
            result = { isError: true, text: "The tool call failed." };
        }
        emit({ type: "tool-result", step, call, result, durationMs: Math.round(performance.now() - started) });

        if (!cfg.sendImages && result.images?.length) {
            return { isError: result.isError, text: `${result.text}\n(${result.images.length} image(s) not sent: the model is configured as text-only.)` };
        }
        return result;
    }
}

/**
 * Keeps the last `n` messages (factor F, context limit), but never starts the window in the
 * middle of a tool exchange: an orphaned tool result is rejected by most APIs. The window
 * therefore always starts at a user message.
 */
function windowed(messages: AgentMessage[], n: number): AgentMessage[] {
    if (!n || messages.length <= n) return messages;
    let start = messages.length - n;
    while (start > 0 && messages[start]!.role !== "user") start--;
    return messages.slice(start);
}
