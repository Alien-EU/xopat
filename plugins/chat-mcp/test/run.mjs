// Bundles each *.test.ts with esbuild (like the xOpat server loader does) and runs it in Node.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dir, "..", ".test-dist");
let failed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".test.ts"))) {
    const outfile = path.join(outDir, file.replace(/\.ts$/, ".mjs"));
    await build({
        entryPoints: [path.join(dir, file)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "warning",
        banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    });
    const r = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
    if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
