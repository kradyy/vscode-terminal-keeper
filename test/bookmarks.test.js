"use strict";

const assert = require("assert");
const { addBookmark, removeBookmark, findBookmark, summarize } = require("../bookmarks");

const groups = [
  {
    id: "projects-split",
    panes: [
      { name: "agent-scheduler", session: "tk-a", cwd: "/home/chris/projects/agent-scheduler" },
      { name: "auto-blogs", session: "tk-b", cwd: "/home/chris/projects/auto-blogs" },
      { name: "glasvik", session: "tk-c", cwd: "/home/chris/projects/glasvik" },
    ],
  },
  {
    id: "aicasts",
    panes: [{ name: "aicasts", session: "claude-aicasts", cwd: "/home/chris/projects/aicasts" }],
  },
];

const saved = addBookmark({ bookmarks: [] }, "Morning", groups, "2026-09-27T09:12:00.000Z");
assert.strictEqual(saved.bookmarks.length, 1);
assert.strictEqual(saved.bookmarks[0].name, "Morning");
assert.strictEqual(saved.bookmarks[0].groups[0].panes.length, 3);
assert.strictEqual(summarize(saved.bookmarks[0].groups), "agent-scheduler, auto-blogs, glasvik, aicasts");

groups[0].panes[0].cwd = "/tmp/changed";
assert.strictEqual(
  saved.bookmarks[0].groups[0].panes[0].cwd,
  "/home/chris/projects/agent-scheduler",
  "a bookmark must keep the folders from the moment it was saved"
);

const second = addBookmark(saved, "Later", groups, "2026-09-27T10:00:00.000Z");
assert.strictEqual(second.bookmarks[0].name, "Later");
assert.strictEqual(second.bookmarks[1].name, "Morning");

const id = second.bookmarks[1].id;
assert.strictEqual(findBookmark(second, id).name, "Morning");
const removed = removeBookmark(second, id);
assert.strictEqual(removed.bookmarks.length, 1);
assert.strictEqual(findBookmark(removed, id), null);

console.log("bookmarks.test.js ok");
