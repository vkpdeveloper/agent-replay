import type { BunPlugin } from "bun";
import type { Replay } from "./replay.ts";

// Replays are silent. The web renderer only loads these WASM audio encoders
// (~1.6 MB) as a fallback for audio tracks, so they are stubbed out.
const noAudioEncoders: BunPlugin = {
  name: "no-audio-encoders",
  setup(build) {
    build.onResolve({ filter: /^@mediabunny\/(aac|flac|mp3)-encoder$/ }, ({ path }) => ({ path, namespace: "no-audio" }));
    build.onLoad({ filter: /.*/, namespace: "no-audio" }, () => ({
      loader: "js",
      contents: `const off = () => { throw new Error("Replays are silent"); };
export { off as registerAacEncoder, off as registerFlacEncoder, off as registerMp3Encoder };`,
    }));
  },
};

/** Bundles the player and inlines it with the replay data into one self-contained HTML file. */
export async function buildHtml(replay: Replay): Promise<string> {
  const build = await Bun.build({
    entrypoints: [new URL("./web/main.tsx", import.meta.url).pathname],
    target: "browser",
    minify: true,
    plugins: [noAudioEncoders],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!build.success) throw new AggregateError(build.logs, "Failed to bundle the player");
  const script = await build.outputs[0]!.text();

  const title = escapeHtml(replay.title || "Agent replay");
  // `<` is escaped so neither the data nor the bundle can close the script tag early.
  const data = JSON.stringify(replay).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #0a0a0a; color: #ebe9e6; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
  main { max-width: 1600px; margin: 0 auto; padding: 20px 24px 32px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
  .title { display: flex; flex-direction: column; min-width: 0; }
  .title strong { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title span { color: #8f8b87; font-size: 13px; }
  button { flex: none; font: inherit; font-weight: 500; color: #0a0a0a; background: #ebe9e6; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
  button:disabled { opacity: .6; cursor: progress; }
  .error { color: #ff6b80; margin: 0 0 12px; }
</style>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="replay-data">${data}</script>
<script type="module">${script.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}
