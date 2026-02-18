#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname, extname } from "path";
import { execSync, spawn } from "child_process";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { homedir, platform } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_SCRIPT = join(__dirname, "play.mjs");
const STAMP_SCRIPT = join(__dirname, "stamp.mjs");
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
  const stamp = { type: "command", command: `node "${STAMP_SCRIPT}"` };
  return {
    Stop: [{ hooks: [idle], metadata: { id: HOOK_ID } }],
    PermissionRequest: [{ hooks: [input], metadata: { id: HOOK_ID } }],
    PromptSubmit: [{ hooks: [stamp], metadata: { id: HOOK_ID } }],
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

function isCustomPath(val) {
  return val && (val.startsWith("/") || /^[A-Z]:\\/.test(val));
}

function buildPickerThemes() {
  const config = readConfig();
  const themes = [SOUND_THEMES[0]]; // default first

  // Show custom option below default if custom sounds have been configured
  if (config.customIdle || config.customInput) {
    themes.push({ name: "custom", desc: "Your custom sounds" });
  }

  // Regular themes
  themes.push(...SOUND_THEMES.slice(1));

  // Add custom trigger at the bottom
  themes.push({ name: "+ Add custom", desc: "Import your own sounds" });

  return themes;
}

function resolvePickerPreview(themeName, event, config) {
  if (themeName === "custom") {
    const path = event === "idle" ? config.customIdle : config.customInput;
    if (path && existsSync(path)) return path;
    return join(SOUNDS_DIR, `${event}.mp3`); // fallback
  }
  if (themeName === "+ Add custom") return null;
  return findThemeFile(themeName, event);
}

function picker() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(null);
      return;
    }

    const themes = buildPickerThemes();
    const config = readConfig();

    // Determine current theme for pre-selection
    const currentTheme = isCustomPath(config.idle) ? "custom" : (config.idle || "default");
    let selected = Math.max(0, themes.findIndex((t) => t.name === currentTheme));

    let nowPlaying = "";
    let previewProc = null;
    const maxName = Math.max(...themes.map((s) => s.name.length));

    const totalLines = themes.length + 5;

    function killPreview() {
      if (previewProc) {
        try { previewProc.kill(); } catch {}
        previewProc = null;
      }
    }

    function playPreview(themeName, event) {
      killPreview();
      const file = resolvePickerPreview(themeName, event, config);
      if (!file || !existsSync(file)) return;
      nowPlaying = `${themeName} ${event}`;
      previewProc = spawnPlayer(file);
      previewProc.on("close", () => {
        if (nowPlaying === `${themeName} ${event}`) nowPlaying = "";
        render();
      });
      render();
    }

    function render(firstTime) {
      if (!firstTime) {
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

        let active = "";
        if (theme.name === "custom" && isCustomPath(config.idle)) {
          active = " \x1b[32m(current)\x1b[0m";
        } else if (theme.name !== "custom" && theme.name !== "+ Add custom"
          && config.idle === theme.name && config.input === theme.name) {
          active = " \x1b[32m(current)\x1b[0m";
        }

        process.stdout.write(
          `\x1b[2K  ${arrow}${color}${theme.name.padEnd(maxName + 2)}${theme.desc}${reset}${active}\n`
        );
      });

      process.stdout.write("\x1b[2K\n");
      const isAddCustom = themes[selected].name === "+ Add custom";
      const playInfo = nowPlaying ? `  \x1b[33m♪ ${nowPlaying}\x1b[0m` : "";
      const controls = isAddCustom
        ? `\x1b[2K  \x1b[90m[up/down] Navigate  [enter] Add custom  [q] Quit\x1b[0m${playInfo}\n`
        : `\x1b[2K  \x1b[90m[up/down] Navigate  [<] Play idle  [>] Play input  [enter] Select  [q] Quit\x1b[0m${playInfo}\n`;
      process.stdout.write(controls);
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
      if (key === "\x03") {
        cleanup();
        console.log("");
        process.exit(0);
      }

      if (key === "q" || key === "Q") {
        cleanup();
        console.log("\n  No changes made.\n");
        resolve(null);
        return;
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(themes[selected].name);
        return;
      }

      if (key === "\x1b[A" || key === "k") {
        selected = (selected - 1 + themes.length) % themes.length;
        render();
      }
      else if (key === "\x1b[B" || key === "j") {
        selected = (selected + 1) % themes.length;
        render();
      }
      else if (key === "\x1b[D") {
        playPreview(themes[selected].name, "idle");
      }
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
    while (true) {
      const choice = await picker();
      if (choice === "+ Add custom") {
        await addCustom();
        continue;
      }
      if (choice) applyPickerChoice(choice);
      break;
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

  if (config.customIdle || config.customInput) {
    const isActive = isCustomPath(config.idle) || isCustomPath(config.input);
    const marker = isActive ? " [active]" : "";
    console.log(`    ${"custom".padEnd(maxName + 2)} Your custom sounds${marker}`);
  }

  const idleLabel = isCustomPath(config.idle) ? "custom" : (config.idle || "default");
  const inputLabel = isCustomPath(config.input) ? "custom" : (config.input || "default");
  console.log("");
  console.log("  Theme:  idle=%s, input=%s", idleLabel, inputLabel);
  const volBar = "#".repeat(vol) + "-".repeat(10 - vol);
  console.log(`  Volume: [${volBar}] ${vol}/10${muted ? "  (MUTED)" : ""}`);

  if (config.ntfy && config.ntfy.topic) {
    const n = config.ntfy;
    const server = (n.server || "https://ntfy.sh").replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const status = n.enabled ? "enabled" : "disabled";
    console.log(`  ntfy:   ${status} (${server}/${n.topic})`);
  }

  console.log("");
}

// --- Interactive add-custom ---

function selectOption(title, options) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) { resolve(null); return; }

    let selected = 0;
    const totalLines = options.length + 4; // blank + title + blank + options + blank

    function render(firstTime) {
      if (!firstTime) process.stdout.write(`\x1b[${totalLines}A`);
      process.stdout.write("\x1b[2K\n");
      process.stdout.write(`\x1b[2K  \x1b[1m${title}\x1b[0m\n`);
      process.stdout.write("\x1b[2K\n");
      options.forEach((opt, i) => {
        const arrow = i === selected ? "\x1b[36m> " : "  ";
        const color = i === selected ? "\x1b[36m" : "\x1b[90m";
        process.stdout.write(`\x1b[2K  ${arrow}${color}${opt.label}\x1b[0m\n`);
      });
      process.stdout.write("\x1b[2K\n");
    }

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    render(true);

    function cleanup() {
      stdin.removeListener("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function onKey(key) {
      if (key === "\x03") { cleanup(); console.log(""); process.exit(0); }
      if (key === "q" || key === "Q") { cleanup(); resolve(null); return; }
      if (key === "\r" || key === "\n") { cleanup(); resolve(options[selected].value); return; }
      if (key === "\x1b[A" || key === "k") { selected = (selected - 1 + options.length) % options.length; render(); }
      else if (key === "\x1b[B" || key === "j") { selected = (selected + 1) % options.length; render(); }
    }
    stdin.on("data", onKey);
  });
}

function promptPath(label) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${label}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function copyCustomSound(sourcePath, event) {
  const ext = extname(sourcePath);
  const destName = `custom-${event}${ext}`;
  const destPath = join(CUSTOM_SOUNDS_DIR, destName);
  mkdirSync(CUSTOM_SOUNDS_DIR, { recursive: true });
  copyFileSync(sourcePath, destPath);
  return destPath;
}

async function addCustom() {
  if (!process.stdin.isTTY) {
    console.log("\n  This command requires an interactive terminal.\n");
    return;
  }

  const config = readConfig();
  let idlePath = null;

  // Step 1: Idle sound
  const idleChoice = await selectOption("Idle sound (when agent finishes):", [
    { label: "Enter file path", value: "path" },
    { label: "Skip (use default)", value: "skip" },
  ]);

  if (idleChoice === null) { console.log("\n  No changes made.\n"); return; }

  if (idleChoice === "path") {
    console.log("");
    const p = await promptPath("Path to idle sound: ");
    if (!p) {
      console.log("  No path provided, using default.\n");
    } else if (!existsSync(p)) {
      console.log(`  File not found: ${p} — using default.\n`);
    } else {
      idlePath = p;
      const dest = copyCustomSound(p, "idle");
      config.idle = dest;
      config.customIdle = dest;
      console.log(`  Copied to: ${dest}\n`);
    }
  }

  if (!idlePath && idleChoice !== "skip") {
    config.idle = config.idle || "default";
  }

  // Step 2: Input sound
  const inputOptions = [
    { label: "Enter file path", value: "path" },
    ...(idlePath ? [{ label: "Same as idle", value: "same" }] : []),
    { label: "Skip (use default)", value: "skip" },
  ];

  const inputChoice = await selectOption("Input sound (when agent needs approval):", inputOptions);

  if (inputChoice === null) { console.log("\n  No changes made.\n"); return; }

  if (inputChoice === "path") {
    console.log("");
    const p = await promptPath("Path to input sound: ");
    if (!p) {
      console.log("  No path provided, using default.\n");
    } else if (!existsSync(p)) {
      console.log(`  File not found: ${p} — using default.\n`);
    } else {
      const dest = copyCustomSound(p, "input");
      config.input = dest;
      config.customInput = dest;
      console.log(`  Copied to: ${dest}\n`);
    }
  } else if (inputChoice === "same" && idlePath) {
    const dest = copyCustomSound(idlePath, "input");
    config.input = dest;
    config.customInput = dest;
    console.log(`\n  Input set to same as idle.\n`);
  }

  // Ensure both have values
  if (!config.idle) config.idle = "default";
  if (!config.input) config.input = "default";

  writeConfig(config);
  console.log("  Custom sounds applied.\n");
}

// --- ntfy.sh push notifications ---

const NTFY_PRIORITIES = ["min", "low", "default", "high", "urgent"];

function ntfyPrompt(label) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${label}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function ntfyInitialSetup() {
  console.log("\n  First-time ntfy.sh setup\n");
  const topic = await ntfyPrompt("Topic (required): ");
  if (!topic) {
    console.log("  Topic is required. Aborting.\n");
    return null;
  }
  const server = await ntfyPrompt("Server (enter for https://ntfy.sh): ");
  return { topic, server: server || "https://ntfy.sh" };
}

async function ntfySendTest(ntfyConfig) {
  const server = (ntfyConfig.server || "https://ntfy.sh").replace(/\/+$/, "");
  const url = `${server}/${ntfyConfig.topic}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Title: "Test Notification",
      Priority: ntfyConfig.priority || "default",
      Tags: "bell",
    },
    body: "agent-noti test notification",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function ntfy() {
  return new Promise(async (resolve) => {
    if (!process.stdin.isTTY) {
      console.log("\n  This command requires an interactive terminal.\n");
      resolve();
      return;
    }

    const config = readConfig();

    // First-time setup: prompt for topic
    if (!config.ntfy || !config.ntfy.topic) {
      const setup = await ntfyInitialSetup();
      if (!setup) { resolve(); return; }
      config.ntfy = {
        enabled: true,
        server: setup.server,
        topic: setup.topic,
        priority: "default",
        threshold: 0,
        idle: true,
        input: true,
      };
      writeConfig(config);
    }

    const ntfyConf = config.ntfy;
    const rows = ["idle", "input"];
    let selected = 0;
    let statusMsg = "";
    const totalLines = 13;

    function render(firstTime) {
      if (!firstTime) process.stdout.write(`\x1b[${totalLines}A`);

      const thresh = ntfyConf.threshold ?? 0;
      const threshLabel = thresh === 0 ? "off (always notify)" : `${thresh} min`;

      process.stdout.write("\x1b[2K\n");
      process.stdout.write(`\x1b[2K  \x1b[1mntfy.sh push notifications\x1b[0m\n`);
      process.stdout.write("\x1b[2K\n");
      process.stdout.write(`\x1b[2K  Server:    \x1b[36m${ntfyConf.server || "https://ntfy.sh"}\x1b[0m\n`);
      process.stdout.write(`\x1b[2K  Topic:     \x1b[36m${ntfyConf.topic}\x1b[0m\n`);
      process.stdout.write(`\x1b[2K  Priority:  \x1b[36m${ntfyConf.priority || "default"}\x1b[0m\n`);
      process.stdout.write(`\x1b[2K  Threshold: \x1b[36m${threshLabel}\x1b[0m\n`);
      process.stdout.write("\x1b[2K\n");

      for (let i = 0; i < rows.length; i++) {
        const checked = ntfyConf[rows[i]] ? "x" : " ";
        const label = rows[i] === "idle" ? "Notify on task complete (idle)" : "Notify on approval needed (input)";
        const arrow = i === selected ? "\x1b[36m> " : "  ";
        const color = i === selected ? "\x1b[36m" : "\x1b[0m";
        process.stdout.write(`\x1b[2K  ${arrow}${color}[${checked}] ${label}\x1b[0m\n`);
      }

      process.stdout.write("\x1b[2K\n");
      const status = statusMsg ? `  ${statusMsg}` : "";
      process.stdout.write(`\x1b[2K  \x1b[90m[space] Toggle  [up/down] Navigate  [e] Edit  [t] Test  [q] Save & quit\x1b[0m${status}\n`);
      process.stdout.write(`\x1b[2K\n`);
    }

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    render(true);

    function cleanup() {
      stdin.removeListener("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function save() {
      ntfyConf.enabled = ntfyConf.idle || ntfyConf.input;
      config.ntfy = ntfyConf;
      writeConfig(config);
    }

    async function editFields() {
      cleanup();
      console.log("");

      const newServer = await ntfyPrompt(`Server (${ntfyConf.server || "https://ntfy.sh"}): `);
      if (newServer) ntfyConf.server = newServer;

      const newTopic = await ntfyPrompt(`Topic (${ntfyConf.topic}): `);
      if (newTopic) ntfyConf.topic = newTopic;

      const priIdx = NTFY_PRIORITIES.indexOf(ntfyConf.priority || "default");
      const newPri = await ntfyPrompt(`Priority [${NTFY_PRIORITIES.join("/")}] (${NTFY_PRIORITIES[priIdx]}): `);
      if (newPri && NTFY_PRIORITIES.includes(newPri)) ntfyConf.priority = newPri;

      const curThresh = ntfyConf.threshold ?? 0;
      const newThresh = await ntfyPrompt(`Threshold in minutes, 0=off (${curThresh}): `);
      if (newThresh !== "") {
        const val = parseInt(newThresh, 10);
        if (!isNaN(val) && val >= 0) ntfyConf.threshold = val;
      }

      // Re-enter raw mode and re-render
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      stdin.on("data", onKey);
      render(true);
    }

    async function testNotification() {
      cleanup();
      statusMsg = "\x1b[33mSending...\x1b[0m";
      // Re-enter raw mode to render
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      render(true);

      try {
        await ntfySendTest(ntfyConf);
        statusMsg = "\x1b[32mSent!\x1b[0m";
      } catch (e) {
        statusMsg = `\x1b[31mFailed: ${e.message}\x1b[0m`;
      }

      stdin.on("data", onKey);
      render();
      setTimeout(() => { statusMsg = ""; render(); }, 3000);
    }

    async function onKey(key) {
      if (key === "\x03") {
        cleanup();
        save();
        console.log("");
        process.exit(0);
      }

      if (key === "q" || key === "Q" || key === "\r" || key === "\n") {
        cleanup();
        save();
        console.log(`\n  ntfy config saved (${ntfyConf.enabled ? "enabled" : "disabled"}).\n`);
        resolve();
        return;
      }

      if (key === " ") {
        ntfyConf[rows[selected]] = !ntfyConf[rows[selected]];
        render();
        return;
      }

      if (key === "\x1b[A" || key === "k") {
        selected = (selected - 1 + rows.length) % rows.length;
        render();
        return;
      }

      if (key === "\x1b[B" || key === "j") {
        selected = (selected + 1) % rows.length;
        render();
        return;
      }

      if (key === "e" || key === "E") {
        await editFields();
        return;
      }

      if (key === "t" || key === "T") {
        stdin.removeListener("data", onKey);
        await testNotification();
        return;
      }
    }

    stdin.on("data", onKey);
  });
}

async function ntfyTest() {
  const config = readConfig();
  const ntfyConf = config.ntfy;

  if (!ntfyConf || !ntfyConf.topic) {
    console.log("\n  ntfy not configured. Run 'agent-noti ntfy' first.\n");
    return;
  }

  process.stdout.write("\n  Sending test notification...");
  try {
    await ntfySendTest(ntfyConf);
    console.log(" sent!\n");
  } catch (e) {
    console.log(` failed: ${e.message}\n`);
  }
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
  console.log("\n  Reset to defaults (theme=default, volume=10, unmuted, ntfy cleared).\n");
}

function applyPickerChoice(choice) {
  const config = readConfig();
  if (choice === "custom") {
    config.idle = config.customIdle || "default";
    config.input = config.customInput || "default";
    writeConfig(config);
    console.log(`\n  Theme set to: custom\n`);
  } else {
    config.idle = choice;
    config.input = choice;
    writeConfig(config);
    console.log(`\n  Theme set to: ${choice}\n`);
  }
}

async function pick() {
  while (true) {
    const choice = await picker();
    if (choice === "+ Add custom") {
      await addCustom();
      continue; // restart picker to show updated custom entry
    }
    if (choice) applyPickerChoice(choice);
    break;
  }
}

// --- Main ---

const cmd = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (cmd) {
    case "install":  case "i":  await install(); break;
    case "uninstall":            uninstall(); break;
    case "test":     case "t":  test(); break;
    case "sounds":   case "s":  sounds(); break;
    case "pick":     case "p":  await pick(); break;
    case "add-custom": case "ac": await addCustom(); break;
    case "volume":   case "v":  volume(args); break;
    case "mute":     case "m":  mute(); break;
    case "unmute":   case "u":  unmute(); break;
    case "reset":    case "r":  reset(); break;
    case "ntfy":     case "n":  await ntfy(); break;
    case "ntfy-test": case "nt": await ntfyTest(); break;
    default:
      console.log("");
      console.log("  agent-noti install   (i)   Add hooks + pick theme");
      console.log("  agent-noti uninstall       Remove hooks");
      console.log("  agent-noti test      (t)   Play current sounds");
      console.log("  agent-noti sounds    (s)   List available themes");
      console.log("  agent-noti pick      (p)   Interactive sound picker");
      console.log("  agent-noti add-custom(ac)  Use your own sound files");
      console.log("  agent-noti volume    (v)   Set volume <1-10>");
      console.log("  agent-noti mute      (m)   Mute notifications");
      console.log("  agent-noti unmute    (u)   Unmute notifications");
      console.log("  agent-noti ntfy      (n)   Configure ntfy.sh push notifications");
      console.log("  agent-noti ntfy-test (nt)  Send a test push notification");
      console.log("  agent-noti reset     (r)   Reset everything");
      console.log("");
  }
}

main();
