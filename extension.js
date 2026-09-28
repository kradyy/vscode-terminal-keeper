const vscode = require("vscode");
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { basename, migrate, withLiveCwds, restoreActions, sessionFromCommand, displayName, chooseCwd, ownTabGroup, groupOpenPanes } = require("./layout");
const { summarize, addBookmark, removeBookmark, findBookmark } = require("./bookmarks");
const { registerOptions } = require("./options");

const STATE_FILE = "terminal-keeper-state.json";
const LAYOUT_FILE = "terminal-layout.json";
const BOOKMARKS_FILE = "terminal-bookmarks.json";
const META_ENV = "TERMINAL_KEEPER";

/** @type {Map<vscode.Terminal, { session: string, cwd: string, name: string, groupId: string }>} */
const tracked = new Map();
/** @type {NodeJS.Timeout | undefined} */
let saveTimer;
let restoring = false;

function cfg() {
  return vscode.workspace.getConfiguration("terminalKeeper");
}

function cursorDir() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) return path.join(folder.uri.fsPath, ".cursor");
  return path.join(os.homedir(), ".cursor");
}

function layoutPath() {
  return path.join(cursorDir(), LAYOUT_FILE);
}

function legacyStatePath() {
  return path.join(cursorDir(), STATE_FILE);
}

function bookmarksPath() {
  return path.join(cursorDir(), BOOKMARKS_FILE);
}

function workspaceKey() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "global";
}

function sanitizeSessionName(name) {
  return (
    String(name || "term")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "term"
  );
}

function makeSessionName(label) {
  const prefix = cfg().get("sessionPrefix") || "tk";
  const ws =
    path
      .basename(workspaceKey())
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .slice(0, 24) || "ws";
  const stamp = `${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 36).toString(36)}`;
  return `${prefix}-${ws}-${sanitizeSessionName(label)}-${stamp}`;
}

function tmuxAvailable() {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function listTmuxSessions() {
  try {
    const out = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function sessionExists(name) {
  return listTmuxSessions().includes(name);
}

function liveCwd(session) {
  try {
    return execFileSync(
      "tmux",
      ["display-message", "-p", "-t", session, "#{pane_current_path}"],
      { encoding: "utf8" }
    ).trim();
  } catch {
    return "";
  }
}

function ensureSession(sessionName, cwd) {
  if (sessionExists(sessionName)) return;
  const args = ["new-session", "-d", "-s", sessionName];
  if (cwd && fs.existsSync(cwd)) args.push("-c", cwd);
  execFileSync("tmux", args, { stdio: "ignore" });
}

function readState() {
  for (const file of [layoutPath(), legacyStatePath()]) {
    try {
      if (!fs.existsSync(file)) continue;
      return migrate(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      // try the next file
    }
  }
  return migrate({});
}

function writeState(state) {
  const file = layoutPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

function getMeta(term) {
  const trackedMeta = tracked.get(term);
  if (trackedMeta) return trackedMeta;
  const env = term.creationOptions?.env || {};
  if (env[META_ENV]) {
    return {
      session: env.TERMINAL_KEEPER_SESSION || "",
      cwd: env.TERMINAL_KEEPER_CWD || String(term.creationOptions?.cwd || ""),
      name: term.name,
      groupId: env.TERMINAL_KEEPER_GROUP || "",
    };
  }
  return null;
}

function refreshCwds(groups) {
  /** @type {Record<string, string>} */
  const live = {};
  for (const g of groups) {
    for (const p of g.panes || []) {
      if (!p.session || !sessionExists(p.session)) continue;
      const cwd = liveCwd(p.session);
      if (cwd) live[p.session] = cwd;
    }
  }
  return withLiveCwds(groups, live);
}

function scheduleSave() {
  if (restoring || !cfg().get("autoSave")) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(false), 500);
}

function readCmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8");
  } catch {
    return "";
  }
}

function readProcCwd(pid) {
  if (!pid) return "";
  try {
    return fs.realpathSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

function cwdFromOptions(term) {
  const cwd = term.creationOptions && term.creationOptions.cwd;
  if (!cwd) return "";
  if (typeof cwd === "string") return cwd;
  return cwd.fsPath || "";
}

function stableSessionName(cwd) {
  const prefix = cfg().get("sessionPrefix") || "tk";
  const ws =
    path
      .basename(workspaceKey())
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .slice(0, 24) || "ws";
  return `${prefix}-${ws}-${sanitizeSessionName(basename(cwd))}`;
}

function uniqueSession(base, used) {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function cwdFromTitle(title) {
  const root = defaultCwd();
  const name = String(title || "").trim();
  if (!name || !root || name === path.basename(root)) return "";
  const candidate = path.join(root, name);
  try {
    if (fs.statSync(candidate).isDirectory()) return candidate;
  } catch {
    return "";
  }
  return "";
}

/**
 * One open editor terminal. Session comes from our metadata, or from
 * `tmux attach-session -t ...` on the process. A normal shell is the folder
 * it is actually in.
 */
async function inspectTerminal(term) {
  const meta = getMeta(term);
  let pid;
  try {
    pid = await term.processId;
  } catch {
    pid = undefined;
  }
  const command = pid ? readCmdline(pid) : "";
  const opts = term.creationOptions || {};
  const fromArgs = sessionFromCommand([opts.shellPath || "", ...(opts.shellArgs || [])].join(" "));
  const session = (meta && meta.session) || sessionFromCommand(command) || fromArgs;
  const live = session && sessionExists(session) ? liveCwd(session) : readProcCwd(pid);
  const cwd = chooseCwd(live, (meta && meta.cwd) || cwdFromOptions(term), cwdFromTitle(term.name), defaultCwd());
  if (!session && !cwd) return null;
  return {
    session: session || "",
    cwd,
    name: displayName(term.name, cwd),
  };
}

/**
 * The tabs open in this window. Does not merge the previous file, and does
 * not pull in tmux sessions that no longer have a tab.
 */
async function currentGroups() {
  const terms = vscode.window.terminals;
  if (terms.length === 0) return [];

  const panes = [];
  const used = new Set();
  /** @type {Map<vscode.Terminal, string>} */
  const groupByTerm = new Map();

  for (const term of terms) {
    const info = await inspectTerminal(term);
    if (!info) continue;
    if (info.session && used.has(info.session)) continue;

    if (!info.session) {
      info.session = uniqueSession(stableSessionName(info.cwd), used);
    }
    used.add(info.session);

    const parent = term.creationOptions && term.creationOptions.location && term.creationOptions.location.parentTerminal;
    const groupId = ownTabGroup(info.session, (parent && groupByTerm.get(parent)) || "");
    groupByTerm.set(term, groupId);
    panes.push({ ...info, groupId });
  }

  return groupOpenPanes(panes);
}

async function saveNow(showMessage) {
  if (restoring && !showMessage) return;
  const groups = await currentGroups();
  if (groups.length === 0) {
    if (showMessage) {
      vscode.window.showInformationMessage("Terminal Layouts: no tabs to save.");
    }
    return;
  }

  writeState({
    workspace: workspaceKey(),
    updatedAt: new Date().toISOString(),
    groups,
  });

  if (showMessage) {
    const panes = groups.reduce((n, g) => n + g.panes.length, 0);
    vscode.window.showInformationMessage(
      `Terminal Layouts: saved ${panes} pane(s) in ${groups.length} group(s)`
    );
  }
}

function defaultCwd() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
}

/**
 * @param {{ name?: string, session?: string, cwd?: string, groupId?: string, parent?: vscode.Terminal, show?: boolean }} opts
 */
function openPersistentTerminal(opts) {
  const useTmux = tmuxAvailable();
  const cwd = opts.cwd || defaultCwd();
  const name = opts.name || basename(cwd) || "term";
  const session = opts.session || makeSessionName(name);
  const groupId = opts.groupId || `g-${Date.now().toString(36)}`;

  if (useTmux) ensureSession(session, cwd);

  // Without tmux the tab is a plain shell in the saved folder; the session
  // name is only an id for the layout file.
  /** @type {vscode.TerminalOptions} */
  const options = {
    name,
    cwd,
    ...(useTmux ? { shellPath: "tmux", shellArgs: ["attach-session", "-t", session] } : {}),
    env: {
      [META_ENV]: "1",
      TERMINAL_KEEPER_SESSION: session,
      TERMINAL_KEEPER_CWD: cwd,
      TERMINAL_KEEPER_GROUP: groupId,
    },
  };
  if (opts.parent) options.location = { parentTerminal: opts.parent };

  const term = vscode.window.createTerminal(options);
  tracked.set(term, { session, cwd, name, groupId });
  if (opts.show !== false) term.show(true);
  scheduleSave();
  return term;
}

async function restoreSaved(silent) {
  if (restoring) return;
  restoring = true;

  try {
    const state = readState();
    const groups = refreshCwds(state.groups || [])
      .map((g) => ({
        ...g,
        panes: (g.panes || []).filter((p) => p.session && (sessionExists(p.session) || p.cwd)),
      }))
      .filter((g) => g.panes.length > 0);

    const max = Number(cfg().get("maxRestore")) || 12;
    const actions = restoreActions(groups, max);
    if (actions.length === 0) {
      if (!silent) {
        vscode.window.showInformationMessage(
          "Terminal Layouts: nothing saved. Use Terminal Layouts: New Persistent Terminal."
        );
      }
      return;
    }

    const already = new Set();
    const openCwds = new Set();
    /** @type {Map<string, vscode.Terminal>} */
    const termBySession = new Map();
    for (const term of vscode.window.terminals) {
      const info = await inspectTerminal(term);
      if (info?.cwd) openCwds.add(info.cwd);
      if (!info?.session || already.has(info.session)) continue;
      already.add(info.session);
      termBySession.set(info.session, term);
    }

    /** @type {Map<string, vscode.Terminal>} */
    const parentByGroup = new Map();
    let opened = 0;

    for (const item of actions) {
      if (already.has(item.session)) {
        const existing = termBySession.get(item.session);
        if (existing && !item.split) parentByGroup.set(item.groupId, existing);
        continue;
      }
      // A normal shell we saved has no tmux session yet. If that folder is
      // already open, Cursor revived it. Don't attach a second copy.
      if (!sessionExists(item.session) && item.cwd && openCwds.has(item.cwd)) continue;
      const cwd = (sessionExists(item.session) && liveCwd(item.session)) || item.cwd;
      const parent = item.split ? parentByGroup.get(item.groupId) : undefined;
      const term = openPersistentTerminal({
        name: basename(cwd) || item.name,
        session: item.session,
        cwd,
        groupId: item.groupId,
        parent,
        show: opened === 0,
      });
      if (!term) continue;
      if (!item.split) parentByGroup.set(item.groupId, term);
      already.add(item.session);
      opened += 1;
    }

    if (opened > 0 && !silent) {
      const splits = actions.filter((a) => a.split).length;
      vscode.window.showInformationMessage(
        `Terminal Layouts: restored ${opened} terminal(s), ${splits} split(s).`
      );
    }
    return opened;
  } finally {
    setTimeout(() => {
      restoring = false;
    }, 2000);
  }
}

async function splitActive() {
  const active = vscode.window.activeTerminal;
  const meta = active ? getMeta(active) : null;
  const cwd = (meta?.session && liveCwd(meta.session)) || meta?.cwd || defaultCwd();
  const groupId = meta?.groupId || `g-${Date.now().toString(36)}`;
  const parent = meta ? active : undefined;
  openPersistentTerminal({
    name: basename(cwd),
    cwd,
    groupId,
    parent,
    show: true,
  });
}

function readBookmarks() {
  try {
    if (!fs.existsSync(bookmarksPath())) return { bookmarks: [] };
    const data = JSON.parse(fs.readFileSync(bookmarksPath(), "utf8"));
    return { bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks : [] };
  } catch {
    return { bookmarks: [] };
  }
}

function writeBookmarks(store) {
  const file = bookmarksPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
}

class BookmarkProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
  }

  refresh() {
    this._onDidChange.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren() {
    return readBookmarks().bookmarks.map((bookmark) => {
      const item = new vscode.TreeItem(bookmark.name, vscode.TreeItemCollapsibleState.None);
      item.description = summarize(bookmark.groups);
      item.tooltip = `${bookmark.name}\n${summarize(bookmark.groups)}\n${bookmark.savedAt}`;
      item.contextValue = "bookmark";
      item.iconPath = new vscode.ThemeIcon("terminal");
      item.command = {
        command: "terminalKeeper.loadBookmark",
        title: "Load layout",
        arguments: [bookmark.id],
      };
      return item;
    });
  }
}

/**
 * @param {vscode.ExtensionContext} ctx
 */
function activate(ctx) {
  const bookmarks = new BookmarkProvider();
  registerOptions(ctx, { onSaveNow: () => saveNow(true) });
  ctx.subscriptions.push(
    vscode.window.createTreeView("terminalKeeper.bookmarks", { treeDataProvider: bookmarks })
  );
  ctx.subscriptions.push(
    vscode.commands.registerCommand("terminalKeeper.openPersistent", async () => {
      const cwd = defaultCwd();
      const name = await vscode.window.showInputBox({
        prompt: "Terminal tab name",
        value: basename(cwd) || "dev",
      });
      if (name === undefined) return;
      openPersistentTerminal({ name: name || basename(cwd) || "dev", cwd });
    }),
    vscode.commands.registerCommand("terminalKeeper.split", () => splitActive()),
    vscode.commands.registerCommand("terminalKeeper.restore", () => restoreSaved(false)),
    vscode.commands.registerCommand("terminalKeeper.save", () => saveNow(true)),
    vscode.commands.registerCommand("terminalKeeper.attachExisting", async () => {
      const sessions = listTmuxSessions();
      if (sessions.length === 0) {
        vscode.window.showInformationMessage("No tmux sessions found.");
        return;
      }
      const picked = await vscode.window.showQuickPick(sessions, {
        placeHolder: "Attach which tmux session?",
      });
      if (!picked) return;
      openPersistentTerminal({
        name: picked,
        session: picked,
        cwd: liveCwd(picked) || defaultCwd(),
      });
    }),
    vscode.window.onDidCloseTerminal((term) => {
      tracked.delete(term);
      scheduleSave();
    }),
    vscode.commands.registerCommand("terminalKeeper.saveAllTabs", async () => {
      const groups = await currentGroups();
      const panes = groups.reduce((n, g) => n + (g.panes || []).length, 0);
      if (panes === 0) {
        vscode.window.showInformationMessage("Terminal Layouts: no tabs to save.");
        return;
      }
      const name = await vscode.window.showInputBox({
        prompt: "Name this layout",
        value: summarize(groups),
        placeHolder: "Morning, client work, ...",
      });
      if (name === undefined) return;
      writeBookmarks(addBookmark(readBookmarks(), name, groups));
      bookmarks.refresh();
      vscode.window.showInformationMessage(`Saved layout "${name.trim() || "Untitled"}" (${panes} tabs)`);
    }),
    vscode.commands.registerCommand("terminalKeeper.loadBookmark", async (arg) => {
      const id =
        typeof arg === "string"
          ? arg
          : arg && arg.command && arg.command.arguments && arg.command.arguments[0];
      const bookmark = findBookmark(readBookmarks(), id);
      if (!bookmark) {
        vscode.window.showWarningMessage("That layout is no longer saved.");
        bookmarks.refresh();
        return;
      }
      writeState({
        workspace: workspaceKey(),
        updatedAt: new Date().toISOString(),
        groups: bookmark.groups,
      });
      const opened = (await restoreSaved(true)) || 0;
      vscode.window.showInformationMessage(
        opened > 0
          ? `Opened ${bookmark.name} (${opened} tab${opened === 1 ? "" : "s"})`
          : `${bookmark.name} is already open`
      );
    }),
    vscode.commands.registerCommand("terminalKeeper.deleteBookmark", async (item) => {
      const id = item && item.command && item.command.arguments && item.command.arguments[0];
      const bookmark = id ? findBookmark(readBookmarks(), id) : null;
      if (!bookmark) return;
      const choice = await vscode.window.showWarningMessage(
        `Delete layout "${bookmark.name}"?`,
        { modal: true },
        "Delete"
      );
      if (choice !== "Delete") return;
      writeBookmarks(removeBookmark(readBookmarks(), bookmark.id));
      bookmarks.refresh();
    })
  );

  const poll = setInterval(() => {
    if (cfg().get("autoSave")) saveNow(false);
  }, 5000);
  ctx.subscriptions.push({ dispose: () => clearInterval(poll) });

  if (cfg().get("autoRestore")) {
    const delay = Number(cfg().get("restoreDelayMs")) || 1200;
    setTimeout(() => {
      restoreSaved(true).catch((err) => console.error("Terminal Layouts restore failed", err));
    }, delay);
  }
}

function deactivate() {
  clearTimeout(saveTimer);
  try {
    if (cfg().get("autoSave")) saveNow(false);
  } catch {
    // ignore
  }
}

module.exports = { activate, deactivate };
