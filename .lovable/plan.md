
# Régime douanier : intégration pipeline pricing (DONE)

## Patches appliqués

### ✅ Migration DB
- `quote_facts_source_type_check` : ajouté `hs_resolution` + `known_contact_match`

### ✅ Patch C1 : Whitelist opérateur
- `set-case-fact/index.ts` : +2 clés (`customs.regime_code`, `regulatory.exemption_title`), +2 cases `detectCategory`
- `CaseView.tsx` : +2 clés dans `EDITABLE_FACT_KEYS` (type texte, pas numérique)

### ✅ Patch B : run-pricing transmet régime + soft blocker
- `PricingInputs` : +`regimeCode`, +`exemptionTitle`
- `buildPricingInputs` : +2 cases mapping
- Soft blocker `REGIME_REQUIRED_FOR_EXEMPTION` si exemptionTitle présent et regimeCode absent
- `engineParams` : +`regimeCode`
- `outputsJson.metadata` : +`duties_regime_code`

### ✅ Patch B2 : quotation-engine applique flags régime inline
- `QuotationRequest` : +`regimeCode`
- Chargement `customs_regimes` si regimeCode fourni
- Flags appliqués APRÈS calcul (CTO: formules intouchées) : `if (!regimeFlags.dd) ddAmount = 0;`
- `dutyBreakdown` : +annotations `regime_applied`, `dd_exonerated`, `rs_exonerated`, `tva_exonerated`
- Metadata réponse : +`regime_applied`, `regime_name`, `regime_unknown`
- Rétrocompat totale si regimeCode absent

### ✅ Patch A : Détection evidence-based dans build-case-puzzle
- Helper `extractRegimeCandidatesFromText` (regex robustes C/S + espaces/tirets/slashes)
- Scan `case_documents.extracted_text` + emails
- Injection si 1 seul code valide en base (confidence 0.95)
- GAP si code inconnu, titre sans code, ou dpi_expected=true sans régime
- Protection manual_input (pas d'écrasement)
- Idempotence GAP

### ✅ Patch C2 : UI affiche blocker régime + badge
- `PricingResultPanel.tsx` : alerte amber si `REGIME_REQUIRED_FOR_EXEMPTION`
- Badge `Régime: {code}` si `duties_regime_code` présent

## Fichiers modifiés (6)
1. `supabase/functions/set-case-fact/index.ts`
2. `src/pages/CaseView.tsx`
3. `supabase/functions/run-pricing/index.ts`
4. `supabase/functions/quotation-engine/index.ts`
5. `supabase/functions/build-case-puzzle/index.ts`
6. `src/components/puzzle/PricingResultPanel.tsx`

## Ce qui n'a PAS changé
- `calculate-duties` : intouché
- Formules fiscales : intouchées (flags appliqués post-calcul)
- Structure DB : aucune nouvelle table/colonne
- Outputs existants : rétro-compatibles
