const test = require("node:test");
const assert = require("node:assert/strict");

// options.js requires vscode at load time, so we stub the module cache.
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return {
      ConfigurationTarget: { Global: 1 },
      workspace: {
        getConfiguration() {
          return {
            get(key) {
              if (key === "autoRestore") return true;
              if (key === "autoSave") return false;
              if (key === "maxRestore") return 12;
              if (key === "restoreDelayMs") return 1200;
              if (key === "sessionPrefix") return "tk";
              return undefined;
            },
            async update() {},
          };
        },
        onDidChangeConfiguration() {
          return { dispose() {} };
        },
      },
      window: {
        registerWebviewViewProvider() {
          return { dispose() {} };
        },
        createWebviewPanel() {
          return {
            webview: {
              html: "",
              onDidReceiveMessage() {
                return { dispose() {} };
              },
              postMessage() {},
            },
            reveal() {},
            onDidDispose() {
              return { dispose() {} };
            },
          };
        },
      },
      commands: {
        registerCommand() {
          return { dispose() {} };
        },
        executeCommand() {},
      },
      ViewColumn: { Active: 1 },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { readOptions } = require("../options");

test("readOptions defaults autoSave off and autoRestore on", () => {
  const values = readOptions();
  assert.equal(values.autoRestore, true);
  assert.equal(values.autoSave, false);
  assert.equal(values.maxRestore, 12);
  assert.equal(values.sessionPrefix, "tk");
});
