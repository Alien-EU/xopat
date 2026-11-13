import type { AgentConfig, AgentEvent, AgentMessage, TraceEntry } from "../contracts";
import type { ListedTool } from "../mcp/client";

const { BaseComponent } = (globalThis as any).UI;
const van = (globalThis as any).van;
const { div, span, button, select, option, textarea, label, input, details, summary, pre } = van.tags;

/** What the panel needs from the plugin. Keeps the UI free of MCP/model specifics. */
export interface PanelHost {
    t(key: string, vars?: Record<string, unknown>): string;
    listProviders(): Promise<Array<{ id: string; label: string }>>;
    listModels(providerId: string): Promise<Array<{ id: string; label: string }>>;
    listTools(): Promise<ListedTool[]>;
    getConfig(): AgentConfig;
    setConfig(patch: Partial<AgentConfig>): void;
    runTurn(
        text: string,
        target: { providerId: string; modelId: string | null },
        onEvent: (e: AgentEvent) => void,
        signal: AbortSignal,
    ): Promise<void>;
    resetConversation(): void;
    getTrace(): TraceEntry[];
    getHistory(): AgentMessage[];
}

/**
 * The "MCP chat" tab: provider/model pickers, the thesis switches, a message list that
 * shows every tool call with its arguments and result, and trace export.
 * Model and tool text is rendered as text only (never as HTML).
 */
export class McpChatPanel extends BaseComponent {
    private host: PanelHost;
    private providerId = van.state("");
    private modelId = van.state("");
    private providers = van.state([] as Array<{ id: string; label: string }>);
    private models = van.state([] as Array<{ id: string; label: string }>);
    private tools = van.state([] as ListedTool[]);
    private busy = van.state(false);
    private status = van.state("");
    private listEl: HTMLElement | null = null;
    private inputEl: HTMLTextAreaElement | null = null;
    private abort: AbortController | null = null;

    constructor(options: { id?: string; host: PanelHost }) {
        super(options);
        this.host = options.host;
    }

    create(): HTMLElement {
        const t = (k: string, v?: Record<string, unknown>) => this.host.t(k, v);
        this.listEl = div({ class: "flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 p-1" }) as HTMLElement;
        this.inputEl = textarea({
            class: "textarea textarea-bordered textarea-sm w-full",
            rows: 3,
            placeholder: t("panel.placeholder"),
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void this.send(); }
            },
        }) as HTMLTextAreaElement;

        const root = div({ class: "flex flex-col gap-2 p-2 h-full min-h-0" },
            this.targetRow(t),
            this.settings(t),
            this.listEl,
            div({ class: "text-xs opacity-70 min-h-4" }, () => this.status.val),
            this.inputEl,
            div({ class: "flex gap-2 flex-wrap" },
                button({ class: "btn btn-primary btn-sm", disabled: () => this.busy.val, onclick: () => this.send() }, t("panel.send")),
                button({ class: "btn btn-sm", disabled: () => !this.busy.val, onclick: () => this.abort?.abort() }, t("panel.stopButton")),
                button({ class: "btn btn-ghost btn-sm", disabled: () => this.busy.val, onclick: () => this.reset() }, t("panel.newConversation")),
                button({ class: "btn btn-ghost btn-sm", onclick: () => this.exportTrace() }, t("panel.exportTrace")),
            ),
        ) as HTMLElement;
        void this.loadCatalog();
        return root;
    }

    /** Refreshes the tool list (called when the MCP server announces list_changed). */
    async refreshTools(): Promise<void> {
        try { this.tools.val = await this.host.listTools(); } catch (e) { console.warn("[chat-mcp] listTools failed", e); }
    }

    private targetRow(t: PanelHost["t"]) {
        // A <select> may only contain <option>s, so the options are re-rendered imperatively.
        const picker = (title: string, items: any, current: any, onPick: (v: string) => void) => {
            const el = select({
                class: "select select-bordered select-xs flex-1 min-w-0",
                title,
                onchange: (e: Event) => onPick((e.target as HTMLSelectElement).value),
            }) as HTMLSelectElement;
            van.derive(() => {
                const list = items.val as Array<{ id: string; label: string }>;
                const selected = current.val;
                el.replaceChildren(...list.map((it) => option({ value: it.id, selected: it.id === selected }, it.label)));
            });
            return el;
        };
        return div({ class: "flex gap-2" },
            picker(t("panel.provider"), this.providers, this.providerId, (v) => { this.providerId.val = v; void this.loadModels(); }),
            picker(t("panel.model"), this.models, this.modelId, (v) => { this.modelId.val = v; }),
        );
    }

    private settings(t: PanelHost["t"]) {
        const cfg = () => this.host.getConfig();
        const toggle = (key: "guardrails" | "feedback" | "sendImages", text: string) =>
            label({ class: "label cursor-pointer justify-start gap-2 py-0.5" },
                input({ type: "checkbox", class: "checkbox checkbox-xs", checked: cfg()[key],
                    onchange: (e: Event) => this.host.setConfig({ [key]: (e.target as HTMLInputElement).checked }) }),
                span({ class: "label-text text-xs" }, text));
        const choice = (key: "systemPrompt" | "toolDescriptions", text: string, values: string[]) =>
            label({ class: "flex items-center gap-2 text-xs" }, span({ class: "w-28" }, text),
                select({ class: "select select-bordered select-xs",
                    onchange: (e: Event) => this.host.setConfig({ [key]: (e.target as HTMLSelectElement).value } as any) },
                ...values.map((v) => option({ value: v, selected: cfg()[key] === v }, t(`settings.${key}.${v}`)))));
        const numberField = (key: "maxSteps" | "historyWindow", text: string, min: number) =>
            label({ class: "flex items-center gap-2 text-xs" }, span({ class: "w-28" }, text),
                input({ type: "number", min, class: "input input-bordered input-xs w-20", value: cfg()[key],
                    onchange: (e: Event) => this.host.setConfig({ [key]: Math.max(min, Number((e.target as HTMLInputElement).value) || min) } as any) }));
        const customPrompt = textarea({
            class: "textarea textarea-bordered textarea-xs w-full", rows: 3, placeholder: t("settings.customPrompt"),
            value: cfg().customSystemPrompt || "",
            onchange: (e: Event) => this.host.setConfig({ customSystemPrompt: (e.target as HTMLTextAreaElement).value }),
        });
        const toolsBox = () => div({ class: "flex flex-col" },
            span({ class: "text-xs font-semibold mt-1" }, t("settings.tools")),
            ...this.tools.val.map((tool) => label({ class: "label cursor-pointer justify-start gap-2 py-0", title: tool.description },
                input({ type: "checkbox", class: "checkbox checkbox-xs", checked: this.isToolEnabled(tool.name),
                    onchange: (e: Event) => this.setToolEnabled(tool.name, (e.target as HTMLInputElement).checked) }),
                span({ class: "label-text text-xs font-mono" }, tool.name))));
        return details({ class: "collapse collapse-arrow bg-base-200 rounded-box" },
            summary({ class: "collapse-title text-xs min-h-0 py-2" }, t("settings.title")),
            div({ class: "collapse-content flex flex-col gap-1" },
                choice("systemPrompt", t("settings.systemPromptLabel"), ["default", "minimal", "custom"]),
                customPrompt,
                choice("toolDescriptions", t("settings.toolDescriptionsLabel"), ["full", "short"]),
                toggle("guardrails", t("settings.guardrails")),
                toggle("feedback", t("settings.feedback")),
                toggle("sendImages", t("settings.sendImages")),
                numberField("maxSteps", t("settings.maxSteps"), 1),
                numberField("historyWindow", t("settings.historyWindow"), 0),
                () => toolsBox(),
            ));
    }

    private isToolEnabled(name: string): boolean {
        const enabled = this.host.getConfig().enabledTools;
        return !enabled.length || enabled.includes(name);
    }

    private setToolEnabled(name: string, on: boolean): void {
        const all = this.tools.val.map((x) => x.name);
        const current = new Set(this.host.getConfig().enabledTools.length ? this.host.getConfig().enabledTools : all);
        if (on) current.add(name); else current.delete(name);
        // Empty list means "all tools"; store an explicit list only when something is off.
        this.host.setConfig({ enabledTools: current.size === all.length ? [] : [...current] });
    }

    private async loadCatalog(): Promise<void> {
        await this.refreshTools();
        try {
            this.providers.val = await this.host.listProviders();
            if (!this.providerId.val && this.providers.val.length) this.providerId.val = this.providers.val[0]!.id;
            await this.loadModels();
        } catch (e: any) {
            this.status.val = this.host.t("panel.providersFailed", { reason: e?.message || String(e) });
        }
    }

    private async loadModels(): Promise<void> {
        if (!this.providerId.val) return;
        try {
            this.models.val = await this.host.listModels(this.providerId.val);
            if (!this.models.val.some((m) => m.id === this.modelId.val)) this.modelId.val = this.models.val[0]?.id || "";
        } catch (e: any) {
            this.models.val = [];
            this.status.val = this.host.t("panel.modelsFailed", { reason: e?.message || String(e) });
        }
    }

    private async send(): Promise<void> {
        const text = this.inputEl?.value.trim();
        if (!text || this.busy.val) return;
        if (!this.providerId.val) { this.status.val = this.host.t("panel.noProvider"); return; }
        this.inputEl!.value = "";
        this.bubble("user", text);
        this.busy.val = true;
        this.abort = new AbortController();
        try {
            await this.host.runTurn(text, { providerId: this.providerId.val, modelId: this.modelId.val || null },
                (e) => this.onEvent(e), this.abort.signal);
        } catch (e: any) {
            this.bubble("error", e?.message || String(e));
        } finally {
            this.busy.val = false;
            this.abort = null;
        }
    }

    private onEvent(e: AgentEvent): void {
        const t = (k: string, v?: Record<string, unknown>) => this.host.t(k, v);
        switch (e.type) {
            case "model-request":
                this.status.val = t("panel.thinking", { step: e.step });
                break;
            case "model-response":
                if (e.response.text && e.response.toolCalls.length) this.bubble("assistant-note", e.response.text);
                break;
            case "tool-result":
                this.toolCard(e.call.name, e.call.arguments, e.result.isError, e.result.text, e.result.images?.[0], e.durationMs);
                this.status.val = t("panel.ranTool", { name: e.call.name });
                break;
            case "guardrail":
                this.status.val = t("panel.guardrail", { name: e.call.name });
                break;
            case "final":
                if (e.text) this.bubble("assistant", e.text);
                this.status.val = e.reason === "answered" ? "" : t(`panel.stopped.${e.reason}`);
                break;
            case "error":
                this.bubble("error", e.message);
                break;
        }
    }

    private bubble(kind: "user" | "assistant" | "assistant-note" | "error", text: string): void {
        const cls = {
            "user": "chat chat-end",
            "assistant": "chat chat-start",
            "assistant-note": "chat chat-start opacity-70",
            "error": "chat chat-start",
        }[kind];
        const bubbleCls = kind === "user" ? "chat-bubble chat-bubble-primary" : kind === "error" ? "chat-bubble chat-bubble-error" : "chat-bubble";
        this.append(div({ class: cls }, div({ class: `${bubbleCls} text-sm whitespace-pre-wrap break-words` }, text)));
    }

    private toolCard(name: string, args: unknown, isError: boolean, text: string, image: { mimeType: string; data: string } | undefined, ms: number): void {
        const icon = isError ? "ph-warning-circle text-error" : "ph-wrench text-success";
        this.append(details({ class: "bg-base-200 rounded-box text-xs" },
            summary({ class: "cursor-pointer px-2 py-1 flex gap-1 items-center" },
                van.tags.i({ class: `ph-light ${icon}` }), span({ class: "font-mono" }, name), span({ class: "opacity-60 ml-auto" }, `${ms} ms`)),
            div({ class: "px-2 pb-2 flex flex-col gap-1" },
                pre({ class: "whitespace-pre-wrap break-all opacity-80" }, typeof args === "string" ? args : JSON.stringify(args, null, 1)),
                pre({ class: "whitespace-pre-wrap break-all max-h-48 overflow-auto" }, text),
                image ? van.tags.img({ class: "rounded max-w-full", src: `data:${image.mimeType};base64,${image.data}` }) : null,
            )));
    }

    private append(node: HTMLElement): void {
        this.listEl?.appendChild(node);
        this.listEl?.scrollTo({ top: this.listEl.scrollHeight });
    }

    private reset(): void {
        this.host.resetConversation();
        if (this.listEl) this.listEl.textContent = "";
        this.status.val = "";
    }

    private exportTrace(): void {
        const payload = JSON.stringify({ exportedAt: new Date().toISOString(), history: this.host.getHistory(), trace: this.host.getTrace() }, null, 2);
        const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
        const a = van.tags.a({ href: url, download: `mcp-chat-trace-${Date.now()}.json` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
