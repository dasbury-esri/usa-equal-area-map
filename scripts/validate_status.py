#!/usr/bin/env python3
"""
validate_status.py — validate STATUS.md frontmatter against schema/status-v1.yaml.

The schema file IS the contract (ADR-001): this script READS it rather than
embedding the field list, so there is exactly one source of truth. Required
fields, types, enums, and the date format all come from the YAML schema.

Behaviour (ADR-001, D3):
  - Required fields must be present, of the right type, with valid enum values.
  - The `updated` field (format: date) must be a YYYY-MM-DD date.
  - Unknown fields are IGNORED — including everything under `extra:`. A STATUS.md
    is never rejected for containing fields the schema doesn't mention.

Usage:
  validate_status.py STATUS.md [STATUS.md ...]
  validate_status.py --schema path/to/status-vN.yaml STATUS.md

Exit codes:
  0  every file given is valid
  1  one or more files are invalid (errors printed to stderr)
  2  usage / environment error (schema missing, PyYAML missing, etc.)

Two intended call sites (ADR-001):
  - write time: CI / pre-commit inside a project repo.
  - read time:  imported by the aggregator at ingest. The aggregator should call
    validate_file() / validate() and act on the returned error list itself
    (ADR-002 iron rule: a bad STATUS.md degrades the digest, it never crashes
    the aggregator). This module only reads files; it is safe to re-run.
"""

from __future__ import annotations

import datetime
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write("error: PyYAML is required (pip install pyyaml)\n")
    sys.exit(2)

# Default schema, relative to this script: <repo>/schema/status-v1.yaml
DEFAULT_SCHEMA = Path(__file__).resolve().parent.parent / "schema" / "status-v1.yaml"
SCHEMA_DIR = DEFAULT_SCHEMA.parent


def _type_ok(value, type_name: str) -> bool:
    # bool is a subclass of int in Python, so check it before / apart from int.
    if type_name == "boolean":
        return isinstance(value, bool)
    if type_name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "object":
        return isinstance(value, dict)
    return True  # unknown type name in the schema itself: don't block on it


def _date_ok(value) -> bool:
    # PyYAML parses an unquoted `2026-06-10` to a datetime.date, while a quoted
    # value stays a str. Accept either, as long as it's a real YYYY-MM-DD date.
    if isinstance(value, datetime.date):
        return True
    if isinstance(value, str):
        try:
            datetime.datetime.strptime(value, "%Y-%m-%d")
            return True
        except ValueError:
            return False
    return False


def load_schema(schema_path: Path) -> dict:
    data = yaml.safe_load(schema_path.read_text())
    if not isinstance(data, dict) or "required_fields" not in data:
        raise ValueError(f"{schema_path}: not a schema file (no 'required_fields')")
    return data


def get_schema_for_version(version, schema_dir: Path, cache: dict):
    """Return (schema_dict, None) or (None, error_message). Cached per version.

    The single implementation of ADR-001's schema_version routing (D4: "the
    aggregator accepts old and new versions during any transition"). Both the
    write-time CLI (main(), below) and the read-time aggregator
    (aggregate_status.py) call this rather than each re-implementing the
    version-to-file lookup, per the single-parser principle in ADR-001's
    2026-06-14 amendment.
    """
    if version in cache:
        return cache[version]
    if not isinstance(version, int) or isinstance(version, bool):
        result = (None, f"schema_version: expected an integer, got {version!r}.")
    else:
        schema_path = schema_dir / f"status-v{version}.yaml"
        if not schema_path.is_file():
            result = (
                None,
                f"schema_version: file declares {version} but "
                f"{schema_path.name} does not exist in {schema_dir}.",
            )
        else:
            try:
                result = (load_schema(schema_path), None)
            except (OSError, ValueError, yaml.YAMLError) as exc:
                result = (None, f"cannot load {schema_path.name}: {exc}")
    cache[version] = result
    return result


def parse_frontmatter(text: str):
    """Return (frontmatter_dict, None) on success, or (None, error_message)."""
    lines = text.splitlines()
    first = lines[0].strip() if lines else ""
    if first != "---":
        if first.startswith("```"):
            return None, (
                "no '---' frontmatter: file opens with a fenced code block "
                "(```). STATUS.md frontmatter must be delimited by '---' lines "
                "(ADR-001 / schema), not a code fence."
            )
        return None, "no YAML frontmatter found ('---' expected on the first line)."
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            try:
                fm = yaml.safe_load("\n".join(lines[1:i]))
            except yaml.YAMLError as exc:
                return None, f"frontmatter is not valid YAML: {exc}"
            if not isinstance(fm, dict):
                return None, "frontmatter did not parse to a key/value mapping."
            return fm, None
    return None, "frontmatter opened with '---' but the closing '---' is missing."


def validate(frontmatter: dict, schema: dict) -> list[str]:
    """Return a list of error strings; an empty list means valid.

    Only fields listed under the schema's `required_fields` are checked.
    Everything else (including the whole `extra:` block) is ignored.
    """
    errors: list[str] = []
    required = schema.get("required_fields", {})

    # Schema-version routing for lazy migration (ADR-001): if the file targets a
    # different schema version than the one we loaded, say so plainly instead of
    # emitting a pile of confusing field errors from the wrong contract.
    schema_ver = schema.get("schema_version")
    file_ver = frontmatter.get("schema_version")
    if schema_ver is not None and file_ver is not None and file_ver != schema_ver:
        return [
            f"schema_version: file declares {file_ver!r} but this is schema "
            f"v{schema_ver}; validate it against schema-v{file_ver}.yaml instead."
        ]

    for field, spec in required.items():
        if field not in frontmatter:
            errors.append(f"{field}: required field is missing.")
            continue
        value = frontmatter[field]
        type_name = spec.get("type")

        if spec.get("format") == "date":
            if not _date_ok(value):
                errors.append(f"{field}: must be a date (YYYY-MM-DD), got {value!r}.")
        elif type_name and not _type_ok(value, type_name):
            errors.append(
                f"{field}: expected {type_name}, got {type(value).__name__} ({value!r})."
            )

        enum = spec.get("enum")
        if enum is not None and value not in enum:
            errors.append(f"{field}: {value!r} is not one of {enum}.")

        max_length = spec.get("max_length")
        if max_length is not None and isinstance(value, str) and len(value) > max_length:
            errors.append(
                f"{field}: {len(value)} chars exceeds max_length {max_length}. "
                "This usually means session updates were prepended instead of "
                "replacing the field (AGENTS.md close-out step 2) — move the "
                "history into session-logs/ and leave one current line here."
            )

    return errors


def validate_file(path: Path, schema: dict) -> list[str]:
    """Validate one STATUS.md file against a fixed schema. Empty list == valid."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [f"could not read file: {exc}"]
    frontmatter, err = parse_frontmatter(text)
    if err:
        return [err]
    return validate(frontmatter, schema)


def validate_file_auto(path: Path, schema_dir: Path, cache: dict) -> list[str]:
    """Validate one STATUS.md file against the schema its own schema_version
    names (ADR-001 D4 lazy migration), instead of one fixed schema for every
    file. Empty list == valid."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [f"could not read file: {exc}"]
    frontmatter, err = parse_frontmatter(text)
    if err:
        return [err]
    schema, err = get_schema_for_version(frontmatter.get("schema_version"), schema_dir, cache)
    if err:
        return [err]
    return validate(frontmatter, schema)


def main(argv: list[str]) -> int:
    args = argv[1:]
    schema_path = None
    if "--schema" in args:
        i = args.index("--schema")
        try:
            schema_path = Path(args[i + 1])
        except IndexError:
            sys.stderr.write("error: --schema requires a path\n")
            return 2
        del args[i : i + 2]

    if not args:
        sys.stderr.write(
            "usage: validate_status.py [--schema PATH] STATUS.md [STATUS.md ...]\n"
        )
        return 2

    any_invalid = False

    if schema_path is not None:
        # Explicit override: force every file given against this one schema.
        try:
            schema = load_schema(schema_path)
        except (OSError, ValueError, yaml.YAMLError) as exc:
            sys.stderr.write(f"error: cannot load schema: {exc}\n")
            return 2
        for arg in args:
            errors = validate_file(Path(arg), schema)
            if errors:
                any_invalid = True
                sys.stderr.write(f"FAIL {arg}\n")
                for e in errors:
                    sys.stderr.write(f"  - {e}\n")
            else:
                sys.stdout.write(f"OK   {arg}\n")
        return 1 if any_invalid else 0

    # Default: each file is validated against the schema its own
    # schema_version names, so v1 and v2 (etc.) files coexist correctly.
    cache: dict = {}
    for arg in args:
        errors = validate_file_auto(Path(arg), SCHEMA_DIR, cache)
        if errors:
            any_invalid = True
            sys.stderr.write(f"FAIL {arg}\n")
            for e in errors:
                sys.stderr.write(f"  - {e}\n")
        else:
            sys.stdout.write(f"OK   {arg}\n")
    return 1 if any_invalid else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
