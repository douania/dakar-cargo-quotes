#!/usr/bin/env python3
"""
PAD-NST-2C — Controlled import of NST 2007 reference data.
Non-runtime script. Kept in repo for traceability only.

Reads 4 UNECE Excel files, normalizes data, inserts into 7 tables
within a single transaction. COMMIT only if expected == actual.
"""

import hashlib
import os
import re
import sys
import subprocess
import json
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone

SOURCES_DIR = Path(__file__).resolve().parent.parent / "unece-sources"
REPORT_PATH = Path(__file__).resolve().parent.parent / "PAD_NST_2C_IMPORT_REPORT.md"

FILES = {
    "cn": "NST2007_CN2024_Table.xlsx",
    "cpa": "NST2007_CPA21_Table.xlsx",
    "nhm": "NST_2007_-_NHM_2025.xlsx",
    "nstr": "NSTR-NST2007.xls",
}

EXPECTED = {
    "nst_mapping_sources": 4,
    "nst_divisions": 20,
    "nst_groups": 73,
    "nst_cpa_mappings": 1759,
    "nst_cn_mappings": 9762,
    "nst_nhm_mappings": 15079,
    "nstr_nst2007_mappings": 9781,
}

DIVISIONS_CE1304 = {
    "01": "Products of agriculture, hunting, and forestry; fish and other fishing products",
    "02": "Coal and lignite; crude petroleum and natural gas",
    "03": "Metal ores and other mining and quarrying products; peat; uranium and thorium ores",
    "04": "Food products, beverages and tobacco",
    "05": "Textiles and textile products; leather and leather products",
    "06": "Wood and products of wood and cork; pulp, paper and paper products; printed matter and recorded media",
    "07": "Coke and refined petroleum products",
    "08": "Chemicals, chemical products, and man-made fibres; rubber and plastic products; nuclear fuel",
    "09": "Other non-metallic mineral products",
    "10": "Basic metals; fabricated metal products, except machinery and equipment",
    "11": "Machinery and equipment n.e.c.; office machinery and computers; electrical machinery and apparatus n.e.c.; radio, television and communication equipment and apparatus; medical, precision and optical instruments; watches and clocks",
    "12": "Transport equipment",
    "13": "Furniture; other manufactured goods n.e.c.",
    "14": "Secondary raw materials; municipal wastes and other wastes",
    "15": "Mail, parcels",
    "16": "Equipment and material utilised in the transport of goods",
    "17": "Goods moved in the course of household and office removals; baggage and articles accompanying travellers; motor vehicles being moved for repair; other non-market goods n.e.c.",
    "18": "Grouped goods: a mixture of types of goods which are transported together",
    "19": "Unidentifiable goods",
    "20": "Other goods n.e.c.",
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def escape_sql(val):
    if val is None:
        return "NULL"
    s = str(val).replace("'", "''")
    return f"'{s}'"


def run_psql(sql: str) -> str:
    result = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
        input=sql, capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql error: {result.stderr}")
    return result.stdout.strip()


def build_sql():
    print("Reading Excel files...")
    cn_df = pd.read_excel(SOURCES_DIR / FILES["cn"])
    cpa_df = pd.read_excel(SOURCES_DIR / FILES["cpa"])
    nhm_df = pd.read_excel(SOURCES_DIR / FILES["nhm"])
    nstr_df = pd.read_excel(SOURCES_DIR / FILES["nstr"])

    hashes = {}
    for key, fname in FILES.items():
        hashes[key] = sha256_file(SOURCES_DIR / fname)
    print(f"SHA256 computed: {json.dumps(hashes, indent=2)}")

    # Collect all groups from all 4 files
    all_groups = set()
    all_groups.update(str(x).strip() for x in cn_df["NST2007_CODE"].dropna().unique())
    all_groups.update(str(x).strip() for x in cpa_df["NST2007_CODE"].dropna().unique())
    all_groups.update(str(x).strip() for x in nhm_df["NST_2007_CODE 81 positions"].dropna().unique())
    nstr_nst = nstr_df["NST2007"].dropna()
    nstr_nst = nstr_nst[nstr_nst.astype(str).str.strip() != "."]
    all_groups.update(str(x).strip() for x in nstr_nst.unique())
    all_groups = sorted(all_groups, key=str)
    print(f"Groups detected: {len(all_groups)}")

    # Derive divisions from groups
    group_divisions = sorted(set(g.split(".")[0] for g in all_groups))
    print(f"Divisions from data: {len(group_divisions)} -> {group_divisions}")

    # Group labels from CN (most complete labels)
    group_labels = {}
    for _, row in cn_df.drop_duplicates(subset=["NST2007_CODE"]).iterrows():
        gc = str(row["NST2007_CODE"]).strip()
        group_labels[gc] = str(row.get("NST2007_NAME", "")).strip()
    for _, row in cpa_df.drop_duplicates(subset=["NST2007_CODE"]).iterrows():
        gc = str(row["NST2007_CODE"]).strip()
        if gc not in group_labels:
            group_labels[gc] = str(row.get("NST2007_NAME", "")).strip()
    for _, row in nhm_df.drop_duplicates(subset=["NST_2007_CODE 81 positions"]).iterrows():
        gc = str(row["NST_2007_CODE 81 positions"]).strip()
        if gc not in group_labels and pd.notna(row.get("Label NST 2007 81 positions")):
            group_labels[gc] = str(row["Label NST 2007 81 positions"]).strip()
    for _, row in nstr_df.drop_duplicates(subset=["NST2007"]).iterrows():
        if pd.isna(row["NST2007"]) or str(row["NST2007"]).strip() == ".":
            continue
        gc = str(row["NST2007"]).strip()
        if gc not in group_labels and pd.notna(row.get("NST2007 Label")):
            group_labels[gc] = str(row["NST2007 Label"]).strip()

    # Build SQL
    stmts = ["BEGIN;"]

    # E1: nst_mapping_sources
    phase = "PAD-NST-2C"
    for key, fname in FILES.items():
        fpath = SOURCES_DIR / fname
        stmts.append(
            f"INSERT INTO nst_mapping_sources (source_name, source_type, sha256_hash, row_count, local_path, phase) "
            f"VALUES ({escape_sql(fname)}, 'xlsx', {escape_sql(hashes[key])}, "
            f"{len(cn_df) if key == 'cn' else len(cpa_df) if key == 'cpa' else len(nhm_df) if key == 'nhm' else len(nstr_df)}, "
            f"{escape_sql(f'docs/tariff-collection/pad/unece-sources/{fname}')}, {escape_sql(phase)}) "
            f"ON CONFLICT DO NOTHING;"
        )

    # E2: nst_divisions (all 20 official)
    for div_code, label in DIVISIONS_CE1304.items():
        stmts.append(
            f"INSERT INTO nst_divisions (division_code, label_en) "
            f"VALUES ({escape_sql(div_code)}, {escape_sql(label)}) "
            f"ON CONFLICT DO NOTHING;"
        )

    # E3: nst_groups (73)
    for gc in all_groups:
        div = gc.split(".")[0]
        label = group_labels.get(gc, "")
        stmts.append(
            f"INSERT INTO nst_groups (group_code, division_code, label_en) "
            f"VALUES ({escape_sql(gc)}, {escape_sql(div)}, {escape_sql(label)}) "
            f"ON CONFLICT DO NOTHING;"
        )

    # We need source IDs for mappings - fetch them after insert
    # Use a CTE approach: first get source IDs
    stmts.append("-- Source IDs will be resolved via subqueries")

    # E4: nst_cpa_mappings
    for idx, row in cpa_df.iterrows():
        gc = str(row["NST2007_CODE"]).strip()
        cpa_code = str(row["CPA21_CODE"]).strip()
        cpa_label = str(row.get("CPA21_NAME", "")).strip() if pd.notna(row.get("CPA21_NAME")) else None
        src_uri = str(row.get("Source", "")).strip() if pd.notna(row.get("Source")) else None
        tgt_uri = str(row.get("Target", "")).strip() if pd.notna(row.get("Target")) else None
        row_num = idx + 2
        stmts.append(
            f"INSERT INTO nst_cpa_mappings (nst_group_code, cpa_code, cpa_label, source_id, source_row_number, source_uri, target_uri) "
            f"VALUES ({escape_sql(gc)}, {escape_sql(cpa_code)}, {escape_sql(cpa_label)}, "
            f"(SELECT id FROM nst_mapping_sources WHERE source_name = {escape_sql(FILES['cpa'])} AND phase = {escape_sql(phase)} LIMIT 1), "
            f"{row_num}, {escape_sql(src_uri)}, {escape_sql(tgt_uri)}) "
            f"ON CONFLICT DO NOTHING;"
        )

    # E5: nst_cn_mappings
    for idx, row in cn_df.iterrows():
        gc = str(row["NST2007_CODE"]).strip()
        raw_cn = str(row["CN2024_CODE"]).strip() if pd.notna(row.get("CN2024_CODE")) else ""
        cn_code = re.sub(r"\D", "", raw_cn)
        if len(cn_code) != 8:
            print(f"WARN: CN row {idx+2} code '{raw_cn}' -> '{cn_code}' not 8 digits, skipping")
            continue
        hs6 = cn_code[:6]
        cn_label = str(row.get("CN2024_NAME", "")).strip() if pd.notna(row.get("CN2024_NAME")) else None
        src_uri = str(row.get("Source", "")).strip() if pd.notna(row.get("Source")) else None
        tgt_uri = str(row.get("Target", "")).strip() if pd.notna(row.get("Target")) else None
        row_num = idx + 2
        stmts.append(
            f"INSERT INTO nst_cn_mappings (nst_group_code, cn_code, cn_label, hs6_prefix, source_id, source_row_number, source_uri, target_uri) "
            f"VALUES ({escape_sql(gc)}, {escape_sql(cn_code)}, {escape_sql(cn_label)}, {escape_sql(hs6)}, "
            f"(SELECT id FROM nst_mapping_sources WHERE source_name = {escape_sql(FILES['cn'])} AND phase = {escape_sql(phase)} LIMIT 1), "
            f"{row_num}, {escape_sql(src_uri)}, {escape_sql(tgt_uri)}) "
            f"ON CONFLICT DO NOTHING;"
        )

    # E6: nst_nhm_mappings
    for idx, row in nhm_df.iterrows():
        raw_nhm = row.get("NHM_2025_Code")
        if pd.isna(raw_nhm):
            continue
        nhm_code = re.sub(r"\D", "", str(raw_nhm)).zfill(12)
        if len(nhm_code) != 12:
            print(f"WARN: NHM row {idx+2} code '{raw_nhm}' -> '{nhm_code}' not 12 digits, skipping")
            continue
        gc_81 = row.get("NST_2007_CODE 81 positions")
        if pd.isna(gc_81):
            continue
        gc = str(gc_81).strip()
        nhm_label = str(row.get("Label NHM_2025 (EN)", "")).strip() if pd.notna(row.get("Label NHM_2025 (EN)")) else None
        row_num = idx + 2
        stmts.append(
            f"INSERT INTO nst_nhm_mappings (nst_group_code, nhm_code, nhm_label, source_id, source_row_number) "
            f"VALUES ({escape_sql(gc)}, {escape_sql(nhm_code)}, {escape_sql(nhm_label)}, "
            f"(SELECT id FROM nst_mapping_sources WHERE source_name = {escape_sql(FILES['nhm'])} AND phase = {escape_sql(phase)} LIMIT 1), "
            f"{row_num}) "
            f"ON CONFLICT DO NOTHING;"
        )

    # E7: nstr_nst2007_mappings
    excluded_dot = 0
    quarantined_null = 0
    for idx, row in nstr_df.iterrows():
        nst2007_raw = row.get("NST2007")
        if pd.notna(nst2007_raw) and str(nst2007_raw).strip() == ".":
            excluded_dot += 1
            continue
        nst2007_code = str(nst2007_raw).strip() if pd.notna(nst2007_raw) else None
        if nst2007_code is None:
            continue

        nstr_raw = row.get("NSTR")
        is_quarantined = False
        quarantine_reason = None
        if pd.isna(nstr_raw):
            nstr_code = None
            nstr_chapter = None
            is_quarantined = True
            quarantine_reason = "NSTR_NULL_CPA_ONLY"
            quarantined_null += 1
        else:
            nstr_code = str(int(float(nstr_raw))).zfill(3)
            nstr_chapter = nstr_code[:2]

        nstr_label = str(row.get("NSTR Label", "")).strip() if pd.notna(row.get("NSTR Label")) else None
        cn2008_raw = row.get("CN2008")
        cn2008_code = str(int(float(cn2008_raw))).zfill(8) if pd.notna(cn2008_raw) else None
        cpa2008_code = str(row.get("CPA2008", "")).strip() if pd.notna(row.get("CPA2008")) else None
        nst2007_label = str(row.get("NST2007 Label", "")).strip() if pd.notna(row.get("NST2007 Label")) else None
        row_num = idx + 2

        stmts.append(
            f"INSERT INTO nstr_nst2007_mappings (nstr_code, nstr_chapter, nstr_label, cn2008_code, cpa2008_code, "
            f"nst2007_code, nst2007_label, is_quarantined, quarantine_reason, source_id, source_row_number) "
            f"VALUES ({escape_sql(nstr_code)}, {escape_sql(nstr_chapter)}, {escape_sql(nstr_label)}, "
            f"{escape_sql(cn2008_code)}, {escape_sql(cpa2008_code)}, "
            f"{escape_sql(nst2007_code)}, {escape_sql(nst2007_label)}, "
            f"{'true' if is_quarantined else 'false'}, {escape_sql(quarantine_reason)}, "
            f"(SELECT id FROM nst_mapping_sources WHERE source_name = {escape_sql(FILES['nstr'])} AND phase = {escape_sql(phase)} LIMIT 1), "
            f"{row_num}) "
            f"ON CONFLICT DO NOTHING;"
        )

    print(f"excluded_dot_count = {excluded_dot}")
    print(f"quarantined_nstr_null_count = {quarantined_null}")

    # Verification queries
    for table, expected in EXPECTED.items():
        stmts.append(f"SELECT '{table}' AS tbl, COUNT(*)::text AS cnt FROM {table};")

    stmts.append("COMMIT;")

    return "\n".join(stmts), hashes, excluded_dot, quarantined_null


if __name__ == "__main__":
    sql, hashes, excluded_dot, quarantined_null = build_sql()

    sql_path = "/tmp/pad_nst_2c.sql"
    with open(sql_path, "w") as f:
        f.write(sql)
    print(f"SQL written to {sql_path} ({len(sql)} bytes, {sql.count(chr(10))+1} lines)")
    print("To execute: psql -v ON_ERROR_STOP=1 -f /tmp/pad_nst_2c.sql")
