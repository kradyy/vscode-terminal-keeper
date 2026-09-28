"use strict";

function basename(cwd) {
  const parts = String(cwd || "")
    .split(/[/\\]/)
    .filter(Boolean);
  return parts[parts.length - 1] || "";
}

/** Old state was a flat tab list. Those stay separate tabs. */
function migrate(state) {
  const src = state && typeof state === "object" ? state : {};
  if (Array.isArray(src.groups)) return src;
  const groups = (src.terminals || [])
    .filter((t) => t && t.session)
    .map((t) => ({
      id: t.session,
      panes: [
        {
          name: t.name || basename(t.cwd) || t.session,
          session: t.session,
          cwd: t.cwd || "",
        },
      ],
    }));
  return {
    workspace: src.workspace || "",
    updatedAt: src.updatedAt || "",
    groups,
  };
}

/** Live tmux path wins over the folder the tab was opened in. */
function withLiveCwds(groups, cwdBySession) {
  const live = cwdBySession || {};
  return (groups || []).map((g) => ({
    ...g,
    panes: (g.panes || []).map((p) => {
      const cwd = live[p.session] || p.cwd || "";
      return {
        ...p,
        cwd,
        name: basename(cwd) || p.name || p.session,
      };
    }),
  }));
}

/**
 * First pane of a group is a tab. The rest are splits of that tab.
 * maxPanes stops after a whole pane, and never starts a group it cannot finish
 * if the group itself fits. A group larger than maxPanes is truncated.
 */
function restoreActions(groups, maxPanes) {
  const cap = Number(maxPanes) > 0 ? Number(maxPanes) : 12;
  const actions = [];
  for (const g of groups || []) {
    const panes = g.panes || [];
    if (panes.length === 0) continue;
    if (actions.length >= cap) break;
    panes.forEach((p, i) => {
      if (actions.length >= cap) return;
      actions.push({
        groupId: g.id,
        name: p.name || basename(p.cwd) || p.session,
        session: p.session,
        cwd: p.cwd || "",
        split: i > 0,
      });
    });
  }
  return actions;
}

/** Tab title wins. A generic shell name falls back to the folder. */
function displayName(title, cwd) {
  const t = String(title || "").trim();
  const folder = basename(cwd);
  if (!t || /^(bash|sh|zsh|fish|tmux|powershell|pwsh)$/i.test(t)) return folder || t || "term";
  return t;
}

/**
 * A live folder that is not the workspace root wins.
 * Otherwise the folder the tab was opened in, then a folder matching the tab title.
 */
function chooseCwd(live, created, titled, workspace) {
  const root = workspace || "";
  if (live && live !== root) return live;
  if (created && created !== root) return created;
  if (titled && titled !== root) return titled;
  return live || created || titled || "";
}

/** A split shares its parent's group. Every other tab is its own group. */
function ownTabGroup(session, parentGroupId) {
  return parentGroupId || session;
}

/** `tmux attach-session -t <name>` from a process command line or shell args. */
function sessionFromCommand(command) {
  const text = String(command || "")
    .replace(/\0/g, " ")
    .trim();
  const match = text.match(/(?:^|[\s/])tmux\s+attach(?:-session)?(?:\s+-\S+)*\s+-t\s+(\S+)/);
  return match ? match[1] : "";
}

/**
 * Tabs open right now, in order. The same session twice (Cursor revived it,
 * then Terminal Keeper attached again) is stored once. groupId ties splits
 * together; without one, the pane is its own tab.
 * This does not look at the previous file. Closed sessions stay closed.
 */
function groupOpenPanes(panes) {
  const groups = [];
  const byId = new Map();
  const seen = new Set();
  for (const pane of panes || []) {
    if (!pane || !pane.session || seen.has(pane.session)) continue;
    seen.add(pane.session);
    const id = pane.groupId || pane.session;
    if (!byId.has(id)) {
      const group = { id, panes: [] };
      byId.set(id, group);
      groups.push(group);
    }
    byId.get(id).panes.push({
      name: pane.name || basename(pane.cwd) || pane.session,
      session: pane.session,
      cwd: pane.cwd || "",
    });
  }
  return groups;
}

/**
 * Attached tmux sessions that are not already in the layout become their own tabs.
 * Existing groups stay as they are, including splits.
 */
function mergeAttachedSessions(groups, attached) {
  const known = new Set();
  for (const g of groups || []) {
    for (const p of g.panes || []) {
      if (p.session) known.add(p.session);
    }
  }
  const next = (groups || []).map((g) => ({
    ...g,
    panes: (g.panes || []).map((p) => ({ ...p })),
  }));
  for (const item of attached || []) {
    if (!item || !item.session || known.has(item.session)) continue;
    known.add(item.session);
    next.push({
      id: item.session,
      panes: [
        {
          name: basename(item.cwd) || item.session,
          session: item.session,
          cwd: item.cwd || "",
        },
      ],
    });
  }
  return next;
}

module.exports = {
  basename,
  migrate,
  withLiveCwds,
  restoreActions,
  sessionFromCommand,
  displayName,
  chooseCwd,
  ownTabGroup,
  groupOpenPanes,
  mergeAttachedSessions,
};
