/**
 * Server half: modelStep against a fake OpenAI-compatible HTTP endpoint, checking what
 * actually goes over the wire (tools, tool_calls, tool results, screenshot as user image).
 */
import assert from "node:assert/strict";
import http from "node:http";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { modelStep } from "../chat-mcp-host.server";

const bodies: any[] = [];
const replies = [
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "navigate_to_region", arguments: "{\"x\":1,\"y\":2,\"width\":3,\"height\":4}" } }] },
    { role: "assistant", content: "Done." },
];
const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
        bodies.push(JSON.parse(raw));
        const message = replies.shift();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: "m",
            choices: [{ index: 0, message, finish_reason: message?.tool_calls ? "tool_calls" : "stop" }],
            usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } }));
    });
});
await new Promise<void>((r) => srv.listen(0, r));
const port = (srv.address() as any).port;
const provider = createOpenAICompatible({ name: "fake", baseURL: `http://127.0.0.1:${port}/v1` });

(globalThis as any).XOPAT_SERVER = {
    async importServerExport(_ctx: any, _target: string, name: string) {
        if (name === "resolveUserScope") return () => "user";
        return { instance: () => ({
            resolveProviderRuntime: async () => ({ type: { id: "t", adapter: "a", defaultModelId: "m" }, instance: { id: "p" }, config: {}, secrets: {} }),
            getAdapter: () => ({ resolveModel: async ({ modelId }: any) => provider.chatModel(modelId) }),
        }) };
    },
};

const tools = [{ name: "navigate_to_region", description: "Shows a rectangle.", inputSchema: {
    type: "object", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
    required: ["x", "y", "width", "height"], additionalProperties: false } }];

const first = await modelStep({}, { providerId: "p", modelId: "qwen", system: "SYS", tools, toolChoice: "auto",
    messages: [{ role: "user", text: "zoom" }] });
assert.deepEqual(first.toolCalls, [{ id: "call_1", name: "navigate_to_region", arguments: { x: 1, y: 2, width: 3, height: 4 } }]);
assert.equal(first.usage.inputTokens, 11);
assert.equal(bodies[0].model, "qwen");
assert.equal(bodies[0].messages[0].role, "system");
assert.equal(bodies[0].tools[0].function.name, "navigate_to_region");

const second = await modelStep({}, { providerId: "p", modelId: "qwen", system: "SYS", tools, toolChoice: "auto", messages: [
    { role: "user", text: "zoom" },
    { role: "assistant", text: "", toolCalls: first.toolCalls },
    { role: "tool", toolCallId: "call_1", toolName: "navigate_to_region", result: { isError: false, text: "{\"ok\":true}", images: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }] } },
] });
assert.equal(second.text, "Done.");
const wire = bodies[1].messages;
assert.deepEqual(wire.map((m: any) => m.role), ["system", "user", "assistant", "tool", "user"]);
assert.equal(wire[2].tool_calls[0].function.name, "navigate_to_region");
assert.equal(wire[3].tool_call_id, "call_1");
assert.equal(wire[3].content, "{\"ok\":true}");
assert.ok(JSON.stringify(wire[4]).includes("data:image/png;base64,iVBORw0KGgo="), "screenshot travels as a user image");

srv.close();
console.log("chat-mcp modelStep tests: all passed");
