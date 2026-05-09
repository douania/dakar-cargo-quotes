#!/usr/bin/env python3
"""
PAD-NST-2E-B-R3 v3 — Calcul H_source pour garde E0
====================================================
Phase : R3 v3 PRÉPARATION (no DB execution)

Garantit que :
  - Le fichier source SQL a un SHA-256 connu et validé
  - La reconstruction Python du dataset 88 règles est cohérente avec le SQL source
  - Les 88 règles ont 88 clés distinctes (nst_level|nst_code|pad_category)
  - Le hash MD5 produit (H_source) est calculé via une sérialisation déterministe
    parfaitement reproductible côté PostgreSQL.

Sérialisation (règle UNIQUE — alignée Python ↔ SQL) :
  - Texte non-null : <octet_length_utf8>:<valeur>;
  - Texte NULL    : N;          (distinct de 0:; chaîne vide)
  - confidence    : f'{x:.2f}'  côté Python ↔ to_char(x, 'FM0.00') côté SQL
                    puis sérialisé comme texte non-null
  - Booléens      : TRUE → '1:t;'  FALSE → '1:f;'
  - Lignes triées : ORDER BY nst_level, nst_code, pad_category
  - Séparateur    : '\n' (LF unique) entre lignes
  - Hash final    : md5(payload_global).hexdigest()  → 32 hex chars

Tout échec d'une garde => sys.exit(1) sans produire H_source.

Usage :
  python docs/tariff-collection/pad/scripts/compute_r3_source_hash.py
"""

import csv
import hashlib
import re
import sys
from pathlib import Path

# ---------- Constantes ----------
SCRIPT_DIR = Path(__file__).parent
RULES_DIR = SCRIPT_DIR.parent / "rules"

SOURCE_SQL = RULES_DIR / "pad_nst_2e_b_r2_corrective.sql"
EXPECTED_SHA256 = "fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50"

MANIFEST_CSV = RULES_DIR / "pad_nst_2e_rule_candidates.csv"
AUDIT_CSV = RULES_DIR / "pad_nst_2e_audit_results.csv"

ALLOWED_EVIDENCE = {"expert_rule", "nstr_bridge_inferred"}
FORBIDDEN_EVIDENCE = {"pad_official_extract", "operator_override"}
ALLOWED_ACTIONS = {"keep_as_is", "adjust_confidence", "enrich_notes"}
EXCLUDED_ACTIONS = {"defer", "remove"}
ALLOWED_TIERS = {"TIER-A", "TIER-B"}

EXPECTED_COUNT = 88
EXPECTED_CONF_MIN = 0.45
EXPECTED_CONF_MAX = 0.85


def fail(msg: str) -> "None":
    print(f"FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


# ---------- Garde 1 : SHA-256 du fichier source ----------
def garde_1_sha256() -> None:
    if not SOURCE_SQL.exists():
        fail(f"Fichier source introuvable: {SOURCE_SQL}")
    h = hashlib.sha256(SOURCE_SQL.read_bytes()).hexdigest()
    if h != EXPECTED_SHA256:
        fail(
            f"Garde 1 KO — SHA-256 source mismatch.\n"
            f"  attendu : {EXPECTED_SHA256}\n"
            f"  obtenu  : {h}"
        )
    print(f"[Garde 1] OK — SHA-256 source = {h}")


# ---------- Reconstruction du dataset 88 règles ----------
def reconstruct_ready() -> "list[dict]":
    """Reproduit la logique de pad_nst_2e_b_r2_corrective.py."""
    manifest = {}
    with open(MANIFEST_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = f"{row['nst_level']}|{row['nst_code']}|{row['pad_category']}"
            manifest[key] = row

    audit = {}
    with open(AUDIT_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            audit[row["rule_key"]] = row

    ready = []
    for key, a in sorted(audit.items()):
        if a["action"] in EXCLUDED_ACTIONS:
            continue
        if a["audit_tier"] not in ALLOWED_TIERS:
            continue
        if a["action"] not in ALLOWED_ACTIONS:
            fail(f"action inconnue '{a['action']}' pour {key}")
        if key not in manifest:
            fail(f"{key} absent du manifest")
        m = manifest[key]
        ev = m["evidence_level"]
        if ev in FORBIDDEN_EVIDENCE:
            fail(f"evidence_level interdit '{ev}' pour {key}")
        if ev not in ALLOWED_EVIDENCE:
            fail(f"evidence_level inconnu '{ev}' pour {key}")
        conf = float(a["adjusted_confidence"])
        if not (0 <= conf <= 1):
            fail(f"confidence hors bornes {conf} pour {key}")

        notes_parts = []
        if m.get("notes"):
            notes_parts.append(m["notes"].strip())
        if a.get("audit_note"):
            notes_parts.append(f"[AUDIT-R1] {a['audit_note'].strip()}")
        combined_notes = " | ".join(notes_parts) if notes_parts else None

        ready.append({
            "nst_level": m["nst_level"],
            "nst_code": m["nst_code"],
            "pad_category": m["pad_category"],
            "confidence": conf,
            "evidence_level": ev,
            "validation_status": "candidate",
            "notes": combined_notes,
            "source_document": m.get("source_document") or None,
            "source_reference": m.get("source_reference") or None,
            "requires_operator_validation": True,
            "is_active": True,
        })

    if len(ready) != EXPECTED_COUNT:
        fail(f"Reconstruction : count = {len(ready)}, attendu {EXPECTED_COUNT}")
    confs = [r["confidence"] for r in ready]
    if min(confs) != EXPECTED_CONF_MIN or max(confs) != EXPECTED_CONF_MAX:
        fail(
            f"Reconstruction : confidence range {min(confs)}-{max(confs)}, "
            f"attendu {EXPECTED_CONF_MIN}-{EXPECTED_CONF_MAX}"
        )
    return ready


# ---------- Parser SQL source (extraction des 88 INSERT) ----------
INSERT_RE = re.compile(
    r"INSERT INTO expected_rules \([^)]+\) VALUES \(\s*"
    r"'([^']*(?:''[^']*)*)',\s*'([^']*(?:''[^']*)*)',\s*'([^']*(?:''[^']*)*)',\s*"
    r"([0-9.]+),\s*'([^']*(?:''[^']*)*)',\s*"
    r"'([^']*(?:''[^']*)*)',\s*(NULL|'(?:[^']|'')*'),\s*(NULL|'(?:[^']|'')*'),\s*"
    r"(NULL|'(?:[^']|'')*'),\s*(true|false),\s*(true|false)\s*\);",
    re.DOTALL,
)


def _unesc(v: str):
    if v == "NULL":
        return None
    if v.startswith("'") and v.endswith("'"):
        v = v[1:-1]
    return v.replace("''", "'")


def parse_source_sql() -> "list[dict]":
    text = SOURCE_SQL.read_text(encoding="utf-8")
    rows = []
    for m in INSERT_RE.finditer(text):
        (nst_level, nst_code, pad_category, confidence_s, evidence_level,
         validation_status, notes_raw, source_document_raw, source_reference_raw,
         req_op, is_act) = m.groups()
        rows.append({
            "nst_level": _unesc(f"'{nst_level}'"),
            "nst_code": _unesc(f"'{nst_code}'"),
            "pad_category": _unesc(f"'{pad_category}'"),
            "confidence": float(confidence_s),
            "evidence_level": _unesc(f"'{evidence_level}'"),
            "validation_status": _unesc(f"'{validation_status}'"),
            "notes": _unesc(notes_raw),
            "source_document": _unesc(source_document_raw),
            "source_reference": _unesc(source_reference_raw),
            "requires_operator_validation": req_op == "true",
            "is_active": is_act == "true",
        })
    return rows


# ---------- Garde 2 : reconstruction Python ↔ SQL source ----------
def garde_2_coherence(ready: "list[dict]", parsed: "list[dict]") -> None:
    if len(parsed) != EXPECTED_COUNT:
        fail(f"Garde 2 KO — parsed SQL count = {len(parsed)}, attendu {EXPECTED_COUNT}")

    def keyfn(r):
        return (r["nst_level"], r["nst_code"], r["pad_category"])

    rs = sorted(ready, key=keyfn)
    ps = sorted(parsed, key=keyfn)

    fields = ("nst_level", "nst_code", "pad_category", "confidence",
              "evidence_level", "validation_status", "notes",
              "source_document", "source_reference",
              "requires_operator_validation", "is_active")

    mismatches = []
    for i, (r, p) in enumerate(zip(rs, ps)):
        for f in fields:
            if r[f] != p[f]:
                mismatches.append((i, keyfn(r), f, repr(r[f])[:80], repr(p[f])[:80]))

    if mismatches:
        for m in mismatches[:10]:
            print(f"  mismatch row#{m[0]} key={m[1]} field={m[2]} "
                  f"reconstruct={m[3]} sql={m[4]}", file=sys.stderr)
        fail(f"Garde 2 KO — {len(mismatches)} mismatches reconstruction ↔ SQL source")

    print(f"[Garde 2] OK — reconstruction Python = SQL source ({EXPECTED_COUNT} lignes)")


# ---------- Garde 3 : unicité des 88 clés ----------
def garde_3_unicite(ready: "list[dict]") -> None:
    keys = [(r["nst_level"], r["nst_code"], r["pad_category"]) for r in ready]
    seen = {}
    dups = []
    for k in keys:
        seen[k] = seen.get(k, 0) + 1
    for k, n in seen.items():
        if n > 1:
            dups.append((k, n))
    if len(set(keys)) != EXPECTED_COUNT or dups:
        for d in dups:
            print(f"  doublon: {d[0]} x{d[1]}", file=sys.stderr)
        fail(f"Garde 3 KO — clés distinctes = {len(set(keys))}, "
             f"attendu {EXPECTED_COUNT} ; doublons = {len(dups)}")
    print(f"[Garde 3] OK — {EXPECTED_COUNT} clés distinctes (nst_level|nst_code|pad_category)")


# ---------- Sérialisation déterministe ----------
def serialize_text_field(v: "str | None") -> str:
    """Texte non-null : '<octet_length_utf8>:<valeur>;'  ; NULL : 'N;'"""
    if v is None:
        return "N;"
    b = v.encode("utf-8")
    return f"{len(b)}:{v};"


def serialize_bool_field(v: bool) -> str:
    """TRUE → '1:t;'  ; FALSE → '1:f;'"""
    return "1:t;" if v else "1:f;"


def serialize_confidence(x: float) -> str:
    """confidence formatée 'FM0.00' puis sérialisée comme texte."""
    s = f"{x:.2f}"
    return serialize_text_field(s)


def row_payload(r: dict) -> str:
    return (
        serialize_text_field(r["nst_level"])
        + serialize_text_field(r["nst_code"])
        + serialize_text_field(r["pad_category"])
        + serialize_confidence(r["confidence"])
        + serialize_text_field(r["evidence_level"])
        + serialize_text_field(r["validation_status"])
        + serialize_text_field(r["notes"])
        + serialize_text_field(r["source_document"])
        + serialize_text_field(r["source_reference"])
        + serialize_bool_field(r["requires_operator_validation"])
        + serialize_bool_field(r["is_active"])
    )


def compute_hash(ready: "list[dict]") -> str:
    sorted_rows = sorted(ready, key=lambda r: (r["nst_level"], r["nst_code"], r["pad_category"]))
    payloads = [row_payload(r) for r in sorted_rows]
    global_payload = "\n".join(payloads)
    return hashlib.md5(global_payload.encode("utf-8")).hexdigest()


# ---------- Main ----------
def main() -> None:
    print("=" * 70)
    print("PAD-NST-2E-B-R3 v3 — compute_r3_source_hash")
    print("=" * 70)

    garde_1_sha256()
    ready = reconstruct_ready()
    parsed = parse_source_sql()
    garde_2_coherence(ready, parsed)
    garde_3_unicite(ready)

    h_source = compute_hash(ready)

    print()
    print("=" * 70)
    print("RÉSULTAT")
    print("=" * 70)
    print(f"H_source         = {h_source}")
    print(f"sha256_source    = {EXPECTED_SHA256}")
    print(f"count            = {len(ready)}")
    print(f"distinct_keys    = {len(set((r['nst_level'], r['nst_code'], r['pad_category']) for r in ready))}")
    confs = [r["confidence"] for r in ready]
    print(f"confidence_range = {min(confs)}-{max(confs)}")
    print()
    print("Sérialisation (règle UNIQUE — alignée Python ↔ SQL) :")
    print("  - Texte non-null : '<octet_length_utf8>:<valeur>;'")
    print("  - Texte NULL    : 'N;' (distinct de '0:;' chaîne vide)")
    print("  - confidence    : f'{x:.2f}' Python ↔ to_char(x, 'FM0.00') SQL,")
    print("                    puis sérialisé comme texte non-null")
    print("  - Booléen TRUE  : '1:t;'")
    print("  - Booléen FALSE : '1:f;'")
    print("  - Tri lignes    : ORDER BY nst_level, nst_code, pad_category")
    print("  - Séparateur    : '\\n' (LF unique) entre lignes")
    print("  - Hash final    : md5(payload_global).hexdigest()")


if __name__ == "__main__":
    main()
