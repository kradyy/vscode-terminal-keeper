"use strict";

const { basename } = require("./layout");

function clone(value) {
  return JSON.parse(JSON.stringify(value || []));
}

function summarize(groups) {
  const names = [];
  for (const group of groups || []) {
    for (const pane of group.panes || []) {
      names.push(pane.name || basename(pane.cwd) || pane.session);
    }
  }
  if (names.length === 0) return "empty";
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

function addBookmark(store, name, groups, nowIso) {
  const savedAt = nowIso || new Date().toISOString();
  const bookmark = {
    id: `${Date.parse(savedAt) || Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: String(name || "").trim() || "Untitled",
    savedAt,
    groups: clone(groups),
  };
  return {
    bookmarks: [bookmark, ...((store && store.bookmarks) || [])],
  };
}

function removeBookmark(store, id) {
  return {
    bookmarks: ((store && store.bookmarks) || []).filter((item) => item.id !== id),
  };
}

function findBookmark(store, id) {
  return ((store && store.bookmarks) || []).find((item) => item.id === id) || null;
}

module.exports = {
  summarize,
  addBookmark,
  removeBookmark,
  findBookmark,
};
