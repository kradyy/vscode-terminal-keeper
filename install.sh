#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PUBLISHER="kradyy"
NAME="terminal-keeper"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
EXT_ID="${PUBLISHER}.${NAME}-${VERSION}"

DEST_BASE=""
for d in "$HOME/.cursor-server/extensions" "$HOME/.cursor/extensions" "$HOME/.vscode-server/extensions"; do
  if [[ -d "$d" ]]; then
    DEST_BASE="$d"
    break
  fi
done

if [[ -z "$DEST_BASE" ]]; then
  DEST_BASE="$HOME/.cursor-server/extensions"
  mkdir -p "$DEST_BASE"
fi

# Remove any older versions of this extension
find "$DEST_BASE" -maxdepth 1 -type d -name "${PUBLISHER}.${NAME}-*" -exec rm -rf {} +

DEST="$DEST_BASE/$EXT_ID"
mkdir -p "$DEST"
mkdir -p "$DEST/media"
cp "$ROOT/package.json" "$ROOT/extension.js" "$ROOT/layout.js" "$ROOT/bookmarks.js" "$ROOT/options.js" "$ROOT/README.md" "$ROOT/tk-shell" "$DEST/"
cp "$ROOT/media/layouts.svg" "$DEST/media/"
chmod +x "$DEST/tk-shell"

EXT_JSON="$DEST_BASE/extensions.json"
export EXT_JSON EXT_ID VERSION DEST
node <<'EOF'
const fs = require("fs");
const p = process.env.EXT_JSON;
const id = "kradyy.terminal-keeper";
const version = process.env.VERSION;
const dest = process.env.DEST;
const relative = process.env.EXT_ID;
let data = [];
try {
  data = JSON.parse(fs.readFileSync(p, "utf8"));
} catch {}
if (!Array.isArray(data)) data = [];
data = data.filter((e) => !(e && e.identifier && e.identifier.id === id));
data.push({
  identifier: { id },
  version,
  location: { $mid: 1, fsPath: dest, path: dest, scheme: "file" },
  relativeLocation: relative,
  metadata: {
    isApplicationScoped: false,
    isMachineScoped: false,
    isBuiltin: false,
    installedTimestamp: Date.now(),
  },
});
fs.writeFileSync(p, JSON.stringify(data));
EOF

echo "Installed $EXT_ID -> $DEST"
echo "Next: Command Palette -> Developer: Reload Window"
echo "Then: Terminal Keeper: New Persistent Terminal"
