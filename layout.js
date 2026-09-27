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
  mergeAttachedSessions,
};
