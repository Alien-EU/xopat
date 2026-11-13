# chat-mcp — viewer chat over MCP tools

**Experimental.** A chat tab ("MCP Chat") in which the model controls the viewer by calling
a small set of typed tools over the [Model Context Protocol](https://modelcontextprotocol.io),
instead of writing Scripting API code as the built-in chat does. Built as the base for
tool-calling experiments with small models, so every step of the agent loop is switchable
and logged.

```
 MCP Chat tab ──▶ AgentLoop ──▶ ModelAdapter ──RPC modelStep──▶ server: provider registry ──▶ LLM
                      │                                          (vercel-ai-chat-sdk, keys stay here)
                      └──▶ MCP Client ⇄ InMemoryTransport ⇄ MCP Server ──▶ ToolDefinition[]
                                                                             └──▶ ScriptingGateway ──▶ Scripting API
```

## Run it

```bash
npm run up -- base/core data/wsi-service auth/none chat/openai-compatible-cerit flags/mcp-chat
```

`flags/mcp-chat` enables this plugin and `gui_annotations`. Any provider configured for the
built-in chat works; the tab offers the same providers and models.

## Layers and contracts (`src/contracts.ts`)

| Layer | Files | Contract |
|---|---|---|
| Data | `src/data/` | `ToolDefinition` (name, descriptions, zod input shape, `run(args, gateway)`), `ViewerGateway.runScript(body, args)` |
| Protocol | `src/mcp/` | MCP server built from `ToolDefinition[]`; client implements `ToolInvoker` (`listTools`, `callTool`) |
| Model | `src/model/`, `chat-mcp-host.server.ts` | `ModelAdapter.complete(ModelRequest) → ModelResponse`: one LLM call, returns tool calls, never executes them |
| Loop | `src/agent/` | `AgentLoop.run(text, history) → TurnOutcome`, configured by `AgentConfig`, reports `AgentEvent`s |
| UI | `src/ui/panel.ts` | `PanelHost` — the panel knows nothing about MCP or models |

Tools never see MCP; the MCP server is transport-agnostic. The same `ToolDefinition`s can be
mounted later on a server-side relay (Streamable HTTP `/mcp` + WebSocket to the tab) so that
external clients such as Claude Desktop use the identical toolset.

## Tools

`list_open_slides`, `select_slide`, `get_viewport`, `navigate_to_region`,
`screenshot_viewport`, `list_annotations`, `create_annotation`, `delete_annotation`.
Coordinates are level-0 image pixels. A tool whose Scripting namespaces are missing is
disabled and the server sends `notifications/tools/list_changed`. The screenshot comes from
`viewer.getViewportScreenshot` and does not include the annotation overlay.

## Experiment switches (`AgentConfig`)

`systemPrompt` (default / minimal / custom), `toolDescriptions` (full / short),
`enabledTools`, `guardrails` (client-side argument validation), `feedback` (exact error vs.
"the tool call failed"), `maxSteps`, `maxRepeatedCalls`, `sendImages`, `historyWindow`.
Settable in the tab ("Experiment settings") or per call:

```js
const p = plugin("chat-mcp");
await p.runTurn("zoom to the centre", { providerId, modelId }, { config: { guardrails: false } });
p.trace;                    // every AgentEvent with a timestamp ("Export trace" downloads it)
await p.mcp.callTool("get_viewport", {});   // raw MCP client
```

## Tests

```bash
cd plugins/chat-mcp && npm test
```

Runs the loop against the real MCP server/client with a fake gateway and a scripted model,
and `modelStep` against a fake OpenAI-compatible HTTP endpoint (checks the wire format).
