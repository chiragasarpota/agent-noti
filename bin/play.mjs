#!/usr/bin/env node
/**
 * Cross-platform audio player. Called by hooks or CLI.
 * Usage: node play.mjs <idle|input>        — plays configured sound for event
 *        node play.mjs <theme>             — plays theme's idle sound (preview)
 *        node play.mjs --file <path>       — plays a file directly
 *
 * Respects ~/.agent-noti/config.json for mute and volume (1-10).
 */

import { execFile, exec } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { platform, homedir } from "os";
import { existsSync, readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUNDS_DIR = join(__dirname, "..", "sounds");
const CONFIG_PATH = join(homedir(), ".agent-noti", "config.json");

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

const arg = process.argv[2];
if (!arg) process.exit(0);

const config = readConfig();

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
