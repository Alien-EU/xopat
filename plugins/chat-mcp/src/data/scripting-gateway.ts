import type { ViewerGateway } from "../contracts";

/**
 * ViewerGateway over the xOpat Scripting API — the same sandboxed path the built-in chat
 * uses for model-written scripts:
 *
 *   tool.run()  →  runScript(body, args)
 *     →  APPLICATION_CONTEXT.Scripting context "<id>" .executeScript(script)
 *     →  sandboxed Web Worker calls the host namespaces (viewer, annotationsRead, …)
 *
 * The difference to the built-in chat is WHO writes the script: here it is a fixed body
 * written by the tool author, and the model only supplies JSON arguments. The MCP toolset
 * is therefore a much narrower surface than "run any script the model writes".
 *
 * `bypassConsentDialog: true` because the tools themselves are the allow-list; the user
 * enabled this plugin and sees every call in the chat. `metadata: {}` is required: the
 * annotations write namespace assigns to the context metadata and throws without it.
 */
export class ScriptingGateway implements ViewerGateway {
    constructor(private readonly contextId = "chat-mcp", private readonly label = "MCP chat") {}

    private _context(): any {
        const scripting = (globalThis as any).APPLICATION_CONTEXT?.Scripting;
        if (!scripting) throw new Error("The xOpat Scripting API is not available in this page.");
        if (scripting.hasContext(this.contextId)) return scripting.getContext(this.contextId);
        return scripting.createContext({
            id: this.contextId,
            label: this.label,
            bypassConsentDialog: true,
            metadata: {},
        });
    }

    async runScript<T = unknown>(body: string, args: Record<string, unknown> = {}): Promise<T> {
        const script = `const args = ${JSON.stringify(args)};\n${body}`;
        return await this._context().executeScript(script) as T;
    }

    availableNamespaces(): string[] {
        const scripting = (globalThis as any).APPLICATION_CONTEXT?.Scripting;
        return Object.keys(scripting?.getNamespaceConsentEntries?.() || {});
    }
}
