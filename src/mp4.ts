import { renderMedia, selectComposition, type OnBrowserDownload } from "@remotion/renderer";
import { existsSync, realpathSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { COMPOSITION_ID, type Replay } from "./replay.ts";

// The installed binary sits next to a prebuilt Remotion site and the compositor
// binaries (see scripts/install.ts). From source, the site is bundled on the fly.
const home = dirname(realpathSync(process.execPath));
const installed = existsSync(join(home, "site", "index.html"));

// Remotion logs a progress line every 10 MB, which floods an agent's tool output.
const onBrowserDownload: OnBrowserDownload = () => {
  process.stderr.write("Downloading Chrome Headless Shell (about 170 MB, first MP4 only)\n");
  return { version: null, onProgress: () => {} };
};

/** Renders the replay to H.264 with headless Chrome. The first run downloads Chrome Headless Shell. */
export async function renderMp4(replay: Replay, outputLocation: string, onProgress: (progress: number) => void) {
  let serveUrl: string;
  if (installed) {
    serveUrl = join(home, "site");
    // Remotion caches Chrome under the nearest package.json, so keep it in the install directory.
    process.chdir(home);
  } else {
    const { bundle } = await import("@remotion/bundler");
    serveUrl = await bundle({ entryPoint: new URL("./video/entry.ts", import.meta.url).pathname });
  }
  const binariesDirectory = installed ? join(home, "compositor") : null;
  const inputProps = { replay };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, binariesDirectory, onBrowserDownload });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    crf: 18,
    imageFormat: "jpeg",
    jpegQuality: 92,
    concurrency: Math.max(1, Math.min(8, cpus().length - 1)),
    outputLocation,
    inputProps,
    binariesDirectory,
    onBrowserDownload,
    onProgress: ({ progress }) => onProgress(progress),
  });
}
