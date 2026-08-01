#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"
uv run --locked pytest -q
uv run --locked ruff check .
uv run --locked ruff format --check .

cd "$repo_root/examples/typescript/task-runner"
bun install --frozen-lockfile
bun run check
