"use strict";

const assert = require("assert");
const { migrate, withLiveCwds, restoreActions, mergeAttachedSessions } = require("../layout");

const saved = {
  workspace: "/home/chris/projects",
  groups: [
    {
      id: "split-1",
      panes: [
        { name: "old", session: "tk-a", cwd: "/home/chris/projects" },
        { name: "old", session: "tk-b", cwd: "/home/chris/projects/agent-scheduler" },
      ],
    },
  ],
};

const actions = restoreActions(
  withLiveCwds(saved.groups, {
    "tk-a": "/home/chris/projects/auto-blogs",
    "tk-b": "/home/chris/projects/passivebacklinks",
  }),
  6
);

assert.strictEqual(actions.length, 2);
assert.strictEqual(actions[0].split, false);
assert.strictEqual(actions[1].split, true);
assert.strictEqual(actions[0].cwd, "/home/chris/projects/auto-blogs");
assert.strictEqual(actions[1].cwd, "/home/chris/projects/passivebacklinks");
assert.strictEqual(actions[0].name, "auto-blogs");
assert.strictEqual(actions[1].name, "passivebacklinks");
assert.notStrictEqual(actions[0].cwd, "/home/chris/projects");

const flat = migrate({
  terminals: [
    { name: "bash-x", session: "tk-x", cwd: "/tmp/x" },
    { name: "bash-y", session: "tk-y", cwd: "/tmp/y" },
  ],
});
const flatActions = restoreActions(flat.groups, 6);
assert.strictEqual(flatActions[0].split, false);
assert.strictEqual(flatActions[1].split, false, "old flat tabs must not become one split");

const capped = restoreActions(
  [
    {
      id: "g",
      panes: [
        { session: "a", cwd: "/a" },
        { session: "b", cwd: "/b" },
        { session: "c", cwd: "/c" },
      ],
    },
  ],
  2
);
assert.strictEqual(capped.length, 2);
assert.strictEqual(capped[1].split, true);
assert.strictEqual(capped[1].cwd, "/b");

const withNew = mergeAttachedSessions(saved.groups, [
  { session: "tk-a", cwd: "/home/chris/projects/auto-blogs" },
  { session: "claude-aicasts-11083617df", cwd: "/home/chris/projects/aicasts" },
]);
assert.strictEqual(withNew.length, 2);
assert.strictEqual(withNew[0].panes.length, 2, "existing split stays one group");
assert.strictEqual(withNew[1].id, "claude-aicasts-11083617df");
assert.strictEqual(withNew[1].panes[0].cwd, "/home/chris/projects/aicasts");
const added = restoreActions(withNew, 12);
assert.strictEqual(added[2].split, false, "a newly attached session is its own tab");
assert.strictEqual(added[2].name, "aicasts");

console.log("layout.test.js ok");
