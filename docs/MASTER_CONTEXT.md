# MASTER CONTEXT — DAKAR CARGO QUOTES
Version: 1.3
Phase: EQ1.2 + CL1 + PAD + Magasinage DT
Latest patch: Phase 3-B.2-A — IA suggestions magasinage Dakar Terminal
Date: 2026-04

---

## État général

- Pricing engine stabilisé
- Parsing IA robuste (extractAndParseJSON)
- Blockers Policy v1 active
- Timeline CHECK constraint corrigée (29 valeurs)
- Silent failures corrigés
- Module EQ1 (External Quote Requests) stabilisé et hardened
- Module CL1 (Conversation Layer) opérationnel
- Phase 3 PAD (droit de passage) validée et gelée
- Référentiel marchandises (commodity_categories + commodity_designation_matches) opérationnel
- Sous-système magasinage Dakar Terminal opérationnel dans son périmètre actuel (P1 provisionnel, alias validés, suggestions IA assistées)
- Backlog différé centralisé : docs/DEFERRED_BACKLOG.md (source de vérité des sujets reportés)

---

## Décisions fondamentales

- Pas d'auto-send — le système produit des brouillons (email_drafts), l'opérateur envoie manuellement. Aucune intégration SMTP.
- Pas d'auto-update facts
- Pas d'agent autonome
- Assistant structurant uniquement
- Idempotence = case_id + event_type + related_email_id
- event_data (JSONB) pour timeline
- verify_jwt=false + requireUser (pattern Lovable Cloud)
- Security contract opérationnel: docs/SECURITY_CONTRACT.md (subordonné à ce document)
- Status registry opérationnel: docs/STATUS_REGISTRY.md (subordonné à ce document)
- Backlog différé : docs/DEFERRED_BACKLOG.md — tout sujet volontairement reporté, dormant ou accepté comme dette doit y être inscrit immédiatement
- Phase S3: DECISIONS_PENDING restauré comme état canonique
- Phase P4: build-case-puzzle introduit une détection d'ambiguïté
- Phase EQ1: Module External Quote Requests — workflow latéral pour demandes partenaires. Injection dans quote_facts via supersede_fact RPC uniquement. Validation humaine obligatoire.
- Phase EQ1.2: Hardening P0 — email thread/sender guard (normalizeEmail strict equality), fail-fast on facts insert, exact-match replay guard, critical error hierarchy.
- Phase CL1: Conversation Layer minimal — suivi drafted→sent→answered→validated par gap_key. Insert-if-not-exists (pas d'upsert). Matching sent-first avec fallback drafted. Promotion answered→validated dans set-case-fact (exception STRUCTURAL_PATCH_ALLOWED).

---

## Module C2

Edge function : analyze-thread-event  
Stockage : event_type = thread_intent_v1  
Parsing : extractAndParseJSON (maxLogChars=500)  
Insert via serviceClient  
SELECT via userClient  

---

## Module EQ1

Edge functions : analyze-partner-response, validate-partner-fact  
Tables : external_quote_requests, external_quote_responses, external_quote_response_facts  
Hook : useExternalRequests  
UI : ExternalRequestsPanel  
Injection : via supersede_fact RPC (pas de write direct dans quote_facts)  
Validation : humaine obligatoire, pas d'auto-merge  
Idempotence : UNIQUE (request_id, source_email_id) + facts-existence guard + exact-match replay guard  

---

## Module CL1

Edge functions : generate-reply-draft (enrichi), analyze-reply-event (enrichi), set-case-fact (enrichi), mark-client-gap-request-sent (nouveau)  
Table : client_gap_requests  
Cycle : drafted → sent → answered → validated (+ cancelled)  
Unicité : UNIQUE partiel (case_id, gap_key) WHERE status IN ('drafted','sent','answered')  
Matching : sent-first, fallback drafted  
Injection : via set-case-fact uniquement (promotion answered → validated)  
UI : ClarificationPanel (bouton "Marquer comme envoyé"), CaseView (section statuts)  
Contrainte : non-bloquant — erreurs CL1 loguées, jamais fatales  

---

## Module P1 Auto-EQ

Edge function : build-case-puzzle (post-processing block)
Déclencheur : gap bloquant `cargo.freight_cost` détecté
Action : création automatique d'une `external_quote_requests` en statut `draft`
Cibles : par lot (`quote_request_lines`) ou case-level (`related_lot_index = null`)
Idempotence : applicative (SELECT before INSERT) — pas de contrainte DB UNIQUE dédiée
Traçabilité : timeline event `external_request_created` avec `actor_type = 'system'`
Non-bloquant : erreurs loguées (`console.warn`), jamais fatales

---

## Phase 3 PAD — Droit de passage (clôturée + alias PAD-1)

- **Statut** : Phase 3 validée et gelée (2026-04-02), Phase PAD-1 alias livrée (2026-04-04)
- **Périmètre Phase 3** : ajout d'une ligne `PAD_DROIT_PASSAGE` dans le pricing lorsque des facts dossier PAD ont été explicitement appliqués au dossier (`cargo.pad_category`, `cargo.pad_rate_fcfa_per_ton`)
- **Périmètre PAD-1** : lookup alias automatique dans `pad_designation_aliases` avant consommation passive des facts. Si alias validé trouvé → résolution automatique `pad_category` + `pad_rate_fcfa_per_ton` depuis `port_tariffs`.
- **Traçabilité** : enrichissement post-moteur, `origin_layer = enrichment_pad`, approche `fact_based`. Source marquée « Fact dossier PAD (barème Redevances Portuaires 2006) »
- **Smoke tests Phase 3** :
  - T01 (`ab959454`) : PASS — PAD 19 239 × 3.086 t = 59 372 FCFA
  - T12 (`29b96eec`) : PASS — PAD 4 780 × 840 t = 4 015 200 FCFA
  - Régression (`2fa7861d`, AIR_IMPORT) : PASS — 0 ligne PAD
  - T07 (`6d4d996f`) : bloqué par FCL-OVR (hors scope PAD, voir `docs/DEFERRED_BACKLOG.md`)
- **Conclusion** : chemin positif validé, régression validée hors maritime, aucune régression démontrée sur les dossiers sans facts PAD

### Phase PAD-1 — Alias runtime (2026-04-04)

- **Table** : `pad_designation_aliases` (bl_term, normalized_term, commodity_category_id, pad_category, is_validated, source_type)
- **Source de vérité métier** : `commodity_category_id` (FK vers `commodity_categories`). `pad_category` est une copie dénormalisée pour la performance runtime.
- **Seed** : 51 correspondances validées importées depuis `commodity_designation_matches` (0 collision auditée)
- **Lookup runtime** : `run-pricing` effectue un lookup alias PAD avant le bloc PAD existant :
  1. Si facts opérateur déjà présents (`cargo.pad_category`) → pas d'override (opérateur prime)
  2. Sinon, si `cargoDescription` présent → normaliser → lookup `pad_designation_aliases` (is_validated=true, exact match)
  3. Si alias trouvé → lookup `port_tariffs` (provider=PAD, category=DROIT_PASSAGE, operation_type=IMPORT, classification=pad_category, is_active=true)
  4. Si tarif trouvé → injecter `padCategory` + `padRateFcfaPerTon` dans inputs
- **Gestion collisions** : si plusieurs alias pointent vers des catégories différentes → warning + skip (comportement déterministe garanti)
- **Guards** : alias validés uniquement, exact match normalisé uniquement, 0 ILIKE, 0 fuzzy, 0 IA
- **Séparation magasinage** : tables distinctes (`pad_designation_aliases` ≠ `terminal_designation_aliases`), aucun mélange
- **Limite connue** : périmètre actuel borné au mono-lot / facts dossier globaux ; pas d'extension multi-lot dans cette phase

---

## Sous-système Magasinage Dakar Terminal (Phases 3-A → 3-B.2-A)

- **Statut** : opérationnel dans son périmètre actuel (P1 provisionnel, alias validés, suggestions IA assistées)
- **Périmètre strict** : Dakar Terminal uniquement, magasinage uniquement, pas de DPW, pas de handling

### Tables

| Table | Rôle |
|-------|------|
| `terminal_designations` | Référentiel des ~956 désignations terminales (label, unit_basis, storage_code_p1/p2/p3, terminal_handling_code) |
| `terminal_tariff_codes` | Référentiel des ~34 codes tarifaires (code, montant, currency, tariff_type, period) |
| `terminal_designation_aliases` | Alias BL → désignation terminale, validés par opérateur, consommés par le moteur |
| `terminal_designation_suggestions` | Suggestions IA (pending/accepted/rejected), validation opérateur obligatoire |

### Logique runtime — cascade 3 couches (run-pricing)

1. **Couche 1 — Alias validé** : lookup sur `normalizeForMatch(cargoDescription)` dans `terminal_designation_aliases` (`is_validated = true`)
2. **Couche 2 — Match direct** : lookup normalisé sur `terminal_designations.designation_label`
3. **Couche 3 — Fallback IA** (Gemini 2.5 Flash) : déclenché uniquement si couches 1 et 2 échouent. Suggestions stockées dans `terminal_designation_suggestions`. **Les suggestions IA ne produisent aucune ligne pricing ni aucun calcul.** Elles sont stockées pour revue opérateur uniquement.

### Calcul provisionnel

- Ligne `TERMINAL_STORAGE_PROVISION_ESTIMATE` = P1 rate × poids (tonnes) × 3 jours
- `confidence = 0.5`, `origin_layer = enrichment_terminal_storage`
- Produit uniquement si couche 1 ou 2 résout un match

### Guards

- Maritime uniquement (`operation_type` maritime)
- Mono-lot uniquement
- `cargoDescription` présent et non vide
- `cargoWeight > 0`
- Match couche 1 ou couche 2 requis pour produire une ligne pricing

### Anti-duplication IA

- Avant appel IA : vérification qu'aucune suggestion `pending` n'existe pour le même `normalized_source_text`
- Si doublon détecté : skip, log explicite, pas de nouvel appel

### Capitalisation contrôlée

- « Accepter + créer alias » depuis l'onglet Suggestions IA
- Anti-doublon vérifié avant insertion (`normalized_term` + `terminal_designation_id`)
- `source_type = 'ai_suggestion_validated'`, `alias_created = true`, `created_alias_id` rempli
- L'alias devient consommable par le moteur au run suivant

### UI Admin (`/admin/terminal-storage`)

- **Onglet Désignations** : lecture seule, statuts visuels, filtres, KPI couverture
- **Onglet Alias BL** : création / validation / suppression, tri opératoire (en attente d'abord)
- **Onglet Suggestions IA** : accepter / rejeter / accepter + créer alias, KPI, filtres statut

### Phases livrées

- Phase 3-A : match direct + provision P1 dans run-pricing
- Phase 3-B.1-A : alias runtime (table + consommation moteur)
- Phase 3-B.1-B : UI admin alias (onglet dédié)
- Phase 3-B.2-A : IA suggestions (fallback, stockage, UI revue, capitalisation)

### Phases différées

- P2/P3 dans le moteur, jours réels après franchise, multi-cargo IA, synonymes avancés, matching DPW → voir `docs/DEFERRED_BACKLOG.md`

---

## Cockpit canonique (M6.1 + M6.2)

- **CaseView** (`/case/:caseId`) = cockpit canonique opérateur pour le workflow complet de cotation (gaps → décisions → pricing → version → PDF → send).
- **QuotationSheet** (`/quotation/:emailId`) = surface secondaire email-first / legacy. Les panels workflow critiques (Decision, Pricing, Version, Send) ne sont plus rendus ici quand un quote_case existe — une carte de redirection oriente vers CaseView. **Depuis le verrouillage pipeline** : quand `quote_case` existe, les actions d'écriture legacy (save draft, generate response, export PDF/Excel, mark as sent) sont désactivées. QuotationSheet reste une surface de consultation et de redirection, pas de production d'artefacts.
- **QuotationSheet** (`/quotation/new`) = point d'entrée manuel encore valide, mais non canonique pour le workflow de dossier une fois un case créé.
- **Dashboard** ne redirige plus silencieusement vers QuotationSheet en cas d'erreur — erreur explicite affichée.
- Aucun panel critique de workflow ne doit être ajouté à QuotationSheet.
- **Doctrine canonique vs legacy** : quand un `quote_case` existe, seul le pipeline canonique (CaseView) peut produire des artefacts de devis (versions, PDF, email drafts). Le pipeline legacy (`quotation_history`, `generate-quotation-pdf`, `create-quotation-draft`) reste déployé pour les cas sans `quote_case` (entrée manuelle `/quotation/new`) et pour l'archivage passif, mais ne doit jamais produire d'artefacts concurrents à un dossier canonique existant.
- **Chemin canonique post-pricing** : `PRICED_DRAFT` → `QUOTED_VERSIONED` → `SENT`. La revue humaine opérateur se fait implicitement lors de la création de version (confirmation dialog). `HUMAN_REVIEW` existe dans l'enum DB et est supporté défensivement par `generate-quotation-version`, mais il n'est pas un sas obligatoire du workflow actuel — il est dormant.
- **Irréversibilité de la création de version** : une fois le dossier passé en `QUOTED_VERSIONED`, le pricing est figé dans le parcours opérateur courant. Il n'existe pas de chemin retour self-service vers un état re-priceable depuis CaseView. C'est un choix produit assumé, cohérent avec le caractère engageant de la création de version (confirmation dialog explicite). Toute évolution future vers un mécanisme de « re-pricing après version » nécessiterait un ticket produit dédié.
- **Pipeline canonique de sortie** : `generate-quotation-version` → `export-quotation-version-pdf` → `create-quotation-email-draft` → `send-quotation`. Ce pipeline est versionné, persistant, idempotent et traçable.
- **Suivi commercial post-envoi** : après `SENT`, l'opérateur peut marquer l'issue commerciale via `close-commercial-outcome` : `SENT → ACCEPTED` ou `SENT → REJECTED`. Ces statuts sont terminaux et irréversibles (pas de transition croisée). Le pipeline de sortie reste inchangé et s'arrête à `send-quotation`.

---

## Auto-pricing sur résolution du dernier gap bloquant

- **Déclencheur** : orchestré par le cockpit `CaseView` (couche UI), pas par le backend. Ni `build-case-puzzle` ni `set-case-fact` ne déclenchent le pricing par eux-mêmes.
- **Séquence exacte** : lorsqu'un opérateur résout un gap bloquant inline, CaseView exécute séquentiellement : `set-case-fact` → `build-case-puzzle` (re-run) → requête fraîche sur `quote_gaps` → si plus aucun gap bloquant ouvert et aucun pricing déjà en cours → appel automatique de `run-pricing`.
- **Pas de confirmation supplémentaire** : l'auto-pricing se lance sans dialogue de confirmation. C'est un choix produit assumé — l'opérateur est averti par un toast explicite.
- **Guards existants** : vérification que le dernier `pricing_runs.status` n'est pas `running` ou `success` ; vérification que le case n'est pas dans un statut terminal (`SENT`, `ARCHIVED`, `PRICING_RUNNING`).
- **Limitation connue** : si un re-run de `build-case-puzzle` crée de nouveaux gaps bloquants (ex. nouvel email reçu entre-temps), le check post-puzzle les détectera et n'auto-lancera pas le pricing. Le risque de race condition est mitigé par l'exécution séquentielle dans le même `await`.

---

## Suggestions dérivées (UI)

- **Portée actuelle** : une seule suggestion — `cargo.weight_per_container_kg` calculé à partir de `cargo.weight_kg / cargo.container_count`.
- **Calcul** : `useMemo` local dans CaseView, basé sur les facts courants. Pas de logique serveur, pas de table dédiée.
- **Application** : via `set-case-fact` (source_type = `manual_input`, confidence = 1.0). La suggestion devient un fait standard une fois appliquée.
- **Rejet** : state local (`dismissedSuggestions`), non persisté. Un refresh de page restaure la suggestion. C'est acceptable tant que le nombre de suggestions reste minimal.
- **Pas de statut métier** : il n'existe pas de concept "suggestion" en base de données. Les suggestions sont purement un confort UI local.
- **Évolution future** : si le nombre de suggestions dérivées augmente (3+), il faudra envisager la persistance du rejet et potentiellement une table dédiée. Hors scope tant qu'il n'y a qu'une suggestion.

---

## Support multi-lot — état et limitations

### Ce qui est en place

- **Détection** : `build-case-puzzle` détecte les demandes multi-lot via `detectMultiQuoteMarkers` + extraction IA. Les lignes sont stockées dans `quote_request_lines` (line_index, extracted_facts_json, request_type_hint).
- **Gap bloquant** : `request.multi_lot_unresolved` bloque le pricing tant que la structure multi-lot n'est pas clarifiée.
- **Pricing orchestration** : `run-pricing` exécute le pricing par lot — fusion de faits spécifiques au lot, résolution service/transport par lot, checks de cohérence par lot, all-or-nothing. Stockage dual : root columns agrégées (`tariff_lines`, `total_ht`) + `outputs_json.lots[]` structuré.
- **UI cockpit** : `MultiRequestLinesPanel` (détection/structure), `PricingResultPanel` (résultats par lot en sections collapsibles), amber badges sur les facts ambigus multi-lot.

### Pipeline de sortie multi-lot (M14b)

- **Multi-lot pricing support** = oui.
- **Multi-lot final deliverable structure** = oui (depuis M14b).
- `generate-quotation-version` enrichit le `VersionSnapshot` avec `is_multi_lot` (boolean) + `lots[]` optionnels, peuplés depuis `pricingRun.outputs_json.lots`. Les snapshots mono-lot existants restent valides sans enrichissement.
- `export-quotation-version-pdf` rend les lots en sections séparées (header par lot, lignes, sous-total) avec pagination réelle multi-page (`ensureSpace`). Fallback legacy : regroupement depuis `raw_lines` si `snapshot.lots` absent mais tags `lot_index`/`lot_label` présents. La troncature silencieuse (ancien `break` sur dépassement) a été supprimée.
- `create-quotation-email-draft` adapte sujet (`(X lots)`) et corps (résumé par lot avec montants HT). Même fallback legacy depuis `raw_lines`.
- **Compatibilité backward** : les snapshots mono-lot restent inchangés (champs optionnels, fallback plat). Les snapshots legacy multi-lot sans `lots[]` peuvent encore être rendus via le fallback `raw_lines`.

### Réserve résiduelle

- Le fallback legacy (regroupement depuis `raw_lines` pour snapshots pré-M14b) est implémenté mais n'a pas pu être validé en runtime faute de cas legacy multi-lot en base. Non bloquant.

---

## Fonctions supprimées (M26b)

Les fonctions suivantes ont été supprimées comme dead code confirmé :
`generate-case-outputs`, `learn-from-contact`, `get-active-exchange-rate`, `calculate-duties`, `suggest-regime`.

**Valeur résiduelle notable** : `generate-case-outputs` contenait une génération IA du corps d'email de cotation (prompt structuré, template fallback). Si des emails plus intelligents deviennent prioritaires, la bonne direction est d'ajouter une option IA à `create-quotation-email-draft`, pas de restaurer la fonction supprimée. Voir backlog A4.

---

## Modules FROZEN

Ne pas modifier :

- quotation-engine
- build-case-puzzle
- set-case-fact
- pricing logic

---

## Philosophie

L'application est un assistant traçable,
pas un décideur automatique.

---

## Exception contrôlée — STRUCTURAL_PATCH_ALLOWED

Par défaut :
- patchs chirurgicaux uniquement
- pas de refactor global
- respect strict des zones FROZEN
- préserver idempotence, traçabilité, intégrité des données

Exception autorisée :
Un patch structurel ciblé peut être accepté, y compris sur une zone sensible/FROZEN, uniquement si toutes les conditions suivantes sont réunies :

1. il corrige ou améliore un manque réel du modèle métier
2. il reste localisé à un périmètre réduit
3. il ne constitue pas un refactor global
4. il préserve le pipeline existant, l'idempotence, la traçabilité et l'intégrité des données
5. il est justifié explicitement avant exécution

---

## Exception contrôlée — CL1 sur set-case-fact

### Contexte

Dans le cadre de la Phase CL1 (Conversation Layer minimal), un besoin métier réel a été identifié :
synchroniser l'état des clarifications client (`client_gap_requests`) avec la validation effective des faits dans le système.

### Problème métier réel

Absence de lien explicite entre :
- validation d'un fait via `set-case-fact` (source de vérité)
- et statut conversationnel du gap correspondant

Conséquences :
- perte de traçabilité métier
- UX incohérente (clarification affichée comme non finalisée alors qu'elle l'est)
- difficulté d'audit du cycle complet de résolution d'un gap

### Patch autorisé

Après un `supersede_fact` réussi dans `set-case-fact` :

1. Rechercher dans `client_gap_requests` :
   `WHERE case_id = case_id AND gap_key = fact_key AND status = 'answered'`

2. Si trouvé :
   `UPDATE status = 'validated', validated_fact_id = factId`

### Justification de l'exception

Ce patch est autorisé au titre de STRUCTURAL_PATCH_ALLOWED car :

1. **Corrige un manque réel du modèle métier** — absence de synchronisation entre validation des faits et suivi conversationnel
2. **Périmètre strictement localisé** — uniquement dans set-case-fact, aucun impact sur build-case-puzzle, quotation-engine, run-pricing
3. **Aucun refactor global** — ajout d'un bloc post-traitement uniquement, aucune modification de la logique existante de supersede_fact
4. **Préservation de l'intégrité des données** — aucune modification des faits eux-mêmes, aucune altération des règles de supersession
5. **Préservation de l'idempotence** — condition stricte `status = 'answered'`, aucune double promotion possible
6. **Préservation de la traçabilité** — lien explicite via `validated_fact_id`, cycle complet traçable : `drafted → sent → answered → validated`

### Contraintes d'implémentation

- **Non-bloquant** : toute erreur dans client_gap_requests est loguée uniquement, ne doit jamais faire échouer set-case-fact
- **Lecture explicite des erreurs Supabase** : vérifier `{ data, error }` sur SELECT et UPDATE
- **Aucun effet de bord** : ne pas modifier la logique de validation existante

### Statut

- Exception validée pour CL1 uniquement
- `set-case-fact` reste FROZEN par défaut
- Toute modification future nécessite une nouvelle justification explicite

---

## Exception contrôlée — P1 Auto-EQ sur build-case-puzzle

### Contexte

Dans le cadre du module P1 Auto-EQ, un besoin métier réel a été identifié :
créer automatiquement des demandes partenaires lorsqu'un gap bloquant `cargo.freight_cost` est détecté par `build-case-puzzle`.

### Problème métier réel

Absence de lien entre :
- détection d'un gap bloquant fret dans le puzzle
- et création d'une demande partenaire pour obtenir le tarif

Conséquences :
- opérateur doit créer manuellement sans contexte pré-rempli
- risque d'oubli sur les dossiers multi-lot
- pricing bloqué sans action visible

### Patch autorisé

Bloc post-processing non bloquant dans `build-case-puzzle`, après le calcul des gaps et avant la réponse finale :

1. Vérifier les gaps bloquants `cargo.freight_cost`
2. Construire les cibles (par lot ou case-level)
3. Garde d'idempotence applicative (SELECT before INSERT)
4. Insérer `external_quote_requests` en `draft` + timeline event

### Justification

1. **Corrige un manque réel** — aucune orchestration gap → action partenaire
2. **Périmètre localisé** — bloc post-processing uniquement, aucune modification de la logique existante
3. **Aucun refactor global** — ajout pur, pas de changement structurel
4. **Préservation de l'intégrité** — aucune injection dans quote_facts, statut draft uniquement
5. **Idempotence applicative** — SELECT before INSERT, pas de contrainte DB UNIQUE dédiée
6. **Traçabilité** — timeline event `external_request_created` avec `actor_type = 'system'`

### Limitation documentée

L'idempotence est applicative seulement (pas de contrainte UNIQUE en base).
En cas de re-runs concurrents, un doublon théorique est possible mais mitigé par l'orchestration séquentielle existante des jobs puzzle.

En multi-lot mixte (un lot avec gap fret, un autre sans), P1 peut créer des demandes pour tous les lots.
Le filtrage lot-level nécessiterait une extension du schéma quote_gaps (hors scope P1).

### Contraintes d'implémentation

- **Non-bloquant** : try/catch global, erreurs loguées via console.warn
- **Pas d'auto-send** : statut `draft`, opérateur doit compléter et envoyer
- **Pas d'auto-inject** : aucune écriture dans quote_facts
- **partner_name = 'À définir'** : empêche tout envoi accidentel

### Statut

- Exception validée pour P1 uniquement
- `build-case-puzzle` reste FROZEN par défaut
- Toute modification future nécessite une nouvelle justification explicite
