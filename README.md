# Terminal Keeper

Persistent terminal tabs for VS Code and Cursor, backed by tmux. For when your agents each have a terminal and you are tired of opening them again.

You leave a tab in the scheduler, a split on the client repo, another one wherever the last agent was working. Reload the window, close the editor, or lose the SSH/WSL connection, and that setup is gone. Terminal Keeper keeps the tabs and the folders, and lets you bookmark a whole set the way you would bookmark tabs in a browser.

Works in VS Code, Cursor, and other VS Code-based editors, locally or over Remote SSH / WSL.

![Saved terminal layouts](media/layouts-pane.png)

## Save what you have open

The **Layouts** pane sits in the bottom panel, next to Terminal.

- **Save all tabs** stores the tabs and folders open right now, under a name you choose.
- Click a name to open that set again. Tabs you already have stay open.
- The trash icon deletes a saved layout.

Auto-save of the live setup is **off by default**. Turn it on from **Terminal Keeper: Options** (or the Options tab in the Layouts pane) if you want every tab change written to `.cursor/terminal-layout.json`. Named layouts via **Save all tabs** still work either way.

**Ctrl+Shift+5** splits the current tab and keeps the new pane in the same folder.

## Options

Command Palette → **Terminal Keeper: Options**, or the **Options** tab next to Saved layouts.

- **Restore saved terminals on reload** → `terminalKeeper.autoRestore` in `settings.json`
- **Auto-save open tabs** → `terminalKeeper.autoSave` (default off)
- Max panes, restore delay, tmux prefix

The panel **+** button is a normal shell. Save and auto-save record that tab and the folder it is in. The next restore opens it as a persistent tab. Closed tabs are dropped, even if their tmux session is still running.

## Install

You need `tmux` on the machine where the terminals run (the remote host when using Remote SSH or WSL).

From the marketplace: search for **Terminal Keeper** in the Extensions view.

From source:

```bash
bash install.sh
```

The script picks the extensions folder of whichever editor it finds (VS Code, VS Code Server, Cursor).

Reload the window. The first time, use **Terminal Keeper: New Persistent Terminal** so a tab is one Terminal Keeper knows about.

## How it works

Each persistent tab is a tmux session. Layouts are stored in `<workspace>/.cursor/terminal-bookmarks.json` and the live tabs in `<workspace>/.cursor/terminal-layout.json`. The same directory is used in every editor, so a layout saved in VS Code opens in Cursor and vice versa.

If tmux is still running after the editor dies, the next open reattaches those same panes. If the host itself shuts down, the folders come back and the processes that were running do not.
