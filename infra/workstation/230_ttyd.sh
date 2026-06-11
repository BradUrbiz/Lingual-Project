#!/bin/bash
# Cloud Workstations startup hook: web terminal for mobile access.
# Exposed at https://7681-<workstation-host>, gated by Google login + IAM
# (workstations.user) via the Cloud Workstations gateway — no extra auth needed.
command -v ttyd >/dev/null || { echo "230_ttyd: ttyd not installed; skipping" >&2; exit 0; }
runuser -u user -- bash -c 'nohup ttyd -p 7681 --writable /usr/local/bin/claude-mobile >/tmp/ttyd.log 2>&1 &'
