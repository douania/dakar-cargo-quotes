# PLAN D'IMPLEMENTATION — HISTORIQUE PHASES

## Phase 12 : IMPLÉMENTÉE ✅

### Exploitation contrôlée des résultats Pricing + Versioning + PDF Draft

**Date d'implémentation** : 2026-02-05

---

### 1. RÉSUMÉ

Phase 12 transforme un résultat technique (`pricing_runs`) en un draft de devis versionné, auditable et exportable.

### 2. ENTITÉS CRÉÉES

| Table | Description |
|-------|-------------|
| `quotation_versions` | Snapshots immuables des devis depuis pricing_runs |
| `quotation_version_lines` | Lignes tarifaires figées par version |

### 3. AJUSTEMENTS CTO INTÉGRÉS

| # | Ajustement | Implémentation |
|---|------------|----------------|
| 1 | RLS INSERT quotation_versions | `(created_by OR assigned_to)` via quote_cases |
| 2 | RLS INSERT quotation_version_lines | Policy complète ajoutée |
| 3 | 1 seul is_selected par case | Index unique partiel `uq_qv_selected_per_case` |
| 4 | Version number atomique | RPC `get_next_quotation_version_number` avec `pg_advisory_xact_lock` |
| 5 | Alignement statuts UI | Visible si status IN ('PRICED_DRAFT', 'HUMAN_REVIEW') |
| 6 | PDF tracé dans quotation_documents | Colonne `quotation_version_id` ajoutée |

### 4. EDGE FUNCTIONS CRÉÉES

| Fonction | Rôle |
|----------|------|
| `generate-quotation-version` | Crée une version immuable depuis un pricing_run |
| `export-quotation-version-pdf` | Génère un PDF DRAFT avec mention obligatoire |

### 5. COMPOSANTS UI

| Composant | Rôle |
|-----------|------|
| `PricingResultPanel.tsx` | Affiche résumé pricing + bouton création version |
| `QuotationVersionCard.tsx` | Liste des versions + export PDF |
| `usePricingResultData.ts` | Hook données pricing + versions |

### 6. FLUX POST-PHASE 12

```
ACK_READY_FOR_PRICING
        |
        v (run-pricing)
PRICING_RUNNING
        |
        v (success)
PRICED_DRAFT
        |
        +-- UI: PricingResultPanel visible
        +-- Bouton: Créer version v1
        |
        v (generate-quotation-version)
        |
quotation_versions.snapshot FIGÉ
        |
        +-- export-quotation-version-pdf
        +-- quotation_documents.quotation_version_id
        |
        v (generate-case-outputs)
HUMAN_REVIEW
        |
        +-- UI: Panels toujours visibles (ajustement #5)
```

### 7. CE QUI N'EST PAS DANS PHASE 12

| Élément | Phase future |
|---------|--------------|
| Envoi email client | Phase 13 |
| Validation commerciale | Phase 13 |
| Signature électronique | Phase 14+ |
| Facturation | Phase 15+ |
| Édition manuelle lignes | Non prévu (immutabilité) |

---

## Phase 11 : IMPLÉMENTÉE ✅

### Modification run-pricing : ACK_READY_FOR_PRICING

**Date d'implémentation** : 2026-02-05

| Modification | Détail |
|--------------|--------|
| Gate statut | `ACK_READY_FOR_PRICING` requis (Phase 10) |
| Timeline | `previous_value` = ACK_READY_FOR_PRICING |
| Rollback | Retour vers ACK_READY_FOR_PRICING si erreur |

---

## Phase 10.1 : IMPLÉMENTÉE ✅

### Gate manuel ACK_READY_FOR_PRICING

- Edge function `ack-pricing-ready`
- Bouton `PricingLaunchPanel`
- Visible uniquement si `READY_TO_PRICE`
