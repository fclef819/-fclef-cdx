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

function logVerbose(message, enabled) {
  if (enabled) console.log(message);
}

function escapePowerShellArg(value) {
  if (value === "") return "''";
  return `'${value.replace(/'/g, "''")}'`;
}

function findCdxFile(startDir, verbose) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, CDX_FILENAME);
    if (fs.existsSync(candidate)) {
      logVerbose(`Found .cdx at: ${candidate}`, verbose);
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

function appendEntry(filePath, entry, verbose) {
  const line = `${entry.uuid}\t${entry.label}\n`;
  logVerbose(`Appending entry to ${filePath}`, verbose);
  fs.appendFileSync(filePath, line, "utf8");
}

function writeEntries(filePath, entries, verbose) {
  if (!entries.length) {
    logVerbose(`Removing empty .cdx at ${filePath}`, verbose);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  logVerbose(`Writing ${entries.length} entries to ${filePath}`, verbose);
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

function getLatestSessionSnapshot(verbose) {
  const files = [];
  collectSessionFiles(SESSIONS_DIR, files);
  if (!files.length) return null;
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const latest = files[files.length - 1];
  const id = readSessionIdFromFile(latest.path);
  logVerbose(`Latest session file: ${latest.path}`, verbose);
  return { id, mtimeMs: latest.mtimeMs, path: latest.path };
}

function getLastHistorySessionId(verbose) {
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
  logVerbose("No session_id found in history.jsonl", verbose);
  return null;
}

function getNewestHistorySessionIdSince(previousId, verbose) {
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
  logVerbose("No new session_id found in history.jsonl", verbose);
  return null;
}

function runCodex(args, cwd, verbose) {
  logVerbose(`Running codex ${args.join(" ")}`.trim(), verbose);
  const result = spawnSync("codex", args, { stdio: "inherit", cwd });
  if (result.error) {
    if (result.error.code === "ENOENT" && process.platform === "win32") {
      logVerbose("codex not found directly; trying PowerShell fallback", verbose);
      const psArgs = [
        "-NoProfile",
        "-Command",
        ["codex", ...args.map(escapePowerShellArg)].join(" ")
      ];
      const psResult = spawnSync("powershell.exe", psArgs, {
        stdio: "inherit",
        cwd
      });
      if (!psResult.error) {
        if (psResult.status !== 0) process.exit(psResult.status ?? 1);
        return;
      }
    }
    console.error(
      "Codex CLI is not available. Please install it and ensure `codex` is on your PATH."
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function printSessionList(entries) {
  console.log("0: new");
  entries.forEach((entry, index) => {
    console.log(`${index + 1}: ${entry.label} (${entry.uuid})`);
  });
}

async function selectSession(entries) {
  if (!entries.length) {
    return { type: "new" };
  }

  printSessionList(entries);
  while (true) {
    const numberInput = await prompts({
      type: "text",
      name: "value",
      message: "Select by number (Enter for list selection)",
      validate: (value) => {
        if (!value || !value.trim()) return true;
        if (!/^\d+$/.test(value.trim())) return "Enter a number";
        const index = Number.parseInt(value.trim(), 10);
        if (index < 0 || index > entries.length) return "Out of range";
        return true;
      }
    });

    if (!numberInput.value && numberInput.value !== "0") break;
    const index = Number.parseInt(String(numberInput.value).trim(), 10);
    if (Number.isNaN(index)) break;
    if (index === 0) return { type: "new" };
    return { type: "resume", entry: entries[index - 1] };
  }

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

async function promptUuid() {
  const response = await prompts({
    type: "text",
    name: "uuid",
    message: "Session UUID",
    validate: (value) => (value && value.trim() ? true : "UUID is required")
  });
  return response.uuid;
}

async function runDefault(startDir, options) {
  const found = options.here ? null : findCdxFile(startDir, options.verbose);
  const workDir = found ? found.dir : startDir;
  const cdxPath = found ? found.filePath : path.join(startDir, CDX_FILENAME);
  const entries = loadEntries(found?.filePath);

  console.log(`.cdx: ${cdxPath}`);
  const selection = options.forceNew
    ? { type: "new" }
    : await selectSession(entries);
  if (!selection) return;

  if (selection.type === "new") {
    const labelInput = await promptLabel();
    if (!labelInput) return;
    const label = sanitizeLabel(labelInput);
    const previousHistoryId = getLastHistorySessionId(options.verbose);
    const previousSession = getLatestSessionSnapshot(options.verbose);
    runCodex([], workDir, options.verbose);
    const latestSession = getLatestSessionSnapshot(options.verbose);
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
      newId = getNewestHistorySessionIdSince(previousHistoryId, options.verbose);
    }
    if (!newId) {
      console.error("Could not determine new session UUID; not updating .cdx.");
      return;
    }
    appendEntry(cdxPath, { uuid: newId, label }, options.verbose);
    return;
  }

  if (selection.type === "resume") {
    runCodex(["resume", selection.entry.uuid], workDir, options.verbose);
  }
}

async function runRemove(startDir, verbose) {
  const found = findCdxFile(startDir, verbose);
  if (!found) {
    console.log("No .cdx file found.");
    return;
  }
  const targetPath = found.filePath;
  const entries = loadEntries(targetPath);
  if (!entries.length) {
    console.log("No sessions to remove.");
    return;
  }

  console.log(`.cdx: ${targetPath}`);
  entries.forEach((entry, index) => {
    console.log(`${index + 1}: ${entry.label} (${entry.uuid})`);
  });

  let selectedUuid = null;
  while (true) {
    const numberInput = await prompts({
      type: "text",
      name: "value",
      message: "Select by number (Enter for list selection)",
      validate: (value) => {
        if (!value || !value.trim()) return true;
        if (!/^\d+$/.test(value.trim())) return "Enter a number";
        const index = Number.parseInt(value.trim(), 10);
        if (index < 1 || index > entries.length) return "Out of range";
        return true;
      }
    });

    if (!numberInput.value) break;
    const index = Number.parseInt(String(numberInput.value).trim(), 10);
    if (!Number.isNaN(index)) {
      selectedUuid = entries[index - 1].uuid;
    }
    break;
  }

  if (!selectedUuid) {
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
    selectedUuid = response.selection;
  }

  const remaining = entries.filter((entry) => entry.uuid !== selectedUuid);
  writeEntries(targetPath, remaining, verbose);
}

function printAddHelp() {
  console.log(`Usage:
  cdx add <uuid> <label>
  cdx add <uuid>
  cdx add`);
}

function runInit(startDir, verbose) {
  const cdxPath = path.join(startDir, CDX_FILENAME);
  if (fs.existsSync(cdxPath)) {
    console.log(".cdx already exists in the current directory.");
    return;
  }
  fs.writeFileSync(cdxPath, "", "utf8");
  logVerbose(`Created .cdx at ${cdxPath}`, verbose);
}

async function runAdd(startDir, args, verbose) {
  if (args.length > 3 || (args.length === 2 && args[1] === "")) {
    printAddHelp();
    return;
  }

  const found = findCdxFile(startDir, verbose);
  const cdxPath = found ? found.filePath : path.join(startDir, CDX_FILENAME);
  let uuid = args[1];
  let label = args[2];

  if (!uuid) {
    uuid = await promptUuid();
  }
  if (!uuid) return;

  if (!label) {
    label = await promptLabel();
  }
  if (!label) return;

  appendEntry(cdxPath, { uuid: uuid.trim(), label: sanitizeLabel(label) }, verbose);
}

function printHelp() {
  console.log(`cdx - Codex session wrapper

Usage:
  cdx
  cdx here
  cdx new
  cdx new here
  cdx here new
  cdx rm
  cdx init
  cdx add <uuid> <label>
  cdx add <uuid>
  cdx add
  cdx -V
  cdx --version
  cdx -v
  cdx --verbose

Notes:
  - "here" skips parent directory search and uses .cdx in the current directory
  - the selected .cdx path is shown before session selection
  - use -h, --help, or help to show this message
  - use -v or --verbose to show debug logs
`);
}

function printVersion() {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    console.log(pkg.version || "unknown");
  } catch {
    console.log("unknown");
  }
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
  const wantsVersion = args.includes("-V") || args.includes("--version");
  const verbose = args.includes("-v") || args.includes("--verbose");

  if (wantsHelp) {
    printHelp();
    return;
  }

  if (wantsVersion) {
    printVersion();
    return;
  }

  if (subcommand === "rm") {
    await runRemove(startDir, verbose);
    return;
  }

  if (subcommand === "add") {
    await runAdd(startDir, args, verbose);
    return;
  }

  if (subcommand === "init") {
    runInit(startDir, verbose);
    return;
  }

  if (subcommand === "new" || (here && args.includes("new"))) {
    await runDefault(startDir, { here, forceNew: true, verbose });
    return;
  }

  if (subcommand === "here" || here) {
    await runDefault(startDir, { here: true, verbose });
    return;
  }

  await runDefault(startDir, { here: false, verbose });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
