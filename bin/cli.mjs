#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAY_SCRIPT = join(__dirname, "play.mjs");
const CODEX_NOTIFY_SCRIPT = join(__dirname, "codex-notify.mjs");

const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");
const CODEX_CONFIG = join(homedir(), ".codex", "config.toml");

const HOOK_ID = "agent-noti";
const CODEX_MARKER = "# agent-noti";

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
    // Remove existing agent-noti or notify lines
    const lines = toml
      .split("\n")
      .filter((l) => !l.includes(CODEX_MARKER) && !l.match(/^\s*notify\s*=/));
    // Insert at top (before any [section] headers) to stay at root level
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

// --- CLI ---

function install() {
  console.log("");
  installClaude();
  installCodex();
  console.log("");
  console.log("  Restart Claude Code / Codex to activate.");
  console.log("");
}

function uninstall() {
  console.log("");
  uninstallClaude();
  uninstallCodex();
  console.log("");
}

function test() {
  console.log("");
  for (const name of ["idle", "input"]) {
    console.log(`  Playing: ${name}`);
    execSync(`node "${PLAY_SCRIPT}" ${name}`, { stdio: "inherit" });
    execSync(process.platform === "win32" ? "timeout /t 1 >nul" : "sleep 1");
  }
  console.log("");
}

const cmd = process.argv[2];

switch (cmd) {
  case "install":    install(); break;
  case "uninstall":  uninstall(); break;
  case "test":       test(); break;
  default:
    console.log("");
    console.log("  agent-noti install     Add hooks");
    console.log("  agent-noti uninstall   Remove hooks");
    console.log("  agent-noti test        Play sounds");
    console.log("");
}
