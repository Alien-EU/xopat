import type { ModelAdapter, ModelRequest, ModelResponse } from "../contracts";

/** Wire shape of the `modelStep` RPC (chat-mcp-host.server.ts). Plain JSON both ways. */
export interface ModelStepInput {
    providerId: string;
    modelId: string | null;
    system: string;
    messages: ModelRequest["messages"];
    tools: ModelRequest["tools"];
    toolChoice: ModelRequest["toolChoice"];
    temperature?: number;
    maxOutputTokens?: number;
}

export type ModelStepOutput = Omit<ModelResponse, "durationMs">;

type RpcCall = (input: ModelStepInput, options: { signal?: AbortSignal; timeoutMs?: number }) => Promise<ModelStepOutput>;

/**
 * ModelAdapter that runs the model on the xOpat server, through the chat module's provider
 * registry. The API key therefore never reaches the browser (same guarantee as the
 * built-in chat), and every provider already configured for the chat works here too:
 * e-INFRA (OpenAI-compatible), OpenAI, Anthropic, Ollama, vLLM, …
 *
 * The server does exactly ONE model call per `complete()` and returns the tool calls the
 * model asked for, without executing them; the tools live in this page.
 */
export class XopatServerModelAdapter implements ModelAdapter {
    readonly id = "xopat-server";

    constructor(
        private readonly rpc: RpcCall,
        readonly providerId: string,
        readonly modelId: string | null,
        private readonly label = `${providerId} / ${modelId ?? "default"}`,
    ) {}

    describe(): string {
        return this.label;
    }

    async complete(request: ModelRequest): Promise<ModelResponse> {
        const started = performance.now();
        const out = await this.rpc({
            providerId: this.providerId,
            modelId: this.modelId,
            system: request.system,
            messages: request.messages,
            tools: request.tools,
            toolChoice: request.toolChoice,
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
        }, { signal: request.signal, timeoutMs: 0 });
        return { ...out, durationMs: Math.round(performance.now() - started) };
    }
}
