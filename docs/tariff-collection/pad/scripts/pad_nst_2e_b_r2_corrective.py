#!/usr/bin/env python3
"""
PAD-NST-2E-B-R2 — Migration corrective finale
================================================
Phase : DATA-ONLY CORRECTIVE MIGRATION
Méthode : Script Python → SQL généré → migration data-only Lovable Cloud

Contexte :
  - PAD-NST-2E-B initial : 88 lignes importées mais PAS les bonnes 88
  - PAD-NST-2E-B-R1 : correction déclarée mais jamais appliquée (aucune migration dans le dépôt)
  - PAD-NST-2E-B-R2 : purge complète + réimport exact depuis audit R1

Sources :
  - pad_nst_2e_rule_candidates.csv  (manifest original)
  - pad_nst_2e_audit_results.csv    (audit R1)

Garde-fous :
  - Utilise une table temporaire expected_rules pour vérification
  - INSERT dans pad_nst_recommendation_rules depuis expected_rules
  - Contrôle d'égalité exacte expected_rules ↔ table finale
  - Aucun INSERT reconstruit manuellement
  - Script = seule source de génération SQL

Filtres stricts :
  - action NOT IN ('defer', 'remove')
  - audit_tier IN ('TIER-A', 'TIER-B')
  - evidence_level IN ('expert_rule', 'nstr_bridge_inferred')
  - expected = 88 règles exactement
"""

import csv
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
RULES_DIR = SCRIPT_DIR.parent / "rules"

MANIFEST_CSV = RULES_DIR / "pad_nst_2e_rule_candidates.csv"
AUDIT_CSV = RULES_DIR / "pad_nst_2e_audit_results.csv"
OUTPUT_SQL = RULES_DIR / "pad_nst_2e_b_r2_corrective.sql"

ALLOWED_EVIDENCE = {"expert_rule", "nstr_bridge_inferred"}
FORBIDDEN_EVIDENCE = {"pad_official_extract", "operator_override"}
ALLOWED_ACTIONS = {"keep_as_is", "adjust_confidence", "enrich_notes"}
EXCLUDED_ACTIONS = {"defer", "remove"}
ALLOWED_TIERS = {"TIER-A", "TIER-B"}


def escape_sql(s: str) -> str:
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

    # Filter ready rules (identical logic to pad_nst_2e_import.py)
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

    # Hard stop if not exactly 88
    if len(ready) != 88:
        print(f"FATAL: expected 88 ready rules, got {len(ready)}", file=sys.stderr)
        sys.exit(1)

    confs = [r["confidence"] for r in ready]
    if min(confs) != 0.45 or max(confs) != 0.85:
        print(f"FATAL: confidence range {min(confs)}-{max(confs)}, expected 0.45-0.85", file=sys.stderr)
        sys.exit(1)

    # Generate SQL with expected_rules temp table pattern
    L = []
    L.append("-- PAD-NST-2E-B-R2 — Migration corrective finale")
    L.append("-- Généré automatiquement par pad_nst_2e_b_r2_corrective.py")
    L.append("-- NE PAS MODIFIER MANUELLEMENT")
    L.append("-- Sources : pad_nst_2e_rule_candidates.csv + pad_nst_2e_audit_results.csv")
    L.append("-- Filtres : action NOT IN (defer, remove), audit_tier IN (TIER-A, TIER-B)")
    L.append("-- Règles générées : 88")
    L.append("")
    L.append("DO $$")
    L.append("DECLARE")
    L.append("  v_expected INTEGER;")
    L.append("  v_count INTEGER;")
    L.append("  v_bad_status INTEGER;")
    L.append("  v_bad_validation INTEGER;")
    L.append("  v_bad_active INTEGER;")
    L.append("  v_bad_evidence INTEGER;")
    L.append("  v_min_conf NUMERIC;")
    L.append("  v_max_conf NUMERIC;")
    L.append("  v_extra INTEGER;")
    L.append("  v_missing INTEGER;")
    L.append("BEGIN")
    L.append("")
    L.append("  -- ============ PHASE 1: TABLE TEMPORAIRE expected_rules ============")
    L.append("")
    L.append("  CREATE TEMP TABLE expected_rules (")
    L.append("    nst_level text NOT NULL,")
    L.append("    nst_code text NOT NULL,")
    L.append("    pad_category text NOT NULL,")
    L.append("    confidence numeric NOT NULL,")
    L.append("    evidence_level text NOT NULL,")
    L.append("    validation_status text NOT NULL,")
    L.append("    notes text,")
    L.append("    source_document text,")
    L.append("    source_reference text,")
    L.append("    requires_operator_validation boolean NOT NULL,")
    L.append("    is_active boolean NOT NULL")
    L.append("  ) ON COMMIT DROP;")
    L.append("")

    for i, r in enumerate(ready, 1):
        L.append(f"  -- Rule {i}/88: {r['nst_level']}|{r['nst_code']}|{r['pad_category']}")
        L.append(f"  INSERT INTO expected_rules (")
        L.append(f"    nst_level, nst_code, pad_category, confidence, evidence_level,")
        L.append(f"    validation_status, notes, source_document, source_reference,")
        L.append(f"    requires_operator_validation, is_active")
        L.append(f"  ) VALUES (")
        L.append(f"    {escape_sql(r['nst_level'])}, {escape_sql(r['nst_code'])}, {escape_sql(r['pad_category'])},")
        L.append(f"    {r['confidence']}, {escape_sql(r['evidence_level'])},")
        L.append(f"    'candidate', {escape_sql(r['notes'])}, {escape_sql(r['source_document'])},")
        L.append(f"    {escape_sql(r['source_reference'])}, true, true")
        L.append(f"  );")
        L.append("")

    L.append("  -- ============ PHASE 2: CONTRÔLES SUR expected_rules ============")
    L.append("")
    L.append("  -- Contrôle E1: count expected_rules = 88")
    L.append("  SELECT count(*) INTO v_expected FROM expected_rules;")
    L.append("  IF v_expected != 88 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC E1: expected_rules count = %, attendu 88', v_expected;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle E2: aucun validation_status != candidate dans expected")
    L.append("  SELECT count(*) INTO v_bad_status FROM expected_rules WHERE validation_status != 'candidate';")
    L.append("  IF v_bad_status != 0 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC E2: % expected avec validation_status != candidate', v_bad_status;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle E3: aucun requires_operator_validation = false dans expected")
    L.append("  SELECT count(*) INTO v_bad_validation FROM expected_rules WHERE requires_operator_validation = false;")
    L.append("  IF v_bad_validation != 0 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC E3: % expected avec requires_operator_validation = false', v_bad_validation;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle E4: evidence_level strict dans expected")
    L.append("  SELECT count(*) INTO v_bad_evidence FROM expected_rules")
    L.append("    WHERE evidence_level NOT IN ('expert_rule', 'nstr_bridge_inferred');")
    L.append("  IF v_bad_evidence != 0 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC E4: % expected avec evidence_level invalide', v_bad_evidence;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle E5: confidence range dans expected")
    L.append("  SELECT min(confidence), max(confidence) INTO v_min_conf, v_max_conf FROM expected_rules;")
    L.append("  IF v_min_conf != 0.45 OR v_max_conf != 0.85 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC E5: expected confidence range %-%, attendu 0.45-0.85', v_min_conf, v_max_conf;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- ============ PHASE 3: PURGE + IMPORT ============")
    L.append("")
    L.append("  DELETE FROM public.pad_nst_recommendation_rules;")
    L.append("")
    L.append("  INSERT INTO public.pad_nst_recommendation_rules (")
    L.append("    nst_level, nst_code, pad_category, confidence, evidence_level,")
    L.append("    validation_status, notes, source_document, source_reference,")
    L.append("    requires_operator_validation, is_active")
    L.append("  )")
    L.append("  SELECT")
    L.append("    nst_level, nst_code, pad_category, confidence, evidence_level,")
    L.append("    validation_status, notes, source_document, source_reference,")
    L.append("    requires_operator_validation, is_active")
    L.append("  FROM expected_rules;")
    L.append("")
    L.append("  -- ============ PHASE 4: CONTRÔLES TABLE FINALE ============")
    L.append("")
    L.append("  -- Contrôle F1: count final = 88")
    L.append("  SELECT count(*) INTO v_count FROM public.pad_nst_recommendation_rules;")
    L.append("  IF v_count != 88 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC F1: count final = %, attendu 88', v_count;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle F2: aucune validation_status != candidate")
    L.append("  SELECT count(*) INTO v_bad_status FROM public.pad_nst_recommendation_rules WHERE validation_status != 'candidate';")
    L.append("  IF v_bad_status != 0 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC F2: % avec validation_status != candidate', v_bad_status;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle F3: aucune requires_operator_validation = false")
    L.append("  SELECT count(*) INTO v_bad_validation FROM public.pad_nst_recommendation_rules WHERE requires_operator_validation = false;")
    L.append("  IF v_bad_validation != 0 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC F3: % avec requires_operator_validation = false', v_bad_validation;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle F4: aucune is_active = false")
    L.append("  SELECT count(*) INTO v_bad_active FROM public.pad_nst_recommendation_rules WHERE is_active = false;")
    L.append("  IF v_bad_active != 0 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC F4: % avec is_active = false', v_bad_active;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle F5: evidence_level strict")
    L.append("  SELECT count(*) INTO v_bad_evidence FROM public.pad_nst_recommendation_rules")
    L.append("    WHERE evidence_level NOT IN ('expert_rule', 'nstr_bridge_inferred');")
    L.append("  IF v_bad_evidence != 0 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC F5: % avec evidence_level invalide', v_bad_evidence;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle F6: confidence range")
    L.append("  SELECT min(confidence), max(confidence) INTO v_min_conf, v_max_conf FROM public.pad_nst_recommendation_rules;")
    L.append("  IF v_min_conf != 0.45 OR v_max_conf != 0.85 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC F6: confidence range %-%, attendu 0.45-0.85', v_min_conf, v_max_conf;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- ============ PHASE 5: ÉGALITÉ EXACTE expected_rules ↔ table finale ============")
    L.append("")
    L.append("  -- Contrôle EQ1: règles en base absentes de expected_rules = 0")
    L.append("  SELECT count(*) INTO v_extra FROM (")
    L.append("    SELECT nst_level, nst_code, pad_category, confidence, evidence_level,")
    L.append("           validation_status, requires_operator_validation, is_active")
    L.append("    FROM public.pad_nst_recommendation_rules")
    L.append("    EXCEPT")
    L.append("    SELECT nst_level, nst_code, pad_category, confidence, evidence_level,")
    L.append("           validation_status, requires_operator_validation, is_active")
    L.append("    FROM expected_rules")
    L.append("  ) AS extra;")
    L.append("  IF v_extra != 0 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC EQ1: % règles en base absentes de expected_rules', v_extra;")
    L.append("  END IF;")
    L.append("")
    L.append("  -- Contrôle EQ2: règles expected absentes de la table finale = 0")
    L.append("  SELECT count(*) INTO v_missing FROM (")
    L.append("    SELECT nst_level, nst_code, pad_category, confidence, evidence_level,")
    L.append("           validation_status, requires_operator_validation, is_active")
    L.append("    FROM expected_rules")
    L.append("    EXCEPT")
    L.append("    SELECT nst_level, nst_code, pad_category, confidence, evidence_level,")
    L.append("           validation_status, requires_operator_validation, is_active")
    L.append("    FROM public.pad_nst_recommendation_rules")
    L.append("  ) AS missing;")
    L.append("  IF v_missing != 0 THEN")
    L.append("    RAISE EXCEPTION 'ECHEC EQ2: % règles expected absentes de la table finale', v_missing;")
    L.append("  END IF;")
    L.append("")
    L.append("  RAISE NOTICE 'PAD-NST-2E-B-R2: 88 règles importées, égalité exacte confirmée, tous contrôles OK';")
    L.append("END $$;")

    with open(OUTPUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")

    print(f"✅ SQL R2 correctif généré: {OUTPUT_SQL}")
    print(f"   Règles: {len(ready)}")
    print(f"   Confidence range: {min(confs)} - {max(confs)}")
    print(f"   Evidence: expert_rule={sum(1 for r in ready if r['evidence_level']=='expert_rule')}, nstr_bridge_inferred={sum(1 for r in ready if r['evidence_level']=='nstr_bridge_inferred')}")
    print(f"   Pattern: expected_rules temp table → INSERT INTO ... SELECT FROM expected_rules")
    print(f"   Contrôles: 5 sur expected + 6 sur table finale + 2 égalité EXCEPT = 13 total")


if __name__ == "__main__":
    main()
