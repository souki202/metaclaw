#!/usr/bin/env node
/**
 * Wrapper script to run a command and restart it if it exits with code 75
 * Usage: node scripts/with-restart.js <command> [args...]
 */

const { spawn, execSync } = require("child_process");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node with-restart.js <command> [args...]");
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);
const isWindows = process.platform === "win32";

const RESTART_CODE = 75;

let currentChild = null;

function startProcess() {
  currentChild = spawn(command, commandArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: isWindows, // Need shell for commands like npx on windows
  });

  currentChild.on("close", (code) => {
    if (code === RESTART_CODE) {
      console.log(
        `\n[with-restart] Process requested restart (code 75). Restarting in 1s...\n`,
      );
      setTimeout(startProcess, 1000);
    } else {
      process.exit(code || 0);
    }
  });
}

// Register signals only once globally, not inside startProcess
function killChild() {
  if (currentChild) {
    if (isWindows) {
      try {
        execSync(`taskkill /pid ${currentChild.pid} /T /F`, {
          stdio: "ignore",
        });
      } catch (e) {
        // ignore errors
      }
    } else {
      currentChild.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", () => {
  killChild();
  process.exit(0);
});

process.on("SIGTERM", () => {
  killChild();
  process.exit(0);
});

startProcess();
