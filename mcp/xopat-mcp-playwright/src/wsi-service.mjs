/**
 * Lists slides directly from the WSI slide server (RationAI wsi-service), the
 * same endpoints the `rationai-wsi-file-browser` plugin uses:
 *   GET /v3/cases/?context=<path>        -> cases (folders) under <path>, each with its `slides`
 *   GET /v3/cases/slides/?slide_id=<path> -> slides lying directly in <path>
 * With the PathsMapper used in the Docker setup a slide id is its relative path,
 * e.g. "slides/CMU-1.svs", which is exactly what the viewer session expects.
 */

const MAX_DEPTH = 4;
const MAX_SLIDES = 200;

const norm = (p) => String(p || "").replace(/^\/+/, "");
const slideIdOf = (entry) => norm(typeof entry === "string" ? entry : (entry?.local_id || entry?.id));

async function getJson(url) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
}

/**
 * @param {string} wsiUrl base URL of wsi-service, e.g. http://localhost:8080
 * @returns {Promise<string[]>} slide ids
 */
export async function listSlides(wsiUrl) {
    const base = wsiUrl.replace(/\/+$/, "");
    const found = new Set();

    try {
        const rootSlides = await getJson(`${base}/v3/cases/slides/?${new URLSearchParams({ slide_id: "" })}`);
        for (const s of rootSlides || []) found.add(slideIdOf(s));
    } catch (_) {
        // Slides at the root are optional; the cases walk below is what matters.
    }

    const walk = async (context, depth) => {
        if (depth > MAX_DEPTH || found.size >= MAX_SLIDES) return;
        const cases = await getJson(`${base}/v3/cases/?${new URLSearchParams({ context })}`);
        for (const c of cases || []) {
            for (const s of c.slides || []) found.add(slideIdOf(s));
            const casePath = norm(c.local_id || c.id);
            if (casePath && casePath !== context) await walk(casePath, depth + 1);
        }
    };

    try {
        await walk("", 0);
    } catch (error) {
        throw new Error(
            `Could not list slides from the slide server at ${base} (${error.message}). ` +
            "Is wsi-service running? Check http://localhost:8080/alive. " +
            "You can still call open_slide with a known slide id such as slides/CMU-1.svs."
        );
    }
    found.delete("");
    return [...found].sort().slice(0, MAX_SLIDES);
}
