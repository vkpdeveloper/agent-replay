// Builds and installs the binary to ~/.local/share/agent-replay, linked as
// ~/.local/bin/agent-replay. Reinstalling keeps the downloaded Chrome.
import { $ } from "bun";
import { existsSync } from "node:fs";
import { cp, mkdir, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const prefix = process.env.AGENT_REPLAY_HOME ?? join(homedir(), ".local", "share", "agent-replay");
const bin = join(homedir(), ".local", "bin", "agent-replay");

await $`bun ${join(import.meta.dir, "build.ts")}`;

await mkdir(prefix, { recursive: true });
for (const name of ["agent-replay", "site", "compositor"]) {
  await rm(join(prefix, name), { recursive: true, force: true });
  await cp(join(dist, name), join(prefix, name), { recursive: true });
}
// Remotion downloads Chrome next to the nearest package.json.
await Bun.write(join(prefix, "package.json"), '{ "private": true }\n');

// Reuse the Chrome Headless Shell from development instead of downloading it again.
const chrome = join(root, "node_modules", ".remotion");
const installedChrome = join(prefix, "node_modules", ".remotion");
if (existsSync(chrome) && !existsSync(installedChrome)) {
  await mkdir(join(prefix, "node_modules"), { recursive: true });
  await $`cp -cR ${chrome} ${installedChrome} 2>/dev/null || cp -R ${chrome} ${installedChrome}`;
}

await mkdir(join(homedir(), ".local", "bin"), { recursive: true });
await rm(bin, { force: true });
await symlink(join(prefix, "agent-replay"), bin);
console.log(`installed ${bin} -> ${join(prefix, "agent-replay")}`);
