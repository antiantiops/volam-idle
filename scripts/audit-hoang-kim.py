#!/usr/bin/env python3
"""Offline auditable parser/index CLI for legacy Hoang Kim TSV tables."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


EXPECTED_FILES = {
    "goldequip": ("goldequip.txt", 60),
    "magicattrib_ge": ("magicattrib_ge.txt", 12),
    "suite_activate_count": ("suite_activate_count.txt", 2),
    "ext_suite_activate_count": ("ext_suite_activate_count.txt", 3),
}


class AuditError(Exception):
    """Contract violation with file/line context."""


def read_tsv_records(path: Path, expected_width: int) -> tuple[str, list[tuple[int, list[str]]]]:
    if not path.is_file():
        raise AuditError(f"missing input file: {path}")
    raw = path.read_bytes()
    sha256 = hashlib.sha256(raw).hexdigest()

    if raw.endswith(b"\r\n"):
        trimmed = raw[:-2]
    elif raw.endswith(b"\n") or raw.endswith(b"\r"):
        raise AuditError(f"{path.name}:1: non-CRLF trailing line ending")
    else:
        trimmed = raw

    raw_lines = trimmed.split(b"\r\n") if trimmed else []
    if not raw_lines:
        raise AuditError(f"{path.name}:1: empty file, missing header")

    records: list[tuple[int, list[str]]] = []
    for line_no, raw_line in enumerate(raw_lines, start=1):
        if b"\r" in raw_line or b"\n" in raw_line:
            raise AuditError(f"{path.name}:{line_no}: stray CR/LF inside line")
        fields = [part.decode("latin1") for part in raw_line.split(b"\t")]
        if len(fields) != expected_width:
            raise AuditError(
                f"{path.name}:{line_no}: width {len(fields)} != expected {expected_width}"
            )
        if line_no > 1:
            records.append((line_no, fields))
    return sha256, records


def parse_req_int(value: str, filename: str, line_no: int, col_name: str) -> int:
    if value == "" or value.strip() != value:
        raise AuditError(f"{filename}:{line_no}: malformed required int in {col_name}")
    try:
        return int(value, 10)
    except ValueError as exc:
        raise AuditError(f"{filename}:{line_no}: non-int in {col_name}: {value!r}") from exc


def parse_opt_int(value: str, filename: str, line_no: int, col_name: str) -> int | None:
    if value == "":
        return None
    return parse_req_int(value, filename, line_no, col_name)


def parse_thresholds(
    records: list[tuple[int, list[str]]],
    filename: str,
    value_cols: int,
) -> tuple[dict[int, tuple[int, ...]], int]:
    table: dict[int, tuple[int, ...]] = {}
    identical_dups = 0
    for line_no, cols in records:
        suite_no = parse_req_int(cols[0], filename, line_no, "col1")
        vals = tuple(
            parse_req_int(cols[i], filename, line_no, f"col{i + 1}")
            for i in range(1, 1 + value_cols)
        )
        if suite_no in table:
            if table[suite_no] != vals:
                raise AuditError(
                    f"{filename}:{line_no}: conflicting duplicate threshold for id {suite_no}: "
                    f"{vals} vs {table[suite_no]}"
                )
            identical_dups += 1
        else:
            table[suite_no] = vals
    return table, identical_dups


def parse_ge(records: list[tuple[int, list[str]]], filename: str) -> dict[int, dict[str, Any]]:
    table: dict[int, dict[str, Any]] = {}
    for line_no, cols in records:
        ge_idx = line_no - 1
        effect_type = parse_opt_int(cols[4], filename, line_no, "col5")
        ranges = [
            [
                parse_opt_int(cols[5], filename, line_no, "col6"),
                parse_opt_int(cols[6], filename, line_no, "col7"),
            ],
            [
                parse_opt_int(cols[7], filename, line_no, "col8"),
                parse_opt_int(cols[8], filename, line_no, "col9"),
            ],
            [
                parse_opt_int(cols[9], filename, line_no, "col10"),
                parse_opt_int(cols[10], filename, line_no, "col11"),
            ],
        ]
        table[ge_idx] = {
            "ge_idx": ge_idx,
            "physical_line": line_no,
            "effect_type": effect_type,
            "ranges": ranges,
        }
    return table


def resolve_ref(
    ge_idx: int | None,
    slot: int,
    ge_table: dict[int, dict[str, Any]],
    filename: str,
    line_no: int,
    col_name: str,
) -> dict[str, Any]:
    if ge_idx is None:
        return {"slot": slot, "ge_idx": None}
    ge = ge_table.get(ge_idx)
    if ge is None:
        raise AuditError(f"{filename}:{line_no}: dangling GE ref {ge_idx} in {col_name}")
    return {
        "slot": slot,
        "ge_idx": ge["ge_idx"],
        "ge_physical_line": ge["physical_line"],
        "effect_type": ge["effect_type"],
        "ranges": ge["ranges"],
    }


def audit_directory(source_dir: Path, target_row: int | None) -> dict[str, Any]:
    ge_file, ge_width = EXPECTED_FILES["magicattrib_ge"]
    ge_sha, ge_records = read_tsv_records(source_dir / ge_file, ge_width)
    ge_table = parse_ge(ge_records, ge_file)

    norm_file, norm_width = EXPECTED_FILES["suite_activate_count"]
    norm_sha, norm_records = read_tsv_records(source_dir / norm_file, norm_width)
    norm_thresholds, norm_identical_dups = parse_thresholds(norm_records, norm_file, 1)

    ext_file, ext_width = EXPECTED_FILES["ext_suite_activate_count"]
    ext_sha, ext_records = read_tsv_records(source_dir / ext_file, ext_width)
    ext_thresholds, ext_identical_dups = parse_thresholds(ext_records, ext_file, 2)

    eq_file, eq_width = EXPECTED_FILES["goldequip"]
    eq_sha, eq_records = read_tsv_records(source_dir / eq_file, eq_width)

    normal_group_ids: set[int] = set()
    ext_group_ids: set[int] = set()
    ext_pair_counts: Counter[tuple[int, int | None]] = Counter()
    normal_effect_counts: Counter[int] = Counter()
    ext_effect_counts: Counter[int] = Counter()
    rows_with_ext_attr_no_ext_group = 0
    rows_by_line: dict[int, dict[str, Any]] = {}

    for line_no, cols in eq_records:
        kind = parse_opt_int(cols[2], eq_file, line_no, "col3")
        subkind = parse_opt_int(cols[3], eq_file, line_no, "col4")

        normal_group = parse_opt_int(cols[52], eq_file, line_no, "col53")
        ext_group = parse_opt_int(cols[53], eq_file, line_no, "col54")
        sid = parse_opt_int(cols[54], eq_file, line_no, "col55")

        normal_refs = [
            resolve_ref(
                parse_opt_int(cols[46 + idx], eq_file, line_no, f"col{47 + idx}"),
                idx + 1,
                ge_table,
                eq_file,
                line_no,
                f"col{47 + idx}",
            )
            for idx in range(6)
        ]
        ext_refs = [
            resolve_ref(
                parse_opt_int(cols[55 + idx], eq_file, line_no, f"col{56 + idx}"),
                idx + 1,
                ge_table,
                eq_file,
                line_no,
                f"col{56 + idx}",
            )
            for idx in range(2)
        ]

        if normal_group is not None:
            normal_group_ids.add(normal_group)
        if ext_group is not None:
            ext_group_ids.add(ext_group)
            ext_pair_counts[(ext_group, sid)] += 1

        has_ext_attr = any(ref["ge_idx"] is not None for ref in ext_refs)
        if has_ext_attr and ext_group is None:
            rows_with_ext_attr_no_ext_group += 1

        for ref in normal_refs:
            if ref["ge_idx"] is not None and ref["effect_type"] is not None:
                normal_effect_counts[ref["effect_type"]] += 1
        for ref in ext_refs:
            if ref["ge_idx"] is not None and ref["effect_type"] is not None:
                ext_effect_counts[ref["effect_type"]] += 1

        if target_row == line_no:
            norm_thresh_tuple = (
                norm_thresholds.get(normal_group) if normal_group is not None else None
            )
            ext_thresh_tuple = (
                ext_thresholds.get(ext_group) if ext_group is not None else None
            )
            rows_by_line[line_no] = {
                "key": f"hk:{line_no}",
                "physical_line": line_no,
                "kind": kind,
                "subkind": subkind,
                "normal_group": normal_group,
                "normal_threshold": norm_thresh_tuple[0] if norm_thresh_tuple else None,
                "ext_group": ext_group,
                "ext_thresholds": list(ext_thresh_tuple) if ext_thresh_tuple else None,
                "sid": sid,
                "normal_refs": normal_refs,
                "ext_refs": ext_refs,
            }

    if target_row is not None and target_row not in rows_by_line:
        raise AuditError(f"{eq_file}: requested --row {target_row} not found in data rows")

    normal_found = sum(1 for gid in normal_group_ids if gid in norm_thresholds)
    normal_missing = len(normal_group_ids) - normal_found
    ext_found = sum(1 for gid in ext_group_ids if gid in ext_thresholds)
    ext_missing = len(ext_group_ids) - ext_found
    ext_pair_repeated_distinct = sum(1 for count in ext_pair_counts.values() if count > 1)
    ext_pair_repeated_extra_rows = sum(
        count - 1 for count in ext_pair_counts.values() if count > 1
    )

    result: dict[str, Any] = {
        "inputs": {
            eq_file: {"sha256": eq_sha, "width": eq_width, "rows": len(eq_records)},
            ge_file: {"sha256": ge_sha, "width": ge_width, "rows": len(ge_records)},
            norm_file: {
                "sha256": norm_sha,
                "width": norm_width,
                "rows": len(norm_records),
                "unique": len(norm_thresholds),
                "identical_duplicates": norm_identical_dups,
            },
            ext_file: {
                "sha256": ext_sha,
                "width": ext_width,
                "rows": len(ext_records),
                "unique": len(ext_thresholds),
                "identical_duplicates": ext_identical_dups,
            },
        },
        "coverage": {
            "equipment_rows": len(eq_records),
            "ge_rows": len(ge_records),
            "normal_threshold_records": len(norm_records),
            "normal_threshold_unique": len(norm_thresholds),
            "normal_threshold_identical_duplicates": norm_identical_dups,
            "ext_threshold_records": len(ext_records),
            "ext_threshold_unique": len(ext_thresholds),
            "ext_threshold_identical_duplicates": ext_identical_dups,
            "normal_group_distinct_nonempty": len(normal_group_ids),
            "normal_group_found_in_threshold": normal_found,
            "normal_group_missing_in_threshold": normal_missing,
            "ext_group_distinct_nonempty": len(ext_group_ids),
            "ext_group_found_in_threshold": ext_found,
            "ext_group_missing_in_threshold": ext_missing,
            "ext_group_sid_repeated_pairs": ext_pair_repeated_distinct,
            "ext_group_sid_repeated_extra_rows": ext_pair_repeated_extra_rows,
            "rows_with_ext_attr_no_ext_group": rows_with_ext_attr_no_ext_group,
            "normal_effect_ref_counts": {
                str(code): normal_effect_counts[code]
                for code in sorted(normal_effect_counts)
            },
            "ext_effect_ref_counts": {
                str(code): ext_effect_counts[code]
                for code in sorted(ext_effect_counts)
            },
        },
    }
    if target_row is not None:
        result["row"] = rows_by_line[target_row]
    return result


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Audit legacy Hoang Kim TSV tables without emitting source text/assets."
    )
    parser.add_argument("source_dir", type=Path, help="Directory containing the 4 TSV files")
    parser.add_argument(
        "--row",
        type=int,
        default=None,
        help="Optional 1-based physical line number in goldequip.txt to inspect",
    )
    args = parser.parse_args(argv)

    try:
        report = audit_directory(args.source_dir, args.row)
    except AuditError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1

    print(json.dumps(report, indent=2, sort_keys=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
