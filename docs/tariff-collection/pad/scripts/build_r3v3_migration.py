#!/usr/bin/env python3
"""
PAD-NST-2E-B-R3 v3 — Builder de la migration R3 v3
====================================================
Construit la migration R3 v3 par injection minimale dans une copie
byte-for-byte du fichier source R2 :
  - en-tête R3 v3 (commentaires uniquement, avant DO $$)
  - 2 lignes DECLARE supplémentaires (v_db_hash, v_expected_hash)
  - bloc PHASE 1bis (garde E0) entre fin PHASE 1 et début PHASE 2

Vérifications post-construction :
  - SHA-256 des zones non injectées du R3 v3 = SHA-256 d'une copie pure du source
  - H_source injecté = H_source recalculé

Aucune autre modification. Aucun effet DB.
"""

import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE_SQL = ROOT / "docs/tariff-collection/pad/rules/pad_nst_2e_b_r2_corrective.sql"
MIGRATIONS_DIR = ROOT / "supabase/migrations"

EXPECTED_SOURCE_SHA = "fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50"

# H_source calculé par compute_r3_source_hash.py (à passer en argument)
def get_h_source() -> str:
    sys.path.insert(0, str(Path(__file__).parent))
    from compute_r3_source_hash import (
        garde_1_sha256, reconstruct_ready, parse_source_sql,
        garde_2_coherence, garde_3_unicite, compute_hash,
    )
    garde_1_sha256()
    ready = reconstruct_ready()
    parsed = parse_source_sql()
    garde_2_coherence(ready, parsed)
    garde_3_unicite(ready)
    return compute_hash(ready)


def main(timestamp: str) -> None:
    h_source = get_h_source()
    print(f"H_source = {h_source}")

    src = SOURCE_SQL.read_text(encoding="utf-8")
    src_sha = hashlib.sha256(src.encode("utf-8")).hexdigest()
    if src_sha != EXPECTED_SOURCE_SHA:
        print(f"FATAL: source SHA mismatch", file=sys.stderr)
        sys.exit(1)

    src_lines = src.splitlines(keepends=True)
    # Sanity check on R2 source structure
    assert src_lines[8].strip() == "DECLARE", f"line 9 attendu DECLARE, got {src_lines[8]!r}"
    assert src_lines[18].strip().startswith("v_missing"), f"line 19 attendu v_missing, got {src_lines[18]!r}"
    assert src_lines[19].strip() == "BEGIN", f"line 20 attendu BEGIN, got {src_lines[19]!r}"
    # PHASE 2 marker (1-indexed line 1094 → 0-indexed 1093)
    phase2_idx = None
    for i, ln in enumerate(src_lines):
        if "PHASE 2: CONTRÔLES SUR expected_rules" in ln:
            phase2_idx = i
            break
    assert phase2_idx is not None, "PHASE 2 marker not found"
    print(f"phase2_idx (0-based) = {phase2_idx} (line {phase2_idx + 1})")

    # ----- R3 v3 header (commentaires uniquement, avant DO $$) -----
    header = (
        "-- PAD-NST-2E-B-R3 v3 — Migration corrective avec garde E0 (checksum indépendant)\n"
        "-- Date : 2026-05-09\n"
        "-- Statut : R3 v3 — préparation locale, exécution DB en attente de GO CTO séparé\n"
        "-- Source SQL : docs/tariff-collection/pad/rules/pad_nst_2e_b_r2_corrective.sql\n"
        f"-- SHA-256 source : {EXPECTED_SOURCE_SHA}\n"
        "-- Méthode : copie byte-for-byte du body source R2 + 3 zones d'injection minimale :\n"
        "--   1) cet en-tête (commentaires uniquement)\n"
        "--   2) 2 lignes DECLARE supplémentaires (v_db_hash, v_expected_hash)\n"
        "--   3) bloc PHASE 1bis (garde E0) entre fin PHASE 1 et début PHASE 2\n"
        "-- Garde E0 : md5 indépendant calculé côté DB sur expected_rules,\n"
        f"--   comparé à H_source = '{h_source}' calculé par compute_r3_source_hash.py.\n"
        "-- Sérialisation déterministe : len:val; ; NULL=N; ; bool TRUE=1:t;|FALSE=1:f; ;\n"
        "--   confidence=FM0.00 ; lignes triées (nst_level,nst_code,pad_category) ; LF entre lignes.\n"
        "-- Si la transmission du payload est altérée d'un seul octet : E0 RAISE EXCEPTION → rollback.\n"
        "-- Contrôles internes existants (E1–E5, F1–F6, EQ1–EQ2) préservés byte-for-byte.\n"
        "-- NE PAS MODIFIER CE FICHIER\n"
    )

    # ----- DECLARE injection (2 lignes après v_missing INTEGER;) -----
    declare_extra = (
        "  v_db_hash text;\n"
        "  v_expected_hash text;\n"
    )

    # ----- PHASE 1bis injection -----
    phase1bis = (
        "  -- ============ PHASE 1bis: GARDE E0 — CHECKSUM INDÉPENDANT ============\n"
        "  -- Détecte toute corruption silencieuse du payload inline AVANT le DELETE.\n"
        "  -- Sérialisation : len:val; ; NULL=N; ; bool TRUE=1:t;|FALSE=1:f; ; confidence=FM0.00\n"
        "  -- Ordre : nst_level, nst_code, pad_category (88 clés uniques garanties par script source).\n"
        "  -- LF unique entre lignes. Hash final : md5(payload_global).\n"
        "\n"
        f"  v_expected_hash := '{h_source}';\n"
        "\n"
        "  SELECT md5(string_agg(row_payload, E'\\n' ORDER BY nst_level, nst_code, pad_category))\n"
        "  INTO v_db_hash\n"
        "  FROM (\n"
        "    SELECT\n"
        "      nst_level, nst_code, pad_category,\n"
        "      octet_length(nst_level)::text || ':' || nst_level || ';' ||\n"
        "      octet_length(nst_code)::text || ':' || nst_code || ';' ||\n"
        "      octet_length(pad_category)::text || ':' || pad_category || ';' ||\n"
        "      octet_length(to_char(confidence, 'FM0.00'))::text || ':' || to_char(confidence, 'FM0.00') || ';' ||\n"
        "      octet_length(evidence_level)::text || ':' || evidence_level || ';' ||\n"
        "      octet_length(validation_status)::text || ':' || validation_status || ';' ||\n"
        "      CASE WHEN notes IS NULL THEN 'N;'\n"
        "           ELSE octet_length(notes)::text || ':' || notes || ';' END ||\n"
        "      CASE WHEN source_document IS NULL THEN 'N;'\n"
        "           ELSE octet_length(source_document)::text || ':' || source_document || ';' END ||\n"
        "      CASE WHEN source_reference IS NULL THEN 'N;'\n"
        "           ELSE octet_length(source_reference)::text || ':' || source_reference || ';' END ||\n"
        "      (CASE WHEN requires_operator_validation THEN '1:t;' ELSE '1:f;' END) ||\n"
        "      (CASE WHEN is_active THEN '1:t;' ELSE '1:f;' END)\n"
        "      AS row_payload\n"
        "    FROM expected_rules\n"
        "  ) AS s;\n"
        "\n"
        "  IF v_db_hash IS DISTINCT FROM v_expected_hash THEN\n"
        "    RAISE EXCEPTION 'ECHEC E0: payload corruption detected. db_hash=% expected=%', v_db_hash, v_expected_hash;\n"
        "  END IF;\n"
        "\n"
    )

    # Build R3 v3 by reassembling the source file
    # Lines 0-18 (1-indexed 1-19): R2 original header (7 lines) + blank + DECLARE + 10 var lines
    # Insert declare_extra after line 18 (0-based) = before line 19 (BEGIN)
    # Then keep BEGIN..PHASE 1 (up to and including last line before PHASE 2 marker)
    # Inject PHASE 1bis before phase2_idx
    # Then keep from phase2_idx to end

    out = [header] + src_lines[:19] + [declare_extra] + src_lines[19:phase2_idx] + [phase1bis] + src_lines[phase2_idx:]
    out_text = "".join(out)

    # ----- Write migration file -----
    out_path = MIGRATIONS_DIR / f"{timestamp}_pad_nst_2e_b_r3_v3_corrective.sql"
    out_path.write_text(out_text, encoding="utf-8")
    out_sha = hashlib.sha256(out_text.encode("utf-8")).hexdigest()
    print(f"R3 v3 written: {out_path}")
    print(f"R3 v3 SHA-256 = {out_sha}")

    # ----- Verify byte-for-byte integrity of non-injected zones -----
    # Reconstruct "pure copy" by removing the 3 injected zones from R3 v3
    out_lines = out_text.splitlines(keepends=True)
    # Header is at top: count of header lines
    header_line_count = header.count("\n")
    # declare_extra position: after the 19 original-source lines + header_line_count
    # After header (header_line_count lines), src lines 0-18 (19 lines), then declare_extra (2 lines)
    # then src lines 19..phase2_idx-1, then phase1bis, then rest
    declare_extra_lc = declare_extra.count("\n")  # 2
    phase1bis_lc = phase1bis.count("\n")

    # Strip header
    stripped = out_lines[header_line_count:]
    # Strip declare_extra block (positions 19..19+2 in stripped)
    stripped = stripped[:19] + stripped[19 + declare_extra_lc:]
    # Strip phase1bis: phase2_idx in source is unchanged in stripped (header removed, declare removed)
    stripped = stripped[:phase2_idx] + stripped[phase2_idx + phase1bis_lc:]

    reconstructed = "".join(stripped)
    reconstructed_sha = hashlib.sha256(reconstructed.encode("utf-8")).hexdigest()
    print(f"Reconstructed (R3v3 minus 3 zones) SHA-256 = {reconstructed_sha}")
    print(f"Source                                SHA-256 = {src_sha}")
    if reconstructed_sha != src_sha:
        print("FATAL: byte-for-byte integrity check FAILED", file=sys.stderr)
        # Diff debug
        diff = subprocess.run(
            ["diff", "-u", "/dev/stdin", str(SOURCE_SQL)],
            input=reconstructed, capture_output=True, text=True
        )
        print(diff.stdout[:2000], file=sys.stderr)
        sys.exit(1)
    print("[Byte-for-byte] OK — R3 v3 minus 3 zones autorisées = source pure")

    # ----- Generate diff for CTO review -----
    diff_path = ROOT / "docs/tariff-collection/pad/PAD_NST_2E_B_R3_V3_diff.txt"
    diff = subprocess.run(
        ["diff", "-u", str(SOURCE_SQL), str(out_path)],
        capture_output=True, text=True
    )
    diff_path.write_text(diff.stdout, encoding="utf-8")
    print(f"Diff written: {diff_path}")
    print(f"Diff length: {len(diff.stdout)} chars / {diff.stdout.count(chr(10))} lines")

    # Summary
    print()
    print("=" * 70)
    print("RÉSUMÉ R3 v3")
    print("=" * 70)
    print(f"H_source                  = {h_source}")
    print(f"SHA source R2             = {src_sha}")
    print(f"SHA R3 v3                 = {out_sha}")
    print(f"SHA R3v3 minus 3 zones    = {reconstructed_sha}  (== source ✓)")
    print(f"Migration file            = {out_path.relative_to(ROOT)}")
    print(f"Diff file                 = {diff_path.relative_to(ROOT)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: build_r3v3_migration.py <timestamp>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
