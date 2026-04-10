
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

---

## CLIENT-GAP-POLICY-FIX — pricing.pad_category ajouté comme gap client-résolvable ✅ DONE

### Problème
Le bouton "Générer brouillon client" dans CaseView échouait silencieusement quand le seul gap ouvert était `pricing.pad_category`. La chaîne `sync-gap-client-actions` → `generate-reply-draft` ne produisait aucune action car `pricing.pad_category` n'était pas dans la whitelist `CLIENT_RESOLVABLE_GAP_KEYS`.

### Diagnostic
1. `sync-gap-client-actions` filtre les gaps via `isClientResolvableGap()` — `pricing.pad_category` absent → `no_client_resolvable_gaps`
2. `generate-reply-draft` utilise exclusivement `GAP_QUESTION_MAP` pour formuler les questions — pas de fallback sur `quote_gaps.question_fr`
3. Les deux ajouts (whitelist + question map) sont donc nécessaires

### Correctif appliqué
1. **`supabase/functions/_shared/client-gap-policy.ts`** : ajout de `"pricing.pad_category"` dans `CLIENT_RESOLVABLE_GAP_KEYS`
2. **`supabase/functions/_shared/client-gap-policy.ts`** : ajout de l'entrée `GAP_QUESTION_MAP["pricing.pad_category"]` = "Pouvez-vous préciser la nature exacte de la marchandise ainsi que le poids brut total ? Ces informations sont nécessaires pour déterminer les droits de passage portuaires applicables."

### Fichiers modifiés
- `supabase/functions/_shared/client-gap-policy.ts` — whitelist + question map

---

## DOC-ALIGN-1 — Alignement documentaire complet repo ↔ état réel ✅ DONE

### Périmètre
Mise en cohérence de la documentation avec le runtime réel, les lots exécutés et les décisions prises.

### Fichiers modifiés
- `.lovable/plan.md` — ajout CLIENT-GAP-POLICY-FIX + DOC-ALIGN-1
- `docs/MASTER_CONTEXT.md` — phase line, SOURCE-GUARD, exception CARRIER-PORT-TAX-1B-A, lots récents
- `docs/SECURITY_CONTRACT.md` — 6 fonctions manquantes + section SOURCE-GUARD
- `docs/STATUS_REGISTRY.md` — date mise à jour
- `docs/DECISIONS.md` — déclassement historique (Option A)
