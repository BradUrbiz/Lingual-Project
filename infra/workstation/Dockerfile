# Custom Cloud Workstations image for Lingual development with Claude Code.
# Build:  gcloud builds submit infra/workstation \
#           --tag us-central1-docker.pkg.dev/lingu-480600/workstations/claude-dev:latest
FROM us-central1-docker.pkg.dev/cloud-workstations-images/predefined/base:latest

# Toolchain: python for the Flask backend, Java for Firestore-emulator tests,
# tmux for parallel Claude sessions
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    default-jre-headless \
    tmux ripgrep jq make ttyd \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI (official apt repo — Debian's packaged gh is too old)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Node 22 + Claude Code + firebase-tools
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code firebase-tools

# Startup hooks: Secret Manager injection (Claude token, dev .env), the ttyd
# web terminal for mobile, Claude auto-start, and the activity-aware idle
# watchdog (250). claude-mobile is the ttyd entry command; claude-idle-watchdog
# is the self-stop daemon that replaces the connection-based idleTimeout.
COPY 205_bind-repo.sh 210_claude-env.sh 220_lingual-env.sh 230_ttyd.sh 240_claude-session.sh 250_watchdog.sh /etc/workstation-startup.d/
COPY claude-mobile claude-idle-watchdog /usr/local/bin/
RUN chmod +x /etc/workstation-startup.d/205_bind-repo.sh \
    /etc/workstation-startup.d/210_claude-env.sh \
    /etc/workstation-startup.d/220_lingual-env.sh \
    /etc/workstation-startup.d/230_ttyd.sh \
    /etc/workstation-startup.d/240_claude-session.sh \
    /etc/workstation-startup.d/250_watchdog.sh \
    /usr/local/bin/claude-mobile \
    /usr/local/bin/claude-idle-watchdog
