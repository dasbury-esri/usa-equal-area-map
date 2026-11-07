#!/bin/sh
# bootstrap-validator-env.sh — create the per-machine Python venv that holds PyYAML for the STATUS.md validator.
#
# One venv per machine, not one per repo: ~/.venvs/status-validator. The
# pre-commit hook (scripts/hooks/pre-commit) looks there automatically, so every
# repo on the box validates STATUS.md with no per-repo setup. This is needed on
# machines whose system Python has no PyYAML and refuses `pip install` outside a
# venv (Homebrew Python on macOS is "externally managed", PEP 668).
#
# Usage:
#   sh scripts/bootstrap-validator-env.sh
#   WITH_PYTEST=1 sh scripts/bootstrap-validator-env.sh   # also install pytest
#   STATUS_VALIDATOR_VENV=/some/path sh scripts/bootstrap-validator-env.sh
#   PYYAML_SPEC='PyYAML==6.0.2' sh scripts/bootstrap-validator-env.sh
#
# WITH_PYTEST=1 is opt-in. It lets the hook regression tests
# (scripts/tests/test_pre_commit_hook.py) run with this venv's interpreter on a
# machine that has no other Python with both pytest and PyYAML.
#
# Idempotent: it installs only what is missing, and does nothing if the venv
# already has everything requested. If you use a non-default path, export
# STATUS_VALIDATOR_PYTHON=<venv>/bin/python so the hook finds it. POSIX sh, so it
# also runs under Git Bash on Windows.

set -eu

VENV="${STATUS_VALIDATOR_VENV:-${HOME:?HOME is not set}/.venvs/status-validator}"
SPEC="${PYYAML_SPEC:-PyYAML>=6.0.2,<7}"
PYTEST_SPEC="${PYTEST_SPEC:-pytest>=8}"
WITH_PYTEST="${WITH_PYTEST:-0}"

venv_python() {
    if [ -x "$VENV/bin/python" ]; then
        echo "$VENV/bin/python"
    elif [ -x "$VENV/Scripts/python.exe" ]; then
        echo "$VENV/Scripts/python.exe"
    fi
}

has_module() {
    "$1" -c "import $2" >/dev/null 2>&1
}

changed=0
py="$(venv_python || true)"

if [ -z "$py" ]; then
    BASE=""
    for cand in python3 python; do
        if command -v "$cand" >/dev/null 2>&1; then
            BASE="$cand"
            break
        fi
    done
    if [ -z "$BASE" ]; then
        echo "bootstrap-validator-env: no python3/python on PATH; install Python 3 first." >&2
        exit 2
    fi
    echo "bootstrap-validator-env: creating $VENV with $($BASE --version 2>&1)"
    mkdir -p "$(dirname "$VENV")"
    "$BASE" -m venv "$VENV"
    py="$(venv_python || true)"
    if [ -z "$py" ]; then
        echo "bootstrap-validator-env: venv created but no interpreter found under $VENV." >&2
        exit 2
    fi
    changed=1
fi

if ! has_module "$py" yaml; then
    "$py" -m pip install --quiet "$SPEC"
    changed=1
fi

if [ "$WITH_PYTEST" = "1" ] && ! has_module "$py" pytest; then
    "$py" -m pip install --quiet "$PYTEST_SPEC"
    changed=1
fi

# Confirm with a fresh interpreter run, not pip's own exit status.
if ! has_module "$py" yaml; then
    echo "bootstrap-validator-env: PyYAML installed but 'import yaml' still fails in $py." >&2
    exit 2
fi
if [ "$WITH_PYTEST" = "1" ] && ! has_module "$py" pytest; then
    echo "bootstrap-validator-env: pytest installed but 'import pytest' still fails in $py." >&2
    exit 2
fi

ver="$("$py" -c 'import yaml; print(yaml.__version__)')"
extra=""
if [ "$WITH_PYTEST" = "1" ]; then
    extra=", pytest $("$py" -c 'import pytest; print(pytest.__version__)')"
fi
if [ "$changed" -eq 1 ]; then
    echo "bootstrap-validator-env: ready: $py (PyYAML $ver$extra)"
    echo "bootstrap-validator-env: the pre-commit hook will now find it automatically."
else
    echo "bootstrap-validator-env: already ready: $py (PyYAML $ver$extra)"
fi
