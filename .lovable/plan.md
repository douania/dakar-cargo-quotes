

# Phase S2 — Status Contract Registry: Audit & Plan

## S2.1 — Audit canonique complet

### A. Enum DB réel (`quote_case_status` — 15 valeurs)

```text
NEW_THREAD, RFQ_DETECTED, FACTS_PARTIAL, NEED_INFO,
READY_TO_PRICE, PRICING_RUNNING, PRICED_DRAFT, HUMAN_REVIEW,
SENT, ARCHIVED,
DECISIONS_PENDING, DECISIONS_COMPLETE, ACK_READY_FOR_PRICING,
QUOTED_VERSIONED, INTAKE
```

### B. Statuts réellement écrits par le runtime

```text
┌──────────────────────────┬─────────────────────────────────┬─────────────────────────────────────────┐
│ Statut                   │ Fonction(s) qui le SET          │ Preuve                                  │
├──────────────────────────┼─────────────────────────────────┼─────────────────────────────────────────┤
│ INTAKE                   │ ensure-quote-case               │ l.108: status: "INTAKE"                 │
│ NEW_THREAD               │ ensure-quote-case               │ l.211: initialStatus = "NEW_THREAD"     │
│ RFQ_DETECTED             │ ensure-quote-case               │ l.211: "RFQ_DETECTED" (if is_quotation) │
│ FACTS_PARTIAL            │ build-case-puzzle, sync-emails  │ bcp l.2999/3513, sync l.1532            │
│ NEED_INFO                │ build-case-puzzle               │ l.3511: newStatus = "NEED_INFO"         │
│ READY_TO_PRICE           │ build-case-puzzle               │ l.3509: newStatus = "READY_TO_PRICE"    │
│ DECISIONS_COMPLETE       │ commit-decision                 │ l.587: status: 'DECISIONS_COMPLETE'     │
│ ACK_READY_FOR_PRICING    │ ack-pricing-ready               │ l.256: transition_to                    │
│ PRICING_RUNNING          │ run-pricing                     │ l.325: status: "PRICING_RUNNING"        │
│ PRICED_DRAFT             │ run-pricing                     │ l.709: new_value: "PRICED_DRAFT"        │
│ HUMAN_REVIEW             │ generate-case-outputs           │ l.331: status: "HUMAN_REVIEW"           │
│ QUOTED_VERSIONED         │ generate-quotation-version      │ l.351: status: "QUOTED_VERSIONED"       │
│ SENT                     │ send-quotation                  │ l.280: status: "SENT"                   │
├──────────────────────────┼─────────────────────────────────┼─────────────────────────────────────────┤
│ DECISIONS_PENDING        │ ❌ AUCUNE FONCTION NE LE SET    │ Réf. passive uniquement: commit-decision│
│                          │                                 │ ALLOWED_STATUSES (l.75) = lecture seule │
│ ARCHIVED                 │ ❌ AUCUNE FONCTION NE LE SET    │ Référencé dans FROZEN_STATUSES          │
│                          │                                 │ Probablement manuel ou futur            │
└──────────────────────────┴─────────────────────────────────┴─────────────────────────────────────────┘
```

### C. Statuts fantômes / morts

```text
┌──────────────────┬─────────────────────────────────────────────────────────────────┐
│ Statut           │ Verdict                                                         │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ DECISIONS_PENDING│ IN DB ENUM, mais JAMAIS ÉCRIT par aucune fonction.              │
│                  │ commit-decision l'accepte en lecture (ALLOWED_STATUSES)         │
│                  │ mais AUCUNE fonction ne fait .update(status: DECISIONS_PENDING) │
│                  │ → STATUT MORT / TROU DE WORKFLOW                               │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ ARCHIVED         │ IN DB ENUM, jamais écrit par le runtime.                       │
│                  │ Référencé en FROZEN_STATUSES. Probablement action manuelle      │
│                  │ future. → STATUT DORMANT (pas mort, pas actif)                 │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ ACCEPTED         │ ABSENT de l'enum DB. Référencé dans FROZEN_STATUSES            │
│                  │ (build-case-puzzle l.1629, sync-emails l.1523).                │
│                  │ → FANTÔME : code le compare mais DB le rejette en écriture     │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ REJECTED         │ ABSENT de l'enum DB. Même situation que ACCEPTED.              │
│                  │ → FANTÔME                                                      │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ PRICED           │ ABSENT de l'enum DB. Label mort dans CaseView l.149.           │
│                  │ Le statut réel est PRICED_DRAFT. → LABEL MORT                 │
├──────────────────┼─────────────────────────────────────────────────────────────────┤
│ LOST             │ ABSENT de l'enum DB. Label mort dans CaseView l.152.           │
│                  │ → LABEL MORT                                                   │
└──────────────────┴─────────────────────────────────────────────────────────────────┘
```

**Verdict DECISIONS_PENDING** : non confirmé écrit. Aucune fonction ne fait `.update({ status: 'DECISIONS_PENDING' })`. C'est un trou de workflow — `commit-decision` accepte ce statut en entrée mais rien ne le produit. Le workflow saute de `READY_TO_PRICE` à `DECISIONS_COMPLETE` quand toutes les 5 décisions sont commitées.

### D. Incohérences UI

```text
┌───────────────────────────────────┬────────────────────────────┬──────────────────────────────────┐
│ Composant                         │ Statuts explicites         │ Problème                         │
├───────────────────────────────────┼────────────────────────────┼──────────────────────────────────┤
│ CaseView.tsx STATUS_LABELS        │ INTAKE, NEED_INFO,         │ MANQUANTS: NEW_THREAD,           │
│ (l.145-154)                       │ READY_TO_PRICE, PRICED,    │ RFQ_DETECTED, FACTS_PARTIAL,     │
│                                   │ SENT, ACCEPTED, LOST,      │ PRICING_RUNNING, PRICED_DRAFT,   │
│                                   │ ARCHIVED                   │ HUMAN_REVIEW, DECISIONS_COMPLETE,│
│                                   │                            │ ACK_READY_FOR_PRICING,           │
│                                   │                            │ QUOTED_VERSIONED                 │
│                                   │                            │ MORTS: PRICED, ACCEPTED, LOST    │
├───────────────────────────────────┼────────────────────────────┼──────────────────────────────────┤
│ QuotationHeader.tsx STATUS_LABELS │ 10 statuts (complet sauf   │ MANQUANTS: INTAKE,               │
│ (l.44-55)                         │ DECISIONS_*, ACK_*, etc.)  │ DECISIONS_COMPLETE,              │
│                                   │                            │ ACK_READY_FOR_PRICING,           │
│                                   │                            │ QUOTED_VERSIONED                 │
│                                   │                            │ (fallback exists: raw string)    │
├───────────────────────────────────┼────────────────────────────┼──────────────────────────────────┤
│ CaseCard.tsx STATUS_CONFIG        │ 11 statuts including       │ MANQUANTS: INTAKE,               │
│ (l.14-27)                         │ QUOTED_VERSIONED           │ DECISIONS_COMPLETE,              │
│                                   │                            │ ACK_READY_FOR_PRICING            │
│                                   │                            │ Decent coverage, fallback exists │
├───────────────────────────────────┼────────────────────────────┼──────────────────────────────────┤
│ BlockingGapsPanel STATUS_LABELS   │ 10 statuts (original set)  │ MANQUANTS: INTAKE,               │
│ (l.31-42)                         │                            │ DECISIONS_COMPLETE,              │
│                                   │                            │ ACK_READY_FOR_PRICING,           │
│                                   │                            │ QUOTED_VERSIONED                 │
├───────────────────────────────────┼────────────────────────────┼──────────────────────────────────┤
│ useQuoteCaseData ACTIVE_STATUSES  │ NEW_THREAD, RFQ_DETECTED,  │ MANQUANTS: INTAKE,               │
│ (l.139-142)                       │ FACTS_PARTIAL, NEED_INFO,  │ DECISIONS_COMPLETE,              │
│                                   │ READY_TO_PRICE,            │ ACK_READY_FOR_PRICING,           │
│                                   │ PRICING_RUNNING,           │ QUOTED_VERSIONED                 │
│                                   │ PRICED_DRAFT, HUMAN_REVIEW │                                  │
│ useQuoteCaseData ARCHIVED_STATUSES│ SENT, ARCHIVED             │ OK for now                       │
└───────────────────────────────────┴────────────────────────────┴──────────────────────────────────┘
```

### E. DECISIONS_PENDING — verdict explicite

**DECISIONS_PENDING n'est pas confirmé écrit et doit être traité comme trou de workflow / statut mort provisoire.**

Preuve : `grep` exhaustif dans `supabase/functions/` — aucune occurrence de `.update({ status: 'DECISIONS_PENDING' })` ni équivalent. La seule référence est `commit-decision/index.ts` l.75 dans `ALLOWED_STATUSES` (lecture/guard, pas écriture). Le workflow actuel saute directement de `READY_TO_PRICE` → `DECISIONS_COMPLETE` (via `commit-decision` quand 5/5 décisions sont commitées).

### F. Proposal boundary

**Corrigeable maintenant (UI alignment, zero métier):**
- Supprimer labels morts dans CaseView (PRICED, LOST, ACCEPTED)
- Ajouter les statuts réels manquants dans tous les mappings UI
- Aligner `ACTIVE_STATUSES` dans `useQuoteCaseData`
- Créer `docs/STATUS_REGISTRY.md`

**Nécessite mini-phase métier dédiée (hors scope S2):**
- Ajouter ACCEPTED/REJECTED à l'enum DB
- Résoudre le trou DECISIONS_PENDING (qui devrait le SET ?)
- Modéliser la fin commerciale après SENT
- Traiter le statut ARCHIVED (action manuelle ? automatique ?)

---

## S2.2 — STATUS_REGISTRY.md

Nouveau fichier `docs/STATUS_REGISTRY.md`, subordonné à MASTER_CONTEXT. Contenu:

1. Les 15 statuts de l'enum avec classification (active/waiting/frozen/terminal/ghost/dormant)
2. Les 13 transitions réellement observées dans le code avec fonction propriétaire
3. Statuts exclus du contrat canonique courant: ACCEPTED, REJECTED, LOST, PRICED
4. Open questions: DECISIONS_PENDING jamais alimenté, fin commerciale après SENT, ARCHIVED jamais écrit

Plus une ligne de référence dans `docs/MASTER_CONTEXT.md`.

---

## S2.3 — Patchs minimum

### Patch A — CaseView.tsx (l.145-154)

Remplacer `STATUS_LABELS` par un mapping complet des 15 statuts réels. Supprimer PRICED, LOST, ACCEPTED (labels morts). Le fallback existant (l.1336 `|| caseData.status`) est conservé.

### Patch B — QuotationHeader.tsx (l.44-55)

Ajouter les 5 statuts réels manquants: INTAKE, DECISIONS_COMPLETE, ACK_READY_FOR_PRICING, QUOTED_VERSIONED, DECISIONS_PENDING (ghost mais en DB). Le fallback existant est déjà bon.

### Patch C — useQuoteCaseData.ts (l.139-145)

Ajouter à `ACTIVE_STATUSES`: INTAKE, DECISIONS_COMPLETE, ACK_READY_FOR_PRICING, QUOTED_VERSIONED, DECISIONS_PENDING.
`ARCHIVED_STATUSES` reste `['SENT', 'ARCHIVED']` — pas de ACCEPTED/REJECTED car absents de l'enum DB.

### Patch D — BlockingGapsPanel.tsx (l.31-42)

Ajouter les 5 statuts manquants au mapping (INTAKE, DECISIONS_COMPLETE, ACK_READY_FOR_PRICING, QUOTED_VERSIONED, DECISIONS_PENDING).

### Patch E — CaseCard.tsx (l.14-27)

Ajouter les 3 statuts réels manquants: INTAKE, DECISIONS_COMPLETE, ACK_READY_FOR_PRICING. QUOTED_VERSIONED est déjà présent.

---

## Fichiers modifiés

1. `docs/STATUS_REGISTRY.md` — nouveau (subordonné à MASTER_CONTEXT)
2. `docs/MASTER_CONTEXT.md` — 1 ligne de référence
3. `src/pages/CaseView.tsx` — STATUS_LABELS (l.145-154)
4. `src/features/quotation/components/QuotationHeader.tsx` — STATUS_LABELS (l.44-55)
5. `src/hooks/useQuoteCaseData.ts` — ACTIVE_STATUSES (l.139-142)
6. `src/components/puzzle/BlockingGapsPanel.tsx` — STATUS_LABELS (l.31-42)
7. `src/components/dashboard/CaseCard.tsx` — STATUS_CONFIG (l.14-27)

## Confirmations explicites

- Aucun module FROZEN touché
- Aucune migration DB
- Aucun changement métier
- Aucun nouveau statut inventé
- ACCEPTED/REJECTED NON ajoutés à l'enum DB
- DECISIONS_PENDING classé comme ghost/trou de workflow
- Toutes les modifications sont cosmétiques (labels/classification)

## Risques

- Nul : purement des mappings UI label → display
- Les fallbacks existants protègent déjà contre les statuts non mappés

## Tests minimum

- Ouvrir un dossier dans chaque statut réel et vérifier que le label s'affiche correctement
- Vérifier que les thread usage tags classifient correctement les statuts ajoutés à ACTIVE_STATUSES

