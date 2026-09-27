const vscode = require("vscode");
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { basename, migrate, withLiveCwds, restoreActions, mergeAttachedSessions } = require("./layout");
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

function collectGroups() {
  /** @type {Map<string, {id: string, panes: Array<{name: string, session: string, cwd: string}>}>} */
  const groups = new Map();
  const seen = new Set();
  for (const term of vscode.window.terminals) {
    const meta = getMeta(term);
    if (!meta?.session || seen.has(meta.session)) continue;
    seen.add(meta.session);
    const id = meta.groupId || meta.session;
    if (!groups.has(id)) groups.set(id, { id, panes: [] });
    groups.get(id).panes.push({
      name: meta.name || term.name || meta.session,
      session: meta.session,
      cwd: meta.cwd || "",
    });
  }
  return [...groups.values()];
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
  if (!cfg().get("autoSave")) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(false), 500);
}

function listAttachedSessions() {
  try {
    const out = execFileSync(
      "tmux",
      ["list-sessions", "-F", "#{session_attached}\t#{session_name}"],
      { encoding: "utf8" }
    );
    const attached = [];
    for (const line of out.split("\n")) {
      const [count, name] = line.split("\t");
      if (!name || Number(count) < 1) continue;
      const cwd = liveCwd(name);
      if (!cwd) continue;
      attached.push({ session: name, cwd });
    }
    return attached;
  } catch {
    return [];
  }
}

function currentGroups() {
  const open = refreshCwds(collectGroups());
  const prev = readState();
  let groups = open;

  if (open.length === 0) {
    groups = (prev.groups || [])
      .map((g) => ({
        ...g,
        panes: (g.panes || []).filter((p) => p.session && sessionExists(p.session)),
      }))
      .filter((g) => g.panes.length > 0);
  } else {
    const byId = new Map();
    for (const g of prev.groups || []) {
      const panes = (g.panes || []).filter((p) => p.session && sessionExists(p.session));
      if (panes.length) byId.set(g.id, { ...g, panes });
    }
    for (const g of open) byId.set(g.id, g);
    groups = [...byId.values()];
  }

  return refreshCwds(mergeAttachedSessions(groups, listAttachedSessions()));
}

function saveNow(showMessage) {
  const groups = currentGroups();
  if (groups.length === 0 && !showMessage) return;

  writeState({
    workspace: workspaceKey(),
    updatedAt: new Date().toISOString(),
    groups,
  });

  if (showMessage) {
    const panes = groups.reduce((n, g) => n + g.panes.length, 0);
    vscode.window.showInformationMessage(
      `Terminal Keeper: saved ${panes} pane(s) in ${groups.length} group(s)`
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
  if (!tmuxAvailable()) {
    vscode.window.showErrorMessage("Terminal Keeper needs tmux.");
    return null;
  }

  const cwd = opts.cwd || defaultCwd();
  const name = opts.name || basename(cwd) || "term";
  const session = opts.session || makeSessionName(name);
  const groupId = opts.groupId || `g-${Date.now().toString(36)}`;

  ensureSession(session, cwd);

  /** @type {vscode.TerminalOptions} */
  const options = {
    name,
    cwd,
    shellPath: "tmux",
    shellArgs: ["attach-session", "-t", session],
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
  if (!tmuxAvailable()) return;
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
          "Terminal Keeper: nothing saved. Use Terminal Keeper: New Persistent Terminal."
        );
      }
      return;
    }

    const already = new Set();
    for (const term of vscode.window.terminals) {
      const m = getMeta(term);
      if (m?.session) already.add(m.session);
    }

    /** @type {Map<string, vscode.Terminal>} */
    const parentByGroup = new Map();
    let opened = 0;

    for (const item of actions) {
      if (already.has(item.session)) {
        const existing = [...tracked.entries()].find(([, m]) => m.session === item.session);
        if (existing && !item.split) parentByGroup.set(item.groupId, existing[0]);
        continue;
      }
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
        `Terminal Keeper: restored ${opened} terminal(s), ${splits} split(s).`
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
      const groups = currentGroups();
      const panes = groups.reduce((n, g) => n + (g.panes || []).length, 0);
      if (panes === 0) {
        vscode.window.showInformationMessage("Terminal Keeper: no tabs to save.");
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
      restoreSaved(true).catch((err) => console.error("Terminal Keeper restore failed", err));
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
