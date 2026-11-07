#!/usr/bin/env bash
# install-hooks.sh — install this repo's git hooks into .git/hooks/.
#
# Copies scripts/hooks/* into the active hooks directory and marks them
# executable. Run once per clone (on asker, and on the Windows work VM under
# Git Bash). Re-running is safe and idempotent — it overwrites with the
# checked-in source, which is the single source of truth.
#
# Why copy rather than symlink: symlinks are unreliable under Git Bash on
# Windows, and core.hooksPath would point git at a tracked dir but silently
# skip hooks that aren't executable. A plain copy + chmod works everywhere.
#
# Degrade-don't-break (D11): exits non-zero with a clear message if it can't
# find the repo or the source hooks, never half-installs silently.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$HERE/hooks"

repo_root="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
    echo "install-hooks: not inside a git repo; aborting." >&2
    exit 2
fi

hooks_dir="$(git -C "$repo_root" rev-parse --git-path hooks)"
# --git-path returns a path relative to repo root for a normal clone, but can
# be absolute (e.g. linked worktrees). Only prefix when it's relative.
case "$hooks_dir" in
    /*) : ;;                          # already absolute
    *)  hooks_dir="$repo_root/$hooks_dir" ;;
esac
if [ ! -d "$SRC_DIR" ]; then
    echo "install-hooks: source dir $SRC_DIR missing; aborting." >&2
    exit 2
fi

mkdir -p "$hooks_dir"
installed=0
for src in "$SRC_DIR"/*; do
    [ -f "$src" ] || continue
    name="$(basename "$src")"
    cp "$src" "$hooks_dir/$name"
    chmod +x "$hooks_dir/$name"
    echo "installed: $hooks_dir/$name"
    installed=$((installed + 1))
done

if [ "$installed" -eq 0 ]; then
    echo "install-hooks: no hooks found in $SRC_DIR." >&2
    exit 2
fi

echo "install-hooks: $installed hook(s) installed. STATUS.md validation is now active on commit."
