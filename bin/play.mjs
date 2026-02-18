#!/usr/bin/env node
/**
 * Cross-platform audio player. Called by hooks or CLI.
 * Usage: node play.mjs <idle|input>        — plays configured sound for event
 *        node play.mjs <theme>             — plays theme's idle sound (preview)
 *        node play.mjs --file <path>       — plays a file directly
 *
 * Respects ~/.agent-noti/config.json for mute and volume (1-10).
 * Also sends ntfy.sh push notifications when configured.
 */

import { execFile, exec } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { platform, homedir } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUNDS_DIR = join(__dirname, "..", "sounds");
const CONFIG_DIR = join(homedir(), ".agent-noti");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const LAST_PROMPT_PATH = join(CONFIG_DIR, "last-prompt");
const LAST_EVENT_PATH = join(CONFIG_DIR, "last-event");

const EVENTS = ["idle", "input"];

function readConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function findFile(name) {
  for (const ext of [".wav", ".mp3", ".aiff", ".ogg"]) {
    const f = join(SOUNDS_DIR, name + ext);
    if (existsSync(f)) return f;
  }
  return null;
}

function resolveSound(arg) {
  // --file <path>: play a file directly
  if (arg === "--file") {
    const fp = process.argv[3];
    return fp && existsSync(fp) ? fp : null;
  }

  const config = readConfig();

  // Event name (idle / input) — resolve through config
  if (EVENTS.includes(arg)) {
    const theme = config[arg] || "default";

    // Absolute path (custom sound)
    if (theme.startsWith("/") || /^[A-Z]:\\/.test(theme)) {
      if (existsSync(theme)) return theme;
      return join(SOUNDS_DIR, `${arg}.mp3`); // fallback
    }

    // Default theme
    if (theme === "default") {
      return join(SOUNDS_DIR, `${arg}.mp3`);
    }

    // Named theme: <theme>-<event>.wav
    return findFile(`${theme}-${arg}`) || join(SOUNDS_DIR, `${arg}.mp3`);
  }

  // Direct sound name (for preview): try <name>-idle first, then <name>
  return findFile(`${arg}-idle`) || findFile(arg) || null;
}

const NTFY_MESSAGES = {
  idle: { title: "Task Complete", tags: "white_check_mark", body: "Agent finished task" },
  input: { title: "Approval Needed", tags: "warning", body: "Agent needs your approval" },
};

async function sendNtfy(event, config) {
  try {
    const ntfy = config.ntfy;
    if (!ntfy || !ntfy.enabled || !ntfy.topic) return;
    if (!ntfy[event]) return;

    const msg = NTFY_MESSAGES[event];
    if (!msg) return;

    const server = (ntfy.server || "https://ntfy.sh").replace(/\/+$/, "");
    const url = `${server}/${ntfy.topic}`;

    await fetch(url, {
      method: "POST",
      headers: {
        Title: msg.title,
        Priority: ntfy.priority || "default",
        Tags: msg.tags,
      },
      body: msg.body,
    });
  } catch {}
}

(async () => {
  const arg = process.argv[2];
  if (!arg) process.exit(0);

  const config = readConfig();

  // Send ntfy push notification for actual events (not --file previews)
  if (EVENTS.includes(arg)) {
    const threshold = config.ntfy?.threshold ?? 0; // minutes, 0 = always
    let shouldSend = true;

    if (threshold > 0) {
      // Claude Code: PromptSubmit hook writes last-prompt (exact task start)
      // Codex fallback: use last-event (time since previous event)
      const tsFile = existsSync(LAST_PROMPT_PATH) ? LAST_PROMPT_PATH : LAST_EVENT_PATH;
      try {
        if (existsSync(tsFile)) {
          const started = parseInt(readFileSync(tsFile, "utf-8"), 10);
          if (!isNaN(started)) {
            const elapsed = (Date.now() - started) / 60000;
            shouldSend = elapsed >= threshold;
          }
        }
      } catch {}
    }

    if (shouldSend) {
      await sendNtfy(arg, config);
    }

    // Write last-event timestamp (Codex fallback for threshold)
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(LAST_EVENT_PATH, String(Date.now()));
    } catch {}
  }

  // Mute check (skip for --file, which is used by picker previews)
  if (arg !== "--file" && config.muted) process.exit(0);

  const file = resolveSound(arg);
  if (!file) process.exit(1);

  // Volume: 1-10 config → 0.0-1.0 native scale
  const vol = Math.max(1, Math.min(10, config.volume ?? 10));
  const volFloat = vol / 10;   // 0.1 – 1.0  (macOS, Windows)
  const volPct = vol * 10;     // 10  – 100   (Linux ffplay, mpv)
  const volPulse = Math.round(volFloat * 65536); // paplay scale

  const os = platform();

  if (os === "darwin") {
    execFile("afplay", ["-v", String(volFloat), file], () => {});
  } else if (os === "win32") {
    exec(
      `powershell -NoProfile -Command "Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([uri]'${file.replace(/'/g, "''")}'); $p.Volume = ${volFloat}; $p.Play(); Start-Sleep -Seconds 3"`,
      () => {}
    );
  } else {
    execFile("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", String(volPct), file], (err) => {
      if (err) execFile("paplay", ["--volume", String(volPulse), file], (err2) => {
        if (err2) execFile("mpv", ["--no-video", `--volume=${volPct}`, file], () => {});
      });
    });
  }
})();
