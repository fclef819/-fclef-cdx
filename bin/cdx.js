#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const prompts = require("prompts");

const CDX_FILENAME = ".cdx";
const CODEX_HOME = path.join(process.env.HOME || "", ".codex");
const HISTORY_PATH = path.join(CODEX_HOME, "history.jsonl");
const SESSIONS_DIR = path.join(CODEX_HOME, "sessions");

function findCdxFile(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, CDX_FILENAME);
    if (fs.existsSync(candidate)) {
      return { dir, filePath: candidate };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadEntries(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tabIndex = line.indexOf("\t");
      if (tabIndex === -1) return null;
      const uuid = line.slice(0, tabIndex).trim();
      const label = line.slice(tabIndex + 1).trim();
      if (!uuid || !label) return null;
      return { uuid, label };
    })
    .filter(Boolean);
}

function sanitizeLabel(label) {
  return label.replace(/[\t\n\r]+/g, " ").trim();
}

function appendEntry(filePath, entry) {
  const line = `${entry.uuid}\t${entry.label}\n`;
  fs.appendFileSync(filePath, line, "utf8");
}

function writeEntries(filePath, entries) {
  if (!entries.length) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  const content = entries.map((e) => `${e.uuid}\t${e.label}`).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf8");
}

function collectSessionFiles(dir, results) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSessionFiles(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const stat = fs.statSync(fullPath);
      results.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    }
  }
}

function extractIdFromFilename(filePath) {
  const match = filePath.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
  );
  return match ? match[1] : null;
}

function readSessionIdFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const firstLine = content.split("\n")[0];
    const record = JSON.parse(firstLine);
    if (record && record.type === "session_meta" && record.payload?.id) {
      return record.payload.id;
    }
  } catch {
    // ignore malformed file
  }
  return extractIdFromFilename(filePath);
}

function getLatestSessionSnapshot() {
  const files = [];
  collectSessionFiles(SESSIONS_DIR, files);
  if (!files.length) return null;
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const latest = files[files.length - 1];
  const id = readSessionIdFromFile(latest.path);
  return { id, mtimeMs: latest.mtimeMs, path: latest.path };
}

function getLastHistorySessionId() {
  if (!fs.existsSync(HISTORY_PATH)) return null;
  const lines = fs.readFileSync(HISTORY_PATH, "utf8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const record = JSON.parse(lines[i]);
      if (record && record.session_id) return record.session_id;
    } catch {
      // ignore malformed lines
    }
  }
  return null;
}

function getNewestHistorySessionIdSince(previousId) {
  if (!fs.existsSync(HISTORY_PATH)) return null;
  const lines = fs.readFileSync(HISTORY_PATH, "utf8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const record = JSON.parse(lines[i]);
      if (record && record.session_id && record.session_id !== previousId) {
        return record.session_id;
      }
    } catch {
      // ignore malformed lines
    }
  }
  return null;
}

function runCodex(args, cwd) {
  const check = spawnSync("codex", ["--version"], { stdio: "ignore" });
  if (check.error && check.error.code === "ENOENT") {
    console.error(
      "Codex CLI is not available. Please install it and ensure `codex` is on your PATH."
    );
    process.exit(1);
  }
  const result = spawnSync("codex", args, { stdio: "inherit", cwd });
  if (result.error) {
    console.error("Failed to run codex:", result.error.message);
    process.exit(result.status ?? 1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function selectSession(entries) {
  const choices = [
    { title: "new", value: { type: "new" } },
    ...entries.map((entry) => ({
      title: `${entry.label} (${entry.uuid})`,
      value: { type: "resume", entry }
    }))
  ];

  const response = await prompts({
    type: "select",
    name: "selection",
    message: "Select a session",
    choices
  });

  return response.selection;
}

async function promptLabel() {
  const response = await prompts({
    type: "text",
    name: "label",
    message: "Label for new session",
    validate: (value) => (value && value.trim() ? true : "Label is required")
  });
  return response.label;
}

async function runDefault(startDir, options) {
  const found = options.here ? null : findCdxFile(startDir);
  const workDir = found ? found.dir : startDir;
  const cdxPath = found ? found.filePath : path.join(startDir, CDX_FILENAME);
  const entries = loadEntries(found?.filePath);

  console.log(`.cdx: ${cdxPath}`);
  const selection = await selectSession(entries);
  if (!selection) return;

  if (selection.type === "new") {
    const labelInput = await promptLabel();
    if (!labelInput) return;
    const label = sanitizeLabel(labelInput);
    const previousHistoryId = getLastHistorySessionId();
    const previousSession = getLatestSessionSnapshot();
    runCodex([], workDir);
    const latestSession = getLatestSessionSnapshot();
    let newId = null;
    if (
      latestSession &&
      latestSession.id &&
      (!previousSession ||
        latestSession.path !== previousSession.path ||
        latestSession.mtimeMs > previousSession.mtimeMs)
    ) {
      newId = latestSession.id;
    } else if (previousHistoryId) {
      newId = getNewestHistorySessionIdSince(previousHistoryId);
    }
    if (!newId) {
      console.error("Could not determine new session UUID; not updating .cdx.");
      return;
    }
    appendEntry(cdxPath, { uuid: newId, label });
    return;
  }

  if (selection.type === "resume") {
    runCodex(["resume", selection.entry.uuid], workDir);
  }
}

async function runRemove(startDir, options) {
  const found = options.here ? null : findCdxFile(startDir);
  const targetPath = found ? found.filePath : path.join(startDir, CDX_FILENAME);
  const targetDir = found ? found.dir : startDir;
  if (!found) {
    if (!fs.existsSync(targetPath)) {
      console.log("No .cdx file found.");
      return;
    }
  }
  const entries = loadEntries(targetPath);
  if (!entries.length) {
    console.log("No sessions to remove.");
    return;
  }

  console.log(`.cdx: ${targetPath}`);
  const response = await prompts({
    type: "select",
    name: "selection",
    message: "Select a session to remove",
    choices: entries.map((entry) => ({
      title: `${entry.label} (${entry.uuid})`,
      value: entry.uuid
    }))
  });

  if (!response.selection) return;
  const remaining = entries.filter((entry) => entry.uuid !== response.selection);
  writeEntries(targetPath, remaining);
}

function printHelp() {
  console.log(`cdx - Codex session wrapper

Usage:
  cdx
  cdx here
  cdx rm
  cdx rm here
  cdx here rm

Notes:
  - "here" skips parent directory search and uses .cdx in the current directory
  - the selected .cdx path is shown before session selection
`);
}

async function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  const startDir = process.cwd();
  const here = args.includes("here");
  const wantsHelp =
    args.includes("-h") ||
    args.includes("--help") ||
    args.includes("help");

  if (wantsHelp) {
    printHelp();
    return;
  }

  if (subcommand === "rm" || (here && args.includes("rm"))) {
    await runRemove(startDir, { here });
    return;
  }

  if (subcommand === "here" || here) {
    await runDefault(startDir, { here: true });
    return;
  }

  await runDefault(startDir, { here: false });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
