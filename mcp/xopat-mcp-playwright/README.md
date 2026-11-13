# xopat-mcp-playwright

Prototype [MCP](https://modelcontextprotocol.io) server for the xOpat viewer (variant **C** of the MCP plan):
a **stdio** server that opens xOpat in a Playwright-controlled Chromium and calls the
**xOpat Scripting API** in it. Nothing in the viewer or its server is changed; the
browser tab is the integration point.

```
Claude Code / Claude Desktop / MCP Inspector
        │  JSON-RPC over stdin/stdout (MCP, stdio transport)
        ▼
src/server.mjs            tool definitions (names, zod input schemas, descriptions)
        │
src/xopat-browser.mjs     Playwright: one Chromium tab with xOpat
        │  page.evaluate → APPLICATION_CONTEXT.Scripting context "mcp" → executeScript(...)
        ▼
xOpat Scripting API       sandboxed worker → namespaces viewer, annotationsRead, annotationsWrite, …
```

`list_slides` is the exception: it asks the slide server (wsi-service) directly over HTTP
(`src/wsi-service.mjs`), the same endpoints the `rationai-wsi-file-browser` plugin uses.

## Tools

| Tool | Scripting API used | Notes |
|---|---|---|
| `list_slides` | — (wsi-service `/v3/cases/`) | slide ids such as `slides/CMU-1.svs` |
| `open_slide` | page load with a session `{data:[id], plugins:{gui_annotations:{}}}` | always a fresh page, so state is reproducible |
| `get_viewport` | `viewer.getViewportBoundsInImage`, `getMetadata`, `getMagnification` | coordinates in level-0 image pixels |
| `navigate_to_region` | `viewer.frameImageRegion` | x, y, width, height in image pixels |
| `screenshot_viewport` | Playwright screenshot of the viewer element | JPEG image content; includes the annotation overlay |
| `list_annotations` | `annotationsRead.getAnnotations` | simplified records |
| `create_annotation` | `annotationsRead.getPresets`, `annotationsWrite.createPreset/createAnnotation` | `rect`, `point`, `polygon`; `class_name` maps to an xOpat preset |
| `delete_annotation` | `annotationsWrite.deleteAnnotation` | |

Tool errors (bad slide id, missing fields, unknown annotation id) come back as a normal result with
`isError: true`, so the model can read the message and retry. Arguments that violate the input
schema are rejected by the MCP SDK before the handler runs.

## Run

Requirements: Node 20+, a running xOpat viewer (default `http://localhost:9000`) and, for real
slides, wsi-service (default `http://localhost:8080`), e.g. the Docker setup from `docker/`.

```bash
cd mcp/xopat-mcp-playwright
npm install
npx playwright install chromium     # optional: without it the server falls back to Edge / Chrome
npm run smoke -- slides/CMU-1.svs   # MCP client that calls every tool once
npm run inspector                   # MCP Inspector UI to call tools by hand
```

Register it in Claude Code:

```bash
claude mcp add --transport stdio --env XOPAT_DEFAULT_SLIDE=slides/CMU-1.svs xopat -- node /abs/path/to/mcp/xopat-mcp-playwright/src/server.mjs
```

or in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "xopat": {
      "command": "node",
      "args": ["/abs/path/to/mcp/xopat-mcp-playwright/src/server.mjs"],
      "env": { "XOPAT_DEFAULT_SLIDE": "slides/CMU-1.svs" }
    }
  }
}
```

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `XOPAT_URL` | `http://localhost:9000` | viewer URL |
| `XOPAT_WSI_URL` | `http://localhost:8080` | wsi-service URL for `list_slides` |
| `XOPAT_DEFAULT_SLIDE` | — | slide opened automatically on the first tool call that needs one |
| `XOPAT_MCP_HEADLESS` | `0` | `1` hides the browser window (experiments); default shows it (demos) |
| `XOPAT_MCP_BROWSER` | try `chromium`, `msedge`, `chrome` | Playwright browser channel |
| `XOPAT_MCP_BROWSER_PATH` | — | explicit browser executable |

## Notes and limits

- The server creates its own scripting context (`mcp`) with `bypassConsentDialog: true`, because
  nobody can click a consent dialog in an automated browser. The `core.scripting.run` capability
  gate still applies.
- The context is created with `metadata: {}`: `annotationsWrite` stores per-context state with
  `this.scriptingContext.metadata = …`, which throws on a context without metadata
  (`ScriptingContext.metadata` is a getter that returns a copy, so that state is also not kept).
  `create_annotation` therefore always passes `presetID` explicitly.
- Single viewer only (the first one). The agent works in its own browser, not in the user's tab;
  that is what the planned `modules/mcp-bridge` (variant B) is for.
- `list_slides` is written against the endpoints the file-browser plugin uses but was not run
  against a live wsi-service; the viewer tools were tested against the `synthetic` preset.
