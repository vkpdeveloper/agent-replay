// The player shipped inside replay.html. Data is inlined by `buildHtml`.
import { Player, type PlayerRef } from "@remotion/player";
import { renderMediaOnWeb } from "@remotion/web-renderer";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Replay as ReplayData } from "../replay.ts";
import { AGENT_NAMES } from "../session.ts";
import { Replay } from "../video/Replay.tsx";

const replay = JSON.parse(document.getElementById("replay-data")!.textContent!) as ReplayData;

const seconds = Math.round(replay.durationInFrames / replay.fps);
const length = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const fileName = `${(replay.title || replay.agent).replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "replay"}.mp4`;

const App = () => {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const player = useRef<PlayerRef>(null);

  const exportMp4 = async () => {
    setError("");
    setProgress(0);
    // Playback and encoding compete for the same main thread.
    player.current?.pause();
    try {
      const { getBlob } = await renderMediaOnWeb({
        composition: {
          id: "replay",
          component: Replay,
          durationInFrames: replay.durationInFrames,
          fps: replay.fps,
          width: replay.width,
          height: replay.height,
          defaultProps: { replay },
        },
        inputProps: { replay },
        videoBitrate: "high",
        // Yield to the page every 100 ms so the progress label still updates.
        pageResponsiveness: "low",
        muted: true,
        frameRange: [0, replay.durationInFrames - 1],
        onProgress: ({ progress }) => setProgress(progress),
      });
      const url = URL.createObjectURL(await getBlob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProgress(null);
    }
  };

  return (
    <main>
      <header>
        <div className="title">
          <strong>{replay.title || `${AGENT_NAMES[replay.agent]} session`}</strong>
          <span>
            {[AGENT_NAMES[replay.agent], replay.model, length].filter(Boolean).join(" · ")}
          </span>
        </div>
        <button onClick={exportMp4} disabled={progress !== null}>
          {progress === null ? "Export MP4" : `Rendering ${Math.round(progress * 100)}%`}
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      <Player
        ref={player}
        component={Replay}
        inputProps={{ replay }}
        durationInFrames={replay.durationInFrames}
        fps={replay.fps}
        compositionWidth={replay.width}
        compositionHeight={replay.height}
        // Vertical and square replays are capped to the viewport height.
        style={{
          width: "100%",
          maxWidth: `calc((100vh - 96px) * ${replay.width / replay.height})`,
          margin: "0 auto",
          aspectRatio: `${replay.width} / ${replay.height}`,
        }}
        controls
        autoPlay
        clickToPlay
        doubleClickToFullscreen
        allowFullscreen
        showPlaybackRateControl={[0.5, 1, 1.5, 2, 4]}
        acknowledgeRemotionLicense
      />
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
