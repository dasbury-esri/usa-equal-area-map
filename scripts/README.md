# scripts

Project-specific scripts live here, plus the bundled **STATUS.md validation
hook** so this repo can validate its own `STATUS.md` at commit time without
depending on the project-tracking clone (it is on the other side of the
work/personal boundary).

## STATUS.md validation hook

| File | Role |
|---|---|
| `validate_status.py` | Routes each `STATUS.md` to `../schema/status-vN.yaml` using its declared version. Both v1 and v2 are bundled; v2 enforces the 400-character `next_action` limit. Run directly, or via the hook. |
| `hooks/pre-commit` | Blocks a commit that stages an invalid `STATUS.md`. Looks for a Python that has PyYAML (`$STATUS_VALIDATOR_PYTHON`, this repo's `venv/`, `~/.venvs/status-validator`, then system python). If none has PyYAML, or the schema is missing, it prints a loud warning and allows the commit, so the check did **not** run. |
| `install-hooks.sh` | Copies `hooks/*` into `.git/hooks/`. Run **once per clone**. |
| `bootstrap-validator-env.sh` | Creates the per-machine venv `~/.venvs/status-validator` with PyYAML. Run **once per machine** (not per repo) where system Python has no PyYAML, e.g. Homebrew Python on macOS. `WITH_PYTEST=1` also installs pytest (opt-in, for running the hook tests). |

Install:

```bash
sh scripts/bootstrap-validator-env.sh   # once per MACHINE, only if system Python lacks PyYAML
scripts/install-hooks.sh                # once per clone
```

After install, a commit that stages a `STATUS.md` with placeholder `[OWNER: ...]`
values in `state`/`health` is blocked until those are filled — an intentional
forcing function.

## Snapshot note

`validate_status.py`, `hooks/pre-commit`, `install-hooks.sh`,
`bootstrap-validator-env.sh`, and `../schema/status-v*.yaml` are **snapshots**
copied from the project-tracking system. The version-aware validator and both
released schemas are bundled so v1 and v2 files can coexist without an external
runtime dependency. New projects use v2; an existing project's version is not
silently changed by installing tooling.

Before distribution, the canonical hook suite checks exact validator/schema
parity and real commits for v1 compatibility, v2 length boundaries, mixed-version
repositories, and staged-versus-working-tree differences. Refresh the validator
and supported schemas together; a passing shell-syntax check is not sufficient.
