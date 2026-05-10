#!/usr/bin/env python3
"""
PAD-BAREME-2006-CSV-IMPORT-VALIDATOR-1 — Phase 1ter-a (read-only)

Validates docs/tariff-collection/pad/PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv
against a frozen manifest. Read-only. No DB write. No CSV/manifest mutation.

Exit code 0 = GO, 1 = NO-GO.
"""
from __future__ import annotations
import csv, hashlib, json, os, sys, subprocess
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv"
MANIFEST_PATH = ROOT / "PAD_BAREME_2006_MANIFEST.json"
REPORT_MD = ROOT / "PAD_BAREME_2006_CSV_IMPORT_VALIDATOR_1_REPORT.md"
REPORT_JSON = ROOT / "PAD_BAREME_2006_CSV_IMPORT_VALIDATOR_1_REPORT.json"

checks: list[dict] = []
errors: list[dict] = []
warnings: list[dict] = []


def add_check(cid: str, status: str, details: str) -> None:
    checks.append({"id": cid, "status": status, "details": details})


def add_error(check: str, row: int | None, column: str | None, found, expected) -> None:
    errors.append({
        "check": check, "row": row, "column": column,
        "found": str(found) if found is not None else None,
        "expected": str(expected) if expected is not None else None,
    })


def sha256_of(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    if not CSV_PATH.exists():
        print(f"FATAL: CSV not found: {CSV_PATH}", file=sys.stderr)
        return 1
    if not MANIFEST_PATH.exists():
        print(f"FATAL: manifest not found: {MANIFEST_PATH}", file=sys.stderr)
        return 1

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest_sha = sha256_of(MANIFEST_PATH)

    # ---------------- Bloc A — Intégrité fichier ----------------
    csv_sha = sha256_of(CSV_PATH)
    sha_match = csv_sha == manifest["expected_sha256"]
    if sha_match:
        add_check("A1", "PASS", f"SHA-256 match: {csv_sha}")
    else:
        add_check("A1", "FAIL", f"SHA-256 mismatch: got {csv_sha}, expected {manifest['expected_sha256']}")
        add_error("A1", None, None, csv_sha, manifest["expected_sha256"])
        # Fail-fast on SHA mismatch
        return finalize(csv_sha, sha_match, manifest_sha)

    try:
        CSV_PATH.read_text(encoding="utf-8")
        add_check("A2", "PASS", "UTF-8 strict OK")
    except UnicodeDecodeError as e:
        add_check("A2", "FAIL", f"Not strict UTF-8: {e}")
        add_error("A2", None, None, "decode_error", "utf-8")
        return finalize(csv_sha, sha_match, manifest_sha)

    # ---------------- Read CSV ----------------
    with CSV_PATH.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)

    # ---------------- Bloc B — Schéma ----------------
    if header == manifest["expected_header"]:
        add_check("B1", "PASS", f"Header match ({len(header)} cols)")
    else:
        add_check("B1", "FAIL", "Header mismatch")
        add_error("B1", 1, None, header, manifest["expected_header"])

    # B2 — types per row
    b2_fail = 0
    for i, r in enumerate(rows, start=2):
        if len(r) != len(manifest["expected_header"]):
            b2_fail += 1
            add_error("B2", i, None, f"col_count={len(r)}", len(manifest["expected_header"]))
    if b2_fail == 0:
        add_check("B2", "PASS", "All rows have 14 columns")
    else:
        add_check("B2", "FAIL", f"{b2_fail} rows with wrong column count")

    # Build dict rows for downstream
    drows = [dict(zip(header, r)) for r in rows]

    # ---------------- Bloc C — Cardinalité & unicité ----------------
    if len(rows) == manifest["expected_total_rows"]:
        add_check("C1", "PASS", f"Total rows = {len(rows)}")
    else:
        add_check("C1", "FAIL", f"got {len(rows)}, expected {manifest['expected_total_rows']}")
        add_error("C1", None, None, len(rows), manifest["expected_total_rows"])

    page_counts = Counter(d["source_page"] for d in drows)
    expected_pages = {k: v for k, v in manifest["expected_page_counts"].items()}
    page_ok = all(page_counts.get(k, 0) == v for k, v in expected_pages.items())
    if page_ok and sum(expected_pages.values()) == sum(page_counts.values()):
        add_check("C2", "PASS", f"Page counts: {dict(page_counts)}")
    else:
        add_check("C2", "FAIL", f"got {dict(page_counts)}, expected {expected_pages}")
        add_error("C2", None, "source_page", dict(page_counts), expected_pages)

    rf_set = {d["rate_family"] for d in drows}
    if rf_set == {"DROIT_PASSAGE"}:
        add_check("C3", "PASS", "rate_family = DROIT_PASSAGE everywhere; no PORT_TAX")
    else:
        add_check("C3", "FAIL", f"rate_family values: {rf_set}")
        add_error("C3", None, "rate_family", rf_set, {"DROIT_PASSAGE"})

    keys = [(d["source_page"], d["operation_type"], d["cargo_type"], d["classification"]) for d in drows]
    dup_counts = Counter(keys)
    dups = [k for k, c in dup_counts.items() if c > 1]
    if not dups:
        add_check("C4", "PASS", "No duplicate (page, op, cargo, classification)")
    else:
        add_check("C4", "FAIL", f"{len(dups)} duplicate keys")
        for k in dups[:20]:
            add_error("C4", None, "key", k, "unique")

    allowed_class = set(manifest["enums"]["classification"])
    bad_class = [(i, d["classification"]) for i, d in enumerate(drows, start=2) if d["classification"] not in allowed_class]
    if not bad_class:
        add_check("C5", "PASS", f"All classifications in allowed set ({len(allowed_class)} values)")
    else:
        add_check("C5", "FAIL", f"{len(bad_class)} orphan classifications")
        for i, v in bad_class[:20]:
            add_error("C5", i, "classification", v, "in enum")

    op_counts = Counter(d["operation_type"] for d in drows)
    exp_op = manifest["expected_op_counts"]
    if dict(op_counts) == exp_op:
        add_check("C6", "PASS", f"operation_type counts match manifest: {dict(op_counts)}")
    else:
        add_check("C6", "FAIL", f"got {dict(op_counts)}, expected {exp_op}")
        add_error("C6", None, "operation_type", dict(op_counts), exp_op)

    cs_counts = Counter(d["cell_status"] for d in drows)
    exp_cs = manifest["expected_cell_status_counts"]
    if dict(cs_counts) == exp_cs:
        add_check("C7", "PASS", f"cell_status counts match: {dict(cs_counts)}")
    else:
        add_check("C7", "FAIL", f"got {dict(cs_counts)}, expected {exp_cs}")
        add_error("C7", None, "cell_status", dict(cs_counts), exp_cs)

    # ---------------- Bloc D — Enums ----------------
    def check_enum(cid: str, col: str, allowed: set[str]) -> None:
        bad = [(i, d[col]) for i, d in enumerate(drows, start=2) if d[col] not in allowed]
        if not bad:
            add_check(cid, "PASS", f"{col} in {sorted(allowed)}")
        else:
            add_check(cid, "FAIL", f"{len(bad)} bad {col} values")
            for i, v in bad[:20]:
                add_error(cid, i, col, v, sorted(allowed))

    check_enum("D1", "operation_type", set(manifest["enums"]["operation_type"]))
    check_enum("D2", "cargo_type", set(manifest["enums"]["cargo_type"]))
    check_enum("D3", "cell_status", set(manifest["enums"]["cell_status"]))

    # ---------------- Bloc E — Cell_status & montants ----------------
    e1_fail = e2_fail = 0
    for i, d in enumerate(drows, start=2):
        amt = d["amount_fcfa_per_tonne"]
        cs = d["cell_status"]
        if cs == "PRESENT":
            if amt == "":
                e1_fail += 1
                add_error("E1", i, "amount_fcfa_per_tonne", "(empty)", "Decimal>=0")
                continue
            try:
                v = Decimal(amt)
                if v < 0:
                    e1_fail += 1
                    add_error("E1", i, "amount_fcfa_per_tonne", str(v), ">=0")
            except InvalidOperation:
                e1_fail += 1
                add_error("E1", i, "amount_fcfa_per_tonne", amt, "Decimal")
        elif cs == "BLANK_IN_PDF":
            if amt != "":
                e2_fail += 1
                add_error("E2", i, "amount_fcfa_per_tonne", amt, "(empty)")
    add_check("E1", "PASS" if e1_fail == 0 else "FAIL",
              f"PRESENT amounts ok ({sum(1 for d in drows if d['cell_status']=='PRESENT')-e1_fail}/{sum(1 for d in drows if d['cell_status']=='PRESENT')})")
    add_check("E2", "PASS" if e2_fail == 0 else "FAIL",
              f"BLANK_IN_PDF amounts empty ({sum(1 for d in drows if d['cell_status']=='BLANK_IN_PDF')-e2_fail}/{sum(1 for d in drows if d['cell_status']=='BLANK_IN_PDF')})")
    add_check("E3", "PASS", "Decimal-only comparisons (no float used)")

    # E4 — T10 page 7 IMPORT zeros preserved
    def find_one(p, op, cargo, cls):
        for d in drows:
            if d["source_page"] == str(p) and d["operation_type"] == op and d["cargo_type"] == cargo and d["classification"] == cls:
                return d
        return None

    e4_ok = True
    for cargo in ("CONTENEUR", "CONVENTIONNEL"):
        d = find_one(7, "IMPORT", cargo, "T10")
        if d is None or d["cell_status"] != "PRESENT" or d["amount_fcfa_per_tonne"] != "0":
            e4_ok = False
            add_error("E4", None, "T10", d and (d["cell_status"], d["amount_fcfa_per_tonne"]), ("PRESENT", "0"))
    add_check("E4", "PASS" if e4_ok else "FAIL",
              "T10 page7/IMPORT/{CONTENEUR,CONVENTIONNEL}=0 PRESENT, distinct from BLANK_IN_PDF")

    # ---------------- Bloc F — Spots critiques ----------------
    d = find_one(7, "EXPORT", "CONVENTIONNEL", "T13")
    if d and d["cell_status"] == "BLANK_IN_PDF" and d["amount_fcfa_per_tonne"] == "":
        add_check("F1", "PASS", "T13/page7/EXPORT/CONVENTIONNEL = BLANK_IN_PDF")
    else:
        add_check("F1", "FAIL", f"T13 spot wrong: {d}")
        add_error("F1", None, "T13", d, "BLANK_IN_PDF")

    f2_ok = True
    for spec in manifest["critical_spots"]["T10_page8_BLANK_rows"]:
        d = find_one(8, spec["operation_type"], spec["cargo_type"], "T10")
        if not d or d["cell_status"] != "BLANK_IN_PDF" or d["amount_fcfa_per_tonne"] != "":
            f2_ok = False
            add_error("F2", None, "T10_page8", d, spec)
    add_check("F2", "PASS" if f2_ok else "FAIL", "T10 page 8 = BLANK_IN_PDF on 3 expected rows")

    f3_ok = True
    for cls, expected in manifest["critical_spots"]["page7_IMPORT_CONTENEUR_amounts"].items():
        d = find_one(7, "IMPORT", "CONTENEUR", cls)
        if not d:
            f3_ok = False
            add_error("F3", None, cls, None, expected)
            continue
        try:
            if Decimal(d["amount_fcfa_per_tonne"]) != Decimal(expected):
                f3_ok = False
                add_error("F3", None, cls, d["amount_fcfa_per_tonne"], expected)
        except InvalidOperation:
            f3_ok = False
            add_error("F3", None, cls, d["amount_fcfa_per_tonne"], expected)
    add_check("F3", "PASS" if f3_ok else "FAIL", "Page7/IMPORT/CONTENEUR P01=28100 P02=2325 P03=13000")

    # ---------------- Bloc G — DB legacy (read-only) ----------------
    g_ran = run_db_checks(drows)

    # ---------------- Finalize ----------------
    return finalize(csv_sha, sha_match, manifest_sha)


def run_db_checks(drows: list[dict]) -> bool:
    """Run G1/G2/G3 via psql SELECTs only. If psql unavailable, mark WARN (not FAIL)."""
    pgenv_ok = bool(os.environ.get("PGHOST"))
    if not pgenv_ok:
        add_check("G1", "WARN", "PGHOST not set; DB legacy checks skipped (read-only env unavailable)")
        add_check("G2", "WARN", "Skipped (no DB env)")
        add_check("G3", "WARN", "Skipped (no DB env)")
        warnings.append({"check": "G", "details": "DB legacy checks skipped — no PGHOST"})
        return False

    def q(sql: str) -> str:
        r = subprocess.run(
            ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        return r.stdout.strip()

    # G1
    try:
        n = int(q(
            "SELECT count(*) FROM public.port_tariffs "
            "WHERE provider='PAD' AND category='DROIT_PASSAGE' "
            "AND operation_type='IMPORT' AND cargo_type='CONTENEUR' AND is_active=true"
        ))
        if n == 19:
            add_check("G1", "PASS", "DB IMPORT/CONTENEUR active = 19")
        else:
            add_check("G1", "FAIL", f"DB IMPORT/CONTENEUR active = {n} (expected 19)")
            add_error("G1", None, "count", n, 19)
    except Exception as e:
        add_check("G1", "FAIL", f"DB read error: {e}")
        return False

    # G2 — match strict 19/19 (classification + amount Decimal)
    try:
        rows = q(
            "SELECT classification, amount FROM public.port_tariffs "
            "WHERE provider='PAD' AND category='DROIT_PASSAGE' "
            "AND operation_type='IMPORT' AND cargo_type='CONTENEUR' AND is_active=true "
            "ORDER BY classification"
        )
        db_map = {}
        for line in rows.splitlines():
            cls, amt = line.split("|")
            db_map[cls.strip()] = Decimal(amt.strip())
        csv_subset = {
            d["classification"]: Decimal(d["amount_fcfa_per_tonne"])
            for d in drows
            if d["source_page"] == "7" and d["operation_type"] == "IMPORT"
            and d["cargo_type"] == "CONTENEUR" and d["cell_status"] == "PRESENT"
        }
        mismatches = []
        for cls, csv_amt in csv_subset.items():
            if cls not in db_map:
                mismatches.append((cls, "missing in DB", str(csv_amt)))
            elif db_map[cls] != csv_amt:
                mismatches.append((cls, str(db_map[cls]), str(csv_amt)))
        for cls in db_map:
            if cls not in csv_subset:
                mismatches.append((cls, str(db_map[cls]), "missing in CSV"))
        if not mismatches and len(db_map) == 19 and len(csv_subset) == 19:
            add_check("G2", "PASS", f"19/19 strict match (classification+amount Decimal)")
        else:
            add_check("G2", "FAIL", f"{len(mismatches)} mismatches; csv={len(csv_subset)} db={len(db_map)}")
            for m in mismatches[:30]:
                add_error("G2", None, m[0], m[1], m[2])
    except Exception as e:
        add_check("G2", "FAIL", f"DB read error: {e}")

    # G3 — non-regression RT-PREIMPORT-1
    try:
        a = int(q(
            "SELECT count(*) FROM public.port_tariffs "
            "WHERE provider='PAD' AND category='DROIT_PASSAGE' "
            "AND operation_type='IMPORT' AND cargo_type='CONTENEUR' AND is_active=true"
        ))
        b = int(q(
            "SELECT count(*) FROM public.port_tariffs "
            "WHERE provider='PAD' AND category='DROIT_PASSAGE' "
            "AND operation_type='IMPORT' AND cargo_type IS NULL AND is_active=true"
        ))
        if a == 19 and b == 0:
            add_check("G3", "PASS", "Non-regression: CONTENEUR=19, NULL=0")
        else:
            add_check("G3", "FAIL", f"CONTENEUR={a} (expect 19), NULL={b} (expect 0)")
            add_error("G3", None, "non_regression", {"CONTENEUR": a, "NULL": b}, {"CONTENEUR": 19, "NULL": 0})
    except Exception as e:
        add_check("G3", "FAIL", f"DB read error: {e}")
    return True


def finalize(csv_sha: str, sha_match: bool, manifest_sha: str) -> int:
    has_fail = any(c["status"] == "FAIL" for c in checks)
    verdict = "GO" if not has_fail else "NO-GO"
    payload = {
        "verdict": verdict,
        "lot_id": "PAD-BAREME-2006-DROIT-PASSAGE",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "csv_sha256": csv_sha,
        "csv_sha256_match": sha_match,
        "manifest_sha256": manifest_sha,
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
        "guarantees": {
            "csv_modified": False,
            "manifest_modified": False,
            "db_writes": False,
            "migrations": False,
            "edge_functions_changed": False,
            "runtime_src_changed": False,
        },
    }
    REPORT_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    pass_n = sum(1 for c in checks if c["status"] == "PASS")
    fail_n = sum(1 for c in checks if c["status"] == "FAIL")
    warn_n = sum(1 for c in checks if c["status"] == "WARN")
    md = []
    md.append("# PAD-BAREME-2006-CSV-IMPORT-VALIDATOR-1 — Report")
    md.append("")
    md.append(f"- **Verdict** : `{verdict}`")
    md.append(f"- **Generated** : {payload['generated_at']}")
    md.append(f"- **CSV SHA-256** : `{csv_sha}` (match manifest: `{sha_match}`)")
    md.append(f"- **Manifest SHA-256** : `{manifest_sha}`")
    md.append(f"- **Checks** : {pass_n} PASS / {fail_n} FAIL / {warn_n} WARN")
    md.append("")
    md.append("## Checks")
    md.append("")
    md.append("| ID | Status | Details |")
    md.append("|----|--------|---------|")
    for c in checks:
        md.append(f"| {c['id']} | {c['status']} | {c['details']} |")
    md.append("")
    if errors:
        md.append("## Errors")
        md.append("")
        md.append("| Check | Row | Column | Found | Expected |")
        md.append("|-------|-----|--------|-------|----------|")
        for e in errors:
            md.append(f"| {e['check']} | {e.get('row') or ''} | {e.get('column') or ''} | {e.get('found') or ''} | {e.get('expected') or ''} |")
        md.append("")
    if warnings:
        md.append("## Warnings")
        md.append("")
        for w in warnings:
            md.append(f"- {w}")
        md.append("")
    md.append("## Guarantees")
    md.append("")
    md.append("- CSV not modified")
    md.append("- Manifest not modified")
    md.append("- No DB write, no migration, no edge function deploy, no `src/` change")
    md.append("- DB queried in SELECT only (or skipped if env unavailable)")
    md.append("")
    md.append(f"**Verdict final : `{verdict}`**")
    REPORT_MD.write_text("\n".join(md) + "\n", encoding="utf-8")

    print(f"VERDICT: {verdict}")
    print(f"PASS={pass_n} FAIL={fail_n} WARN={warn_n}")
    return 0 if verdict == "GO" else 1


if __name__ == "__main__":
    sys.exit(main())
