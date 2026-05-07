# PAD-TOTALS-0 — Audit intégrité des totaux pricing

**Date**: 2026-05-07
**Statut**: CLOS — Bug confirmé, patch PAD-TOTALS-1 requis
**Auteur**: Lovable CTO mode
**Scope**: `supabase/functions/run-pricing/index.ts` → `pricing_runs.total_ht / total_ttc` → downstream

---

## 1. Cause racine

### Code fautif (`run-pricing/index.ts` L2480-2488)

```typescript
const honoraires_ht  = engineTotals?.honoraires ?? 0;
const debours        = engineTotals?.debours ?? 0;
const TVA_RATE       = 0.18;
const honoraires_tva = Math.round(honoraires_ht * TVA_RATE);
const honoraires_ttc = honoraires_ht + honoraires_tva;

const totalHt  = honoraires_ht;                    // ← BUG
const totalTtc = debours + honoraires_ttc;          // ← BUG
```

### Ce que quotation-engine produit (`quotation-engine/index.ts` L2544-2555)

```typescript
const totals = {
  operationnel: lines.filter(l => l.bloc === 'operationnel' ...).reduce(...),
  honoraires:   lines.filter(l => l.bloc === 'honoraires' ...).reduce(...),
  debours:      lines.filter(l => l.bloc === 'debours' ...).reduce(...),
  border:       lines.filter(l => l.bloc === 'border' ...).reduce(...),
  terminal:     lines.filter(l => l.bloc === 'terminal' ...).reduce(...),
  dap: 0, ddp: 0
};
totals.dap = totals.operationnel + totals.honoraires + totals.border + totals.terminal;
totals.ddp = totals.dap + totals.debours;
```

### Blocs perdus par `totalHt = honoraires_ht`

| Bloc | Inclus dans total_ht ? | Exemple montant |
|------|------------------------|-----------------|
| honoraires | ✅ Oui | 1,235,000 XOF |
| operationnel | ❌ Non | 14,880,000 XOF (THC) |
| border | ❌ Non | variable |
| terminal | ❌ Non | variable |
| debours | ❌ Non (sauf via total_ttc) | variable |
| PAD enrichment | ❌ Non | 4,015,200 XOF |
| Terminal storage enrichment | ❌ Non | variable |

---

## 2. Preuve par données réelles

### Pricing run `f4c005af` (le plus récent)

| Champ | Valeur | Source |
|-------|--------|--------|
| `engineTotals.dap` | 16,115,000 XOF | `outputs_json.totals.dap` |
| `engineTotals.ddp` | 16,115,000 XOF | `outputs_json.totals.ddp` |
| `total_ht` stocké | 1,235,000 XOF | `pricing_runs.total_ht` |
| `total_ttc` stocké | 1,457,300 XOF | `pricing_runs.total_ttc` |
| **Écart** | **14,880,000 XOF** | THC IMPORT 40ft HC |

Ventilation des lignes (run `f4c005af`) :
- `operationnel` / THC IMPORT 40ft HC: **14,880,000 XOF**
- `honoraires` / Suivi opérationnel: 1,120,000 XOF
- `honoraires` / Dédouanement: 75,000 XOF
- `honoraires` / Ouverture dossier: 25,000 XOF
- `honoraires` / Documentation: 15,000 XOF
- `operationnel` / Transport, Surestaries: montants null (à confirmer)
- PAD non résolu: 0 XOF (TO_CONFIRM)

### Pricing run `465bf868` (PAD-NOM-3 test run)

| Champ | Valeur |
|-------|--------|
| `engineTotals.dap` | 3,525,000 XOF |
| `total_ht` stocké | 1,260,000 XOF |
| **Écart** | **2,265,000 XOF** |
| PAD T12 enrichi | 4,015,200 XOF (OFFICIAL, absent des totaux) |

---

## 3. Post-engine enrichments ignorés

### PAD_DROIT_PASSAGE (`run-pricing/index.ts` L2093-2121)

Ajouté après l'appel quotation-engine via `engineResponse.lines.push(...)`.
Le montant est calculé à partir de `port_tariffs.rate` × tonnage.
Source type: `OFFICIAL` ou `TO_CONFIRM`.
**Non inclus dans engineTotals** car ajouté après calcul des totaux.

### TERMINAL_STORAGE_PROVISION_ESTIMATE (`run-pricing/index.ts` L2123-2225)

Ajouté après PAD enrichment.
Calcule la provision magasinage basée sur la franchise PAD.
**Non inclus dans engineTotals** car ajouté après calcul des totaux.

---

## 4. Propagation downstream

| Étape | Fichier | Ligne | Consomme |
|-------|---------|-------|----------|
| Stockage | `run-pricing/index.ts` | L2536-2537 | `total_ht: totalHt, total_ttc: totalTtc` |
| Snapshot | `generate-quotation-version/index.ts` | L342-343 | `pricingRun.total_ht / total_ttc` |
| PDF | `export-quotation-version-pdf/index.ts` | L487 | `snapshot.totals.total_ht` |
| Email | `create-quotation-email-draft/index.ts` | L155-190 | `totalsBlock.total_ht` → "Montant total HT" |
| UI | `PricingResultPanel.tsx` / `QuotationVersionCard.tsx` | — | `snapshot.totals.total_ht` |

**Résultat** : Le PDF affiche 1,235,000 XOF au lieu de ~16,115,000 XOF.

---

## 5. Trois chemins sans dap/ddp dans engineTotals

| Chemin | Ligne | engineTotals produit |
|--------|-------|---------------------|
| Provisional DDP | L1708 | `{ honoraires, debours: 0, operationnel }` |
| Export guard init | L1715 | `{ honoraires: 0, debours: 0 }` |
| Export guard recalc | L1793 | `{ honoraires, debours, operationnel }` |

**Conséquence** : toute formule basée sur `engineTotals?.ddp ?? 0` est dangereuse — elle écraserait le total à 0 sur ces chemins.

---

## 6. Doctrine métier des totaux

| Concept | Signification | TVA SODATRA |
|---------|---------------|-------------|
| `honoraires_ht` | Base honoraires transitaire SODATRA | ✅ Oui (18%) |
| `operationnel` | THC, manutention, transport | ❌ Non |
| `border` | Frais frontaliers | ❌ Non |
| `terminal` | Frais terminaux | ❌ Non |
| `debours` | Droits de douane, taxes | ❌ Non |
| PAD enrichment | Droit de passage portuaire | ❌ Non |
| Terminal storage | Provision magasinage | ❌ Non |

**total_ht** = total client HT (tous blocs inclus, hors TVA)
**total_ttc** = total_ht + TVA sur honoraires uniquement

---

## 7. PAD-R1B — Fonction IA existante (documentation)

### Localisation
- `supabase/functions/recommend-pad-category/index.ts`
- Appelle `callAI(...)` avec `google/gemini-2.5-flash`

### Intégration
- Appelée par `src/components/case/DesignationSuggestionBlock.tsx` L298
- Via `supabase.functions.invoke("recommend-pad-category", ...)`
- Interface opérateur : bouton IA pour recommander une catégorie PAD

### Statut config.toml
- **Non déclarée** dans `supabase/config.toml`
- Fonctionne car Lovable Cloud déploie avec `verify_jwt = false` par défaut

### Verdict PAD-R1B
- **Active dans l'UI** : oui (DesignationSuggestionBlock)
- **Branchée à run-pricing** : non
- **Conforme PAD-R1 local-only** : non (appel IA)
- **Action** : documenter comme non-canonique, ne pas modifier dans PAD-TOTALS-1
- **Chantier séparé** : PAD-R1B-GOVERNANCE requis

---

## 8. Verdict

**BUG CONFIRMÉ** — intégrité commerciale.
- Le devis client affiché est sous-évalué d'un facteur 3x à 13x selon les cas.
- Tous les chemins downstream (snapshot, PDF, email, UI) propagent l'erreur.
- Patch requis dans `run-pricing/index.ts` uniquement (PAD-TOTALS-1).
