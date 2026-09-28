"use strict";

const assert = require("assert");
const { migrate, withLiveCwds, restoreActions, mergeAttachedSessions, sessionFromCommand, displayName, chooseCwd, ownTabGroup, groupOpenPanes } = require("../layout");

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

assert.strictEqual(
  sessionFromCommand("/usr/bin/tmux attach-session -t tk-projects-glasvik"),
  "tk-projects-glasvik"
);
assert.strictEqual(
  sessionFromCommand("tmux\0attach-session\0-t\0claude-aicasts-11083617df"),
  "claude-aicasts-11083617df"
);
assert.strictEqual(sessionFromCommand("/usr/bin/bash --init-file shellIntegration-bash.sh"), "");

// Open tabs replace the old file. xgorithm is closed, algorithm is a normal shell.
// A second attach of the same session (Cursor revived it, then we attached again) is one tab.
const openNow = groupOpenPanes([
  {
    session: "tk-projects-agent-scheduler",
    cwd: "/home/chris/projects/agent-scheduler",
    groupId: "tk-projects-agent-scheduler",
  },
  {
    session: "tk-projects-algorithm",
    cwd: "/home/chris/projects/algorithm",
    groupId: "tk-projects-algorithm",
  },
  {
    session: "tk-projects-agent-scheduler",
    cwd: "/home/chris/projects/agent-scheduler",
    groupId: "projects-split",
  },
  {
    session: "claude-aicasts-11083617df",
    cwd: "/home/chris/projects/aicasts",
    groupId: "claude-aicasts-11083617df",
  },
]);
assert.strictEqual(openNow.length, 3);
assert.strictEqual(openNow[1].panes[0].name, "algorithm");
assert.strictEqual(openNow[0].panes.length, 1, "duplicate attach is not a second pane");
assert.ok(!JSON.stringify(openNow).includes("xgorithm"));
assert.ok(!JSON.stringify(openNow).includes("projects-split"));

assert.strictEqual(displayName("algorithm", "/home/chris/projects"), "algorithm");
assert.strictEqual(displayName("bash", "/home/chris/projects/glasvik"), "glasvik");
assert.strictEqual(displayName("claude", "/home/chris/projects/directory-submitter"), "claude");
assert.strictEqual(
  chooseCwd("/home/chris/projects", "", "/home/chris/projects/algorithm", "/home/chris/projects"),
  "/home/chris/projects/algorithm"
);
assert.strictEqual(
  chooseCwd("/home/chris/projects/glasvik", "/tmp", "", "/home/chris/projects"),
  "/home/chris/projects/glasvik"
);
assert.strictEqual(ownTabGroup("tk-projects-glasvik", ""), "tk-projects-glasvik");
assert.strictEqual(ownTabGroup("tk-projects-glasvik", "tk-projects-agent-scheduler"), "tk-projects-agent-scheduler");

const separate = groupOpenPanes([
  { session: "tk-projects-agent-scheduler", cwd: "/home/chris/projects/agent-scheduler", name: "agent-scheduler", groupId: ownTabGroup("tk-projects-agent-scheduler", "") },
  { session: "tk-projects-glasvik", cwd: "/home/chris/projects/glasvik", name: "glasvik", groupId: ownTabGroup("tk-projects-glasvik", "") },
]);
assert.strictEqual(separate.length, 2, "tabs that are not splits stay separate");

console.log("layout.test.js ok");
