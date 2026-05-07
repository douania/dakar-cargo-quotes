# PAD-TOTALS-1 — Rapport de patch intégrité des totaux

**Date**: 2026-05-07
**Statut**: ✅ CLOS — tous tests PASS
**Fichier modifié**: `supabase/functions/run-pricing/index.ts` (L2480-2551)

---

## 1. Cause racine

`totalHt = honoraires_ht` ignorait les blocs `operationnel`, `border`, `terminal`, `debours`, ainsi que les enrichissements PAD et terminal storage ajoutés post-engine. Le PDF affichait 1.2M XOF au lieu de 16.1M XOF.

Voir `PAD_TOTALS_0_AUDIT.md` pour les preuves complètes.

## 2. Diff fonctionnel

### Avant (P0 FIX)
```typescript
const honoraires_ht  = engineTotals?.honoraires ?? 0;
const debours        = engineTotals?.debours ?? 0;
const TVA_RATE       = 0.18;
const honoraires_tva = Math.round(honoraires_ht * TVA_RATE);
const honoraires_ttc = honoraires_ht + honoraires_tva;

const totalHt  = honoraires_ht;
const totalTtc = debours + honoraires_ttc;
```

### Après (PAD-TOTALS-1)
```typescript
// Safe extraction of all engine bloc totals
const engineOperationnel = Number(engineTotals?.operationnel) || 0;
const engineHonoraires   = Number(engineTotals?.honoraires) || 0;
const engineDebours      = Number(engineTotals?.debours) || 0;
const engineBorder       = Number(engineTotals?.border) || 0;
const engineTerminal     = Number(engineTotals?.terminal) || 0;

// Robust DAP/DDP: use engine value if finite, otherwise reconstruct
const rawDap = Number(engineTotals?.dap);
const rawDdp = Number(engineTotals?.ddp);
const hasRawDap = engineTotals?.dap !== undefined && engineTotals?.dap !== null && Number.isFinite(rawDap);
const hasRawDdp = engineTotals?.ddp !== undefined && engineTotals?.ddp !== null && Number.isFinite(rawDdp);

const engineDapComputed = hasRawDap ? rawDap
  : engineOperationnel + engineHonoraires + engineBorder + engineTerminal;
const engineDdpComputed = hasRawDdp ? rawDdp
  : engineDapComputed + engineDebours;

// Post-engine enrichment (PAD + terminal storage, non-TO_CONFIRM, amount > 0)
// TO_CONFIRM normalized: trim, split on + or :, uppercase
const enrichmentAmount = tariffLines.filter(l => {
  const layer = l.canonical?.origin_layer;
  if (layer !== 'enrichment_pad' && layer !== 'enrichment_terminal_storage') return false;
  const sourceType = String(l?.source?.type || '').trim().split('+')[0].split(':')[0].toUpperCase();
  if (sourceType === 'TO_CONFIRM') return false;
  return (Number(l.amount) || 0) > 0;
}).reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

// TVA SODATRA only on honoraires
const totalHt  = engineDdpComputed + enrichmentAmount;
const totalTtc = totalHt + honoraires_tva;
```

## 3. Doctrine des totaux retenue

| Champ | Signification | TVA |
|-------|---------------|-----|
| `total_ht` | Total client HT (tous blocs + enrichments) | Non |
| `total_ttc` | total_ht + TVA sur honoraires uniquement | — |
| `honoraires_ht` | Base honoraires SODATRA | Oui (18%) |
| `honoraires_tva` | TVA sur honoraires | — |
| `operationnel` | THC, transport, surestaries | Non |
| `border` | Frais frontaliers | Non |
| `terminal` | Frais terminaux | Non |
| `debours_engine` | Droits de douane (engine) | Non |
| `debours_enrichment` | PAD + terminal storage enrichments | Non |
| `dap` | Computed DAP (safe fallback) | — |
| `ddp` | Computed DDP (safe fallback) | — |

## 4. Fichiers modifiés

| Fichier | Lignes | Nature |
|---------|--------|--------|
| `supabase/functions/run-pricing/index.ts` | L2480-2551 | Recalcul totaux + outputs_json.totals enrichi |

## 5. Fichiers NON modifiés (explicitement)

- `quotation-engine/index.ts` — déjà correct (produit dap/ddp)
- `generate-quotation-version/index.ts` — lit `pricingRun.total_ht` → auto-correct
- `export-quotation-version-pdf/index.ts` — lit `snapshot.totals.total_ht` → auto-correct
- `create-quotation-email-draft/index.ts` — lit `totalsBlock.total_ht` → auto-correct
- `supabase/config.toml` — PAD-R1B hors scope
- `recommend-pad-category/index.ts` — documenté, non modifié

## 6. Tests exécutés

| # | Cas | Résultat | Preuve |
|---|-----|----------|--------|
| 1 | Import standard (THC + honoraires) | ✅ PASS | total_ht = 9,767,880 (run #21) |
| 2 | PAD OFFICIAL | ✅ PASS | PAD T12 = 4,015,200 inclus |
| 3 | Terminal storage OFFICIAL | ✅ PASS | Terminal = 2,227,680 inclus |
| 4 | PAD + terminal storage | ✅ PASS | enrichment = 6,242,880 |
| 5 | Sans enrichissement | ✅ PASS | Deno test: total_ht = ddp engine |
| 6 | TO_CONFIRM amount=0 | ✅ PASS | Deno test: exclu |
| 7 | TO_CONFIRM amount>0 | ✅ PASS | Deno test: exclu |
| 8 | Export guard (pas de dap/ddp) | ✅ PASS | Deno test: fallback reconstruit, total_ht = 260,000 |
| 9 | Provisional DDP (pas de dap/ddp) | ✅ PASS | Deno test: fallback reconstruit, total_ht = 800,000 |
| 10 | Quotation version snapshot | ✅ PASS | snapshot.totals.total_ht = 9,767,880 |
| 11 | PDF export | ✅ PASS | PDF généré avec total_ht corrigé |
| 12 | Email draft | ✅ PASS | "Montant total HT ferme : 9 767 880 XOF" |

### Tests unitaires Deno (8/8 PASS)

Fichier: `supabase/functions/run-pricing/totals-calculation_test.ts`

- Standard import: uses engine dap/ddp, includes enrichments ✅
- Export guard initial: total_ht = 0 (correct for empty lines) ✅
- Export guard enriched: reconstructs dap/ddp from blocs ✅
- Provisional DDP: reconstructs dap/ddp from blocs ✅
- TO_CONFIRM enrichment lines excluded ✅
- Provisional DDP with nonzero debours ✅
- Engine dap/ddp = 0 treated as present (not reconstructed) ✅
- Legacy debours field = debours_engine + enrichment ✅

## 7. Risques résiduels

- **Multi-lot**: les totaux multi-lot suivent un chemin séparé (L1129-1195) qui n'est pas touché par ce patch. À auditer séparément si nécessaire.
- **Existing runs**: les pricing_runs déjà stockés conservent les anciens totaux. Un re-run est nécessaire pour corriger.
- **Legacy debours**: ✅ RÉSOLU — `totals.debours = engineDebours + enrichmentAmount` préservé pour rétrocompatibilité.

## 8. PAD-R1B — Documentation

La fonction `supabase/functions/recommend-pad-category/index.ts` :
- Appelle `callAI` avec `google/gemini-2.5-flash`
- Est appelée par `DesignationSuggestionBlock.tsx` L298
- N'est PAS branchée à `run-pricing`
- N'est PAS dans `config.toml` (fonctionne via défaut Lovable Cloud)
- **Statut**: active dans l'UI, non canonique pour PAD-R1 local-only
- **Action**: ne pas modifier dans PAD-TOTALS-1, gouverner dans PAD-R1B-GOVERNANCE

## 9. Verdict GO/NO-GO PAD-R1

**PAD-R1 = NO-GO** tant que :
1. ~~PAD-TOTALS-1 n'est pas testé et validé~~ → ✅ CLOS
2. PAD-R1B-GOVERNANCE n'a pas clarifié le statut de recommend-pad-category
3. La doctrine amount > 0 vs estimated_amount n'est pas définie
