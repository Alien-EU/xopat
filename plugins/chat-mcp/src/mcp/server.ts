import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition, ViewerGateway } from "../contracts";

/** `_meta` key that carries the short description variant (thesis factor B). */
export const SHORT_DESCRIPTION_META = "xopat/shortDescription";

export interface ViewerMcpServer {
    server: McpServer;
    /**
     * Re-checks which Scripting namespaces exist and enables/disables tools accordingly.
     * The SDK then sends `notifications/tools/list_changed` to connected clients.
     */
    refreshAvailability(): void;
}

/**
 * Builds an MCP server from transport-agnostic ToolDefinitions. Nothing here depends on
 * the browser: give it another ViewerGateway (e.g. one that forwards scripts over a
 * WebSocket to a viewer tab) and connect it to another transport (Streamable HTTP on the
 * xOpat Node server) and the same tools serve Claude Desktop.
 */
export function createViewerMcpServer(tools: ToolDefinition<any>[], gateway: ViewerGateway): ViewerMcpServer {
    const server = new McpServer(
        { name: "xopat-viewer", version: "0.1.0" },
        {
            capabilities: { tools: { listChanged: true } },
            instructions:
                "Tools for the xOpat whole-slide image viewer. Typical flow: get_viewport -> navigate_to_region / " +
                "screenshot_viewport -> create_annotation. All coordinates are level-0 image pixels of the selected " +
                "slide (origin top-left).",
        },
    );

    const registered = new Map<string, { def: ToolDefinition<any>; handle: RegisteredTool }>();
    for (const def of tools) {
        const handle = server.registerTool(
            def.name,
            {
                title: def.title,
                description: def.description,
                inputSchema: def.inputSchema,
                annotations: def.annotations,
                _meta: { [SHORT_DESCRIPTION_META]: def.shortDescription },
            },
            async (args: any) => {
                try {
                    const out = await def.run(args ?? {}, gateway);
                    const content: any[] = [{ type: "text", text: out.text }];
                    for (const img of out.images || []) content.push({ type: "image", mimeType: img.mimeType, data: img.data });
                    return { content };
                } catch (error: any) {
                    // A tool error is a RESULT with isError, not a protocol error: the model reads
                    // the message and can correct its next call (feedback loop).
                    return { isError: true, content: [{ type: "text" as const, text: `Error: ${error?.message || String(error)}` }] };
                }
            },
        );
        registered.set(def.name, { def, handle });
    }

    const refreshAvailability = () => {
        const available = new Set(gateway.availableNamespaces());
        for (const { def, handle } of registered.values()) {
            const ok = def.requiresNamespaces.every((ns) => available.has(ns));
            if (ok !== handle.enabled) ok ? handle.enable() : handle.disable();
        }
    };
    refreshAvailability();
    return { server, refreshAvailability };
}
