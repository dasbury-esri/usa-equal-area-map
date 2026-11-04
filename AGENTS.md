# Repository Working Rules

Read STATUS.md and relevant decision records before changing behavior. Preserve
the owner's next_action and require explicit approval for production publication.

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
