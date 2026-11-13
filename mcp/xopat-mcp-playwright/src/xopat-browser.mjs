/**
 * XopatBrowser: owns one Chromium page with xOpat open and runs Scripting API
 * calls in it.
 *
 * How a tool call reaches the viewer:
 *
 *   MCP client (Claude)  --stdio JSON-RPC-->  server.mjs (tool handler)
 *        --> XopatBrowser.call("viewer", "getViewport", [])
 *        --> page.evaluate(...) in the xOpat tab
 *        --> APPLICATION_CONTEXT.Scripting context "mcp" .executeScript(script)
 *        --> sandboxed Web Worker calls the host namespace (viewer, annotationsRead, ...)
 *
 * The script path is the same one the built-in xOpat chat uses, so every call
 * goes through the Scripting API's sandbox, namespace registry and capability
 * gate (`core.scripting.run`). We only switch off the interactive consent dialog
 * for our context, because nobody is sitting at a headless browser to click it.
 */
import { chromium } from "playwright";

const SCRIPTING_CONTEXT_ID = "mcp";

/** Namespaces the tools rely on; the page counts as ready once they are registered. */
const REQUIRED_NAMESPACES = ["application", "viewer", "annotationsRead", "annotationsWrite"];

export class XopatBrowser {
    /**
     * @param {object} options
     * @param {string} options.viewerUrl   base URL of the xOpat viewer, e.g. http://localhost:9000
     * @param {boolean} options.headless   false = show the browser window (good for demos)
     * @param {string} [options.channel]   "chromium" | "msedge" | "chrome"; empty = try them in this order
     * @param {string} [options.executablePath] explicit browser binary, overrides channel
     * @param {(msg: string) => void} options.log  logger; must NOT write to stdout (stdout is the MCP channel)
     */
    constructor({ viewerUrl, headless, channel, executablePath, log }) {
        this.viewerUrl = viewerUrl.replace(/\/+$/, "");
        this.headless = headless;
        this.channel = channel;
        this.executablePath = executablePath;
        this.log = log;
        this.browser = null;
        this.page = null;
        this.currentSlide = null;
    }

    async _launch() {
        if (this.browser?.isConnected()) return;

        if (this.executablePath) {
            this.browser = await chromium.launch({ headless: this.headless, executablePath: this.executablePath });
            return;
        }
        // On Windows, Edge is always installed, so it is a fallback that needs no
        // `npx playwright install`.
        const candidates = this.channel ? [this.channel] : ["chromium", "msedge", "chrome"];
        const errors = [];
        for (const candidate of candidates) {
            try {
                this.browser = await chromium.launch({
                    headless: this.headless,
                    ...(candidate === "chromium" ? {} : { channel: candidate }),
                });
                this.log(`browser launched (${candidate}, headless=${this.headless})`);
                return;
            } catch (error) {
                errors.push(`${candidate}: ${String(error?.message || error).split("\n")[0]}`);
            }
        }
        throw new Error(
            "Could not start a browser. Run `npx playwright install chromium` in the MCP server folder, " +
            "or set XOPAT_MCP_BROWSER=msedge. Details: " + errors.join(" | ")
        );
    }

    /**
     * Opens the viewer with exactly one slide and the annotations plugin. Always
     * starts from a fresh page, so every call gives the same initial state
     * (important for repeatable experiments later).
     * @param {string} slideId slide id as the slide server knows it, e.g. "slides/CMU-1.svs"
     */
    async openSlide(slideId) {
        await this._launch();
        if (this.page && !this.page.isClosed()) {
            await this.page.close({ runBeforeUnload: false });
        }
        const context = this.browser.contexts()[0] || await this.browser.newContext({ viewport: { width: 1400, height: 900 } });
        const page = await context.newPage();
        // xOpat may ask "do you really want to leave?" — never let a dialog block the agent.
        page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
        page.on("pageerror", (error) => this.log(`page error: ${error.message}`));

        // An xOpat session: which data to load, what is the background, which plugins.
        // `gui_annotations` is the id of plugins/annotations; it pulls in the annotations module
        // that registers the annotationsRead / annotationsWrite scripting namespaces.
        const session = {
            data: [slideId],
            background: [{ dataReference: 0 }],
            plugins: { gui_annotations: {} },
        };
        const url = `${this.viewerUrl}/#${encodeURIComponent(JSON.stringify(session))}`;
        this.log(`opening ${url}`);
        await page.goto(url, { waitUntil: "load", timeout: 60_000 });

        try {
            await page.waitForFunction((required) => {
                const ctx = window.APPLICATION_CONTEXT;
                const viewer = window.VIEWER_MANAGER?.viewers?.[0];
                if (!ctx?.Scripting || !viewer || viewer.world.getItemCount() < 1) return false;
                const item = viewer.world.getItemAt(0);
                if (!item?.getFullyLoaded?.() && !item?.source) return false;
                const known = Object.keys(ctx.Scripting.getNamespaceConsentEntries?.() || {});
                return required.every((ns) => known.includes(ns));
            }, REQUIRED_NAMESPACES, { timeout: 60_000, polling: 250 });
        } catch (error) {
            const reason = await page.evaluate(() => {
                const viewer = window.VIEWER_MANAGER?.viewers?.[0];
                return {
                    hasScripting: !!window.APPLICATION_CONTEXT?.Scripting,
                    viewers: window.VIEWER_MANAGER?.viewers?.length || 0,
                    items: viewer ? viewer.world.getItemCount() : 0,
                    namespaces: Object.keys(window.APPLICATION_CONTEXT?.Scripting?.getNamespaceConsentEntries?.() || {}),
                };
            }).catch(() => null);
            throw new Error(
                `xOpat did not finish loading slide "${slideId}" within 60 s. ` +
                `Is the viewer running at ${this.viewerUrl} and does the slide id exist? State: ${JSON.stringify(reason)}`
            );
        }

        this.page = page;
        this.currentSlide = slideId;
        // Create our own scripting context once per page. `metadata: {}` is needed
        // because the annotations write namespace keeps per-context state there.
        await page.evaluate((id) => {
            window.APPLICATION_CONTEXT.Scripting.createContext({
                id,
                label: "MCP server",
                bypassConsentDialog: true,
                metadata: {},
            });
        }, SCRIPTING_CONTEXT_ID);
        return slideId;
    }

    _requirePage() {
        if (!this.page || this.page.isClosed()) {
            throw new Error("No slide is open. Call open_slide first (use list_slides to find a slide id).");
        }
        return this.page;
    }

    /**
     * Runs a script in the xOpat scripting sandbox and returns its result.
     * `args` is serialised as JSON and bound to the `args` constant, so tool
     * arguments never get concatenated into code as raw text.
     * Inside the worker every namespace call returns a Promise, hence `await`.
     * @param {string} body script body, may use `args` and `return`
     * @param {unknown} [args]
     */
    async runScript(body, args = {}) {
        const page = this._requirePage();
        const script = `const args = ${JSON.stringify(args)};\n${body}`;
        const outcome = await page.evaluate(async ({ id, script }) => {
            try {
                const ctx = window.APPLICATION_CONTEXT.Scripting.getContext(id);
                return { ok: true, value: await ctx.executeScript(script) };
            } catch (error) {
                return { ok: false, error: String(error?.message || error) };
            }
        }, { id: SCRIPTING_CONTEXT_ID, script });
        if (!outcome.ok) throw new Error(outcome.error);
        return outcome.value;
    }

    /**
     * Screenshot of the first viewer's area as the user would see it: slide tiles
     * plus the annotation overlay. (The Scripting API's getViewportScreenshot reads
     * only the WebGL tile canvas, so annotations would be missing.)
     * @returns {Promise<Buffer>} JPEG bytes
     */
    async screenshotViewer() {
        const page = this._requirePage();
        const box = await page.evaluate(() => {
            const r = window.VIEWER_MANAGER.viewers[0].element.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        // Let the tiles for the current view finish loading before capturing.
        await page.waitForFunction(() => {
            const world = window.VIEWER_MANAGER.viewers[0].world;
            for (let i = 0; i < world.getItemCount(); i++) {
                if (!world.getItemAt(i).getFullyLoaded()) return false;
            }
            return true;
        }, null, { timeout: 10_000, polling: 200 }).catch(() => {});
        return page.screenshot({ clip: box, type: "jpeg", quality: 80 });
    }

    async close() {
        await this.browser?.close().catch(() => {});
        this.browser = null;
        this.page = null;
    }
}
