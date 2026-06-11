#!/bin/bash
# Cloud Workstations startup hook: auto-start a Claude Code session in the
# shared tmux session at boot, with remote control requested as the first
# input — so starting the workstation from the mobile control page is enough
# to make the session appear in the Claude mobile app.
# Runs after 205 (repo bind mount) and 210 (token injection).

runuser -u user -- bash -lc '
  tmux has-session -t work 2>/dev/null && exit 0
  cd /Users/new/Documents/GitHub/Lingual-U/Lingual-Project || cd "$HOME"
  tmux new-session -ds work "claude \"/remote-control\""
' || echo "240_claude-session: failed to start session" >&2
