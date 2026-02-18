#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname, extname } from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";
import { homedir, platform } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_SCRIPT = join(__dirname, "play.mjs");
const CODEX_NOTIFY_SCRIPT = join(__dirname, "codex-notify.mjs");
const SOUNDS_DIR = join(__dirname, "..", "sounds");

const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");
const CODEX_CONFIG = join(homedir(), ".codex", "config.toml");
const CONFIG_DIR = join(homedir(), ".agent-noti");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const CUSTOM_SOUNDS_DIR = join(CONFIG_DIR, "sounds");

const HOOK_ID = "agent-noti";
const CODEX_MARKER = "# agent-noti";

// --- Sound catalog ---

const SOUND_THEMES = [
  { name: "default",       desc: "Original notification" },
  { name: "cow",           desc: "Moo!" },
  { name: "goose",         desc: "Honk!" },
  { name: "duck",          desc: "Quack quack" },
  { name: "car",           desc: "Vroom vroom" },
  { name: "slide-whistle", desc: "Wheee!" },
  { name: "video-game",    desc: "Retro gaming" },
  { name: "digital-glass", desc: "Sleek & modern" },
];

function getThemeNames() {
  return SOUND_THEMES.map((s) => s.name);
}

// --- Sound file resolution ---

function findThemeFile(theme, event) {
  if (theme === "default") {
    return join(SOUNDS_DIR, `${event}.mp3`);
  }
  for (const ext of [".wav", ".mp3", ".aiff", ".ogg"]) {
    const f = join(SOUNDS_DIR, `${theme}-${event}${ext}`);
    if (existsSync(f)) return f;
  }
  // Fallback to default
  return join(SOUNDS_DIR, `${event}.mp3`);
}

// --- Cross-platform audio spawner (non-blocking, returns killable process) ---

function spawnPlayer(file, volOverride) {
  const config = readConfig();
  const vol = volOverride ?? Math.max(1, Math.min(10, config.volume ?? 10));
  const volFloat = vol / 10;
  const volPct = vol * 10;
  const volPulse = Math.round(volFloat * 65536);

  const os = platform();
  if (os === "darwin") {
    return spawn("afplay", ["-v", String(volFloat), file], { stdio: "ignore" });
  } else if (os === "win32") {
    return spawn("powershell", [
      "-NoProfile", "-Command",
      `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([uri]'${file.replace(/'/g, "''")}'); $p.Volume = ${volFloat}; $p.Play(); Start-Sleep -Seconds 3`,
    ], { stdio: "ignore" });
  } else {
    const proc = spawn("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", String(volPct), file], { stdio: "ignore" });
    proc.on("error", () => {
      const p2 = spawn("paplay", ["--volume", String(volPulse), file], { stdio: "ignore" });
      p2.on("error", () => {
        spawn("mpv", ["--no-video", `--volume=${volPct}`, file], { stdio: "ignore" });
      });
    });
    return proc;
  }
}

// --- Config ---

function readConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return { idle: "default", input: "default" };
}

function writeConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

// --- Claude ---

function buildClaudeHooks() {
  const idle = { type: "command", command: `node "${PLAY_SCRIPT}" idle` };
  const input = { type: "command", command: `node "${PLAY_SCRIPT}" input` };
  return {
    Stop: [{ hooks: [idle], metadata: { id: HOOK_ID } }],
    PermissionRequest: [{ hooks: [input], metadata: { id: HOOK_ID } }],
  };
}

function readJson(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function removeOurHooks(entries) {
  if (!Array.isArray(entries)) return entries;
  return entries.filter((e) => !e.metadata || e.metadata.id !== HOOK_ID);
}

function installClaude() {
  const settings = readJson(CLAUDE_SETTINGS);
  if (!settings.hooks) settings.hooks = {};

  for (const [event, entries] of Object.entries(buildClaudeHooks())) {
    const existing = removeOurHooks(settings.hooks[event] || []);
    settings.hooks[event] = [...existing, ...entries];
  }

  writeJson(CLAUDE_SETTINGS, settings);
  console.log("  Claude Code: hooks added");
}

function uninstallClaude() {
  if (!existsSync(CLAUDE_SETTINGS)) return;
  const settings = readJson(CLAUDE_SETTINGS);
  if (!settings.hooks) return;

  for (const event of Object.keys(settings.hooks)) {
    const cleaned = removeOurHooks(settings.hooks[event]);
    if (cleaned.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = cleaned;
  }

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeJson(CLAUDE_SETTINGS, settings);
  console.log("  Claude Code: hooks removed");
}

// --- Codex ---

function installCodex() {
  mkdirSync(dirname(CODEX_CONFIG), { recursive: true });

  const notifyLine = `notify = ["node", "${CODEX_NOTIFY_SCRIPT}"] ${CODEX_MARKER}`;

  if (existsSync(CODEX_CONFIG)) {
    let toml = readFileSync(CODEX_CONFIG, "utf-8");
    const lines = toml
      .split("\n")
      .filter((l) => !l.includes(CODEX_MARKER) && !l.match(/^\s*notify\s*=/));
    const firstSection = lines.findIndex((l) => l.match(/^\s*\[/));
    if (firstSection === -1) {
      lines.push(notifyLine);
    } else {
      lines.splice(firstSection, 0, notifyLine);
    }
    writeFileSync(CODEX_CONFIG, lines.join("\n"));
  } else {
    writeFileSync(CODEX_CONFIG, notifyLine + "\n");
  }

  console.log("  Codex: notify added");
}

function uninstallCodex() {
  if (!existsSync(CODEX_CONFIG)) return;
  let toml = readFileSync(CODEX_CONFIG, "utf-8");
  const lines = toml.split("\n").filter((l) => !l.includes(CODEX_MARKER));
  writeFileSync(CODEX_CONFIG, lines.join("\n"));
  console.log("  Codex: notify removed");
}

// --- Interactive picker ---

function picker() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(null);
      return;
    }

    const themes = SOUND_THEMES;
    const config = readConfig();
    const currentTheme = config.idle || "default";
    let selected = Math.max(0, themes.findIndex((t) => t.name === currentTheme));
    let nowPlaying = "";
    let previewProc = null;
    const maxName = Math.max(...themes.map((s) => s.name.length));

    // Total lines we render (for redraw cursor math)
    const totalLines = themes.length + 5; // blank + title + blank + themes + blank + footer

    function killPreview() {
      if (previewProc) {
        try { previewProc.kill(); } catch {}
        previewProc = null;
      }
    }

    function playPreview(theme, event) {
      killPreview();
      const file = findThemeFile(theme, event);
      if (!existsSync(file)) return;
      nowPlaying = `${theme} ${event}`;
      previewProc = spawnPlayer(file);
      previewProc.on("close", () => {
        if (nowPlaying === `${theme} ${event}`) nowPlaying = "";
        render();
      });
      render();
    }

    function render(firstTime) {
      if (!firstTime) {
        // Move cursor up to start of our block and clear
        process.stdout.write(`\x1b[${totalLines}A`);
      }

      process.stdout.write("\x1b[2K\n");
      process.stdout.write(`\x1b[2K  \x1b[1mSelect notification theme:\x1b[0m\n`);
      process.stdout.write("\x1b[2K\n");

      themes.forEach((theme, i) => {
        const isSelected = i === selected;
        const arrow = isSelected ? "\x1b[36m> " : "  ";
        const color = isSelected ? "\x1b[36m" : "\x1b[90m";
        const reset = "\x1b[0m";
        const active = config.idle === theme.name && config.input === theme.name
          ? " \x1b[32m(current)\x1b[0m" : "";
        process.stdout.write(
          `\x1b[2K  ${arrow}${color}${theme.name.padEnd(maxName + 2)}${theme.desc}${reset}${active}\n`
        );
      });

      process.stdout.write("\x1b[2K\n");
      const playInfo = nowPlaying ? `  \x1b[33m♪ ${nowPlaying}\x1b[0m` : "";
      process.stdout.write(
        `\x1b[2K  \x1b[90m[up/down] Navigate  [<] Idle  [>] Input  [enter] Select  [q] Quit\x1b[0m${playInfo}\n`
      );
    }

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    render(true);

    function cleanup() {
      killPreview();
      stdin.removeListener("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function onKey(key) {
      // Ctrl+C
      if (key === "\x03") {
        cleanup();
        console.log("");
        process.exit(0);
      }

      // q = quit
      if (key === "q" || key === "Q") {
        cleanup();
        console.log("\n  No changes made.\n");
        resolve(null);
        return;
      }

      // Enter = confirm
      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(themes[selected].name);
        return;
      }

      // Arrow up
      if (key === "\x1b[A" || key === "k") {
        selected = (selected - 1 + themes.length) % themes.length;
        render();
      }
      // Arrow down
      else if (key === "\x1b[B" || key === "j") {
        selected = (selected + 1) % themes.length;
        render();
      }
      // Arrow left = preview idle
      else if (key === "\x1b[D") {
        playPreview(themes[selected].name, "idle");
      }
      // Arrow right = preview input
      else if (key === "\x1b[C") {
        playPreview(themes[selected].name, "input");
      }
    }

    stdin.on("data", onKey);
  });
}

// --- CLI commands ---

async function install() {
  console.log("");
  installClaude();
  installCodex();
  console.log("");
  console.log("  Restart Claude Code / Codex to activate.");
  console.log("");

  if (process.stdin.isTTY) {
    const choice = await picker();
    if (choice) {
      const config = readConfig();
      config.idle = choice;
      config.input = choice;
      writeConfig(config);
      console.log(`\n  Theme set to: ${choice}\n`);
    }
  } else {
    console.log("  Run 'agent-noti pick' to choose a sound theme.\n");
  }
}

function uninstall() {
  console.log("");
  uninstallClaude();
  uninstallCodex();
  console.log("");
}

function test() {
  console.log("");
  const config = readConfig();
  for (const name of ["idle", "input"]) {
    const theme = config[name] || "default";
    console.log(`  Playing ${name} (${theme})...`);
    execSync(`node "${PLAY_SCRIPT}" ${name}`, { stdio: "inherit" });
    execSync(process.platform === "win32" ? "timeout /t 1 >nul" : "sleep 1");
  }
  console.log("");
}

function sounds() {
  const config = readConfig();
  const maxName = Math.max(...SOUND_THEMES.map((s) => s.name.length));
  const vol = config.volume ?? 10;
  const muted = config.muted ?? false;

  console.log("");
  console.log("  Available sound themes:");
  console.log("");

  for (const { name, desc } of SOUND_THEMES) {
    const current =
      (config.idle === name ? " [idle]" : "") +
      (config.input === name ? " [input]" : "");
    const marker = config.idle === name && config.input === name ? " [active]" : current;
    console.log(`    ${name.padEnd(maxName + 2)} ${desc}${marker}`);
  }

  if (config.idle && config.idle.startsWith("/")) {
    console.log(`    ${"(custom idle)".padEnd(maxName + 2)} ${config.idle} [idle]`);
  }
  if (config.input && config.input.startsWith("/")) {
    console.log(`    ${"(custom input)".padEnd(maxName + 2)} ${config.input} [input]`);
  }

  console.log("");
  console.log("  Theme:  idle=%s, input=%s", config.idle || "default", config.input || "default");
  const volBar = "#".repeat(vol) + "-".repeat(10 - vol);
  console.log(`  Volume: [${volBar}] ${vol}/10${muted ? "  (MUTED)" : ""}`);
  console.log("");
}

function set(args) {
  const themes = getThemeNames();

  if (args.length === 1) {
    const theme = args[0];
    if (!themes.includes(theme)) {
      console.log(`\n  Unknown theme: ${theme}`);
      console.log(`  Available: ${themes.join(", ")}\n`);
      return;
    }
    const config = readConfig();
    config.idle = theme;
    config.input = theme;
    writeConfig(config);
    console.log(`\n  Both idle & input set to: ${theme}\n`);
    return;
  }

  if (args.length === 2) {
    const [event, theme] = args;
    if (event !== "idle" && event !== "input") {
      console.log(`\n  Invalid event: ${event} (use idle or input)\n`);
      return;
    }
    if (!themes.includes(theme)) {
      console.log(`\n  Unknown theme: ${theme}`);
      console.log(`  Available: ${themes.join(", ")}\n`);
      return;
    }
    const config = readConfig();
    config[event] = theme;
    writeConfig(config);
    console.log(`\n  ${event} sound set to: ${theme}\n`);
    return;
  }

  console.log("\n  Usage:");
  console.log("    agent-noti set <theme>              Set both idle & input");
  console.log("    agent-noti set <idle|input> <theme>  Set one event\n");
}

function setCustom(args) {
  if (args.length < 1 || args.length > 2) {
    console.log("\n  Usage:");
    console.log("    agent-noti set-custom <path>                Set for both idle & input");
    console.log("    agent-noti set-custom <idle|input> <path>   Set for one event\n");
    return;
  }

  // set-custom <path> — sets both events to same custom file
  // set-custom <event> <path> — sets one event
  let event, sourcePath;
  if (args.length === 1) {
    sourcePath = args[0];
    event = null; // both
  } else {
    [event, sourcePath] = args;
    if (event !== "idle" && event !== "input") {
      console.log(`\n  Invalid event: ${event} (use idle or input)\n`);
      return;
    }
  }

  if (!existsSync(sourcePath)) {
    console.log(`\n  File not found: ${sourcePath}\n`);
    return;
  }

  const ext = extname(sourcePath);
  const config = readConfig();

  const events = event ? [event] : ["idle", "input"];
  for (const ev of events) {
    const destName = `custom-${ev}${ext}`;
    const destPath = join(CUSTOM_SOUNDS_DIR, destName);
    mkdirSync(CUSTOM_SOUNDS_DIR, { recursive: true });
    copyFileSync(sourcePath, destPath);
    config[ev] = destPath;
    console.log(`\n  Copied to: ${destPath}`);
  }

  // Ensure both events have a value (fallback to default)
  if (!config.idle) config.idle = "default";
  if (!config.input) config.input = "default";

  writeConfig(config);
  console.log(`  Custom sound applied.\n`);
}

function preview(args) {
  if (args.length < 1) {
    console.log("\n  Usage: agent-noti preview <theme>\n");
    return;
  }

  const theme = args[0];
  const themes = getThemeNames();

  if (!themes.includes(theme)) {
    console.log(`\n  Unknown theme: ${theme}`);
    console.log(`  Available: ${themes.join(", ")}\n`);
    return;
  }

  console.log("");
  for (const event of ["idle", "input"]) {
    const file = findThemeFile(theme, event);
    console.log(`  Playing ${theme} ${event}...`);
    try {
      execSync(`node "${PLAY_SCRIPT}" --file "${file}"`, { stdio: "inherit" });
      execSync(process.platform === "win32" ? "timeout /t 2 >nul" : "sleep 2");
    } catch {
      console.log(`  Could not play ${theme}-${event}`);
    }
  }
  console.log("");
}

function mute() {
  const config = readConfig();
  config.muted = true;
  writeConfig(config);
  console.log("\n  Notifications muted.\n");
}

function unmute() {
  const config = readConfig();
  config.muted = false;
  writeConfig(config);
  console.log("\n  Notifications unmuted.\n");
}

function volume(args) {
  const config = readConfig();

  if (args.length === 0) {
    const vol = config.volume ?? 10;
    const muted = config.muted ?? false;
    const bar = "#".repeat(vol) + "-".repeat(10 - vol);
    console.log(`\n  Volume: [${bar}] ${vol}/10${muted ? "  (MUTED)" : ""}\n`);
    return;
  }

  const val = parseInt(args[0], 10);
  if (isNaN(val) || val < 1 || val > 10) {
    console.log("\n  Usage: agent-noti volume <1-10>\n");
    return;
  }

  config.volume = val;
  if (config.muted) config.muted = false; // setting volume implies unmute
  writeConfig(config);
  const bar = "#".repeat(val) + "-".repeat(10 - val);
  console.log(`\n  Volume: [${bar}] ${val}/10\n`);
}

function reset() {
  writeConfig({ idle: "default", input: "default", volume: 10, muted: false });
  console.log("\n  Reset to defaults (theme=default, volume=10, unmuted).\n");
}

async function pick() {
  const choice = await picker();
  if (choice) {
    const config = readConfig();
    config.idle = choice;
    config.input = choice;
    writeConfig(config);
    console.log(`\n  Theme set to: ${choice}\n`);
  }
}

// --- Main ---

const cmd = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (cmd) {
    case "install":     await install(); break;
    case "uninstall":   uninstall(); break;
    case "test":        test(); break;
    case "sounds":      sounds(); break;
    case "set":         set(args); break;
    case "set-custom":  setCustom(args); break;
    case "preview":     preview(args); break;
    case "reset":       reset(); break;
    case "pick":        await pick(); break;
    case "mute":        mute(); break;
    case "unmute":      unmute(); break;
    case "volume":      volume(args); break;
    default:
      console.log("");
      console.log("  agent-noti install                          Add hooks + pick theme");
      console.log("  agent-noti uninstall                        Remove hooks");
      console.log("  agent-noti test                             Play current sounds");
      console.log("  agent-noti sounds                           List available themes");
      console.log("  agent-noti pick                             Interactive sound picker");
      console.log("  agent-noti set <theme>                      Set both idle & input");
      console.log("  agent-noti set <idle|input> <theme>         Set one event");
      console.log("  agent-noti set-custom [idle|input] <file>   Use custom sound");
      console.log("  agent-noti preview <theme>                  Preview a theme");
      console.log("  agent-noti volume <1-10>                    Set volume level");
      console.log("  agent-noti mute                             Mute notifications");
      console.log("  agent-noti unmute                           Unmute notifications");
      console.log("  agent-noti reset                            Reset everything");
      console.log("");
  }
}

main();
