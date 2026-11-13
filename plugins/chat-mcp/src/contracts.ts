/**
 * Contracts between the three layers of the MCP chat.
 *
 *   ┌──────────── Chat UI (ui/panel.ts) ────────────┐
 *   │  text in, AgentEvent stream out               │
 *   └───────────────────────┬───────────────────────┘
 *                           │ AgentLoop.run(userText, history)
 *   ┌──────────── Agent loop (agent/loop.ts) ───────┐
 *   │  owns the conversation, the step budget,      │
 *   │  guardrails, feedback policy and the trace    │
 *   └───────┬───────────────────────────────┬───────┘
 *           │ ModelAdapter.complete()       │ ToolInvoker.list()/call()
 *   ┌───────▼────────┐              ┌───────▼─────────────────────┐
 *   │ Model layer    │              │ Data layer = MCP            │
 *   │ (model/*.ts)   │              │ client ⇄ in-memory ⇄ server │
 *   │ one LLM call,  │              │ server = ToolDefinition[]   │
 *   │ no tool exec.  │              │ over ViewerGateway          │
 *   └────────────────┘              │ (Scripting API)             │
 *                                   └─────────────────────────────┘
 *
 * Rules that keep the layers replaceable:
 * - The loop never touches the Scripting API and never knows which LLM vendor runs.
 * - A ModelAdapter never executes a tool; it only returns the tool calls the model asked for.
 * - A ToolDefinition never knows about MCP, the loop or the model. It gets validated
 *   arguments and a ViewerGateway, and returns a ToolOutput. The same definitions can be
 *   registered into any MCP server: the in-browser one here, or later a relay on the
 *   xOpat Node server (Streamable HTTP for Claude Desktop), without changes.
 *
 * Everything here is plain JSON-serialisable data so a trace can be exported and replayed.
 */
import type { z } from "zod";

// ─────────────────────────────────────────────────────────────── data layer

/**
 * The only door from tools into the viewer. Implemented over the xOpat Scripting API
 * (data/scripting-gateway.ts). A test or a Node relay can provide another implementation.
 */
export interface ViewerGateway {
    /**
     * Runs a script body in the Scripting API sandbox. `args` is JSON-serialised and bound to
     * a constant named `args`, so tool arguments are never concatenated into code as text.
     * Inside the body every namespace call must be awaited. Throws on a script error.
     */
    runScript<T = unknown>(body: string, args?: Record<string, unknown>): Promise<T>;
    /** Namespaces currently registered in the Scripting API (e.g. "viewer", "annotationsRead"). */
    availableNamespaces(): string[];
}

/** What a tool returns. Mirrors the MCP CallToolResult content we use. */
export interface ToolOutput {
    /** Text for the model. Usually JSON. */
    text: string;
    /** Optional images, base64 without the data: prefix. */
    images?: Array<{ mimeType: string; data: string }>;
}

/**
 * One viewer tool, independent of MCP. Registered into an McpServer by mcp/server.ts.
 * `description` is the full text; `shortDescription` is the minimal variant used by the
 * "tool descriptions" thesis factor.
 */
export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
    name: string;
    title: string;
    description: string;
    shortDescription: string;
    inputSchema: Shape;
    /** Scripting namespaces the tool needs; the tool is hidden when one is missing. */
    requiresNamespaces: string[];
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
    run(args: z.infer<z.ZodObject<Shape>>, gateway: ViewerGateway): Promise<ToolOutput>;
}

/** Tool as the loop and the model see it: what MCP `tools/list` returns. */
export interface ToolSpec {
    name: string;
    description: string;
    /** JSON Schema of the arguments (from MCP). */
    inputSchema: Record<string, unknown>;
}

/** Result of one tool call as the loop sees it (from MCP `tools/call`). */
export interface ToolResult {
    isError: boolean;
    text: string;
    images?: Array<{ mimeType: string; data: string }>;
}

/** The loop's view of the data layer. Implemented by the MCP client (mcp/client.ts). */
export interface ToolInvoker {
    listTools(): Promise<ToolSpec[]>;
    callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}

// ─────────────────────────────────────────────────────────────── conversation

export interface ToolCall {
    id: string;
    name: string;
    /** Parsed arguments, or the raw string when the model produced invalid JSON. */
    arguments: Record<string, unknown> | string;
}

/** Vendor-neutral conversation. Adapters translate it to their wire format. */
export type AgentMessage =
    | { role: "user"; text: string }
    | { role: "assistant"; text: string; toolCalls: ToolCall[] }
    | { role: "tool"; toolCallId: string; toolName: string; result: ToolResult };

// ─────────────────────────────────────────────────────────────── model layer

export interface ModelRequest {
    system: string;
    messages: AgentMessage[];
    tools: ToolSpec[];
    /** "auto" lets the model answer in text; "required" forces a tool call; "none" forbids it. */
    toolChoice: "auto" | "required" | "none";
    temperature?: number;
    maxOutputTokens?: number;
    signal?: AbortSignal;
}

export interface ModelResponse {
    text: string;
    toolCalls: ToolCall[];
    finishReason: string | null;
    usage: { inputTokens: number | null; outputTokens: number | null };
    /** Milliseconds the call took, measured by the adapter. */
    durationMs: number;
}

/** One LLM call. Never executes tools, never loops. */
export interface ModelAdapter {
    readonly id: string;
    /** Human-readable "provider / model" for the trace. */
    describe(): string;
    complete(request: ModelRequest): Promise<ModelResponse>;
}

// ─────────────────────────────────────────────────────────────── loop configuration

/**
 * Every switch the thesis experiments need (factors A–F of the plan). Defaults give a
 * sensible demo; an experiment changes one field at a time.
 */
export interface AgentConfig {
    /** A: system prompt variant, or a custom text when `systemPrompt === "custom"`. */
    systemPrompt: "default" | "minimal" | "custom";
    customSystemPrompt?: string;
    /** B: tool description variant sent to the model. */
    toolDescriptions: "full" | "short";
    /** C/F: subset of tools offered to the model (empty = all available). */
    enabledTools: string[];
    /** D: validate arguments against the tool's JSON schema before calling it. */
    guardrails: boolean;
    /** E: on a failed call, send the exact error back (true) or only "the call failed" (false). */
    feedback: boolean;
    /** Stop after this many model calls in one user turn. */
    maxSteps: number;
    /** Stop when the same tool is called with the same arguments this many times in a row. */
    maxRepeatedCalls: number;
    /** Send images returned by tools (screenshot) to the model. Off for text-only models. */
    sendImages: boolean;
    /** F: keep only the last N messages of history (0 = keep all). */
    historyWindow: number;
    temperature?: number;
    maxOutputTokens?: number;
}

// ─────────────────────────────────────────────────────────────── trace

/** Everything the loop does is reported as an event. The UI renders them, the trace stores them. */
export type AgentEvent =
    | { type: "turn-start"; userText: string; config: AgentConfig; model: string; tools: string[] }
    | { type: "model-request"; step: number; messages: number; tools: number }
    | { type: "model-response"; step: number; response: ModelResponse }
    | { type: "tool-call"; step: number; call: ToolCall }
    | { type: "guardrail"; step: number; call: ToolCall; problem: string }
    | { type: "tool-result"; step: number; call: ToolCall; result: ToolResult; durationMs: number }
    | { type: "final"; step: number; text: string; reason: StopReason }
    | { type: "error"; step: number; message: string };

export type StopReason = "answered" | "max-steps" | "repeated-call" | "aborted" | "error";

export interface TraceEntry {
    t: number;
    event: AgentEvent;
}

export interface TurnOutcome {
    text: string;
    reason: StopReason;
    steps: number;
    /** History after the turn, to pass into the next turn. */
    messages: AgentMessage[];
    trace: TraceEntry[];
}
