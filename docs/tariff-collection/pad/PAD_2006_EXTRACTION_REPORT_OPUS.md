# PAD 2006 Nomenclature Extraction — QA Report

**Source document:** `REDEVANCES_PORTUAIRES_2006.pdf` (40 pages)  
**Sections processed:** 2.3.1 (par catégorie NST, pp. 9–16), 2.3.2 (alphabétique, pp. 17–23), 2.3.3 (par catégorie tarifaire, pp. 24–31).  
**Categories accepted into injectable:** T01–T14, P01–P05.  
**Categories explicitly excluded from injectable:** C01, C02, C03 (cabotage container fees — they are not commodity categories and do not belong in the BL → category lookup).  
**Page numbering:** PDF page numbers and printed page numbers are aligned in this document, so `source_page` values match both.

## Counts

- Raw extracted rows (across all 3 sections): **811**
- Injectable entries (after dedup, conflict, and C-category exclusion): **332**
- Conflicts detected: **2**
- Rejected fragments (headers, etc.): **90**
- Suggested secondary aliases (typo corrections): **41**

## Injectable distribution by category

| Category | Count |
|---|---:|
| P01 | 1 |
| P02 | 1 |
| P03 | 4 |
| P04 | 1 |
| P05 | 1 |
| T01 | 34 |
| T02 | 86 |
| T03 | 24 |
| T04 | 22 |
| T05 | 14 |
| T06 | 8 |
| T07 | 27 |
| T08 | 7 |
| T09 | 7 |
| T10 | 1 |
| T11 | 12 |
| T12 | 79 |
| T13 | 2 |
| T14 | 1 |

All expected categories T01–T14 and P01–P05 have at least one injectable entry.

## Conflicts (same normalized_term mapped to different categories)

| normalized_term | categories | raw designations | source refs |
|---|---|---|---|
| `alcool industriel` | T07, T12 | ALCOOL INDUSTRIEL | 2.3.2:p17; 2.3.3:p29 |
| `sport` | T01, T02 | SPORT | 2.3.1:p14; 2.3.2:p22; 2.3.3:p26 |

**Action required:** these rows are NOT in the injectable file. The operator must arbitrate which tariff category is correct before either mapping can be loaded into `pad_designation_aliases`.

## QA invariants

- ✅ No conflicting `normalized_term` appears in the injectable file: **True**
- ✅ No `C01`/`C02`/`C03` rows in the injectable file: **True**
- ✅ All injectable categories are within the allowed set T01–T14 / P01–P05: **True**

## Notable items

### `geomembranes` — NOT present in the source PDF

A textual search for *geomembrane*, *géomembrane*, and *membrane* returns **zero matches** anywhere in the source PDF. Consequently this extraction pipeline does NOT create any alias for the term `geomembranes`. 
If `geomembranes` arrives on a BL, the closest categories observed in the source nomenclature that could conceivably apply are:

- **T07** — `MATERIAUX DE CONSTRUCTION ET CARRELAGE NDA` is in T12, but several construction materials (e.g. `AMIANTE`, `TERRES REFRACTAIRES`, `ARGILE ET CRAIE EN POUDRE`) live under T07.
- **T12** — covers many manufactured / non-listed items including `MATIERE PLASTIQUE BRUTE NDA` (which is actually T03) — but `ARTICLES EN MATIERES PLASTIQUES NDA` is in T12.
- **T03** — `MATIERES PLASTIQUES BRUTES NDA` if the geomembrane is treated as a raw plastic.

This is provided for **observational context only**. Do NOT auto-create a `geomembranes` alias from this report — that is an operator decision, ideally backed by a line in the PAD's official tariff guidance.

### Multi-line designation reconstruction

The longest designation in the PDF, `CONTENEURS DE GROUPAGE IMPORT DE DIVERSES MARCHANDISES NE CONTENANT AUCUN PRODUIT DE CAT. T01` (T13), is broken across two visual lines in all three sections. It has been reconstructed as a single designation in each occurrence.
Section 2.3.1 (p. 16) and section 2.3.2 (p. 19) both render the word `PRODUIT` with a stray diaeresis as `P¨RODUIT`; section 2.3.3 (p. 30) renders it cleanly. Because normalization preserves the diaeresis-induced gap, these two forms produce **two distinct injectable entries**, both mapped to T13. The clean form `PRODUIT` is offered as a secondary-alias suggestion against the typo'd entries.

### Near-duplicates (different normalized form, same domain)

- `MATERIEL DE PHOTOCOPIE ET DE REPROGRAPHIE` → **T02** (consistent in 2.3.2 and 2.3.3)
- `MATERIEL DE PHOTOCOPIEUSE ET DE REPROGRAPHIE` → **T01** (consistent in 2.3.1 and 2.3.3)

These are **not flagged as conflicts** because `photocopie` ≠ `photocopieuse` after normalization. Both go into injectable, each carrying a `notes` field that points operators at the other. The category split (T01 vs T02) is intentional in the source PDF.

### `BOISSONS ACOOLISEES …` typos

Three variants exist in the PDF:

| Raw form | Section / page | Category |
|---|---|---|
| `BOISSONS ACOOLISEES SAUF < = 13° NDA` | 2.3.1 p.10 | T02 |
| `BOISSONS ACOOLISEES SAUF VIN < = 13° NDA` | 2.3.2 p.18 | T02 |
| `BOISSONS ACOOLISEES SAUF < = 13°` | 2.3.3 p.25 | T02 |
| `BOISSONS ALCOOLISEES SAUF VIN <= 13°` (T01) | 2.3.1 p.10, 2.3.2 p.18, 2.3.3 p.24 | T01 |

Auto-correcting the `ACOOLISEES` typos to `ALCOOLISEES` would collapse three rows into the existing T01 entry and create a hard conflict. Because the semantic intent of the T02 rows is unclear (it may be a missing-`N` typo intended to mean *non-alcoolisées*), no corrected aliases are generated for these rows. They are left as-is in injectable with a `notes` field directing the operator to review.

### Source-PDF artifacts that survived as injectable rows

- 2.3.1 p.13 has a duplicate `CAFE, NESCAFE → T02` row appearing under section header `69 AUTRES MATERIAUX DE CONSTRUCTION` (rendering artifact). This collapses cleanly under dedup.
- 2.3.2 p.17 and 2.3.3 p.25 each list `APPAREILS MENAGERS NON ELECTRIQUES → T02` twice. Both copies collapse under dedup.
- Several spelling and punctuation drift cases between the three sections (e.g. `BEURRE FROAMGE` ↔ `BEURRE FROMAGE`, `BEURRES VEGETAUX` ↔ `BEURRES VEGETALES`, `MATERIELS INDUSTRIELS` ↔ `MATERIELS INDUSTRIEL`, `CONSERVE` ↔ `CONSERVES`, `SOBRETS` ↔ `SORBETS`, `GLUCERINE` ↔ `GLYCERINE`, `SOUFFRE` ↔ `SOUFRE`, etc.) all yield distinct normalized forms and are therefore each present as separate injectable rows. The source-PDF spelling is preserved verbatim in `bl_term`. Suggested clean spellings are offered in `PAD_2006_SUGGESTED_SECONDARY_ALIASES.csv` for operator review.

## Methodology summary

1. Section 2.3.1, 2.3.2, and 2.3.3 of the source PDF were extracted manually into the `SECTION_2_3_*` Python lists in this script. Each item is a `(raw_term, pad_category, page)` tuple. PDF spelling is preserved exactly, including obvious typos. Multi-line designations are reconstructed as single entries.
2. NST chapter / section headers, alphabetical letter headers, and tariff-category headers do not represent designations and are listed in `PAD_2006_REJECTED_FRAGMENTS.csv`.
3. `normalize(text)` applies Unicode NFKD decomposition, strips combining marks, lowercases, and replaces any non-alphanumeric run with a single space. This yields a stable matching key.
4. Rows are deduplicated on `(normalized_term, pad_category)`. When the same key appears in multiple sections / pages, `source_refs` aggregates all references.
5. Any `normalized_term` that appears with two or more **different** tariff categories is moved out of the injectable file and into `PAD_2006_ALIAS_CONFLICTS.csv`. No automatic arbitration is performed.
6. Categories C01, C02, C03 (cabotage container fees) are excluded from the injectable file. They appear in the source nomenclature for completeness but they are not commodity designations.
7. Typo corrections are not applied to `bl_term` in the injectable file. Suggested corrected forms appear in `PAD_2006_SUGGESTED_SECONDARY_ALIASES.csv` with `status=operator_review_required` so a human can validate them before any are loaded.

## Output files

- `PAD_2006_NOMENCLATURE_INJECTABLE.csv` — the clean, deduplicated, conflict-free nomenclature ready to be loaded into `pad_designation_aliases`.
- `PAD_2006_ALIAS_CONFLICTS.csv` — items that cannot be safely injected because the source PDF assigns the same normalized designation to multiple categories.
- `PAD_2006_REJECTED_FRAGMENTS.csv` — the headers and structural fragments that exist in the PDF but are not designations.
- `PAD_2006_SUGGESTED_SECONDARY_ALIASES.csv` — proposed typo corrections, awaiting operator validation. None of these are loaded automatically.
