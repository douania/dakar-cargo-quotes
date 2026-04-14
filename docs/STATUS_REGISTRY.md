# Status Registry — Dakar Cargo Quotes

> Subordonné à docs/MASTER_CONTEXT.md (source de vérité).
> Ce document décrit l'application opérationnelle du contrat d'état réellement supporté par le code.

Date de création : 2026-03-11
Phase : M19
Dernière mise à jour : 2026-04-10

---

## 1. Liste canonique des statuts réellement supportés

L'enum DB `quote_case_status` contient 17 valeurs.

| # | Statut | Label FR | Définition métier | Fonction(s) autorisées à l'écrire | Classification | Écran(s) principaux |
|---|--------|----------|-------------------|-----------------------------------|----------------|---------------------|
| 1 | `INTAKE` | Réception | Dossier créé manuellement (sans email) | `ensure-quote-case` | active | CaseView, CaseCard |
| 2 | `NEW_THREAD` | Nouveau fil | Dossier créé automatiquement depuis un email non-RFQ | `ensure-quote-case` | active | CaseView, CaseCard |
| 3 | `RFQ_DETECTED` | RFQ détectée | Email identifié comme demande de cotation | `ensure-quote-case` | active | CaseView, CaseCard |
| 4 | `FACTS_PARTIAL` | Données incomplètes | Puzzle analysé, données insuffisantes | `build-case-puzzle`, `sync-emails` | active | CaseView, CaseCard |
| 5 | `NEED_INFO` | Info requise | Gaps bloquants identifiés, action requise | `build-case-puzzle` | waiting | CaseView, CaseCard, BlockingGapsPanel |
| 6 | `READY_TO_PRICE` | Prêt à chiffrer | Puzzle complet, aucune ambiguïté détectée (P4). Dossier directement éligible au pricing sans validation opérateur. | `build-case-puzzle` (P4) | active | CaseView, CaseCard |
| 7 | `DECISIONS_PENDING` | Décisions en attente | Puzzle complet (pas de gaps bloquants, faits disponibles), en attente de validation des décisions opérateur | `build-case-puzzle` | active | CaseView, CaseCard, DecisionSupportPanel |
| 8 | `DECISIONS_COMPLETE` | Décisions validées | Toutes les décisions opérateur sont commitées (5/5) | `commit-decision` | active | CaseView, CaseCard |
| 9 | `ACK_READY_FOR_PRICING` | Prêt confirmé | Opérateur a confirmé le lancement du chiffrage | `ack-pricing-ready` | frozen | CaseView, CaseCard |
| 10 | `PRICING_RUNNING` | Chiffrage en cours | Moteur de pricing en exécution | `run-pricing` | active | CaseView, CaseCard |
| 11 | `PRICED_DRAFT` | Brouillon chiffré | Résultat de chiffrage disponible, en attente de revue | `run-pricing` | active | CaseView, CaseCard |
| 12 | `HUMAN_REVIEW` | Revue humaine | Statut conservé à titre historique et de compatibilité documentaire. **Hors pipeline canonique actuel** : présent dans l'enum DB et supporté défensivement par `generate-quotation-version`, mais aucun writer canonique actif ne pousse vers ce statut depuis la suppression de `generate-case-outputs` en M26b. La revue humaine se fait implicitement lors de la création de version depuis `PRICED_DRAFT`. | ❌ aucun writer canonique actif (fonction historique supprimée en M26b) | dormant | CaseView, CaseCard |
| 13 | `QUOTED_VERSIONED` | Versionné | Version de cotation générée | `generate-quotation-version` | active | CaseView, CaseCard |
| 14 | `SENT` | Envoyé | Cotation envoyée au client | `send-quotation` | terminal | CaseView, CaseCard |
| 15 | `ARCHIVED` | Archivé | Dossier clos (action manuelle future) | ❌ aucun writer canonique actif identifié dans le runtime actuel (dormant) | dormant | CaseView, CaseCard |
| 16 | `ACCEPTED` | Accepté | Client a accepté le devis | `close-commercial-outcome` | terminal | CaseView, CaseCard |
| 17 | `REJECTED` | Refusé | Client a refusé le devis | `close-commercial-outcome` | terminal | CaseView, CaseCard |

### Classifications

- **active** : le dossier est en cours de traitement, transitions automatiques possibles
- **waiting** : en attente d'action opérateur ou client
- **frozen** : statut figé par `build-case-puzzle` (pas de rétrogradation automatique), réouvrable par `sync-emails`
- **terminal** : état final du workflow courant
- **dormant** : présent dans l'enum DB mais jamais écrit par le runtime actuel
- **legacy** : présent dans l'enum DB, accepté en lecture pour compatibilité, mais plus écrit par le runtime post-S3 (sauf READY_TO_PRICE réactivé en P4)

---

## 2. Transitions réellement observées

| # | From | To | Owner function | Type |
|---|------|----|----------------|------|
| 1 | *(création)* | `INTAKE` | `ensure-quote-case` | operator-driven |
| 2 | *(création)* | `NEW_THREAD` | `ensure-quote-case` | automatic |
| 3 | *(création)* | `RFQ_DETECTED` | `ensure-quote-case` | automatic |
| 4 | `NEW_THREAD` / `RFQ_DETECTED` | `FACTS_PARTIAL` | `build-case-puzzle` | automatic |
| 5 | `FACTS_PARTIAL` | `NEED_INFO` | `build-case-puzzle` | automatic |
| 6a | Puzzle complete, ambiguity detected | `DECISIONS_PENDING` | `build-case-puzzle` | automatic (P4) |
| 6b | Puzzle complete, no ambiguity | `READY_TO_PRICE` | `build-case-puzzle` | automatic (P4) |
| 7 | `DECISIONS_PENDING` | `DECISIONS_COMPLETE` | `commit-decision` | operator-driven |
| 8 | `DECISIONS_COMPLETE` | `ACK_READY_FOR_PRICING` | `ack-pricing-ready` | operator-driven |
| 9 | `ACK_READY_FOR_PRICING` / `READY_TO_PRICE` (legacy) | `PRICING_RUNNING` | `run-pricing` | automatic |
| 10 | `PRICING_RUNNING` | `PRICED_DRAFT` | `run-pricing` | automatic |
| 11 | `PRICED_DRAFT` | `HUMAN_REVIEW` | ❌ supprimée du pipeline canonique | `generate-case-outputs` n'existe plus dans le runtime (supprimée M26b). La transition `PRICED_DRAFT` → `HUMAN_REVIEW` n'est plus produite par une fonction canonique active. Le statut `HUMAN_REVIEW` reste dans l'enum DB à titre historique. |
| 11b | `PRICED_DRAFT` | `QUOTED_VERSIONED` | `generate-quotation-version` | operator-driven — **chemin canonique actuel** |
| 12 | `HUMAN_REVIEW` | `QUOTED_VERSIONED` | `generate-quotation-version` | operator-driven — accepté défensivement, non atteint en pratique |
| 13 | `QUOTED_VERSIONED` | `SENT` | `send-quotation` | operator-driven |
| 14 | `SENT` / `ACK_READY_FOR_PRICING` / `DECISIONS_PENDING` / `DECISIONS_COMPLETE` / `READY_TO_PRICE` | `FACTS_PARTIAL` | `sync-emails` | automatic (reopen) |
| 15 | `SENT` | `ACCEPTED` | `close-commercial-outcome` | operator-driven |
| 16 | `SENT` | `REJECTED` | `close-commercial-outcome` | operator-driven |

### Protection contre rétrogradation (Phase S3)

`build-case-puzzle` gèle les statuts suivants — un rebuild ne peut pas les rétrograder :
- `DECISIONS_PENDING`, `DECISIONS_COMPLETE`
- `ACK_READY_FOR_PRICING`, `PRICED_DRAFT`, `HUMAN_REVIEW`
- `SENT`, `ACCEPTED`, `REJECTED`, `ARCHIVED`

---

## 3. Statuts exclus du contrat canonique courant

| Statut | Raison |
|--------|--------|
| `LOST` | Absent de l'enum DB. Label mort dans l'ancien code UI. |
| `PRICED` | Absent de l'enum DB. Label mort — le statut réel est `PRICED_DRAFT`. |

---

## 4. Open questions

1. **ARCHIVED** : présent dans l'enum DB et dans `FROZEN_STATUSES`. 14 cas en statut ARCHIVED dans la DB live. Aucun writer canonique actif identifié dans le runtime actuel. L'origine de ces cas historiques en base n'est pas établie ici.

2. **Transitions croisées ACCEPTED ↔ REJECTED** : interdites par `close-commercial-outcome`. Si un opérateur se trompe, aucun mécanisme de correction n'est prévu dans le runtime actuel.

---

## 5. Sémantique EQ1 — statut `sent` des demandes partenaires

Le statut `sent` dans `external_quote_requests` signifie : **brouillon email créé par le système, envoi manuel attendu par l'opérateur**.

Le système ne dispose d'aucune intégration SMTP. La frontière système est :
- Le runtime produit un `email_draft` (via `send-external-quote-request`)
- L'opérateur copie/envoie manuellement depuis son client email
- Le statut `sent` marque la fin de l'action système, pas la preuve d'un dispatch réel

Cette sémantique est cohérente avec la décision fondamentale **"Pas d'auto-send"** documentée dans `docs/MASTER_CONTEXT.md`.

> **Dette identifiée** : le label `sent` est sémantiquement ambigu. Un statut intermédiaire `draft_ready` serait plus littéral. À reconsidérer si une intégration SMTP est ajoutée.

---

## 6. Historique des phases

| Phase | Date | Changement |
|-------|------|------------|
| S2 | 2026-03-11 | Création du registre. Alignement UI/DB sur les 15 statuts. `DECISIONS_PENDING` documenté comme ghost. |
| S3 | 2026-03-11 | `DECISIONS_PENDING` restauré comme état canonique actif. `build-case-puzzle` en devient le writer. `READY_TO_PRICE` passe en legacy. Protection contre rétrogradation étendue. |
| P4 | 2026-03-16 | Bypass décisionnel : `build-case-puzzle` introduit détection d'ambiguïté. Cas clairs → `READY_TO_PRICE` (réactivé). Cas ambigus → `DECISIONS_PENDING`. Signaux : `UNKNOWN_FLOW_TYPE`, `AMBIGUOUS_LCL_FCL`, `NO_SERVICE_PACKAGE`. `ACK_READY_FOR_PRICING` reste exclusif à `ack-pricing-ready`. |
| STAB-1 | 2026-03-23 | Stabilisation EQ1/P4 : fix `getNextAction()` (closed, response_analyzed, partially_validated). Extraction `PRICING_CRITICAL_KEYS` en module partagé. Clarification sémantique `sent` EQ1. Réalignement `.lovable/plan.md` avec P4.E/F/G. |
| M6.1 | 2026-03-25 | Cockpit canonique : CaseView désigné comme surface principale opérateur. QuotationSheet réduit à surface secondaire email-first/legacy. Panels workflow dupliqués (Decision, Pricing, Version, Send) retirés de QuotationSheet quand un quote_case existe. Dashboard ne redirige plus silencieusement vers QuotationSheet. Colonne "Écran(s) principaux" réalignée sur CaseView. |
| M6.2 | 2026-03-25 | HUMAN_REVIEW déclassé du chemin canonique. Reclassifié de `waiting` à `dormant`. Chemin canonique explicité : `PRICED_DRAFT` → `QUOTED_VERSIONED` → `SENT`. La revue humaine est implicite dans l'action de création de version. Transition 11 (`generate-case-outputs`) marquée dormante. (Fonction supprimée en M26b.) |
| M19b | 2026-03-25 | Audit FSM transversal. CHECK constraint `case_timeline_events.event_type` alignée avec le runtime : 6 event_types manquants ajoutés (`new_email_received`, `quotation_version_created`, `decision_committed`, `all_decisions_complete`, `pricing_unlocked`, `pricing_blocked`). Traçabilité restaurée pour les événements futurs. Aucune edge function modifiée. |
