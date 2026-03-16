# Status Registry — Dakar Cargo Quotes

> Subordonné à docs/MASTER_CONTEXT.md (source de vérité).
> Ce document décrit l'application opérationnelle du contrat d'état réellement supporté par le code.

Date de création : 2026-03-11
Phase : S3
Dernière mise à jour : 2026-03-11

---

## 1. Liste canonique des statuts réellement supportés

L'enum DB `quote_case_status` contient 15 valeurs.

| # | Statut | Label FR | Définition métier | Fonction(s) autorisées à l'écrire | Classification | Écran(s) principaux |
|---|--------|----------|-------------------|-----------------------------------|----------------|---------------------|
| 1 | `INTAKE` | Réception | Dossier créé manuellement (sans email) | `ensure-quote-case` | active | CaseView, CaseCard |
| 2 | `NEW_THREAD` | Nouveau fil | Dossier créé automatiquement depuis un email non-RFQ | `ensure-quote-case` | active | CaseCard, QuotationHeader |
| 3 | `RFQ_DETECTED` | RFQ détectée | Email identifié comme demande de cotation | `ensure-quote-case` | active | CaseCard, QuotationHeader |
| 4 | `FACTS_PARTIAL` | Données incomplètes | Puzzle analysé, données insuffisantes | `build-case-puzzle`, `sync-emails` | active | CaseCard, QuotationHeader, BlockingGapsPanel |
| 5 | `NEED_INFO` | Info requise | Gaps bloquants identifiés, action requise | `build-case-puzzle` | waiting | CaseView, CaseCard, QuotationHeader, BlockingGapsPanel |
| 6 | `READY_TO_PRICE` | Prêt à chiffrer | Puzzle complet, aucune ambiguïté détectée (P4). Dossier directement éligible au pricing sans validation opérateur. | `build-case-puzzle` (P4) | active | CaseView, CaseCard |
| 7 | `DECISIONS_PENDING` | Décisions en attente | Puzzle complet (pas de gaps bloquants, faits disponibles), en attente de validation des décisions opérateur | `build-case-puzzle` | active | CaseView, CaseCard, QuotationHeader, DecisionSupportPanel |
| 8 | `DECISIONS_COMPLETE` | Décisions validées | Toutes les décisions opérateur sont commitées (5/5) | `commit-decision` | active | QuotationHeader |
| 9 | `ACK_READY_FOR_PRICING` | Prêt confirmé | Opérateur a confirmé le lancement du chiffrage | `ack-pricing-ready` | frozen | QuotationHeader |
| 10 | `PRICING_RUNNING` | Chiffrage en cours | Moteur de pricing en exécution | `run-pricing` | active | CaseCard, QuotationHeader |
| 11 | `PRICED_DRAFT` | Brouillon chiffré | Résultat de chiffrage disponible, en attente de revue | `run-pricing` | active | CaseView, CaseCard, QuotationHeader |
| 12 | `HUMAN_REVIEW` | Revue humaine | Outputs générés, en attente de validation opérateur | `generate-case-outputs` | waiting | CaseCard, QuotationHeader |
| 13 | `QUOTED_VERSIONED` | Versionné | Version de cotation générée | `generate-quotation-version` | active | CaseCard, QuotationHeader |
| 14 | `SENT` | Envoyé | Cotation envoyée au client | `send-quotation` | terminal | CaseView, CaseCard, QuotationHeader |
| 15 | `ARCHIVED` | Archivé | Dossier clos (action manuelle future) | ❌ aucune (dormant) | dormant | CaseView, CaseCard |

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
| 11 | `PRICED_DRAFT` | `HUMAN_REVIEW` | `generate-case-outputs` | automatic |
| 12 | `HUMAN_REVIEW` | `QUOTED_VERSIONED` | `generate-quotation-version` | operator-driven |
| 13 | `QUOTED_VERSIONED` | `SENT` | `send-quotation` | operator-driven |
| 14 | `SENT` / `ACK_READY_FOR_PRICING` / `DECISIONS_PENDING` / `DECISIONS_COMPLETE` / `READY_TO_PRICE` | `FACTS_PARTIAL` | `sync-emails` | automatic (reopen) |

### Protection contre rétrogradation (Phase S3)

`build-case-puzzle` gèle les statuts suivants — un rebuild ne peut pas les rétrograder :
- `DECISIONS_PENDING`, `DECISIONS_COMPLETE`
- `ACK_READY_FOR_PRICING`, `PRICED_DRAFT`, `HUMAN_REVIEW`
- `SENT`, `ACCEPTED`, `REJECTED`, `ARCHIVED`

---

## 3. Statuts exclus du contrat canonique courant

| Statut | Raison |
|--------|--------|
| `ACCEPTED` | Absent de l'enum DB. Référencé dans `FROZEN_STATUSES` de `build-case-puzzle` et `sync-emails` comme garde passive. Aucune fonction ne l'écrit. |
| `REJECTED` | Absent de l'enum DB. Même situation que `ACCEPTED`. |
| `LOST` | Absent de l'enum DB. Label mort dans l'ancien code UI. |
| `PRICED` | Absent de l'enum DB. Label mort — le statut réel est `PRICED_DRAFT`. |

---

## 4. Open questions

1. **Fin commerciale après SENT** : aucune transition `SENT → ACCEPTED` ou `SENT → REJECTED` n'est modélisée. La fin commerciale n'est pas couverte par le runtime actuel.

2. **ARCHIVED** : présent dans l'enum DB et dans `FROZEN_STATUSES`, mais jamais écrit par le runtime. Probablement prévu comme action manuelle future.

---

## 5. Historique des phases

| Phase | Date | Changement |
|-------|------|------------|
| S2 | 2026-03-11 | Création du registre. Alignement UI/DB sur les 15 statuts. `DECISIONS_PENDING` documenté comme ghost. |
| S3 | 2026-03-11 | `DECISIONS_PENDING` restauré comme état canonique actif. `build-case-puzzle` en devient le writer. `READY_TO_PRICE` passe en legacy. Protection contre rétrogradation étendue. |
| P4 | 2026-03-16 | Bypass décisionnel : `build-case-puzzle` introduit détection d'ambiguïté. Cas clairs → `READY_TO_PRICE` (réactivé). Cas ambigus → `DECISIONS_PENDING`. Signaux : `UNKNOWN_FLOW_TYPE`, `AMBIGUOUS_LCL_FCL`, `NO_SERVICE_PACKAGE`. `ACK_READY_FOR_PRICING` reste exclusif à `ack-pricing-ready`. |
