/**
 * Smoke test = a tiny MCP *client*. It starts the server over stdio exactly the
 * way Claude does, lists the tools and calls each of them once.
 *
 *   node test/smoke.mjs [slide_id]
 *
 * slide_id defaults to XOPAT_DEFAULT_SLIDE or "slides/CMU-1.svs". Screenshots
 * are written next to this file as smoke-*.jpg.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const slide = process.argv[2] || process.env.XOPAT_DEFAULT_SLIDE || "slides/CMU-1.svs";

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(here, "..", "src", "server.mjs")],
    env: { ...process.env, XOPAT_MCP_HEADLESS: process.env.XOPAT_MCP_HEADLESS ?? "1" },
    stderr: "inherit",
});
const client = new Client({ name: "xopat-smoke-test", version: "0.1.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

let failures = 0;
const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const first = result.content?.[0];
    if (result.isError) failures++;
    if (first?.type === "image") {
        const file = path.join(here, `smoke-${name}.jpg`);
        writeFileSync(file, Buffer.from(first.data, "base64"));
        console.log(`\n# ${name} -> image ${first.mimeType}, saved to ${file}`);
    } else {
        console.log(`\n# ${name}${result.isError ? " (isError)" : ""}\n${first?.text}`);
    }
    return first?.type === "text" && !result.isError ? JSON.parse(first.text) : null;
};

// list_slides needs wsi-service; without it the error is expected and not counted.
const listed = await call("list_slides");
if (!listed) failures--;
const opened = await call("open_slide", { slide_id: slide });
if (!opened) {
    await client.close();
    process.exit(1);
}
const { width, height } = opened.slideSize;
await call("get_viewport");
await call("navigate_to_region", { x: Math.round(width * 0.25), y: Math.round(height * 0.25), width: Math.round(width / 4), height: Math.round(height / 4) });
await call("screenshot_viewport");
const rect = await call("create_annotation", { shape: "rect", x: Math.round(width * 0.3), y: Math.round(height * 0.3), width: Math.round(width / 20), height: Math.round(height / 20), class_name: "tumor" });
await call("create_annotation", { shape: "point", x: Math.round(width * 0.4), y: Math.round(height * 0.4), class_name: "mitosis" });
await call("create_annotation", { shape: "polygon", points: [{ x: width * 0.3, y: height * 0.45 }, { x: width * 0.4, y: height * 0.45 }, { x: width * 0.35, y: height * 0.35 }], class_name: "tumor" });
await call("create_annotation", { shape: "rect", x: 10 }); // expected error: missing fields
failures--; // that one is supposed to fail
await call("list_annotations");
if (rect) await call("delete_annotation", { id: rect.created.id });
await call("screenshot_viewport");

await client.close();
console.log(failures ? `\n${failures} unexpected tool error(s)` : "\nall tool calls OK");
process.exit(failures ? 1 : 0);
