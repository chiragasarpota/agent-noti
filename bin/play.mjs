#!/usr/bin/env node
/**
 * Cross-platform audio player. Called directly by Claude Code hooks.
 * Usage: node play.mjs <idle|input>
 */

import { execFile, exec } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { platform } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUNDS_DIR = join(__dirname, "..", "sounds");
const sound = process.argv[2];

if (!sound) process.exit(0);

const file = join(SOUNDS_DIR, `${sound}.mp3`);
const os = platform();

if (os === "darwin") {
  execFile("afplay", [file], () => {});
} else if (os === "win32") {
  exec(
    `powershell -NoProfile -Command "Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([uri]'${file.replace(/'/g, "''")}'); $p.Play(); Start-Sleep -Seconds 3"`,
    () => {}
  );
} else {
  // Linux: try players in order
  execFile("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file], (err) => {
    if (err) execFile("paplay", [file], (err2) => {
      if (err2) execFile("mpv", ["--no-video", file], () => {});
    });
  });
}
