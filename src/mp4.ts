import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { cpus } from "node:os";
import type { Replay } from "./replay.ts";
import { COMPOSITION_ID } from "./video/Root.tsx";

/** Renders the replay to H.264 with headless Chrome. The first run downloads Chrome Headless Shell. */
export async function renderMp4(replay: Replay, outputLocation: string, onProgress: (progress: number) => void) {
  const serveUrl = await bundle({ entryPoint: new URL("./video/entry.ts", import.meta.url).pathname });
  const inputProps = { replay };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
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
    onProgress: ({ progress }) => onProgress(progress),
  });
}
