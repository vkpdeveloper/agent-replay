import { Composition } from "remotion";
import { COMPOSITION_ID, FORMATS, FPS, type Replay as ReplayData } from "../replay.ts";
import { Replay, type ReplayProps } from "./Replay.tsx";

const empty: ReplayData = {
  agent: "claude",
  title: "",
  cwd: "",
  model: "",
  version: "",
  fps: FPS,
  ...FORMATS.landscape,
  durationInFrames: 1,
  lines: [],
  prompts: [],
  status: [],
  captions: [],
};

export const Root = () => (
  <Composition
    id={COMPOSITION_ID}
    component={Replay}
    width={empty.width}
    height={empty.height}
    fps={FPS}
    durationInFrames={1}
    defaultProps={{ replay: empty } satisfies ReplayProps}
    calculateMetadata={({ props: { replay } }) => ({
      durationInFrames: replay.durationInFrames,
      fps: replay.fps,
      width: replay.width,
      height: replay.height,
    })}
  />
);
