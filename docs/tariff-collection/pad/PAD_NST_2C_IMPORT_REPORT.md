# PAD-NST-2C — Import Report

**Date**: 2026-05-07
**Phase**: PAD-NST-2C — Controlled import of NST 2007 reference data
**Script**: `docs/tariff-collection/pad/scripts/pad_nst_2c_import.py`

## Expected vs Actual

| Table | Expected | Actual | Status |
|-------|----------|--------|--------|
| `nst_mapping_sources` | 4 | 4 | ✅ |
| `nst_divisions` | 20 | 20 | ✅ |
| `nst_groups` | 73 | 73 | ✅ |
| `nst_cpa_mappings` | 1,759 | 1,759 | ✅ |
| `nst_cn_mappings` | 9,762 | 9,762 | ✅ |
| `nst_nhm_mappings` | 15,079 | 15,079 | ✅ |
| `nstr_nst2007_mappings` | 9,781 | 9,781 | ✅ |

## Integrity Checks

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `excluded_dot_count` | 1 | 1 | ✅ |
| `quarantined_nstr_null_count` | 5 | 5 | ✅ |
| `rejected_by_conflict` | 0 | 0 | ✅ |
| FK orphan count (groups) | 0 | 0 | ✅ |
| FK orphan count (cpa) | 0 | 0 | ✅ |
| FK orphan count (cn) | 0 | 0 | ✅ |
| FK orphan count (nhm) | 0 | 0 | ✅ |
| FK orphan count (nstr) | 0 | 0 | ✅ |

## SHA256 File Hashes

| File | SHA256 |
|------|--------|
| `NST2007_CN2024_Table.xlsx` | `39689011ef4718383dd274c1bdd3e4fd729fb45b36616d3568f3de18a0cadbb2` |
| `NST2007_CPA21_Table.xlsx` | `e23e2a7fe8bdcd5d0eef77f660fd1d22b8d6c782bdcf542974e2223424e0f933` |
| `NST_2007_-_NHM_2025.xlsx` | `c63bddc5818c1723531bb378edae4c9b28adffab12714e759707a3a43e17fa7c` |
| `NSTR-NST2007.xls` | `d4c4d81b76e83dc7a3bac4b171168e44f6693618f7bfd7073198f2f7892d5478` |

## Normalizations Applied

| Rule | Description |
|------|-------------|
| N1 | `group_code`: preserved as `XX.Y` (e.g. `01.1`, `18.0`, `01.A`) |
| N2 | `division_code`: `group_code.split('.')[0]` → 2 digits |
| N3 | `cn_code`: `re.sub(r'\D', '', CN2024_CODE)` → 8 digits strict |
| N4 | `nhm_code`: `re.sub(r'\D', '', value).zfill(12)` → 12 digits text |
| N5 | `nstr_code`: `str(int(float(value))).zfill(3)` → 3 digits |
| N6 | `nstr_chapter`: `nstr_code[:2]` → 2 digits |
| N7 | `hs6_prefix`: `cn_code[:6]` → derived |
| N8 | `source_row_number`: `DataFrame index + 2` (Excel row) |

## Perimeter Confirmation

| Item | Status |
|------|--------|
| `src/` modifications | ❌ None |
| Edge Functions | ❌ None |
| `config.toml` | ❌ None |
| Schema modifications | ❌ None |
| Runtime impact | ❌ None |
| Import method | Transactional (BEGIN/COMMIT) |

## Notes

- Group `18.0` confirmed as valid format (matches `^[0-9]{2}\.[0-9A-Z]$`). No PAD-NST-2B-R2 needed.
- Divisions 15 and 20 inserted with labels but have no groups in this phase.
- 5 quarantined NSTR rows have `quarantine_reason = 'NSTR_NULL_CPA_ONLY'` and must not participate in PAD reasoning.
- 1 dot entry (`NST2007 = '.'`, NSTR=999) excluded before INSERT.
- The versioned script (`pad_nst_2c_import.py`) corresponds to the batch version used for the final import. It includes conditional COMMIT / ROLLBACK logic: `RAISE EXCEPTION` (automatic ROLLBACK) if any expected vs actual count mismatches.
