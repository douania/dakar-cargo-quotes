
# Orchestration — Plan d'exécution

## ORCH-SYNC-2 — Aligner bloc Actions & actions internes ✅ DONE

### Problème
1. Le vieux bloc "Actions" affichait "Aucune action ouverte" même quand ReadyActionsPanel avait des actions client prioritaires
2. Les actions internes ("Créer la version du devis") apparaissaient comme exécutables même en présence de gaps bloquants

### Correctif appliqué
1. **CaseView.tsx** : Le bloc "Open Actions" n'est affiché que pour les dossiers terminaux (`SENT`, `ACCEPTED`, `REJECTED`, `ARCHIVED`). Pour les dossiers actifs, ReadyActionsPanel est la seule source d'actions exécutables.
2. **ReadyActionsPanel.tsx** : Les actions internes (§8 — pricing, version, PDF) sont conditionnées à `!hasBlockingGaps`. Elles réapparaissent automatiquement quand tous les gaps bloquants sont résolus.

### Fichiers modifiés
- `src/pages/CaseView.tsx` — wrapping conditionnel du bloc Actions
- `src/components/case/ReadyActionsPanel.tsx` — guard `hasBlockingGaps` sur §8

---

## Fix impression PDF ✅ DONE

Neutralisation du layout flex sidebar dans `@media print` (`src/index.css`).

---

## PRICING-AUDIT-1 — Clarification des lignes tarifaires ✅ DONE

### Problème
Les lignes pricing affichaient des faux zéros (PAD_DROIT_PASSAGE = 0 au lieu de "À confirmer") et ne distinguaient pas visuellement les lignes calculées, informatives et en attente.

### Correctif appliqué
1. **PricingResultPanel.tsx** : `isToConfirm` corrigé pour détecter `source.type === 'TO_CONFIRM'` indépendamment du montant (couvre les cas `amount: 0`).
2. **PricingResultPanel.tsx** : Ajout de la détection `isInformational` pour les lignes à zéro métier (`business_rule` / `OFFICIAL` avec `amount: 0`), rendu en style muted avec label explicatif.
3. **PricingResultPanel.tsx** : Résumé de fiabilité ajouté sous le compteur de lignes (`X calculées · Y à confirmer · Z info`).
4. **PricingResultPanel.tsx** : Avertissement "Total provisoire" affiché quand des postes sont encore à confirmer.
5. **DEFERRED_BACKLOG.md** : PORT_DAKAR_HANDLING documenté comme dette métier sous audit (confiance 69%).

### Fichiers modifiés
- `src/components/puzzle/PricingResultPanel.tsx` — fix isToConfirm, rendu informatif, résumé fiabilité, total provisoire
- `docs/DEFERRED_BACKLOG.md` — PORT-DAKAR-HANDLING-AUDIT ajouté
- `.lovable/plan.md` — documentation

---

## CARRIER-PORT-TAX-1B-A — Injection carrier charges IMPORT (carrier connu) ✅ DONE

### Problème
Le moteur `quotation-engine` chargeait les carrier charges pour toutes les opérations via `fetchCarrierCharges()`, mais ne les injectait que pour TRANSIT (`if (isTransit && carrierCharges.length > 0)`). Les charges carrier IMPORT (TXI, HTF, etc.) étaient donc ignorées même quand le carrier était connu.

### Correctif appliqué
1. **quotation-engine/index.ts** L1457 : condition `isTransit &&` supprimée → `if (carrierCharges.length > 0)`. Le bloc d'injection existant (PER_BL, PER_CNT, PER_TEU) est déjà générique.
2. Quand `carrier` est absent, `fetchCarrierCharges` ne retourne que les templates `GENERIC` (aucun pour import), donc `carrierCharges.length === 0` → pas de faux positif.

### Option B reportée
La stratégie "carrier inconnu → provisionnement prudent sur plus haute valeur fixe connue" est documentée dans `docs/DEFERRED_BACKLOG.md` (ID: CARRIER-PORT-TAX-1B) comme décision produit à arbitrer séparément.

### Fichiers modifiés
- `supabase/functions/quotation-engine/index.ts` — suppression guard `isTransit` sur injection carrier charges
- `docs/DEFERRED_BACKLOG.md` — Option B documentée
- `.lovable/plan.md` — documentation
