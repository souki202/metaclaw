/**
 * Process wrapper for meta-claw.
 * Handles graceful restarts when the AI triggers self-modification.
 * Exit code 75 = restart requested by AI
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const RESTART_CODE = 75;
const MAX_QUICK_RESTARTS = 5;
const QUICK_RESTART_WINDOW_MS = 10_000;

let quickRestarts = 0;
let windowStart = Date.now();
let currentChild = null;

process.on("SIGINT", () => {
  if (currentChild) currentChild.kill("SIGINT");
});
process.on("SIGTERM", () => {
  if (currentChild) currentChild.kill("SIGTERM");
});

function startProcess() {
  const now = Date.now();
  if (now - windowStart > QUICK_RESTART_WINDOW_MS) {
    quickRestarts = 0;
    windowStart = now;
  }

  // On Windows, .cmd files require shell:true or explicit cmd invocation
  const isWindows = process.platform === "win32";
  let stderrBuffer = "";

  const child = spawn(
    isWindows ? "cmd.exe" : "npx",
    isWindows
      ? ["/d", "/s", "/c", "npx tsx src/index.ts"]
      : ["tsx", "src/index.ts"],
    { stdio: ["inherit", "inherit", "pipe"], cwd: ROOT, shell: !isWindows },
  );
  currentChild = child;

  child.stderr.on("data", (data) => {
    process.stderr.write(data);
    stderrBuffer += data.toString();
    if (stderrBuffer.length > 10000) {
      stderrBuffer = stderrBuffer.slice(-10000);
    }
  });

  const startTime = Date.now();

  child.on("close", (code) => {
    if (code === RESTART_CODE) {
      const uptime = Date.now() - startTime;
      if (uptime < QUICK_RESTART_WINDOW_MS) {
        quickRestarts++;
        if (quickRestarts >= MAX_QUICK_RESTARTS) {
          console.error(
            `[runner] Too many quick restarts (${quickRestarts}). Stopping.`,
          );
          process.exit(1);
        }
      }
      console.log(
        `[runner] Restart requested. Starting in 2s... (attempt ${quickRestarts})`,
      );
      setTimeout(startProcess, 2000);
    } else if (code !== 0) {
      console.log(`\n[runner] Crash detected! Exit code: ${code}`);

      const uptime = Date.now() - startTime;
      if (uptime < QUICK_RESTART_WINDOW_MS) {
        quickRestarts++;
        if (quickRestarts >= MAX_QUICK_RESTARTS) {
          console.error(
            `[runner] Too many quick restarts/crashes (${quickRestarts}). Stopping.`,
          );
          process.exit(1);
        }
      }

      console.log(`[runner] Attempting auto-repair...`);
      const errorLogPath = path.join(ROOT, "data", "last_crash.log");
      fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
      fs.writeFileSync(errorLogPath, stderrBuffer, "utf-8");

      const repairChild = spawn("node", ["scripts/repair.js", errorLogPath], {
        stdio: "inherit",
        cwd: ROOT,
      });

      repairChild.on("close", (repairCode) => {
        if (repairCode === 0) {
          console.log("[runner] Auto-repair succeeded. Restarting in 2s...");
          setTimeout(startProcess, 2000);
        } else {
          console.error("[runner] Auto-repair failed. Exiting.");
          process.exit(code || 1);
        }
      });
      process.exit(0);
    }
  });
}

startProcess();
