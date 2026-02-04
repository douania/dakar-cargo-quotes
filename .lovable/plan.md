

# PLAN D'ARCHITECTURE PHASE 9.0 — RÉVISÉ (v2)

## CORRECTIONS CTO APPLIQUÉES

| Erreur identifiée | Correction appliquée |
|-------------------|----------------------|
| Écriture dans `quote_facts` | ❌ INTERDITE — Phase 9 n'écrit JAMAIS dans `quote_facts` |
| `suggest-decisions` écrit en DB | ❌ CORRIGÉ — Retourne JSON uniquement, aucune persistance |
| `confidence` numérique | ✅ Remplacé par `confidence_level ENUM` |
| Transition auto vers pricing | ✅ Ajout clic explicite `ACK_READY_FOR_PRICING` |

---

## 1. ARCHITECTURE RÉVISÉE — Principe "Zero DB sans action humaine"

### 1.1 Flux corrigé

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 9 — DECISION SUPPORT                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ ÉTAPE 1 — GÉNÉRATION (STATELESS)                                   │    │
│  │                                                                     │    │
│  │  [suggest-decisions] → JSON en mémoire                             │    │
│  │                                                                     │    │
│  │  ❌ Aucune écriture DB                                             │    │
│  │  ❌ Aucun snapshot persisté                                        │    │
│  │  ✅ Retourne DecisionProposal[]                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼ (JSON affiché dans UI)                 │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ ÉTAPE 2 — AFFICHAGE (READ-ONLY)                                    │    │
│  │                                                                     │    │
│  │  [DecisionSupportPanel] affiche les options                        │    │
│  │                                                                     │    │
│  │  ❌ Aucune écriture DB                                             │    │
│  │  ✅ État local React uniquement                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼ (Opérateur clique "Valider")           │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ ÉTAPE 3 — VALIDATION HUMAINE (SEUL MOMENT D'ÉCRITURE)              │    │
│  │                                                                     │    │
│  │  [commit-decision] écrit :                                         │    │
│  │    1. decision_proposals (snapshot IA immuable)                    │    │
│  │    2. operator_decisions (choix humain)                            │    │
│  │    3. case_timeline_events (audit)                                 │    │
│  │                                                                     │    │
│  │  ❌ N'écrit JAMAIS dans quote_facts                                │    │
│  │  ✅ Écriture atomique au clic humain                               │    │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼ (Toutes décisions validées)            │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ ÉTAPE 4 — GATE EXPLICITE VERS PHASE 10                             │    │
│  │                                                                     │    │
│  │  Bouton: "✅ Confirmer et passer au pricing"                       │    │
│  │                                                                     │    │
│  │  → Crée événement ACK_READY_FOR_PRICING                            │    │
│  │  → Statut passe à READY_TO_PRICE                                   │    │
│  │  → Phase 10 peut commencer                                         │    │
│  │                                                                     │    │
│  │  ❌ JAMAIS automatique                                             │    │
│  │  ✅ Clic humain obligatoire                                        │    │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. MODÈLE DE DONNÉES RÉVISÉ

### 2.1 Table `decision_proposals` (snapshot IA immuable)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ decision_proposals                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ id                UUID PRIMARY KEY                                      │
│ case_id           UUID → quote_cases.id                                 │
│ proposal_batch_id UUID (groupe toutes options d'une génération)         │
│ decision_type     ENUM (regime, routing, services, incoterm, container) │
│ options_json      JSONB (tableau des options proposées par l'IA)        │
│ generated_at      TIMESTAMP NOT NULL                                    │
│ generated_by      TEXT = 'ai' (toujours)                                │
│ committed_at      TIMESTAMP (NULL jusqu'au choix humain)                │
│ committed_by      UUID → auth.users.id (NULL jusqu'au choix)            │
└─────────────────────────────────────────────────────────────────────────┘

CONTRAINTE:
- committed_at et committed_by sont NULL jusqu'au clic humain
- Insertion UNIQUEMENT via commit-decision (pas suggest-decisions)
```

### 2.2 Structure `options_json` (JSONB)

```json
{
  "options": [
    {
      "key": "transit_t1",
      "label_fr": "Transit T1 vers Mali",
      "label_en": "T1 Transit to Mali",
      "justification_fr": "Marchandise en transit vers Bamako...",
      "justification_en": "Goods in transit to Bamako...",
      "pros": ["Droits suspendus", "Procédure simplifiée"],
      "cons": ["Délai douane Mali", "Caution requise"],
      "confidence_level": "high",
      "is_recommended": true
    },
    {
      "key": "mise_conso",
      "label_fr": "Mise à la consommation Sénégal",
      "confidence_level": "medium",
      "is_recommended": false
    }
  ],
  "source_fact_ids": ["uuid1", "uuid2"],
  "generation_model": "gemini-2.5-flash",
  "generation_timestamp": "2025-02-04T10:30:00Z"
}
```

### 2.3 Table `operator_decisions` (choix humain tracé)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ operator_decisions                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ id                UUID PRIMARY KEY                                      │
│ case_id           UUID → quote_cases.id                                 │
│ proposal_id       UUID → decision_proposals.id                          │
│ decision_type     ENUM                                                  │
│ selected_key      TEXT (clé de l'option choisie)                        │
│ override_value    TEXT (NULL sauf si "Autre choix")                     │
│ override_reason   TEXT (obligatoire si override_value NOT NULL)         │
│ decided_at        TIMESTAMP NOT NULL DEFAULT now()                      │
│ decided_by        UUID → auth.users.id NOT NULL                         │
│ is_final          BOOLEAN DEFAULT false                                 │
│ superseded_by     UUID → operator_decisions.id                          │
└─────────────────────────────────────────────────────────────────────────┘

CONTRAINTE CHECK:
- override_value IS NULL OR override_reason IS NOT NULL
```

### 2.4 Nouveaux statuts `quote_case_status`

```text
Ajouter au ENUM:
- DECISIONS_PENDING    (options générées, en attente de choix humain)
- DECISIONS_COMPLETE   (tous choix faits, en attente ACK)
- ACK_READY_FOR_PRICING (clic humain explicite confirmant passage Phase 10)
```

---

## 3. EDGE FUNCTIONS RÉVISÉES

### 3.1 `suggest-decisions` — STATELESS

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ supabase/functions/suggest-decisions/index.ts                           │
├─────────────────────────────────────────────────────────────────────────┤
│ ENTRÉE:                                                                 │
│   - case_id: UUID                                                       │
│   - decision_types: string[] (optionnel)                                │
│                                                                         │
│ SORTIE:                                                                 │
│   - proposals: DecisionProposal[] (JSON en mémoire)                     │
│   - missing_info: string[]                                              │
│   - can_proceed: false (TOUJOURS)                                       │
│                                                                         │
│ COMPORTEMENT:                                                           │
│   ✅ Lit quote_facts (SELECT uniquement)                                │
│   ✅ Appelle IA, retourne JSON                                          │
│   ❌ N'ÉCRIT RIEN EN DB                                                 │
│   ❌ Pas de timeline event (rien ne s'est passé côté DB)                │
│                                                                         │
│ GARDE-FOU CTO:                                                          │
│   // ⚠️ CTO RULE: This function is STATELESS                           │
│   // NO supabase.from(...).insert/update/delete ALLOWED                 │
│   // Output is JSON only, consumed by UI                                │
│                                                                         │
│ SÉCURITÉ:                                                               │
│   - verify_jwt = true                                                   │
│   - Ownership check sur case_id                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 `commit-decision` — SEUL POINT D'ÉCRITURE

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ supabase/functions/commit-decision/index.ts                             │
├─────────────────────────────────────────────────────────────────────────┤
│ ENTRÉE:                                                                 │
│   - case_id: UUID                                                       │
│   - decision_type: string                                               │
│   - proposal_json: object (snapshot IA reçu du frontend)                │
│   - selected_key: string                                                │
│   - override_value?: string                                             │
│   - override_reason?: string                                            │
│                                                                         │
│ SORTIE:                                                                 │
│   - decision_id: UUID                                                   │
│   - remaining_decisions: number                                         │
│   - all_complete: boolean                                               │
│                                                                         │
│ COMPORTEMENT:                                                           │
│   1. Vérifie ownership case_id                                          │
│   2. Insère decision_proposals (snapshot IA)                            │
│   3. Insère operator_decisions (choix humain)                           │
│   4. Crée case_timeline_events (audit)                                  │
│   5. Met à jour quote_case.status si toutes décisions faites            │
│                                                                         │
│   ❌ N'écrit JAMAIS dans quote_facts                                    │
│   ❌ Ne passe JAMAIS à READY_TO_PRICE automatiquement                   │
│                                                                         │
│ GARDE-FOU CTO:                                                          │
│   // ⚠️ CTO RULE: NEVER write to quote_facts                           │
│   // Facts are committed ONLY in Phase 10 via explicit commit           │
│                                                                         │
│ VALIDATION:                                                             │
│   - Si override_value → override_reason obligatoire                     │
│   - Si supersedes décision existante → superseded_by renseigné          │
│                                                                         │
│ SÉCURITÉ:                                                               │
│   - verify_jwt = true                                                   │
│   - Ownership check                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3 `ack-ready-for-pricing` — GATE EXPLICITE

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ supabase/functions/ack-ready-for-pricing/index.ts                       │
├─────────────────────────────────────────────────────────────────────────┤
│ ENTRÉE:                                                                 │
│   - case_id: UUID                                                       │
│                                                                         │
│ SORTIE:                                                                 │
│   - success: boolean                                                    │
│   - new_status: 'READY_TO_PRICE'                                        │
│                                                                         │
│ PRÉCONDITIONS VÉRIFIÉES:                                                │
│   ✅ Toutes décisions required ont un operator_decision                 │
│   ✅ Aucun gap bloquant ouvert                                          │
│   ✅ quote_case.status = DECISIONS_COMPLETE                             │
│                                                                         │
│ COMPORTEMENT:                                                           │
│   1. Vérifie ownership                                                  │
│   2. Vérifie préconditions                                              │
│   3. Met à jour quote_case.status → READY_TO_PRICE                      │
│   4. Crée événement ACK_READY_FOR_PRICING                               │
│                                                                         │
│   ❌ N'écrit JAMAIS dans quote_facts                                    │
│   ❌ Ne lance PAS de pricing                                            │
│                                                                         │
│ SÉCURITÉ:                                                               │
│   - verify_jwt = true                                                   │
│   - Ownership check                                                     │
│   - Préconditions atomiques                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. MATRICE AUTORISÉ / INTERDIT (RÉVISÉE)

### 4.1 ✅ AUTORISÉ

| Action | Où | Quand |
|--------|-----|-------|
| SELECT quote_facts, quote_gaps, emails | suggest-decisions | Génération |
| Retourner JSON DecisionProposal[] | suggest-decisions | Génération |
| Afficher options dans UI | DecisionSupportPanel | Affichage |
| INSERT decision_proposals | commit-decision | Clic humain |
| INSERT operator_decisions | commit-decision | Clic humain |
| INSERT case_timeline_events | commit-decision, ack-ready | Clic humain |
| UPDATE quote_case.status → DECISIONS_COMPLETE | commit-decision | Dernière décision |
| UPDATE quote_case.status → READY_TO_PRICE | ack-ready-for-pricing | Clic ACK |

### 4.2 ❌ INTERDIT (ABSOLU)

| Action | Raison |
|--------|--------|
| INSERT/UPDATE quote_facts (Phase 9) | Faits = Phase 10 uniquement |
| Écriture DB dans suggest-decisions | Fonction stateless |
| Transition auto READY_TO_PRICE | Gate humaine obligatoire |
| confidence NUMERIC | Effet tunnel cognitif |
| Afficher 1 seule option | Choix biaisé |
| Pricing Phase 9 | Phase 10+ |

---

## 5. COMPOSANTS UI RÉVISÉS

### 5.1 `DecisionSupportPanel.tsx`

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ RESPONSABILITÉ:                                                         │
│   Afficher les options IA et permettre le choix humain                  │
│                                                                         │
│ ÉTAT LOCAL (React):                                                     │
│   - proposals: DecisionProposal[] (reçu de suggest-decisions)           │
│   - pendingChoices: Map<decision_type, selected_key>                    │
│                                                                         │
│ RÈGLES D'AFFICHAGE:                                                     │
│   ✅ Afficher TOUTES les options (minimum 2)                            │
│   ✅ Badge "Recommandé" discret (pas dominant)                          │
│   ✅ confidence_level affiché comme texte ("Confiance élevée")          │
│   ✅ Pros/Cons visibles pour chaque option                              │
│   ✅ Option "Autre choix" avec champ libre + justification obligatoire  │
│                                                                         │
│ COMPORTEMENT:                                                           │
│   ❌ Aucune écriture DB (lecture seule)                                 │
│   ✅ Stockage local du proposal_json                                    │
│   ✅ Au clic "Valider" → appel commit-decision avec snapshot            │
│   ✅ Confirmation dialog avant validation                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 `ReadyForPricingGate.tsx` (NOUVEAU)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ RESPONSABILITÉ:                                                         │
│   Gate explicite avant Phase 10                                         │
│                                                                         │
│ AFFICHAGE:                                                              │
│   Si status = DECISIONS_COMPLETE:                                       │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ ✅ Toutes les décisions ont été validées                        │   │
│   │                                                                  │   │
│   │ Récapitulatif:                                                   │   │
│   │   • Régime: Transit T1 (choisi par Jean, 14:30)                 │   │
│   │   • Routage: DAP Bamako (choisi par Jean, 14:32)                │   │
│   │   • Services: Full service (choisi par Jean, 14:35)             │   │
│   │                                                                  │   │
│   │            [✅ Confirmer et passer au pricing]                   │   │
│   │                                                                  │   │
│   │ ⚠️ Cette action est irréversible                                │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│ COMPORTEMENT:                                                           │
│   ✅ Bouton désactivé si status ≠ DECISIONS_COMPLETE                   │
│   ✅ Dialog de confirmation avant appel                                 │
│   ✅ Au clic → ack-ready-for-pricing                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. TRAÇABILITÉ RÉVISÉE

### 6.1 Événements timeline Phase 9

| event_type | actor_type | Payload |
|------------|------------|---------|
| `decision_committed` | `human` | decision_type, selected_key, was_override |
| `decision_superseded` | `human` | old_decision_id, new_decision_id, reason |
| `all_decisions_complete` | `system` | decisions_count, types_validated |
| `ack_ready_for_pricing` | `human` | confirmed_by_user_id, timestamp |

### 6.2 Chaîne d'audit complète

```text
Pour chaque décision:

1. decision_proposals.options_json
   → Quelles options l'IA a proposées (snapshot immuable)
   → Avec quel modèle, à quel moment
   
2. operator_decisions
   → Quelle option l'humain a choisie
   → S'il a fait un override, pourquoi
   → Qui, quand
   
3. case_timeline_events
   → Trace horodatée de l'action
   → Lien vers les IDs concernés

4. ack_ready_for_pricing
   → Confirmation explicite du passage Phase 10
   → Impossible sans toutes décisions validées
```

---

## 7. DÉCOUPAGE RÉVISÉ

### Phase 9.0 — Plan d'architecture (ACTUEL)

**Livrable :** Plan révisé validé par CTO
**Critère :** Approbation explicite

---

### Phase 9.1 — Infrastructure DB

**Livrables :**
- Table `decision_proposals` (append-only)
- Table `operator_decisions` avec CHECK constraint
- Nouveaux statuts ENUM
- RLS policies strictes
- Trigger validation override_reason

**Critère :** Tables créées, constraints actives

---

### Phase 9.2 — Edge `suggest-decisions` (STATELESS)

**Livrables :**
- Edge function déployée
- Garde-fou CTO "NO WRITE" documenté
- Tests : aucune trace DB après appel

**Critère :** 
- Appel retourne JSON valide
- SELECT sur decision_proposals après appel = 0 lignes

---

### Phase 9.3 — Edge `commit-decision`

**Livrables :**
- Edge function déployée
- Insertion atomique proposals + decisions
- Timeline event créé
- Tests E2E

**Critère :**
- Décision tracée avec snapshot IA
- Override fonctionne avec raison obligatoire

---

### Phase 9.4 — Edge `ack-ready-for-pricing`

**Livrables :**
- Edge function déployée
- Préconditions vérifiées
- Timeline event ACK créé

**Critère :**
- Statut passe à READY_TO_PRICE uniquement si toutes décisions OK
- Jamais automatique

---

### Phase 9.5 — UI `DecisionSupportPanel`

**Livrables :**
- Composant React
- Affichage neutre des options
- Bouton "Autre choix" avec justification
- Intégration dans QuotationSheet

**Critère :**
- Toutes options visibles (min 2)
- Choix tracé dans DB au clic

---

### Phase 9.6 — UI `ReadyForPricingGate`

**Livrables :**
- Composant gate explicite
- Récapitulatif décisions
- Confirmation avant ACK

**Critère :**
- Impossible de passer Phase 10 sans clic ACK
- Récapitulatif visible avant confirmation

---

### Phase 9.7 — Tests E2E & Documentation

**Livrables :**
- Scénario complet testé
- Documentation utilisateur
- Tests automatisés

**Critère :**
- Flow bout en bout fonctionnel
- Aucune régression Phase 8.8
- CTO valide merge final

---

## 8. RÉPONSES AUX QUESTIONS CTO

| Question | Réponse |
|----------|---------|
| Gate vers pricing automatique ? | ❌ NON — Clic ACK obligatoire |
| Écriture quote_facts Phase 9 ? | ❌ NON — Phase 10 uniquement |
| suggest-decisions écrit en DB ? | ❌ NON — Retourne JSON uniquement |
| confidence numérique ? | ❌ NON — ENUM (low/medium/high) |
| Override sans justification ? | ❌ NON — Toujours obligatoire |
| Affichage 1 seule option ? | ❌ NON — Minimum 2 options |

---

## 9. POINTS À VALIDER PAR LE CTO

### Questions restantes

1. **Nombre d'options minimum** : 2 options minimum par type de décision — suffisant ?

2. **Révision des décisions** : Permettre de modifier une décision après validation (avec superseded_by) ou bloquer définitivement ?

3. **Timeout proposal** : Le snapshot IA doit-il expirer ? (ex: après 24h, regénérer obligatoire)

4. **RLS policies** : Décisions visibles par créateur seul ou par tous les utilisateurs assignés au case ?

---

**Ce plan révisé respecte strictement :**
- ❌ Aucune écriture dans `quote_facts` en Phase 9
- ❌ `suggest-decisions` = stateless, JSON uniquement
- ✅ `confidence_level` ENUM (pas numérique)
- ✅ Gate explicite `ACK_READY_FOR_PRICING` avant Phase 10
- ✅ Override toujours avec justification obligatoire

