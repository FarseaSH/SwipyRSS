import { spawnSync } from "node:child_process";

// Keep the existing /swipy/ deployment default; this branch's Site is hosted at its origin root.
const result = spawnSync(process.execPath, [process.env.npm_execpath, "run", "build:web"], {
  stdio: "inherit",
  env: { ...process.env, VITE_PWA_BASE: "/" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
