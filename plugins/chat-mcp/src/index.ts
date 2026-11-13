/// <reference path="../../../src/types/globals.d.ts" />
import type { AgentConfig, AgentEvent, AgentMessage, ModelAdapter, TraceEntry, TurnOutcome } from "./contracts";
import { ScriptingGateway } from "./data/scripting-gateway";
import { VIEWER_TOOLS } from "./data/tools";
import { createViewerMcpServer, type ViewerMcpServer } from "./mcp/server";
import { McpToolInvoker } from "./mcp/client";
import { XopatServerModelAdapter } from "./model/xopat-server-adapter";
import { AgentLoop, DEFAULT_AGENT_CONFIG } from "./agent/loop";
import { McpChatPanel } from "./ui/panel";

/**
 * chat-mcp — the viewer chat on MCP tools instead of model-written scripts.
 *
 *   panel ─▶ AgentLoop ─▶ ModelAdapter (server RPC `modelStep`, one LLM call)
 *                     └─▶ MCP Client ⇄ InMemoryTransport ⇄ MCP Server ─▶ tools ─▶ Scripting API
 *
 * Public API for experiments (e.g. from Playwright or the console):
 *   const p = plugin("chat-mcp");
 *   await p.mcp.listTools();                       // raw MCP client
 *   await p.runTurn("zoom to the centre", { providerId, modelId }, { config: { guardrails: false } });
 */
addPlugin("chat-mcp", class extends XOpatPlugin {
    private gateway = new ScriptingGateway();
    private viewerServer: ViewerMcpServer | null = null;
    /** The MCP client. Public so experiments can call tools directly. */
    mcp: McpToolInvoker | null = null;
    private config: AgentConfig = { ...DEFAULT_AGENT_CONFIG };
    private history: AgentMessage[] = [];
    private trace: TraceEntry[] = [];
    private panel: any = null;
    private ready: Promise<void> | null = null;

    constructor(id: string) {
        super(id);
    }

    async pluginReady() {
        await this.loadLocale();
        this.config = { ...DEFAULT_AGENT_CONFIG, ...this.readStoredConfig() };
        this.ready = this.connect();
        await this.ready;
        this.attachPanel();
    }

    private async connect(): Promise<void> {
        this.viewerServer = createViewerMcpServer(VIEWER_TOOLS, this.gateway);
        this.mcp = await McpToolInvoker.connectInMemory(this.viewerServer.server);
        // Plugins that register Scripting namespaces later (annotations) change which tools exist.
        const refresh = () => this.viewerServer?.refreshAvailability();
        (globalThis as any).APPLICATION_CONTEXT?.Scripting?.addNamespacesChangedHandler?.(refresh);
        this.mcp.onToolsChanged(() => void this.panel?.refreshTools());
    }

    private attachPanel(): void {
        const plugin = this;
        this.panel = new McpChatPanel({
            id: "chat-mcp-panel",
            host: {
                t: (k, v) => plugin.t(k, v),
                listProviders: () => plugin.listProviders(),
                listModels: (id) => plugin.listModels(id),
                listTools: async () => { plugin.viewerServer?.refreshAvailability(); return plugin.mcp!.listToolsDetailed(); },
                getConfig: () => plugin.config,
                setConfig: (patch) => plugin.setConfig(patch),
                runTurn: async (text, target, onEvent, signal) => { await plugin.runTurn(text, target, { onEvent, signal }); },
                resetConversation: () => { plugin.history = []; plugin.trace = []; },
                getTrace: () => plugin.trace,
                getHistory: () => plugin.history,
            },
        });
        (globalThis as any).LAYOUT.addTab({
            id: "chat-mcp",
            title: this.t("tabTitle"),
            icon: "ph-plugs-connected",
            body: [this.panel],
        });
    }

    /** Runs one user turn through the loop and keeps the conversation. */
    async runTurn(
        text: string,
        target: { providerId: string; modelId: string | null },
        options: { onEvent?: (e: AgentEvent) => void; signal?: AbortSignal; config?: Partial<AgentConfig>; model?: ModelAdapter } = {},
    ): Promise<TurnOutcome> {
        await this.ready;
        const model = options.model ?? new XopatServerModelAdapter(
            (input, opts) => this.server().modelStep(input, opts),
            target.providerId,
            target.modelId,
        );
        const loop = new AgentLoop(model, this.mcp!, { ...this.config, ...(options.config || {}) });
        const outcome = await loop.run(text, this.history, { onEvent: options.onEvent, signal: options.signal });
        this.history = outcome.messages;
        this.trace.push(...outcome.trace);
        return outcome;
    }

    setConfig(patch: Partial<AgentConfig>): void {
        this.config = { ...this.config, ...patch };
        try { this.cache.set("config", JSON.stringify(this.config)); } catch { /* preference only */ }
    }

    private readStoredConfig(): Partial<AgentConfig> {
        try {
            const raw = this.cache.get("config");
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    private chatModule(): any {
        const chat = (globalThis as any).singletonModule?.("vercel-ai-chat-sdk");
        if (!chat?.chatService) throw new Error(this.t("error.noChatModule"));
        return chat;
    }

    /** Providers configured for the built-in chat (same registry, same keys on the server). */
    async listProviders(): Promise<Array<{ id: string; label: string }>> {
        const chat = this.chatModule();
        await chat.whenManagedRegistrationsSettled?.();
        const providers = await chat.chatService.refreshProvidersFromServer();
        return (providers || []).map((p: any) => ({ id: p.id, label: p.label || p.id }));
    }

    async listModels(providerId: string): Promise<Array<{ id: string; label: string }>> {
        const models = await this.chatModule().chatService.listModels(providerId);
        return (models || []).map((m: any) => ({ id: m.id, label: m.label || m.id }));
    }
});
