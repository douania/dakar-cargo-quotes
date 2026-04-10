
# SOURCE-GUARD-1 — Empêcher la contamination des facts par les emails sortants SODATRA

## Statut : DONE (2026-04-10)

### Diagnostic

`threadContext` (L1844) était construit à partir de **tous les emails** du thread sans filtrage par expéditeur.
`extractFactsWithAI` recevait donc le contenu des emails sortants SODATRA, permettant à l'AI d'extraire des montants de devis (ex: 4187 USD) comme `cargo.freight_cost`.

### Correctifs appliqués

1. **Helper `isSodatraEmail`** (L10-15)
   - Détection par domaine (`sodatra.sn`, `sodatra.com`)
   - Même logique que le frontend (`useThreadEmails.ts`)

2. **Contexte filtré `inboundThreadContext`** (L1856-1864)
   - Emails dont `from_address` n'est PAS un domaine SODATRA
   - Passé à `extractFactsWithAI` à la place de `threadContext`
   - `threadContext` complet conservé pour détection de type et multi-quote

3. **Prompt Rule 9: SOURCE PROVENANCE** (L4089-4098)
   - Instruction explicite à l'AI de ne jamais extraire `cargo.freight_cost` / `cargo.freight_currency` depuis des emails sortants SODATRA
   - Double protection : filtrage contexte EN AMONT + instruction AI EN AVAL

4. **Log d'audit** (L1858-1860)
   - `[SOURCE-GUARD]` log avec nombre d'emails filtrés

### Fichiers impactés

| Fichier | Changement |
|---------|-----------|
| `supabase/functions/build-case-puzzle/index.ts` | Helper + filtrage + prompt rule 9 (~30 lignes) |
| `.lovable/plan.md` | Documentation |
| `docs/DEFERRED_BACKLOG.md` | Dette SOURCE-GUARD-1-DEBT |

### Ce que ce lot ne fait PAS

- Pas de migration
- Pas de modification du schéma `quote_facts`
- Pas de purge automatique des facts contaminés existants
- Pas de modification du chemin doc-regex (risque secondaire)

---


## Statut : DONE (2026-04-10)

### Correctifs appliqués

1. **isMaritime hoisted** (`supabase/functions/run-pricing/index.ts`)
   - `isMaritime` remonté avant le bloc PAD alias pour réutilisation dans la condition gap

2. **Gap bloquant `pricing.pad_category`** (`supabase/functions/run-pricing/index.ts`)
   - Condition : `isMaritime && cargoDescription && cargoWeight > 0 && !padCategory`
   - Idempotent : check `existingGap` avant insert
   - `question_fr` contient la question client pré-rédigée + description reçue + fourchette tarifs
   - `is_blocking = true`

3. **Ligne placeholder PAD TO_CONFIRM** (`supabase/functions/run-pricing/index.ts`)
   - `amount = 0`, `source.type = 'TO_CONFIRM'`, `confidence = 0`
   - Garde-fou anti-duplication : check `hasExistingPadPlaceholder` avant push
   - Non interprétée comme tarif confirmé dans les agrégats

### Adaptation schéma

- `quote_gaps` n'a **pas** de colonnes `context` ni `suggested_question`
- La question client + contexte sont combinés dans `question_fr` (seul champ texte disponible)

### Dette reportée

- Tarif max PAD comme fallback conservateur → voir `docs/DEFERRED_BACKLOG.md` (PAD-GAP-1-DEBT)

---

# ACTION-SYNC-1 — Synchroniser le bloc Actions avec les gaps réellement ouverts

## Statut : DONE (2026-04-10)

### Diagnostic

Le bloc "Actions" dans CaseView lisait `case_timeline_events` (event_type `manual_action`) et filtrait uniquement par `event_data.status === "open"`, sans vérifier si les gaps référencés dans `requested_gap_keys` étaient encore ouverts dans `quote_gaps`.

Résultat : une action pour `routing.destination_port` restait affichée alors que ce gap était déjà `resolved`.

### Correctif

**Fichier** : `src/pages/CaseView.tsx` — `openActions` useMemo

- Ajout d'un cross-reference avec le tableau `gaps` (qui ne contient que les gaps `status = 'open'`)
- Si une action timeline référence des `requested_gap_keys`, elle n'est affichée que si **au moins un** de ces gap keys est encore ouvert
- Si aucun gap key n'est référencé, l'action reste visible (comportement conservateur)
- Pas de blacklist codée en dur sur un gap spécifique

### Fichiers impactés

| Fichier | Changement |
|---------|-----------|
| `src/pages/CaseView.tsx` | `openActions` memo croisé avec gaps ouverts (~20 lignes) |
| `.lovable/plan.md` | Documentation |

### Ce que ce lot ne fait PAS

- Pas de migration
- Pas de modification backend
- Pas de création d'action timeline pour `pricing.pad_category`
- Pas de refactor global

---

# SOURCE-GUARD-2 — Séparer proprement facts client, facts partenaires et facts internes

## Statut : DONE (2026-04-10)

### Diagnostic confirmé

1. **SOURCE-GUARD-1** filtre le contexte AI (emails SODATRA exclus)
2. **Filière partenaire** déjà séparée (`external_quote_response_facts`) — aucun risque direct
3. **Risques résiduels** : (a) hallucination AI malgré Rule 9, (b) doc-regex sur documents internes

### Correctifs appliqués

1. **`classifyEmailProvenance`** (L16-35)
   - Classification : `internal_sodatra` | `partner` | `client` | `unknown`
   - Basé sur domain matching avec `client_email`/`partner_email` du thread

2. **`SENSITIVE_MONETARY_FACTS`** (L38-43)
   - Set protégé : `cargo.freight_cost`, `cargo.freight_currency`, `cargo.value`, `cargo.value_currency`

3. **Post-extraction guard** (~L1990-2020)
   - Filtre `extractedFacts` → `guardedFacts` avant promotion vers `quote_facts`
   - Règle stricte : facts monétaires sensibles autorisés **uniquement** si provenance = `client`
   - `unknown` → bloqué (pas traité comme client)
   - `sourceEmailId` absent → bloqué prudemment
   - Logs `[SOURCE-GUARD-2] BLOCKED {key} (provenance={prov})`

4. **Doc-regex guard** (~L2685)
   - Documents de type `quotation_draft`, `quotation_sent`, `internal_note`, `devis`, `proforma_sent` exclus du scan cargo value
   - Log `[SOURCE-GUARD-2] Skipping doc-regex on internal document`

5. **Thread metadata enrichi** (L1822)
   - Query `email_threads` étendue avec `client_email, partner_email`

### Fichiers impactés

| Fichier | Changement |
|---------|-----------|
| `supabase/functions/build-case-puzzle/index.ts` | `classifyEmailProvenance` + post-extraction guard + doc-regex guard (~70 lignes) |
| `.lovable/plan.md` | Documentation SOURCE-GUARD-2 |
| `docs/DEFERRED_BACKLOG.md` | SOURCE-GUARD-1-DEBT → SOURCE-GUARD-DEBT (consolidé) |

### Ce que ce lot ne fait PAS

- Pas de migration DB
- Pas de nouveau composant UI
- Pas de modification de `run-pricing` ni `analyze-partner-response`
- Pas de reroutage des partner facts vers `quote_facts`
- Pas de suppression massive d'anciens facts
