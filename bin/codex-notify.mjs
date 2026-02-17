#!/usr/bin/env node
/**
 * Codex notify handler. Receives JSON arg from Codex.
 * Events: agent-turn-complete, approval-requested
 */

import { execFile } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_SCRIPT = join(__dirname, "play.mjs");

try {
  const event = JSON.parse(process.argv[2] || "{}");
  if (event.type === "agent-turn-complete") {
    execFile("node", [PLAY_SCRIPT, "idle"], () => {});
  } else if (event.type === "approval-requested") {
    execFile("node", [PLAY_SCRIPT, "input"], () => {});
  }
} catch {}
