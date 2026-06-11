#!/bin/bash
# Cloud Workstations startup hook (runs as root at container boot).
# Renders the Lingual dev .env and service-account.json from Secret Manager
# into the repo checkout, so app secrets are centrally managed instead of
# living as stale file copies. Tolerant: failures must not block boot.

REPO_DIR=/Users/new/Documents/GitHub/Lingual-U/Lingual-Project
PROJECT=lingu-480600

ACCESS_TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | jq -r '.access_token // empty')

if [ -z "$ACCESS_TOKEN" ]; then
  echo "220_lingual-env: no metadata token; skipping" >&2
  exit 0
fi

fetch_secret() {
  curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/$1/versions/latest:access" \
    | jq -r '.payload.data // empty' | base64 -d
}

mkdir -p "$REPO_DIR"
umask 077

DOTENV=$(fetch_secret dev-dotenv)
if [ -n "$DOTENV" ]; then
  printf '%s\n' "$DOTENV" > "$REPO_DIR/.env"
  chown user:user "$REPO_DIR/.env"
  chmod 600 "$REPO_DIR/.env"
else
  echo "220_lingual-env: dev-dotenv fetch failed; keeping existing .env" >&2
fi

SA_JSON=$(fetch_secret dev-service-account-json)
if [ -n "$SA_JSON" ]; then
  printf '%s\n' "$SA_JSON" > "$REPO_DIR/service-account.json"
  chown user:user "$REPO_DIR/service-account.json"
  chmod 600 "$REPO_DIR/service-account.json"
else
  echo "220_lingual-env: dev-service-account-json fetch failed; keeping existing file" >&2
fi
