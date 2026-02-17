#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const PLAY_SCRIPT = join(__dirname, "play.mjs");
const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

const HOOK_ID = "agent-noti";

function buildHooks() {
  const idle = { type: "command", command: `node "${PLAY_SCRIPT}" idle` };
  const input = { type: "command", command: `node "${PLAY_SCRIPT}" input` };

  return {
    Stop: [{ hooks: [idle], metadata: { id: HOOK_ID } }],
    PermissionRequest: [{ hooks: [input], metadata: { id: HOOK_ID } }],
  };
}

function readSettings() {
  const dir = dirname(SETTINGS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(SETTINGS_PATH)) return {};
  return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
}

function writeSettings(settings) {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function removeOurHooks(hookEntries) {
  if (!Array.isArray(hookEntries)) return hookEntries;
  return hookEntries.filter((e) => !e.metadata || e.metadata.id !== HOOK_ID);
}

function install() {
  const settings = readSettings();
  if (!settings.hooks) settings.hooks = {};

  for (const [event, entries] of Object.entries(buildHooks())) {
    const existing = removeOurHooks(settings.hooks[event] || []);
    settings.hooks[event] = [...existing, ...entries];
  }

  writeSettings(settings);

  console.log("");
  console.log("  agent-noti installed!");
  console.log("  Restart Claude Code to activate.");
  console.log("");
  console.log("    agent-noti test        Play sounds");
  console.log("    agent-noti uninstall   Remove hooks");
  console.log("");
}

function uninstall() {
  const settings = readSettings();
  if (!settings.hooks) {
    console.log("Nothing to uninstall.");
    return;
  }

  for (const event of Object.keys(settings.hooks)) {
    const cleaned = removeOurHooks(settings.hooks[event]);
    if (cleaned.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = cleaned;
  }

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeSettings(settings);

  console.log("");
  console.log("  agent-noti uninstalled!");
  console.log("");
}

function test() {
  console.log("");
  for (const name of ["idle", "input"]) {
    console.log(`  Playing: ${name}`);
    execSync(`node "${PLAY_SCRIPT}" ${name}`, { stdio: "inherit" });
    // Small pause between sounds
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
    console.log("  agent-noti install     Add hooks to Claude Code");
    console.log("  agent-noti uninstall   Remove hooks");
    console.log("  agent-noti test        Play sounds");
    console.log("");
}
