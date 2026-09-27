const vscode = require("vscode");

const OPTIONS_VIEW_TYPE = "terminalKeeper.options";
const OPTIONS_PANEL_TYPE = "terminalKeeper.optionsPanel";

function cfg() {
  return vscode.workspace.getConfiguration("terminalKeeper");
}

function readOptions() {
  const c = cfg();
  return {
    autoRestore: c.get("autoRestore") !== false,
    autoSave: c.get("autoSave") === true,
    maxRestore: Number(c.get("maxRestore")) || 12,
    restoreDelayMs: Number(c.get("restoreDelayMs")) || 1200,
    sessionPrefix: String(c.get("sessionPrefix") || "tk"),
  };
}

/**
 * @param {string} key
 * @param {unknown} value
 */
async function writeOption(key, value) {
  await cfg().update(key, value, vscode.ConfigurationTarget.Global);
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function optionsHtml(nonce, values) {
  const { autoRestore, autoSave, maxRestore, restoreDelayMs, sessionPrefix } = values;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Terminal Keeper Options</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; --gap: 14px; --radius: 8px; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 20px 24px 40px;
      max-width: 560px;
    }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 6px; }
    .sub { color: var(--vscode-descriptionForeground); margin: 0 0 22px; line-height: 1.4; }
    .card {
      border: 1px solid var(--vscode-widget-border, rgba(127,127,127,.35));
      border-radius: var(--radius);
      padding: 14px 16px;
      margin-bottom: var(--gap);
      background: var(--vscode-sideBar-background, transparent);
    }
    .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .label { font-weight: 600; margin: 0 0 4px; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 0.92em; line-height: 1.35; margin: 0; }
    .switch { position: relative; width: 40px; height: 22px; flex: 0 0 auto; margin-top: 2px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; inset: 0; cursor: pointer; border-radius: 22px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border, rgba(127,127,127,.45));
      transition: .15s;
    }
    .slider:before {
      content: ""; position: absolute; height: 16px; width: 16px; left: 2px; top: 2px;
      border-radius: 50%; background: var(--vscode-foreground); transition: .15s;
    }
    input:checked + .slider {
      background: var(--vscode-button-background);
      border-color: var(--vscode-button-background);
    }
    input:checked + .slider:before {
      transform: translateX(18px);
      background: var(--vscode-button-foreground);
    }
    .field { display: grid; gap: 6px; margin-top: 10px; }
    .field label { font-weight: 600; }
    input[type="number"], input[type="text"] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, rgba(127,127,127,.45));
      border-radius: 4px; padding: 6px 8px; width: 100%; box-sizing: border-box; font: inherit;
    }
    .status { margin-top: 8px; min-height: 1.2em; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .status.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
    .status.err { color: var(--vscode-errorForeground); }
    .actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    button {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; border-radius: 4px; padding: 7px 12px; font: inherit; cursor: pointer;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    code { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Terminal Keeper</h1>
  <p class="sub">Toggles write straight into your Cursor <code>settings.json</code>.</p>

  <div class="card">
    <div class="row">
      <div>
        <p class="label">Restore saved terminals on reload</p>
        <p class="hint">Default terminal save/restore. Reopens your saved tmux-backed tabs after Reload Window or remote restart.</p>
      </div>
      <label class="switch">
        <input type="checkbox" id="autoRestore" ${autoRestore ? "checked" : ""} />
        <span class="slider"></span>
      </label>
    </div>
  </div>

  <div class="card">
    <div class="row">
      <div>
        <p class="label">Auto-save open tabs</p>
        <p class="hint">Continuously write the current layout to <code>.cursor/terminal-layout.json</code>. Keep this off unless you want every tab change saved automatically.</p>
      </div>
      <label class="switch">
        <input type="checkbox" id="autoSave" ${autoSave ? "checked" : ""} />
        <span class="slider"></span>
      </label>
    </div>
  </div>

  <div class="card">
    <div class="field">
      <label for="maxRestore">Max panes to restore</label>
      <input type="number" id="maxRestore" min="1" max="40" value="${maxRestore}" />
    </div>
    <div class="field">
      <label for="restoreDelayMs">Restore delay (ms)</label>
      <input type="number" id="restoreDelayMs" min="0" max="30000" step="100" value="${restoreDelayMs}" />
    </div>
    <div class="field">
      <label for="sessionPrefix">tmux session prefix</label>
      <input type="text" id="sessionPrefix" value="${escapeAttr(sessionPrefix)}" />
    </div>
  </div>

  <div class="actions">
    <button id="saveNow" type="button">Save tabs now</button>
    <button id="openSettings" class="secondary" type="button">Open in Settings UI</button>
  </div>
  <p class="status" id="status"></p>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const status = document.getElementById("status");
    function flash(msg, ok) {
      status.textContent = msg;
      status.className = "status " + (ok ? "ok" : "err");
    }
    function send(type, key, value) { vscode.postMessage({ type, key, value }); }
    document.getElementById("autoRestore").addEventListener("change", (e) => send("set", "autoRestore", e.target.checked));
    document.getElementById("autoSave").addEventListener("change", (e) => send("set", "autoSave", e.target.checked));
    document.getElementById("maxRestore").addEventListener("change", (e) => send("set", "maxRestore", Number(e.target.value) || 12));
    document.getElementById("restoreDelayMs").addEventListener("change", (e) => send("set", "restoreDelayMs", Number(e.target.value) || 1200));
    document.getElementById("sessionPrefix").addEventListener("change", (e) => send("set", "sessionPrefix", e.target.value || "tk"));
    document.getElementById("saveNow").addEventListener("click", () => send("saveNow"));
    document.getElementById("openSettings").addEventListener("click", () => send("openSettings"));
    window.addEventListener("message", (event) => {
      const msg = event.data || {};
      if (msg.type === "saved") flash("Saved to settings.json", true);
      if (msg.type === "error") flash(msg.message || "Failed to save", false);
      if (msg.type === "values") {
        document.getElementById("autoRestore").checked = !!msg.values.autoRestore;
        document.getElementById("autoSave").checked = !!msg.values.autoSave;
        document.getElementById("maxRestore").value = msg.values.maxRestore;
        document.getElementById("restoreDelayMs").value = msg.values.restoreDelayMs;
        document.getElementById("sessionPrefix").value = msg.values.sessionPrefix;
      }
    });
  </script>
</body>
</html>`;
}

/**
 * @param {vscode.Webview} webview
 * @param {{ onSaveNow?: () => void }} hooks
 */
function wireWebview(webview, hooks, disposables) {
  const render = () => {
    webview.html = optionsHtml(String(Date.now()), readOptions());
  };
  render();

  disposables.push(
    webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.type === "set") {
          await writeOption(msg.key, msg.value);
          webview.postMessage({ type: "saved" });
          webview.postMessage({ type: "values", values: readOptions() });
          return;
        }
        if (msg.type === "saveNow") {
          if (hooks.onSaveNow) hooks.onSaveNow();
          return;
        }
        if (msg.type === "openSettings") {
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "@ext:chris.terminal-keeper"
          );
        }
      } catch (err) {
        webview.postMessage({
          type: "error",
          message: err && err.message ? err.message : String(err),
        });
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("terminalKeeper")) render();
    })
  );
}

/**
 * @param {vscode.ExtensionContext} ctx
 * @param {{ onSaveNow?: () => void }} hooks
 */
function registerOptions(ctx, hooks = {}) {
  /** @type {vscode.WebviewPanel | undefined} */
  let panel;

  const openPanel = () => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Active);
      return panel;
    }
    panel = vscode.window.createWebviewPanel(
      OPTIONS_PANEL_TYPE,
      "Terminal Keeper Options",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const local = [];
    wireWebview(panel.webview, hooks, local);
    panel.onDidDispose(() => {
      for (const d of local) d.dispose();
      panel = undefined;
    });
    return panel;
  };

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(OPTIONS_VIEW_TYPE, {
      resolveWebviewView(webviewView) {
        webviewView.webview.options = { enableScripts: true };
        const local = [];
        wireWebview(webviewView.webview, hooks, local);
        webviewView.onDidDispose(() => {
          for (const d of local) d.dispose();
        });
      },
    }),
    vscode.commands.registerCommand("terminalKeeper.openOptions", () => openPanel())
  );
}

module.exports = {
  OPTIONS_VIEW_TYPE,
  registerOptions,
  readOptions,
  writeOption,
};
