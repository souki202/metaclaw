#!/usr/bin/env node
/**
 * Development server for meta-claw.
 * Starts only the Next.js dev server. The backend initializes inside
 * Next.js via instrumentation.ts → backend-init.ts.
 *
 * Ctrl+C cleanly kills the Next.js process tree on Windows.
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";

// Load config to get the port
let port = 3000;
try {
  const configPath = path.join(ROOT, "config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    port = config.dashboard?.port || 3000;
  }
} catch (e) {
  console.warn("[dev] Could not load config.json, using default port 3000");
}

console.log(`[dev] Starting Next.js dev server on port ${port}...`);
const nextDev = spawn(
  isWindows ? "npx.cmd" : "npx",
  ["next", "dev", "--webpack", "-p", String(port)],
  {
    stdio: "inherit",
    cwd: ROOT,
    shell: isWindows,
  },
);

nextDev.on("close", (code) => {
  console.log(`[dev] Next.js dev server exited with code ${code}`);
  process.exit(code || 0);
});

function cleanupAndExit() {
  if (isWindows) {
    try {
      execSync(`taskkill /pid ${nextDev.pid} /T /F`, { stdio: "ignore" });
    } catch (e) {
      // already dead
    }
  } else {
    nextDev.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);
