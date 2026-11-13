/**
 * Node test of the data layer + MCP + loop without a browser or a real model:
 * a fake ViewerGateway stands in for the Scripting API and a scripted ModelAdapter
 * replays fixed responses. Run: npm test (in plugins/chat-mcp).
 */
import assert from "node:assert/strict";
import type { ModelAdapter, ModelRequest, ModelResponse, ViewerGateway } from "../src/contracts";
import { VIEWER_TOOLS } from "../src/data/tools";
import { createViewerMcpServer } from "../src/mcp/server";
import { McpToolInvoker } from "../src/mcp/client";
import { AgentLoop, DEFAULT_AGENT_CONFIG } from "../src/agent/loop";

const scripts: string[] = [];
const gateway: ViewerGateway & { namespaces: string[] } = {
    namespaces: ["application", "viewer"],
    availableNamespaces() { return this.namespaces; },
    async runScript(body: string, args: Record<string, unknown> = {}) {
        scripts.push(body);
        if (body.includes("frameImageRegion") || body.includes("getViewportBoundsInImage")) {
            return { visibleRegion: { x: args.x ?? 0, y: args.y ?? 0, width: args.width ?? 1000, height: args.height ?? 800 }, slideSize: { width: 10000, height: 8000 } } as any;
        }
        if (body.includes("getAnnotations")) return [] as any;
        throw new Error("unexpected script");
    },
};

function scripted(responses: Array<Partial<ModelResponse>>): ModelAdapter & { requests: ModelRequest[] } {
    const requests: ModelRequest[] = [];
    return {
        id: "scripted", requests,
        describe: () => "scripted",
        async complete(req) {
            requests.push(structuredClone({ ...req, signal: undefined }));
            const r = responses.shift() ?? { text: "done" };
            return { text: "", toolCalls: [], finishReason: "stop", usage: { inputTokens: null, outputTokens: null }, durationMs: 0, ...r };
        },
    };
}

const { server, refreshAvailability } = createViewerMcpServer(VIEWER_TOOLS, gateway);
const mcp = await McpToolInvoker.connectInMemory(server);

// 1. tools/list over MCP respects namespaces; list_changed arrives when annotations appear.
let names = (await mcp.listTools()).map((t) => t.name);
assert.deepEqual(names, ["list_open_slides", "select_slide", "get_viewport", "navigate_to_region", "screenshot_viewport"]);
let changed = false;
mcp.onToolsChanged(() => { changed = true; });
gateway.namespaces.push("annotationsRead", "annotationsWrite");
refreshAvailability();
await new Promise((r) => setTimeout(r, 10));
assert.ok(changed, "list_changed notification received");
names = (await mcp.listTools()).map((t) => t.name);
assert.equal(names.length, 8);
const detailed = await mcp.listToolsDetailed();
assert.equal(detailed.find((t) => t.name === "navigate_to_region")!.shortDescription, "Shows the rectangle x, y, width, height.");

// 2. Happy path: model calls navigate_to_region, then answers.
let model = scripted([
    { toolCalls: [{ id: "c1", name: "navigate_to_region", arguments: { x: 10, y: 20, width: 300, height: 200 } }] },
    { text: "Done, zoomed in." },
]);
let out = await new AgentLoop(model, mcp, DEFAULT_AGENT_CONFIG).run("zoom");
assert.equal(out.reason, "answered");
assert.equal(out.text, "Done, zoomed in.");
assert.equal(out.steps, 2);
const toolMsg = out.messages.find((m) => m.role === "tool")!;
assert.equal(toolMsg.role === "tool" && toolMsg.result.isError, false);
assert.match(scripts.at(-1)!, /frameImageRegion/);

// 3. Guardrail catches a missing field before MCP; feedback carries the message back.
model = scripted([
    { toolCalls: [{ id: "c1", name: "navigate_to_region", arguments: { x: 10, y: 20, width: 300 } }] },
    { text: "ok" },
]);
const before = scripts.length;
out = await new AgentLoop(model, mcp, DEFAULT_AGENT_CONFIG).run("zoom");
assert.equal(scripts.length, before, "guardrail stopped the call before the viewer");
assert.equal(out.trace.filter((e) => e.event.type === "guardrail").length, 1);
const lastTool = model.requests[1]!.messages.at(-1)!;
assert.ok(lastTool.role === "tool" && /missing required field "height"/.test(lastTool.result.text));

// 4. Guardrails off: same call reaches the MCP server, whose zod validation rejects it.
model = scripted([
    { toolCalls: [{ id: "c1", name: "navigate_to_region", arguments: { x: 10, y: 20, width: 300 } }] },
    { text: "ok" },
]);
out = await new AgentLoop(model, mcp, { ...DEFAULT_AGENT_CONFIG, guardrails: false }).run("zoom");
const serverErr = model.requests[1]!.messages.at(-1)!;
assert.ok(serverErr.role === "tool" && serverErr.result.isError && /height/i.test(serverErr.result.text));

// 5. Feedback off hides the reason.
model = scripted([{ toolCalls: [{ id: "c1", name: "nope", arguments: {} }] }, { text: "ok" }]);
out = await new AgentLoop(model, mcp, { ...DEFAULT_AGENT_CONFIG, feedback: false }).run("x");
const hidden = model.requests[1]!.messages.at(-1)!;
assert.ok(hidden.role === "tool" && hidden.result.text === "The tool call failed.");

// 6. Repeated identical calls stop the turn; max steps is respected.
const same = { toolCalls: [{ id: "c", name: "get_viewport", arguments: {} }] };
model = scripted([same, same, same, same, same]);
out = await new AgentLoop(model, mcp, DEFAULT_AGENT_CONFIG).run("x");
assert.equal(out.reason, "repeated-call");
model = scripted(Array.from({ length: 10 }, (_, i) => ({ toolCalls: [{ id: `c${i}`, name: "navigate_to_region", arguments: { x: i, y: 0, width: 10, height: 10 } }] })));
out = await new AgentLoop(model, mcp, { ...DEFAULT_AGENT_CONFIG, maxSteps: 3 }).run("x");
assert.equal(out.reason, "max-steps");
assert.equal(model.requests.length, 3);

// 7. Short descriptions and tool subset reach the model.
model = scripted([{ text: "hi" }]);
await new AgentLoop(model, mcp, { ...DEFAULT_AGENT_CONFIG, toolDescriptions: "short", enabledTools: ["get_viewport"] }).run("x");
assert.deepEqual(model.requests[0]!.tools.map((t) => t.description), ["Returns the visible region and slide size."]);

console.log("chat-mcp loop tests: all passed");
process.exit(0);
