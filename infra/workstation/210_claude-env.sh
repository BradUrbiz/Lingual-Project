#!/bin/bash
# Cloud Workstations startup hook (runs as root at container boot).
# Fetches the Claude Code OAuth token from Secret Manager via the
# workstation's service account and exposes it to login shells.
# Deliberately tolerant: a fetch failure must not block workstation boot.

ACCESS_TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | jq -r '.access_token // empty')

if [ -z "$ACCESS_TOKEN" ]; then
  echo "210_claude-env: no metadata token; skipping Claude token setup" >&2
  exit 0
fi

CLAUDE_TOKEN=$(curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/lingu-480600/secrets/claude-code-oauth-token/versions/latest:access" \
  | jq -r '.payload.data // empty' | base64 -d)

if [ -z "$CLAUDE_TOKEN" ]; then
  echo "210_claude-env: secret fetch failed; skipping Claude token setup" >&2
  exit 0
fi

# Secret lands user-readable-only in the dev user's home (runs after
# 010_add-user.sh, so /home/user exists); /etc/profile.d gets a secret-free stub.
umask 077
mkdir -p /home/user/.config
printf 'export CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_TOKEN" > /home/user/.config/claude-token.sh
chown user:user /home/user/.config/claude-token.sh

cat > /etc/profile.d/claude-token.sh <<'EOF'
[ -r "$HOME/.config/claude-token.sh" ] && . "$HOME/.config/claude-token.sh"
EOF
chmod 644 /etc/profile.d/claude-token.sh
