import { Composition } from "remotion";
import { COLS, COMPOSITION_ID, FPS, HEIGHT, ROWS, WIDTH, type Replay as ReplayData } from "../replay.ts";
import { Replay, type ReplayProps } from "./Replay.tsx";

const empty: ReplayData = {
  agent: "claude",
  title: "",
  cwd: "",
  model: "",
  version: "",
  fps: FPS,
  cols: COLS,
  rows: ROWS,
  durationInFrames: 1,
  lines: [],
  prompts: [],
  status: [],
};

export const Root = () => (
  <Composition
    id={COMPOSITION_ID}
    component={Replay}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={1}
    defaultProps={{ replay: empty } satisfies ReplayProps}
    calculateMetadata={({ props }) => ({ durationInFrames: props.replay.durationInFrames, fps: props.replay.fps })}
  />
);
