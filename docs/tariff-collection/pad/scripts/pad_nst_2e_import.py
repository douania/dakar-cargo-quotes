#!/usr/bin/env python3
"""
PAD-NST-2E-B — Import contrôlé des 88 règles candidates
=========================================================
Phase : DATA-ONLY MIGRATION (pas d'import direct via insert tool)
Méthode : Script Python → SQL généré → migration data-only Lovable Cloud

Sources :
  - pad_nst_2e_rule_candidates.csv  (manifest original : evidence_level, source_document, source_reference, notes)
  - pad_nst_2e_audit_results.csv    (audit R1 : adjusted_confidence, audit_note, action, audit_tier)

Règles d'import :
  - Uniquement action NOT IN ('defer', 'remove')
  - TIER-A + TIER-B uniquement, jamais TIER-C
  - evidence_level uniquement expert_rule ou nstr_bridge_inferred
  - validation_status = 'candidate' (explicite)
  - requires_operator_validation = true (explicite)
  - is_active = true (explicite)
  - confidence = adjusted_confidence R1

Le SQL est transactionnel : BEGIN → INSERTs → contrôles → RAISE EXCEPTION si écart → COMMIT.
"""

import csv
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
RULES_DIR = SCRIPT_DIR.parent / "rules"

MANIFEST_CSV = RULES_DIR / "pad_nst_2e_rule_candidates.csv"
AUDIT_CSV = RULES_DIR / "pad_nst_2e_audit_results.csv"
OUTPUT_SQL = RULES_DIR / "pad_nst_2e_import.sql"

# Allowed values (mirrors DB CHECK constraints)
ALLOWED_EVIDENCE = {"expert_rule", "nstr_bridge_inferred"}
FORBIDDEN_EVIDENCE = {"pad_official_extract", "operator_override"}
ALLOWED_ACTIONS = {"keep_as_is", "adjust_confidence", "enrich_notes"}
EXCLUDED_ACTIONS = {"defer", "remove"}
ALLOWED_TIERS = {"TIER-A", "TIER-B"}


def escape_sql(s: str) -> str:
    """Escape single quotes for SQL."""
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def main():
    # Load manifest
    manifest = {}
    with open(MANIFEST_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = f"{row['nst_level']}|{row['nst_code']}|{row['pad_category']}"
            manifest[key] = row

    # Load audit
    audit = {}
    with open(AUDIT_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            audit[row["rule_key"]] = row

    # Filter ready rules
    ready = []
    for key, a in sorted(audit.items()):
        if a["action"] in EXCLUDED_ACTIONS:
            continue
        if a["audit_tier"] not in ALLOWED_TIERS:
            print(f"SKIP (tier={a['audit_tier']}): {key}", file=sys.stderr)
            continue
        if a["action"] not in ALLOWED_ACTIONS:
            print(f"ERROR: unknown action '{a['action']}' for {key}", file=sys.stderr)
            sys.exit(1)
        if key not in manifest:
            print(f"ERROR: {key} not found in manifest", file=sys.stderr)
            sys.exit(1)

        m = manifest[key]
        ev = m["evidence_level"]
        if ev in FORBIDDEN_EVIDENCE:
            print(f"ERROR: forbidden evidence_level '{ev}' for {key}", file=sys.stderr)
            sys.exit(1)
        if ev not in ALLOWED_EVIDENCE:
            print(f"ERROR: unknown evidence_level '{ev}' for {key}", file=sys.stderr)
            sys.exit(1)

        conf = float(a["adjusted_confidence"])
        if conf < 0 or conf > 1:
            print(f"ERROR: confidence {conf} out of range for {key}", file=sys.stderr)
            sys.exit(1)

        # Combine notes: original + audit note
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
            "source_document": m.get("source_document"),
            "source_reference": m.get("source_reference"),
            "requires_operator_validation": True,
            "is_active": True,
        })

    if len(ready) != 88:
        print(f"ERROR: expected 88 ready rules, got {len(ready)}", file=sys.stderr)
        sys.exit(1)

    # Confidence range check
    confs = [r["confidence"] for r in ready]
    if min(confs) != 0.45 or max(confs) != 0.85:
        print(f"ERROR: confidence range {min(confs)}-{max(confs)}, expected 0.45-0.85", file=sys.stderr)
        sys.exit(1)

    # Generate SQL
    lines = []
    lines.append("-- PAD-NST-2E-B — Import contrôlé de 88 règles candidates")
    lines.append("-- Généré par pad_nst_2e_import.py")
    lines.append("-- Méthode unique : migration data-only transactionnelle")
    lines.append("-- AUCUNE règle TIER-C, AUCUNE validated, AUCUNE requires_operator_validation=false")
    lines.append("")
    lines.append("DO $$")
    lines.append("DECLARE")
    lines.append("  v_count INTEGER;")
    lines.append("  v_bad_status INTEGER;")
    lines.append("  v_bad_validation INTEGER;")
    lines.append("  v_bad_active INTEGER;")
    lines.append("  v_bad_evidence INTEGER;")
    lines.append("  v_min_conf NUMERIC;")
    lines.append("  v_max_conf NUMERIC;")
    lines.append("BEGIN")
    lines.append("")
    lines.append("  -- Vérifier que la table est vide avant import")
    lines.append("  SELECT count(*) INTO v_count FROM public.pad_nst_recommendation_rules;")
    lines.append("  IF v_count != 0 THEN")
    lines.append("    RAISE EXCEPTION 'Table non vide avant import: % lignes existantes', v_count;")
    lines.append("  END IF;")
    lines.append("")

    for i, r in enumerate(ready, 1):
        lines.append(f"  -- Rule {i}/88: {r['nst_level']}|{r['nst_code']}|{r['pad_category']}")
        lines.append(f"  INSERT INTO public.pad_nst_recommendation_rules (")
        lines.append(f"    nst_level, nst_code, pad_category, confidence, evidence_level,")
        lines.append(f"    validation_status, notes, source_document, source_reference,")
        lines.append(f"    requires_operator_validation, is_active")
        lines.append(f"  ) VALUES (")
        lines.append(f"    {escape_sql(r['nst_level'])}, {escape_sql(r['nst_code'])}, {escape_sql(r['pad_category'])},")
        lines.append(f"    {r['confidence']}, {escape_sql(r['evidence_level'])},")
        lines.append(f"    'candidate', {escape_sql(r['notes'])}, {escape_sql(r['source_document'])},")
        lines.append(f"    {escape_sql(r['source_reference'])}, true, true")
        lines.append(f"  );")
        lines.append("")

    # Post-insert integrity checks
    lines.append("  -- ============ CONTRÔLES POST-IMPORT ============")
    lines.append("")
    lines.append("  -- Contrôle 1: count total = 88")
    lines.append("  SELECT count(*) INTO v_count FROM public.pad_nst_recommendation_rules;")
    lines.append("  IF v_count != 88 THEN")
    lines.append("    RAISE EXCEPTION 'ECHEC: count total = %, attendu 88', v_count;")
    lines.append("  END IF;")
    lines.append("")
    lines.append("  -- Contrôle 2: aucune validated")
    lines.append("  SELECT count(*) INTO v_bad_status FROM public.pad_nst_recommendation_rules WHERE validation_status != 'candidate';")
    lines.append("  IF v_bad_status != 0 THEN")
    lines.append("    RAISE EXCEPTION 'ECHEC: % règles avec validation_status != candidate', v_bad_status;")
    lines.append("  END IF;")
    lines.append("")
    lines.append("  -- Contrôle 3: aucune requires_operator_validation = false")
    lines.append("  SELECT count(*) INTO v_bad_validation FROM public.pad_nst_recommendation_rules WHERE requires_operator_validation = false;")
    lines.append("  IF v_bad_validation != 0 THEN")
    lines.append("    RAISE EXCEPTION 'ECHEC: % règles avec requires_operator_validation = false', v_bad_validation;")
    lines.append("  END IF;")
    lines.append("")
    lines.append("  -- Contrôle 4: aucune is_active = false")
    lines.append("  SELECT count(*) INTO v_bad_active FROM public.pad_nst_recommendation_rules WHERE is_active = false;")
    lines.append("  IF v_bad_active != 0 THEN")
    lines.append("    RAISE EXCEPTION 'ECHEC: % règles avec is_active = false', v_bad_active;")
    lines.append("  END IF;")
    lines.append("")
    lines.append("  -- Contrôle 5: evidence_level strict")
    lines.append("  SELECT count(*) INTO v_bad_evidence FROM public.pad_nst_recommendation_rules")
    lines.append("    WHERE evidence_level NOT IN ('expert_rule', 'nstr_bridge_inferred');")
    lines.append("  IF v_bad_evidence != 0 THEN")
    lines.append("    RAISE EXCEPTION 'ECHEC: % règles avec evidence_level invalide', v_bad_evidence;")
    lines.append("  END IF;")
    lines.append("")
    lines.append("  -- Contrôle 6: confidence range")
    lines.append("  SELECT min(confidence), max(confidence) INTO v_min_conf, v_max_conf FROM public.pad_nst_recommendation_rules;")
    lines.append("  IF v_min_conf != 0.45 OR v_max_conf != 0.85 THEN")
    lines.append("    RAISE EXCEPTION 'ECHEC: confidence range %-%, attendu 0.45-0.85', v_min_conf, v_max_conf;")
    lines.append("  END IF;")
    lines.append("")
    lines.append("  RAISE NOTICE 'PAD-NST-2E-B: 88 règles importées avec succès, tous contrôles OK';")
    lines.append("END $$;")

    with open(OUTPUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"✅ SQL généré: {OUTPUT_SQL}")
    print(f"   Règles importées: {len(ready)}")
    print(f"   Confidence range: {min(confs)} - {max(confs)}")
    print(f"   Evidence levels: expert_rule={sum(1 for r in ready if r['evidence_level']=='expert_rule')}, nstr_bridge_inferred={sum(1 for r in ready if r['evidence_level']=='nstr_bridge_inferred')}")


if __name__ == "__main__":
    main()
