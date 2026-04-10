
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

---

## P0-A — ReadyActionsPanel : console de priorisation avec navigation directe ✅ DONE

### Problème
ReadyActionsPanel calculait 9 priorités opérationnelles mais n'exécutait directement que 3 (brouillon client, copier, marquer envoyé). Les 6 actions restantes (partenaire draft/envoi/faits/sélection, pricing, version) étaient orphelines — affichées sans bouton d'action ni navigation.

### Décision architecturale
ReadyActionsPanel = **console de priorisation** avec navigation directe vers les panneaux spécialisés. Ce n'est **pas** une couche d'exécution universelle. L'exécution métier complexe reste dans les panneaux opératoires dédiés.

### Discriminant d'action
Chaque action porte un `actionKey` explicite (type `ActionKey`) utilisé pour le routage de navigation. Les actions partenaire `to_execute` sont distinguées par `actionKey` (`pending_facts` vs `select_partner`), pas par une heuristique fragile `type + status`.

### Mapping actions → surfaces opératoires

| Action | actionKey | Surface cible | Mode |
|---|---|---|---|
| Gap bloquant client | `blocking_gap` | ReadyActionsPanel | Exécution directe |
| Clarification drafted | `drafted_client_gap` | ReadyActionsPanel | Exécution directe |
| Clarification en attente | `open_client_gap` | — | Informatif |
| Demande partenaire draft | `draft_partner` | ExternalRequestsPanel | Navigation |
| Envoi partenaire | `unsent_partner` | ExternalRequestsPanel | Navigation |
| Faits partenaires | `pending_facts` | ExternalRequestsPanel | Navigation |
| Sélection offre | `select_partner` | PartnerRequestsDetailView | Navigation |
| Pricing | `launch_pricing` | PricingLaunchPanel | Navigation |
| Version | `create_version` | QuotationVersionCard | Navigation |

### Fix défensif `kind || output_type`
Le filtre des brouillons timeline (L184) accepte maintenant `kind === "reply_draft_v1"` OU `output_type === "reply_draft_v1"` pour tolérer les deux conventions.

### Fichiers modifiés
- `src/components/case/ReadyActionsPanel.tsx` — type `ActionKey`, `actionKey` sur chaque action, `scrollToSection` helper, boutons de navigation, fix filter draft
- `src/pages/CaseView.tsx` — 4 ancres `id` stables (`section-partner-detail`, `section-external-requests`, `section-pricing`, `section-version`)

---

## P0-B — Réintégration manual_action dans le cockpit actif ✅ DONE

### Diagnostic

Inventaire exhaustif des `manual_action` produites par les edge functions actives :

| action_code | Source edge function | Couvert nativement ? | Décision |
|---|---|---|---|
| `REQUEST_CLIENT_INFO_FOR_GAPS` | `sync-gap-client-actions` | **OUI** — ReadyActionsPanel (blocking gaps) | Ignorer |
| `PREPARE_CLIENT_REPLY_DRAFT` | `analyze-reply-event`, `apply-thread-intent-v1` | **OUI** — ReadyActionsPanel (gaps ouverts) | Ignorer |
| `LAUNCH_PRICING` | `analyze-reply-event` | **OUI** — ReadyActionsPanel (action pricing) | Ignorer |
| `REVIEW_PARTNER_RESPONSE` | `analyze-partner-response` | **OUI** — ReadyActionsPanel (pending_facts) | Ignorer |
| `APPLY_FACT_PROPOSALS` | `analyze-reply-event` | **Partiel** — section CaseView existe, pas de CTA cockpit | Micro-patch navigation |
| `IDENTIFY_MISSING_INFO` | `apply-thread-intent-v1` | **OUI** — bloc Thread intent CaseView | Ignorer |
| `REVIEW_NEW_REQUEST` | `apply-thread-intent-v1` | **OUI** — bloc Thread intent CaseView | Ignorer |
| `REVIEW_THREAD_INTENT` | `apply-thread-intent-v1` | **OUI** — bloc Thread intent CaseView | Ignorer |

### Décision architecturale

Seule `APPLY_FACT_PROPOSALS` nécessite un micro-patch de navigation. Toutes les autres actions sont déjà couvertes nativement ou par des blocs dédiés existants. Aucun système parallèle de lecture des `manual_action` n'est créé.

### Correctif appliqué (Option 2 — micro-patch navigation)

1. **CaseView.tsx** : ancre `id="section-reply-analysis"` ajoutée sur la section « Analyse dernière réponse client »
2. **ReadyActionsPanel.tsx** :
   - `"apply_facts"` ajouté au type `ActionKey`
   - Entrée `apply_facts: "section-reply-analysis"` dans `ACTION_SCROLL_TARGETS`
   - Entrée `apply_facts: "Voir les faits proposés"` dans `ACTION_NAV_LABELS`
   - Entrée `apply_facts` dans `NEXT_STEPS`
   - Détection de `reply_analysis_v1` depuis la requête timeline **déjà existante** (aucune nouvelle requête DB timeline)
   - Filtrage des faits proposés vs `quote_facts` courants via `toFactPayload()` (même logique que `isFactAlreadyApplied()` de CaseView)
   - CTA affiché avec `priority: "next"` uniquement si au moins un fait proposé n'est pas encore appliqué

### Micro-correctif condition de visibilité (P0-B-fix)
- **Problème** : le CTA s'affichait dès que `proposed_facts.length > 0`, même si tous les faits étaient déjà appliqués (faux positif)
- **Correctif** : ajout d'une 7e requête `quote_facts` (filtre `is_current`) dans le `Promise.all` existant, puis filtrage via `toFactPayload()` importé depuis `helpers.ts` — logique identique à `isFactAlreadyApplied()` de CaseView
- **Le CTA disparaît automatiquement quand tous les faits sont appliqués**

### Contraintes respectées
- **1 requête DB supplémentaire légère** : `quote_facts` avec `is_current` (quelques dizaines de rows max)
- **Aucune lecture de `manual_action`** : la source de vérité reste `reply_analysis_v1`
- **Aucun doublon** : le CTA navigue vers la section existante, il ne recrée pas le rendu des faits
- **Priorité modérée** : `"next"`, ne concurrence pas les gaps bloquants ou clarifications client
- **Logique de comparaison identique** à `isFactAlreadyApplied()` — pas de divergence

### Fichiers modifiés
- `src/pages/CaseView.tsx` — ancre `section-reply-analysis`
- `src/components/case/ReadyActionsPanel.tsx` — ActionKey, scroll target, nav label, next step, détection reply_analysis, filtrage unapplied facts via toFactPayload, CTA builder
- `.lovable/plan.md` — documentation P0-B

---

## P0-C — Confirmation traçable d'envoi partenaire ✅ DONE

### Problème
L'UI affichait "À confirmer" pour les demandes partenaires `status=sent && !email_sent_at`, mais aucune action opératoire ne permettait de confirmer l'envoi réel.

### Solution — Option A (pas de nouvel enum)
- Nouvelle edge function `confirm-external-request-sent` (`requireUser`)
- Préconditions backend :
  - `request` existe avec `case_id` correspondant
  - `status === "sent"`
  - `email_draft_id` présent (garde d'intégrité)
  - `email_sent_at` NULL → sinon retour idempotent
- Mutation : `UPDATE email_sent_at = now()`
- Timeline : `manual_action` avec `action_code = "PARTNER_REQUEST_SEND_CONFIRMED"`, `dedupe_key`
- UI : bouton "Confirmer l'envoi" dans ExternalRequestsPanel, conditionné à `status=sent && !email_sent_at`
- Invalidation large : `external-*` + 8 surfaces cockpit
- Compatible COM-1A futur

### Fichiers modifiés
- `supabase/functions/confirm-external-request-sent/index.ts` — nouvelle edge function
- `supabase/config.toml` — entrée `[functions.confirm-external-request-sent]` avec `verify_jwt = false`
- `src/hooks/useExternalRequestFlow.ts` — mutation `confirmSent` + invalidation large (8 surfaces cockpit)
- `src/components/puzzle/ExternalRequestsPanel.tsx` — bouton "Confirmer l'envoi" + import CheckCircle
- `docs/MASTER_CONTEXT.md` — section P0-C ajoutée sous S1
- `docs/SECURITY_CONTRACT.md` — `confirm-external-request-sent` ajouté à la classification + S1 Patch Log
- `.lovable/plan.md` — documentation P0-C
