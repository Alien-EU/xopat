import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolInvoker, ToolResult, ToolSpec } from "../contracts";
import { SHORT_DESCRIPTION_META } from "./server";

/** A tool as listed by MCP, plus the short description variant. */
export interface ListedTool extends ToolSpec {
    shortDescription: string;
}

/**
 * The chat's MCP client. Connected to the in-page server through an in-memory transport:
 * a linked pair of transports that pass JSON-RPC objects directly, without a socket.
 * The protocol is the real one (initialize, tools/list, tools/call, notifications), so
 * swapping the transport for Streamable HTTP or a WebSocket changes nothing above it.
 */
export class McpToolInvoker implements ToolInvoker {
    private _cache: ListedTool[] | null = null;
    private _listeners = new Set<() => void>();

    private constructor(readonly client: Client) {
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
            this._cache = null;
            for (const fn of this._listeners) fn();
        });
    }

    static async connectInMemory(server: McpServer): Promise<McpToolInvoker> {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: "xopat-chat", version: "0.1.0" });
        await client.connect(clientTransport);
        return new McpToolInvoker(client);
    }

    /** Called when the server announces that its tool list changed. */
    onToolsChanged(fn: () => void): () => void {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    async listToolsDetailed(): Promise<ListedTool[]> {
        if (this._cache) return this._cache;
        const { tools } = await this.client.listTools();
        this._cache = tools.map((t) => ({
            name: t.name,
            description: t.description || "",
            shortDescription: String((t._meta as any)?.[SHORT_DESCRIPTION_META] || t.description || ""),
            inputSchema: t.inputSchema as Record<string, unknown>,
        }));
        return this._cache;
    }

    async listTools(): Promise<ToolSpec[]> {
        return (await this.listToolsDetailed()).map(({ shortDescription: _s, ...spec }) => spec);
    }

    async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
        try {
            const res: any = await this.client.callTool({ name, arguments: args }, undefined, signal ? { signal } : undefined);
            const content: any[] = Array.isArray(res?.content) ? res.content : [];
            return {
                isError: !!res?.isError,
                text: content.filter((c) => c.type === "text").map((c) => c.text).join("\n"),
                images: content.filter((c) => c.type === "image").map((c) => ({ mimeType: c.mimeType, data: c.data })),
            };
        } catch (error: any) {
            // Protocol-level failure (unknown tool, schema rejected by the server, …). Report it to
            // the loop the same way as a tool error so the feedback policy applies to both.
            return { isError: true, text: `Error: ${error?.message || String(error)}` };
        }
    }
}
