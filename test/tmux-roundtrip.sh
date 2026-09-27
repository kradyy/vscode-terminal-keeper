#!/usr/bin/env bash
# Proves a split layout and the live folder survive detach and a dead session.
set -euo pipefail

root="$(mktemp -d)"
trap 'tmux kill-session -t tk-test-split 2>/dev/null || true; tmux kill-session -t tk-test-rebuilt 2>/dev/null || true; rm -rf "$root"' EXIT

mkdir -p "$root/auto-blogs" "$root/passivebacklinks/nested"

tmux new-session -d -s tk-test-split -c "$root/auto-blogs" -n work
tmux split-window -t tk-test-split -h -c "$root/passivebacklinks"
tmux send-keys -t tk-test-split:0.1 "cd nested" Enter
sleep 0.4

mapfile -t paths < <(tmux list-panes -t tk-test-split -F '#{pane_current_path}')
[[ "${#paths[@]}" -eq 2 ]]
[[ "${paths[0]}" == "$root/auto-blogs" ]]
[[ "${paths[1]}" == "$root/passivebacklinks/nested" ]]

# Cursor/WSL disconnect drops the client. The session has to still be there.
tmux detach-client -s tk-test-split 2>/dev/null || true
tmux has-session -t tk-test-split

# WSL reboot kills tmux. Recreate each pane from the path tmux reported.
saved0="${paths[0]}"
saved1="${paths[1]}"
tmux kill-session -t tk-test-split
if tmux has-session -t tk-test-split 2>/dev/null; then
  echo "session should be dead" >&2
  exit 1
fi

tmux new-session -d -s tk-test-rebuilt -c "$saved0" -n work
tmux split-window -t tk-test-rebuilt -h -c "$saved1"
mapfile -t again < <(tmux list-panes -t tk-test-rebuilt -F '#{pane_current_path}')
[[ "${#again[@]}" -eq 2 ]]
[[ "${again[0]}" == "$root/auto-blogs" ]]
[[ "${again[1]}" == "$root/passivebacklinks/nested" ]]

echo "tmux-roundtrip.sh ok"
