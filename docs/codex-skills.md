# Codex Skills Catalog

This document summarizes the skills currently available in this Codex environment and their intended functions.

| Skill | Function | Path |
| --- | --- | --- |
| atlas | AppleScript control for the ChatGPT Atlas desktop app on macOS. Use only when explicitly asked to control Atlas tabs/bookmarks/history. | /Users/new/.codex/skills/atlas/SKILL.md |
| code-architect | Design an actionable architecture blueprint for a new feature that fits existing codebase patterns (feature-dev Phase 4). | /Users/new/.codex/skills/code-architect/SKILL.md |
| code-explorer | Deeply analyze a codebase area by tracing execution paths, mapping architecture layers, and listing key files (feature-dev Phase 2). | /Users/new/.codex/skills/code-explorer/SKILL.md |
| code-reviewer | Review code changes for correctness, security, and project-convention fit using confidence-based filtering (feature-dev Phase 6). | /Users/new/.codex/skills/code-reviewer/SKILL.md |
| coderabbit-review | Run a full diff-based code review similar to CodeRabbit using `codex review` (uncommitted, vs base branch, or a commit). | /Users/new/.codex/skills/coderabbit-review/SKILL.md |
| codex-readiness-integration-test | Run the Codex Readiness integration test (end-to-end agentic loop with build/test scoring). | /Users/new/.codex/skills/codex-readiness-integration-test/SKILL.md |
| codex-readiness-unit-test | Run the Codex Readiness unit test report (deterministic checks plus in-session LLM evals for AGENTS.md/PLANS.md). | /Users/new/.codex/skills/codex-readiness-unit-test/SKILL.md |
| create-plan | Create a concise plan when a user explicitly asks for a plan related to a coding task. | /Users/new/.codex/skills/create-plan/SKILL.md |
| design-md | Analyze Stitch projects and synthesize a semantic design system into DESIGN.md files. | /Users/new/.codex/skills/design-md/SKILL.md |
| develop-web-game | Web game dev workflow with Playwright-based test loop and rendering checks for small iterative changes. | /Users/new/.codex/skills/develop-web-game/SKILL.md |
| doc | Read, create, or edit `.docx` files with formatting/layout fidelity using python-docx and render checks. | /Users/new/.codex/skills/doc/SKILL.md |
| figma | Use the Figma MCP server to fetch design context, screenshots, variables, and assets for design-to-code work. | /Users/new/.codex/skills/figma/SKILL.md |
| figma-implement-design | Translate Figma nodes into production-ready code with 1:1 visual fidelity using the Figma MCP workflow. | /Users/new/.codex/skills/figma-implement-design/SKILL.md |
| frontend-design | Create distinctive, production-grade frontend interfaces with high design quality (components/pages/UX). | /Users/new/.codex/skills/frontend-design/SKILL.md |
| gh-address-comments | Address comments on the open GitHub PR using `gh` CLI; verify auth before proceeding. | /Users/new/.codex/skills/gh-address-comments/SKILL.md |
| gh-fix-ci | Debug failing GitHub Actions checks using `gh`; summarize failures and propose fix plan before changes. | /Users/new/.codex/skills/gh-fix-ci/SKILL.md |
| jupyter-notebook | Create, scaffold, or edit Jupyter notebooks using bundled templates and helper scripts. | /Users/new/.codex/skills/jupyter-notebook/SKILL.md |
| openai-docs | Answer OpenAI API/product questions using official OpenAI docs with citations. | /Users/new/.codex/skills/openai-docs/SKILL.md |
| pdf | Read, create, or review PDFs with visual checks and Python tooling. | /Users/new/.codex/skills/pdf/SKILL.md |
| playwright | Automate real browsers from the terminal (navigation, form filling, screenshots, data extraction). | /Users/new/.codex/skills/playwright/SKILL.md |
| screenshot | Capture desktop/system screenshots (full screen, specific app, or region). | /Users/new/.codex/skills/screenshot/SKILL.md |
| speech | Generate text-to-speech audio via OpenAI Audio API using bundled CLI; requires `OPENAI_API_KEY`. | /Users/new/.codex/skills/speech/SKILL.md |
| spreadsheet | Create, edit, or analyze spreadsheets (`.xlsx`, `.csv`, `.tsv`) with formulas and formatting preserved. | /Users/new/.codex/skills/spreadsheet/SKILL.md |
| transcribe | Transcribe audio/video to text with optional diarization and known-speaker hints. | /Users/new/.codex/skills/transcribe/SKILL.md |
| ui-ux-pro-max | UI/UX design intelligence with style palettes, font pairings, layouts, and component guidance. | /Users/new/.codex/skills/ui-ux-pro-max/SKILL.md |
| web-artifacts-builder | Build elaborate multi-component web artifacts (React/Tailwind/shadcn) with state and routing. | /Users/new/.codex/skills/web-artifacts-builder/SKILL.md |
| skill-creator | Guide for creating or updating skills that extend Codex capabilities. | /Users/new/.codex/skills/.system/skill-creator/SKILL.md |
| skill-installer | Install skills into `$CODEX_HOME/skills` from curated lists or GitHub repos. | /Users/new/.codex/skills/.system/skill-installer/SKILL.md |

