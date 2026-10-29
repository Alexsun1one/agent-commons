// Build offline IIFE bundles into ../../preview/vendor. Run: node build.mjs
import { build } from "esbuild";
import { mkdirSync, rmdirSync, copyFileSync, statSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "preview", "vendor");
const lock = join(here, ".lock");

try { mkdirSync(lock); } catch { console.error("build lock exists: " + lock); process.exit(1); }
try {
  mkdirSync(out, { recursive: true });
  // default export -> the global itself; named exports -> a namespace object
  const jobs = [
    { entry: "hls.js", file: "hls.min.js", name: "Hls", unwrap: true },
    { entry: "wavesurfer.js", file: "wavesurfer.min.js", name: "WaveSurfer", unwrap: true },
    { entry: "rrweb-player.js", file: "rrweb-player.min.js", name: "rrwebPlayer", unwrap: true },
    { entry: "asciinema-player.js", file: "asciinema-player.min.js", name: "AsciinemaPlayer" },
    { entry: "fsrs.js", file: "ts-fsrs.min.js", name: "FSRS" },
    { entry: "html-to-image.js", file: "html-to-image.min.js", name: "htmlToImage" },
    { entry: "tiptap.js", file: "tiptap.min.js", name: "Tiptap" },
    { entry: "livekit.js", file: "livekit-client.min.js", name: "LivekitClient" },
  ];
  for (const j of jobs) {
    await build({
      entryPoints: [join(here, "entries", j.entry)],
      outfile: join(out, j.file),
      bundle: true, minify: true, format: "iife", globalName: j.name,
      target: "es2020", platform: "browser", legalComments: "none", logLevel: "warning",
      // unwrap: the IIFE returns {default: X}; re-point the global at X
      footer: j.unwrap ? { js: `${j.name}=${j.name}.default;` } : undefined,
    });
  }
  const css = [
    ["node_modules/rrweb-player/dist/style.min.css", "rrweb-player.css"],
    ["node_modules/asciinema-player/dist/bundle/asciinema-player.css", "asciinema-player.css"],
  ];
  for (const [from, to] of css) copyFileSync(join(here, from), join(out, to));
  // html-to-image as a source string, for injecting into sandboxed iframes (srcdoc) that cannot load files
  const h2i = readFileSync(join(out, "html-to-image.min.js"), "utf8");
  writeFileSync(join(out, "html-to-image.src.js"), "window.__COMMONS_HTML_TO_IMAGE_SRC=" + JSON.stringify(h2i) + ";\n");
  jobs.push({ file: "html-to-image.src.js" });
  for (const f of [...jobs.map(j => j.file), ...css.map(c => c[1])])
    console.log(f.padEnd(24), statSync(join(out, f)).size);
} finally {
  rmdirSync(lock);
}
