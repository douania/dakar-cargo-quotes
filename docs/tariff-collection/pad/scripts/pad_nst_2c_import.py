#!/usr/bin/env python3
"""
PAD-NST-2C — Controlled import of NST 2007 reference data.
Non-runtime script. Kept in repo for traceability only.

This is the BATCH version actually used for the final import.
Uses multi-value INSERTs (chunks of 500) for performance.
Includes transactional COMMIT/ROLLBACK: RAISE EXCEPTION if expected != actual.
"""

import hashlib, re, subprocess, json
import pandas as pd
from pathlib import Path

SOURCES_DIR = Path(__file__).resolve().parent.parent / "unece-sources"

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


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(8192), b""):
            h.update(c)
    return h.hexdigest()


def esc(v):
    if v is None:
        return "NULL"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def chunk_insert(table, columns, rows, batch=500):
    """Generate multi-value INSERT statements in chunks for performance."""
    stmts = []
    for i in range(0, len(rows), batch):
        chunk = rows[i : i + batch]
        vals = ",\n".join(f"({','.join(r)})" for r in chunk)
        stmts.append(
            f"INSERT INTO {table} ({','.join(columns)}) VALUES\n{vals}\nON CONFLICT DO NOTHING;"
        )
    return stmts


def build_sql():
    print("Reading Excel files...")
    cn = pd.read_excel(SOURCES_DIR / FILES["cn"])
    cpa = pd.read_excel(SOURCES_DIR / FILES["cpa"])
    nhm = pd.read_excel(SOURCES_DIR / FILES["nhm"])
    nstr = pd.read_excel(SOURCES_DIR / FILES["nstr"])
    hashes = {k: sha256_file(SOURCES_DIR / v) for k, v in FILES.items()}
    print(f"SHA256: {json.dumps(hashes, indent=2)}")

    # Collect all groups from all 4 files
    all_groups = set()
    all_groups.update(str(x).strip() for x in cn["NST2007_CODE"].dropna().unique())
    all_groups.update(str(x).strip() for x in cpa["NST2007_CODE"].dropna().unique())
    all_groups.update(
        str(x).strip() for x in nhm["NST_2007_CODE 81 positions"].dropna().unique()
    )
    nstr_nst = nstr["NST2007"].dropna()
    nstr_nst = nstr_nst[nstr_nst.astype(str).str.strip() != "."]
    all_groups.update(str(x).strip() for x in nstr_nst.unique())
    all_groups = sorted(all_groups, key=str)
    print(f"Groups detected: {len(all_groups)}")

    # Group labels (CN first, then CPA, then NHM as fallback)
    group_labels = {}
    for _, r in cn.drop_duplicates(subset=["NST2007_CODE"]).iterrows():
        gc = str(r["NST2007_CODE"]).strip()
        group_labels[gc] = str(r.get("NST2007_NAME", "")).strip()
    for _, r in cpa.drop_duplicates(subset=["NST2007_CODE"]).iterrows():
        gc = str(r["NST2007_CODE"]).strip()
        if gc not in group_labels:
            group_labels[gc] = str(r.get("NST2007_NAME", "")).strip()
    for _, r in nhm.drop_duplicates(subset=["NST_2007_CODE 81 positions"]).iterrows():
        gc = str(r["NST_2007_CODE 81 positions"]).strip()
        if gc not in group_labels and pd.notna(r.get("Label NST 2007 81 positions")):
            group_labels[gc] = str(r["Label NST 2007 81 positions"]).strip()

    phase = "PAD-NST-2C"
    sql_parts = ["BEGIN;"]

    # E1: nst_mapping_sources (4 rows)
    for k, fname in FILES.items():
        rc = len(cn) if k == "cn" else len(cpa) if k == "cpa" else len(nhm) if k == "nhm" else len(nstr)
        sql_parts.append(
            f"INSERT INTO nst_mapping_sources (source_name, source_type, sha256_hash, row_count, local_path, phase) "
            f"VALUES ({esc(fname)}, 'xlsx', {esc(hashes[k])}, {rc}, "
            f"{esc(f'docs/tariff-collection/pad/unece-sources/{fname}')}, {esc(phase)}) "
            f"ON CONFLICT DO NOTHING;"
        )

    # E2: nst_divisions (20 official CE 1304/2007)
    for dc, lbl in DIVISIONS_CE1304.items():
        sql_parts.append(
            f"INSERT INTO nst_divisions (division_code, label_en) "
            f"VALUES ({esc(dc)}, {esc(lbl)}) ON CONFLICT DO NOTHING;"
        )

    # E3: nst_groups (73)
    for gc in all_groups:
        div = gc.split(".")[0]
        lbl = group_labels.get(gc, "")
        sql_parts.append(
            f"INSERT INTO nst_groups (group_code, division_code, label_en) "
            f"VALUES ({esc(gc)}, {esc(div)}, {esc(lbl)}) ON CONFLICT DO NOTHING;"
        )

    # E4: nst_cpa_mappings (1759) — batch chunks
    cpa_rows = []
    for idx, r in cpa.iterrows():
        gc = str(r["NST2007_CODE"]).strip()
        cc = str(r["CPA21_CODE"]).strip()
        cl = esc(str(r["CPA21_NAME"]).strip()) if pd.notna(r.get("CPA21_NAME")) else "NULL"
        su = esc(str(r["Source"]).strip()) if pd.notna(r.get("Source")) else "NULL"
        tu = esc(str(r["Target"]).strip()) if pd.notna(r.get("Target")) else "NULL"
        cpa_rows.append([
            esc(gc), esc(cc), cl,
            f"(SELECT id FROM nst_mapping_sources WHERE source_name={esc(FILES['cpa'])} AND phase={esc(phase)} LIMIT 1)",
            str(idx + 2), su, tu,
        ])
    sql_parts.extend(chunk_insert(
        "nst_cpa_mappings",
        ["nst_group_code", "cpa_code", "cpa_label", "source_id", "source_row_number", "source_uri", "target_uri"],
        cpa_rows,
    ))

    # E5: nst_cn_mappings (9762) — batch, CN2024_CODE normalized with re.sub
    cn_rows = []
    cn_skipped = 0
    for idx, r in cn.iterrows():
        gc = str(r["NST2007_CODE"]).strip()
        raw = str(r["CN2024_CODE"]).strip() if pd.notna(r.get("CN2024_CODE")) else ""
        code = re.sub(r"\D", "", raw)
        if len(code) != 8:
            cn_skipped += 1
            continue
        hs6 = code[:6]
        cl = esc(str(r["CN2024_NAME"]).strip()) if pd.notna(r.get("CN2024_NAME")) else "NULL"
        su = esc(str(r["Source"]).strip()) if pd.notna(r.get("Source")) else "NULL"
        tu = esc(str(r["Target"]).strip()) if pd.notna(r.get("Target")) else "NULL"
        cn_rows.append([
            esc(gc), esc(code), cl, esc(hs6),
            f"(SELECT id FROM nst_mapping_sources WHERE source_name={esc(FILES['cn'])} AND phase={esc(phase)} LIMIT 1)",
            str(idx + 2), su, tu,
        ])
    if cn_skipped:
        print(f"CN skipped (bad length): {cn_skipped}")
    sql_parts.extend(chunk_insert(
        "nst_cn_mappings",
        ["nst_group_code", "cn_code", "cn_label", "hs6_prefix", "source_id", "source_row_number", "source_uri", "target_uri"],
        cn_rows,
    ))

    # E6: nst_nhm_mappings (15079) — batch, NHM normalized with re.sub + zfill(12)
    nhm_rows = []
    nhm_skipped = 0
    for idx, r in nhm.iterrows():
        raw = r.get("NHM_2025_Code")
        if pd.isna(raw):
            nhm_skipped += 1
            continue
        code = re.sub(r"\D", "", str(raw)).zfill(12)
        if len(code) != 12:
            nhm_skipped += 1
            continue
        gc81 = r.get("NST_2007_CODE 81 positions")
        if pd.isna(gc81):
            nhm_skipped += 1
            continue
        gc = str(gc81).strip()
        nl = esc(str(r["Label NHM_2025 (EN)"]).strip()) if pd.notna(r.get("Label NHM_2025 (EN)")) else "NULL"
        nhm_rows.append([
            esc(gc), esc(code), nl,
            f"(SELECT id FROM nst_mapping_sources WHERE source_name={esc(FILES['nhm'])} AND phase={esc(phase)} LIMIT 1)",
            str(idx + 2),
        ])
    if nhm_skipped:
        print(f"NHM skipped: {nhm_skipped}")
    sql_parts.extend(chunk_insert(
        "nst_nhm_mappings",
        ["nst_group_code", "nhm_code", "nhm_label", "source_id", "source_row_number"],
        nhm_rows,
    ))

    # E7: nstr_nst2007_mappings (9781) — batch, dot excluded, null quarantined
    nstr_rows = []
    excluded_dot = 0
    quarantined_null = 0
    for idx, r in nstr.iterrows():
        nst_raw = r.get("NST2007")
        if pd.notna(nst_raw) and str(nst_raw).strip() == ".":
            excluded_dot += 1
            continue
        if pd.isna(nst_raw):
            continue
        nst_code = str(nst_raw).strip()

        nstr_raw = r.get("NSTR")
        if pd.isna(nstr_raw):
            nc, nch, is_q, qr = "NULL", "NULL", "true", esc("NSTR_NULL_CPA_ONLY")
            quarantined_null += 1
        else:
            nc_val = str(int(float(nstr_raw))).zfill(3)
            nc, nch, is_q, qr = esc(nc_val), esc(nc_val[:2]), "false", "NULL"

        nl = esc(str(r["NSTR Label"]).strip()) if pd.notna(r.get("NSTR Label")) else "NULL"
        cn08 = esc(str(int(float(r["CN2008"]))).zfill(8)) if pd.notna(r.get("CN2008")) else "NULL"
        cpa08 = esc(str(r["CPA2008"]).strip()) if pd.notna(r.get("CPA2008")) else "NULL"
        nst_lbl = esc(str(r["NST2007 Label"]).strip()) if pd.notna(r.get("NST2007 Label")) else "NULL"
        nstr_rows.append([
            nc, nch, nl, cn08, cpa08, esc(nst_code), nst_lbl, is_q, qr,
            f"(SELECT id FROM nst_mapping_sources WHERE source_name={esc(FILES['nstr'])} AND phase={esc(phase)} LIMIT 1)",
            str(idx + 2),
        ])

    print(f"excluded_dot={excluded_dot}, quarantined_null={quarantined_null}")
    print(f"NSTR rows to insert: {len(nstr_rows)}")
    sql_parts.extend(chunk_insert(
        "nstr_nst2007_mappings",
        ["nstr_code", "nstr_chapter", "nstr_label", "cn2008_code", "cpa2008_code",
         "nst2007_code", "nst2007_label", "is_quarantined", "quarantine_reason",
         "source_id", "source_row_number"],
        nstr_rows,
    ))

    # ── Verification: RAISE EXCEPTION if any count mismatches → auto ROLLBACK ──
    verify_block = """
DO $$
DECLARE
  v_ok BOOLEAN := true;
  v_count INTEGER;
BEGIN
"""
    for tbl, exp in EXPECTED.items():
        verify_block += f"""  SELECT COUNT(*) INTO v_count FROM {tbl};
  RAISE NOTICE '{tbl}: expected={exp}, actual=%', v_count;
  IF v_count <> {exp} THEN
    RAISE NOTICE 'MISMATCH on {tbl}: expected {exp}, got %', v_count;
    v_ok := false;
  END IF;
"""
    verify_block += """
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ROLLBACK: expected vs actual mismatch detected — transaction aborted';
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED — proceeding to COMMIT';
END $$;

COMMIT;
"""
    sql_parts.append(verify_block)

    return "\n".join(sql_parts), hashes, excluded_dot, quarantined_null, {
        "cpa_rows": len(cpa_rows),
        "cn_rows": len(cn_rows),
        "nhm_rows": len(nhm_rows),
        "nstr_rows": len(nstr_rows),
    }


if __name__ == "__main__":
    sql, hashes, excluded_dot, quarantined_null, counts = build_sql()

    sql_path = "/tmp/pad_nst_2c.sql"
    with open(sql_path, "w") as f:
        f.write(sql)

    print(f"\nSQL written to {sql_path} ({len(sql)} bytes, {sql.count(chr(10)) + 1} lines)")
    print(f"Row counts: {json.dumps(counts)}")
    print(f"SHA256: {json.dumps(hashes)}")
    print(f"excluded_dot={excluded_dot}, quarantined_null={quarantined_null}")
    print(f"\nTo execute: psql -v ON_ERROR_STOP=1 -f {sql_path}")
    print("The transaction will ROLLBACK automatically if any count mismatches.")
