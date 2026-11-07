# Repository Working Rules

Read STATUS.md and relevant decision records before changing behavior. Preserve
the owner's next_action and require explicit approval for production publication.

## STATUS Authoring

This project uses `schema_version: 2`, defined by `schema/status-v2.yaml`.
Never downgrade the declaration without explicit owner approval. Preserve owner
values; v2 limits `next_action` to 400 characters, but never truncate owner text
merely to pass validation. Validate using `scripts/validate_status.py` with Python
and PyYAML. See `scripts/README.md` for the shared environment and per-clone hook
setup. These repository rules remain authoritative; installing the tooling does
not replace them with template policy or authorize application publication.

## Session Logs

Before creating or renumbering a session log:

1. Run `git fetch --all --prune`. If fetching fails, stop; do not allocate a number
   from stale refs.
2. Inspect session-log filenames across every local and remote branch, including
   history (`git log --branches --remotes --format= --name-only -- session-logs`),
   plus uncommitted logs in all worktrees.
3. Choose one greater than the highest used numeric session identifier, regardless
   of date. Never reuse a number used on another branch. Allocate consecutive
   numbers for a batch and recheck before committing if other work is concurrent.
4. Use `YYYY-MM-DD-NNNN-session-log.md` and update references when renumbering.

Keep screenshots, raw browser results and build logs outside Git. Session logs
must link to their external evidence and record how to verify its integrity.
Do not add files under `session-logs/artifacts/`.
