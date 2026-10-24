// Builds dist/: the player embedded into replay.html, the prebuilt Remotion site
// and compositor binaries used for MP4s, and the compiled `agent-replay` binary.
import { bundle } from "@remotion/bundler";
import { $, type BunPlugin } from "bun";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

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

await rm(dist, { recursive: true, force: true });
await mkdir(dist);

const player = await Bun.build({
  entrypoints: [join(root, "src/web/main.tsx")],
  target: "browser",
  minify: true,
  plugins: [noAudioEncoders],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!player.success) throw new AggregateError(player.logs, "Failed to bundle the player");
await Bun.write(join(dist, "player.js.txt"), await player.outputs[0]!.text());
console.log("built dist/player.js.txt");

if (process.argv.includes("--player")) process.exit(0);

await bundle({ entryPoint: join(root, "src/video/entry.ts"), outDir: join(dist, "site") });
console.log("built dist/site");

const suffix = process.platform === "linux" ? "-gnu" : process.platform === "win32" ? "-msvc" : "";
const platform = `${process.platform}-${process.arch}${suffix}`;
const compositor = dirname(createRequire(import.meta.url).resolve(`@remotion/compositor-${platform}/package.json`));
await cp(compositor, join(dist, "compositor"), { recursive: true });
console.log("copied dist/compositor");

// The bundler (webpack) is only needed when rendering from source.
// The binary runs inside the user's projects: never load their .env or bunfig.toml. A broken
// one (t3code's .env was a symlink to itself) made it exit 1 before printing anything.
await $`bun build ${join(root, "src/cli.ts")} --compile --minify --no-compile-autoload-dotenv --no-compile-autoload-bunfig --external @remotion/bundler --outfile ${join(dist, "agent-replay")}`.quiet();
console.log("compiled dist/agent-replay");
