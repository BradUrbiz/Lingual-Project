#!/bin/bash
# Cloud Workstations startup hook: launch the activity-aware idle watchdog.
# Replaces the disabled connection-based idleTimeout (set to 0 on the config)
# with self-stop that keeps the VM up while Claude is actually working.
# Runs after 240 (Claude tmux session started) so the pane exists to sample.
# Runs as root: needs to read all processes, the metadata server, and call the
# Workstations stop API. Tolerant — must never block boot.
command -v /usr/local/bin/claude-idle-watchdog >/dev/null \
  || { echo "250_watchdog: watchdog missing; skipping" >&2; exit 0; }
nohup /usr/local/bin/claude-idle-watchdog >/tmp/watchdog.log 2>&1 &
echo "250_watchdog: launched (pid $!)"
