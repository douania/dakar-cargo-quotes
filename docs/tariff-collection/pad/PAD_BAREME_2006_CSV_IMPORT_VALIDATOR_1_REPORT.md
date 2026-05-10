# PAD-BAREME-2006-CSV-IMPORT-VALIDATOR-1 — Report

- **Verdict** : `GO`
- **Generated** : 2026-05-10T21:01:24.613473+00:00
- **CSV SHA-256** : `1c34c05fe596eb48831aa5bc53bf16008b4b6076f541fef27d93de7b0b396be0` (match manifest: `True`)
- **Manifest SHA-256** : `4d60f4e160ace7827f552b043298a0b4a83c338cee4cc8c27da335074697da6a`
- **Checks** : 24 PASS / 0 FAIL / 0 WARN

## Checks

| ID | Status | Details |
|----|--------|---------|
| A1 | PASS | SHA-256 match: 1c34c05fe596eb48831aa5bc53bf16008b4b6076f541fef27d93de7b0b396be0 |
| A2 | PASS | UTF-8 strict OK |
| B1 | PASS | Header match (14 cols) |
| B2 | PASS | All rows have 14 columns |
| C1 | PASS | Total rows = 124 |
| C2 | PASS | Page counts: {'7': 76, '8': 48} |
| C3 | PASS | rate_family = DROIT_PASSAGE everywhere; no PORT_TAX |
| C4 | PASS | No duplicate (page, op, cargo, classification) |
| C5 | PASS | All classifications in allowed set (22 values) |
| C6 | PASS | operation_type counts match manifest: {'IMPORT': 38, 'EXPORT': 38, 'TRANSBORDEMENT': 16, 'TRANSIT_IMPORT': 16, 'TRANSIT_EXPORT': 16} |
| C7 | PASS | cell_status counts match: {'PRESENT': 120, 'BLANK_IN_PDF': 4} |
| D1 | PASS | operation_type in ['EXPORT', 'IMPORT', 'TRANSBORDEMENT', 'TRANSIT_EXPORT', 'TRANSIT_IMPORT'] |
| D2 | PASS | cargo_type in ['CONTENEUR', 'CONVENTIONNEL'] |
| D3 | PASS | cell_status in ['BLANK_IN_PDF', 'PRESENT'] |
| E1 | PASS | PRESENT amounts ok (120/120) |
| E2 | PASS | BLANK_IN_PDF amounts empty (4/4) |
| E3 | PASS | Decimal-only comparisons (no float used) |
| E4 | PASS | T10 page7/IMPORT/{CONTENEUR,CONVENTIONNEL}=0 PRESENT, distinct from BLANK_IN_PDF |
| F1 | PASS | T13/page7/EXPORT/CONVENTIONNEL = BLANK_IN_PDF |
| F2 | PASS | T10 page 8 = BLANK_IN_PDF on 3 expected rows |
| F3 | PASS | Page7/IMPORT/CONTENEUR P01=28100 P02=2325 P03=13000 |
| G1 | PASS | DB IMPORT/CONTENEUR active = 19 |
| G2 | PASS | 19/19 strict match (classification+amount Decimal) |
| G3 | PASS | Non-regression: CONTENEUR=19, NULL=0 |

## Guarantees

- CSV not modified
- Manifest not modified
- No DB write, no migration, no edge function deploy, no `src/` change
- DB queried in SELECT only (or skipped if env unavailable)

**Verdict final : `GO`**
