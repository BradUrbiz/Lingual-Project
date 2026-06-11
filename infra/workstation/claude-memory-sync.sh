#!/bin/bash
# Bidirectional sync of this project's Claude Code memory + session history
# between this machine and the GCS hub bucket. Works identically on the Mac
# and the Cloud Workstation (each side syncs itself against the hub).
#
#   First run on a new machine:  claude-memory-sync.sh --resync
#   Normal run:                  claude-memory-sync.sh
#
# Conflict policy: newer file wins; the loser is kept as a renamed
# .conflict copy. Session .jsonl files are single-writer per machine,
# so real conflicts can only come from memory/*.md edits on both sides.
set -e

# Hook-safe: hooks run with a minimal PATH; cover Homebrew and ~/.local/bin
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
command -v rclone >/dev/null || { echo "rclone not installed; skipping sync"; exit 0; }

KEY="-Users-new-Documents-GitHub-Lingual-U-Lingual-Project"
LOCAL="$HOME/.claude/projects/$KEY"
REMOTE=":gcs,env_auth,bucket_policy_only=true:lingu-480600-claude-state/projects/$KEY"

exec rclone bisync "$LOCAL" "$REMOTE" \
  --conflict-resolve newer \
  --create-empty-src-dirs \
  --resilient \
  "$@"
