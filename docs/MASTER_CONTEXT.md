# MASTER CONTEXT — DAKAR CARGO QUOTES
Version: 1.9
Phase: EQ1.2 + CL1 + PAD + PAD-1 + PAD-ADMIN-UI + Magasinage DT + COCKPIT-5-P1 + SOURCE-GUARD + ORCH-SYNC-2 + PRICING-AUDIT-1 + CARRIER-PORT-TAX-1B-A + CLIENT-GAP-POLICY-FIX + P1-A + P1-B + P1-C + P2-A + P2-B + P2-C + P2-D
Latest patch: P2-D Lot 1 — modèle dérivé de scope courant (qualifyScope helper + useServiceScope hook + gates de promotion sur PartnerSuggestionPanel/PartnerScopeCard/PricingLaunchPanel + migration PricingCommWarnings sur useCockpitState)
Date: 2026-04-11

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
- **Audit F1 métier** : plan validé (2026-04-05), outils prêts (`run_p0_audit.mjs`, `audit_case_dossier.mjs`), bloqué par l'arrivée des devis SODATRA réels. Champs d'annotation ajoutés : `reference_doc_type`, `exception_metier`, `exception_reason`

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

### COM-2A — Suggestions de réponse partenaire (2026-04-07)

Edge function : auto-match-partner-responses (actions: scan, confirm, reject)  
Table : partner_response_suggestions (séparée du pipeline EQ1)  
Hook : usePartnerSuggestions  
Pattern : identique à terminal_designation_suggestions — suggestions isolées, validation opérateur obligatoire  
Scoring : duplication contrôlée de suggestPartnerResponse.ts (~50 lignes, dette acceptée)  
Doctrine : assistant structurant — scan déclenché manuellement, confirm/reject par opérateur, aucune action auto  
Confirm : appelle d'abord analyze-partner-response avec le bearer token utilisateur ; en cas de succès seulement, passe la suggestion à accepted et journalise l'action  
Reject : passe la suggestion à rejected, empêche re-proposition  
Timeline : event_type manual_action avec action_code PARTNER_SUGGESTION_CONFIRMED / PARTNER_SUGGESTION_REJECTED  
Idempotence : UNIQUE (request_id, suggested_email_id) + garde pending-only sur confirm/reject

### COCKPIT-2 — Garde-fous communication avant envoi devis (2026-04-08)

Composants : `useSendQuotation.ts`, `SendQuotationPanel.tsx`
Pattern : avertissements informatifs, pas blocage dur (`canSend` inchangé — opérateur souverain)
Vérifications pré-envoi :
- Demandes partenaires non clôturées (`external_quote_requests` tout sauf `closed`)
- Faits partenaires en attente de validation (`external_quote_response_facts` en `proposed`)
- Clarifications client non résolues (`client_gap_requests` en `drafted`, `sent` ou `answered`)
Affichage : section alertes ambrées dans le panneau + rappel dans le dialog de confirmation finale
Doctrine : cockpit de communication assistée — l'opérateur est informé mais peut décider d'envoyer un devis partiel volontairement

### COCKPIT-3 — Résumé communication dossier (2026-04-08)

Composant : `src/components/case/CommunicationSummaryCard.tsx` (autonome, ~130 lignes)
Placement : CaseView, juste avant ExternalRequestsPanel, même gating (`caseId` présent)
Rôle : synthèse dossier-level de l'état communication
Requêtes : 3 queries parallèles réutilisant les filtres COCKPIT-2 :
- Demandes partenaires ouvertes (`external_quote_requests` tout sauf `closed`)
- Faits partenaires à valider (`external_quote_response_facts` en `proposed`)
- Clarifications client ouvertes (`client_gap_requests` en `drafted`, `sent`, `answered`)
UI :
- Badge vert « Communication complète » si tout est à 0
- Badge amber « X point(s) en attente » sinon
- Mini-liste limitée aux demandes partenaires ouvertes (max 3 affichées)
staleTime : 30s
Doctrine : lecture seule, aucun effet métier, aucun blocage opérateur, aucun impact sur le pipeline EQ1

### COCKPIT-4B — Plan d'actions orienté communication réelle (2026-04-08)

Composant : `src/components/case/CaseActionPlan.tsx` (autonome, ~336 lignes)
Placement : CaseView, avant CommunicationSummaryCard, même gating (`caseId` présent)
Rôle : checklist ordonnée de 12 étapes orientées orchestration communication réelle
Étapes : Analyser demande → Résoudre gaps → Préparer demandes partenaires → Confirmer envoi demandes → Traiter réponses partenaires → Envoyer clarifications client → Analyser réponses client → Pricing → Version → PDF → Préparer email client → Marquer envoi client
Dynamisme : étapes partenaires masquées si totalPartnerRequests === 0, étapes client masquées si totalClientGaps === 0
Étape 4 : "Confirmer l'envoi des demandes" — done seulement si `email_sent_at` renseigné, note discrète pré-COM-1A sinon
Queries : 3 comptages supplémentaires (draftPartnerRequests, unsentPartnerRequests, draftedClientGaps) + queries existantes
staleTime : 30s
Doctrine : lecture seule, aucune mutation, aucun blocage opérateur, assistant structurant

### S1 — Clarification sémantique du statut partenaire (2026-04-08)

Problème résolu : `status = "sent"` dans `external_quote_requests` signifiait "brouillon email créé" alors qu'aucun envoi SMTP réel n'avait lieu. Le timer `stale_followup` (24h) se déclenchait depuis la date de marquage, pas d'envoi réel.

Solution (Option B — preuve d'envoi séparée) :
- Ajout de `email_sent_at TIMESTAMPTZ NULL` sur `external_quote_requests` — preuve d'envoi réel (NULL = brouillon seulement, rempli par COM-1A après transmission SMTP)
- Ajout de `email_draft_id UUID NULL` avec FK vers `email_drafts` — traçabilité du brouillon source
- `send-external-quote-request` stocke `email_draft_id` et laisse `email_sent_at = NULL`
- `getNextAction.ts` : timer stale basé sur `email_sent_at ?? sent_at` (fallback gracieux)
- UI : badge "Envoyée (brouillon)" vs "Envoyée (confirmée)" selon `email_sent_at`
- Toast corrigé : "Brouillon email créé pour le partenaire"
- `status = "sent"` = "demandé/préparé côté opérateur, sans preuve d'envoi réel"
- Aucun changement d'enum DB, rétro-compatible, prépare COM-1A

### P0-C — Confirmation traçable d'envoi partenaire (2026-04-10)

Problème résolu : l'opérateur voyait "À confirmer" dans le cockpit mais ne pouvait pas confirmer — aucune action opératoire pour renseigner `email_sent_at`.

Solution (Option A — pas de nouvel enum) :
- Nouvelle edge function `confirm-external-request-sent` (`requireUser`)
- Préconditions vérifiées : `status === "sent"`, `email_draft_id` présent, `email_sent_at` NULL
- Idempotence : si `email_sent_at` déjà renseigné → retour `{ ok: true, idempotent: true }`
- Mutation : `UPDATE email_sent_at = now()` sur `external_quote_requests`
- Timeline : `manual_action` avec `action_code = "PARTNER_REQUEST_SEND_CONFIRMED"` et `dedupe_key`
- UI : bouton "Confirmer l'envoi" dans `ExternalRequestsPanel`, conditionné à `status=sent && !email_sent_at`
- Le bouton disparaît dès que `email_sent_at` est renseigné — toutes les surfaces cockpit reflètent l'état confirmé
- Invalidation large : `external-*`, `ready-actions-panel`, `next-action-banner`, `case-action-plan`, `partner-requests-*`, `communication-summary`, `partner-collection-readiness`, `pricing-readiness`
- Compatible COM-1A futur : quand l'envoi SMTP réel sera implémenté, `email_sent_at` sera renseigné automatiquement et le bouton manuel deviendra inutile

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

### Phase PAD-ADMIN-UI + enrichissement T14 (2026-04-04)

- **UI Admin** : onglet "Alias PAD" dans `CommodityCategories.tsx` — KPI (total/en attente/validés), recherche texte, filtre statut, création (anti-doublon + normalisation), validation, suppression (AlertDialog)
- **Enrichissement T14** : 6 alias prudents ajoutés (fil machine, wire rod, feuillard, steel strip, fer blanc, tinplate) — catégorie T14 (Fil machine, bobines, feuillard, fer blanc) désormais couverte
- **Total alias PAD** : 57 (51 seed + 6 T14)
- **Couverture** : toutes les catégories PAD actuellement présentes dans `commodity_categories` sont couvertes par au moins un alias
- **Catégories absentes** : T06, T08, T10, T11 restent hors périmètre référentiel applicatif actuel — audit différé en attente d'observation des non-matchs réels (voir `docs/DEFERRED_BACKLOG.md`)

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

## Lots récents (2026-04-09 → 2026-04-10)

| Lot | Date | Résumé |
|-----|------|--------|
| SOURCE-GUARD-1 | 2026-04-10 | Filtrage emails domaines SODATRA hors contexte extraction IA dans build-case-puzzle |
| SOURCE-GUARD-2 | 2026-04-10 | Classification provenance emails + blocage facts monétaires sensibles (internal/partner/unknown) + skip doc-regex documents internes |
| FLOW-FIX-1 | 2026-04-09 | Normalisation pays ISO + inférence port Sénégal dans build-case-puzzle |
| PAD-GAP-1 | 2026-04-09 | pricing.pad_category comme gap structurel pricing détecté par build-case-puzzle |
| PAD-GAP-SYNC-1 | 2026-04-09 | Synchronisation gaps → actions client via sync-gap-client-actions |
| ORCH-ACTION-1 | 2026-04-09 | ReadyActionsPanel comme couche opératoire principale dans CaseView |
| ORCH-SYNC-2 | 2026-04-10 | Alignement bloc Actions CaseView + guard hasBlockingGaps sur actions internes ReadyActionsPanel |
| PRICING-AUDIT-1 | 2026-04-10 | Distinction À confirmer / Estimé / Informatif dans PricingResultPanel + résumé fiabilité |
| CARRIER-PORT-TAX-1B-A | 2026-04-10 | Injection carrier charges IMPORT (carrier connu) — suppression guard isTransit sur quotation-engine (exception STRUCTURAL_PATCH_ALLOWED) |
| CLIENT-GAP-POLICY-FIX | 2026-04-10 | pricing.pad_category ajouté à CLIENT_RESOLVABLE_GAP_KEYS + GAP_QUESTION_MAP dans client-gap-policy.ts |

Détails d'exécution : voir `.lovable/plan.md`.
Dettes et sujets reportés : voir `docs/DEFERRED_BACKLOG.md`.

---

## SOURCE-GUARD — Protection provenance facts (2026-04-10)

Edge function : `build-case-puzzle` (FROZEN — exception SOURCE-GUARD)

### Problème métier

Risque de « contamination des faits » : un prix proposé par SODATRA dans un email sortant peut être ré-extrait comme un coût de fret entrant, faussant le pricing.

### Mécanisme

1. **SG-1 — Filtrage contexte extraction IA** : les emails des domaines internes (`@sodatra.sn`, `@sodatra.com`) sont exclus du contexte fourni à l'IA pour l'extraction de facts
2. **SG-2 — Classification provenance + garde monétaire** :
   - Chaque email est classifié par `classifyEmailProvenance()` (client / internal / partner / unknown) via domain matching
   - Les facts monétaires sensibles (`cargo.value`, `cargo.freight_cost`, etc.) sont bloqués si la provenance n'est pas `client`
   - Seule la provenance `client` démontrée autorise l'extraction de facts monétaires
3. **SG-2 doc-regex** : les documents internes (devis, brouillons SODATRA) sont ignorés lors de l'extraction par regex

### Limitations connues

- Le domain matching est heuristique et ne couvre pas les cas multi-domaines (clients utilisant Gmail/Outlook)
- Pas de champ `sender_role` persisté sur la table `emails` — voir `SOURCE-GUARD-DEBT` dans `docs/DEFERRED_BACKLOG.md`

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

---

## Exception contrôlée — Export Sénégal gap profile (2026-04-07)

Edge function : build-case-puzzle (gap analysis + prompt extraction)
Justification : STRUCTURAL_PATCH_ALLOWED

### Problème métier

Un dossier export maritime (origin = Dakar, destination = Nhava Sheva / Mundra, India) génère un faux gap bloquant « Quelle est la destination finale des marchandises ? » alors que le port de déchargement est explicitement mentionné dans l'email client. Cause : la logique de gaps utilise `detectedType` (import-centré) au lieu du `flowType` réel (`EXPORT_SENEGAL`), et aucun profil export n'existe dans `MANDATORY_FACTS`.

### Périmètre du patch

8 modifications locales dans `build-case-puzzle/index.ts` + documentation :

1. **MANDATORY_FACTS** — ajout profil `EXPORT_SENEGAL` (destination_port, cargo.description, cargo.containers, contacts.client_email)
2. **EXPORT_SENEGAL_BLOCKING_GAPS** — set dédié (destination_port, cargo.description)
3. **gapProfileType** — variable locale créée après `assumptionResult`, utilisée uniquement dans la gap analysis (L3125, L3432+)
4. **PORT_COUNTRY_MAP** — ajout MUNDRA, CHENNAI, KOLKATA, CHITTAGONG, COLOMBO
5. **KNOWN_COUNTRIES** — ajout pays commerciaux hors Afrique Ouest (India, China, Turkey, Brazil, USA, Bangladesh, Sri Lanka, Thailand)
6. **Prompt AI extraction** — ajout `routing.origin_country`, `routing.destination_country` + règle 8 (COUNTRY EXTRACTION)
7. **GAP_QUESTIONS** — `routing.destination_port` reformulé (« Quel est le port de déchargement ? »)

### Ce qui n'est PAS modifié

- L1789 (`mandatoryFactsForType`) — inchangé
- `detectedType` — inchangé
- `request_type` en DB — inchangé (enum import-only, limitation connue)
- `run-pricing`, `set-case-fact`, UI — aucun impact
- Logique import existante — aucune modification

### Limitation connue

Le badge `request_type` du dossier restera un type import (ex: `SEA_FCL_IMPORT`) car l'enum DB `quote_request_type` ne contient pas `EXPORT_SENEGAL`. Cette limitation est documentée dans `docs/DEFERRED_BACKLOG.md` sous `EXPORT-DB-ENUM`.

### Impact indirect (faible mais non nul)

- Meilleure redirection pays → `destination_country` via KNOWN_COUNTRIES élargi
- Meilleure résolution pays depuis certains ports (MUNDRA etc.)
- Wording plus neutre pour `destination_port`

### Risques

- **Scope gapProfileType** : créé après `assumptionResult`, accessible dans la gap analysis — vérifié
- **KNOWN_COUNTRIES élargi** : peut rediriger certains textes auparavant stockés en `destination_city` vers `destination_country` — souhaitable
- **Branchement export** : strictement conditionné à `flowType === EXPORT_SENEGAL` — aucune interférence import

### Contraintes

- Non-bloquant : erreurs export loguées, jamais fatales
- Idempotent : le branchement export n'intervient que si `flowType === EXPORT_SENEGAL`
- Traçable : commentaires `STRUCTURAL_PATCH_ALLOWED` dans le code

### Statut

- Exception validée pour Export Sénégal gap profile uniquement
- `build-case-puzzle` reste FROZEN par défaut
- Toute modification future nécessite une nouvelle justification explicite

---

## Exception contrôlée — CARRIER-PORT-TAX-1B-A sur quotation-engine (2026-04-10)

Edge function : `quotation-engine/index.ts` (FROZEN)
Justification : STRUCTURAL_PATCH_ALLOWED

### Problème métier

Le moteur `quotation-engine` chargeait les carrier charges pour toutes les opérations via `fetchCarrierCharges()`, mais ne les injectait que pour les dossiers TRANSIT (`if (isTransit && carrierCharges.length > 0)`). Les charges carrier IMPORT (TXI, HTF, etc.) étaient donc ignorées même quand le carrier était connu et les données chargées.

### Patch autorisé

Suppression de la condition `isTransit &&` sur l'injection carrier charges (~L1457). Le bloc d'injection existant (PER_BL, PER_CNT, PER_TEU) est déjà générique et fonctionne pour tous les types d'opération.

### Garde naturelle

Quand `carrier` est absent, `fetchCarrierCharges` ne retourne que les templates `GENERIC` (aucun pour import), donc `carrierCharges.length === 0` → le bloc n'est pas exécuté. Aucun faux positif.

### Justification de l'exception

1. **Corrige un manque réel** — charges carrier IMPORT systématiquement absentes du pricing
2. **Périmètre strictement localisé** — 1 condition supprimée, bloc existant inchangé
3. **Aucun refactor global** — suppression d'un guard restrictif uniquement
4. **Préservation de l'intégrité** — aucune modification des données ou du calcul
5. **Idempotence préservée** — le bloc d'injection est déjà idempotent
6. **Garde naturelle** — carrier absent → carrierCharges vide → bloc non exécuté

### Option B reportée

La stratégie "carrier inconnu → provisionnement prudent sur plus haute valeur fixe connue" est documentée dans `docs/DEFERRED_BACKLOG.md` (ID: `CARRIER-PORT-TAX-1B`) comme décision produit à arbitrer séparément.

### Statut

- Exception validée pour CARRIER-PORT-TAX-1B-A uniquement
- `quotation-engine` reste FROZEN par défaut
- Toute modification future nécessite une nouvelle justification explicite

---

## Exception contrôlée — HS-NORMALIZATION Phase A sur quotation-engine et run-pricing

### Contexte

Anomalie confirmée par audit DB (2026-04-07) : sur le dossier multi-lot 76c9819c, les lots 1-2 portent un `cargo.hs_code = "08013100"` (8 digits) dans `extracted_facts_json`, qui écrase le global 10 digits `0801310000` via `mergeFactsForLot()`. Le moteur `quotation-engine` ne normalise pas à 10 digits avant lookup, causant un échec de résolution incohérent entre lots.

### Problème métier réel

Le Système Harmonisé (SH) n'est fiable qu'à 6 chiffres mondialement. Au-delà, chaque pays applique ses propres subdivisions. Un code 8 digits provenant d'un lot-level override dégrade la résolution HS sans apporter de précision locale.

### Patch autorisé

**Fichier 1 — `run-pricing/index.ts`** (zone sensible/pricing) :
Garde dans `mergeFactsForLot()` : si un lot apporte un `cargo.hs_code` < 10 digits et que le global a un 10 digits avec le même SH6, le global est préservé.

**Fichier 2 — `quotation-engine/index.ts`** (FROZEN) :
Résolution SH6 "candidat unique seulement" : exact match prioritaire, puis fallback SH6 uniquement si un seul candidat 10 digits existe dans `hs_codes`. Si plusieurs candidats ou aucun, comportement inchangé (non-résolu).

### Justification de l'exception

1. **Corrige un manque réel du modèle métier** — résolution HS incohérente entre lots d'un même dossier
2. **Périmètre strictement localisé** — ~15 lignes dans chaque fichier, aucun impact sur le pipeline existant
3. **Aucun refactor global** — insertion chirurgicale dans les blocs existants
4. **Préservation de l'intégrité des données** — aucune modification des données, seulement de la logique de lecture
5. **Préservation de l'idempotence** — la garde ne s'active que si SH6 identique + global plus précis
6. **Aucune sur-correction** — pas de padEnd aveugle, pas de premier-match arbitraire

### Contraintes d'implémentation

- **Non-bloquant** : si le fallback SH6 ne trouve pas de candidat unique, le comportement existant est préservé
- **Pas de sur-interprétation** : un code client étranger n'est jamais traité comme vérité locale
- **Traçable** : commentaires `STRUCTURAL_PATCH_ALLOWED` dans le code

### Statut

- Exception validée pour HS-NORMALIZATION Phase A uniquement
- `quotation-engine` reste FROZEN par défaut
- `run-pricing` reste zone sensible par défaut
- Phase B (architecture multi-couche HS) documentée dans DEFERRED_BACKLOG.md comme `HS-MULTI-LAYER-ARCHITECTURE`
- Toute modification future nécessite une nouvelle justification explicite

---

## Contrat canonique timeline — case_timeline_events (P1-C)

### output_generated

Clé discriminante : `event_data.kind` (string).

| `kind` | Producteur | Notes |
|---|---|---|
| `reply_analysis_v1` | `analyze-reply-event` | Contient `analysis`, `model_meta`, `dedupe_key` |
| `reply_draft_v1` | `generate-reply-draft` | Contient `draft_reply`, `dedupe_key` |
| `quotation_email_draft_v1` | `create-quotation-email-draft` | ⚠ Pas de `dedupe_key` — watchlist TIMELINE-DEDUPE-1 |

Règle : tout nouveau producteur de `output_generated` **doit** écrire `event_data.kind` et `event_data.dedupe_key`.

Clé historique `output_type` : **abandonnée**. N'a jamais été écrite par aucun producteur actif. Le seul lecteur vestigial a été supprimé en P1-C.

### manual_action

Clé discriminante : `event_data.action_code` (string).

Clés obligatoires : `action_code`, `dedupe_key`, `status` (open | done).

| `action_code` | Producteur |
|---|---|
| `APPLY_FACT_PROPOSALS` | `analyze-reply-event` |
| `PREPARE_CLIENT_REPLY_DRAFT` | `analyze-reply-event` |
| `LAUNCH_PRICING` | `analyze-reply-event` |
| `REQUEST_CLIENT_INFO_FOR_GAPS` | `sync-gap-client-actions` |
| `PARTNER_REQUEST_CLOSED` | `close-external-quote-request` |
| `PARTNER_REQUEST_SENT` | `send-external-quote-request` |
| `PARTNER_FACT_VALIDATED` | `validate-partner-fact` |
| `PARTNER_ALL_FACTS_VALIDATED` | `validate-partner-fact` |
| `AUTO_MATCH_RESPONSE` | `auto-match-partner-responses` |
| `PARTNER_RESPONSE_ANALYZED` | `auto-match-partner-responses` |
| `REVIEW_PARTNER_FACTS` | `analyze-partner-response` |

Règle : tout nouveau producteur de `manual_action` **doit** écrire `action_code` + `dedupe_key` + `status`.

### Compatibilité historique

Les données historiques en base utilisent déjà `kind` / `action_code`. Aucune migration de données nécessaire.

---

## P2-D — Modèle dérivé de scope courant (2026-04-11)

### Principe

Helper pur `qualifyScope()` (`src/lib/scopeQualification.ts`) qui centralise l'interprétation du périmètre contractuel à partir du signal `service_scope_v1` et des facts structurés. 3 catégories strictes : `confirmed`, `unconfirmed`, `out_of_scope`. Pas de catégorie `optional`.

Hook léger `useServiceScope()` (`src/hooks/useServiceScope.ts`) qui lit le dernier `service_scope_v1` une seule fois (remplace 2-3 queries dupliquées).

### Lot 1 — Composants réalignés

| Composant | Action | Règles de surface |
|---|---|---|
| `PartnerSuggestionPanel` | Consomme `useServiceScope` + `qualifyScope` + gate de statut | `confirmed` → CTA actif. `unconfirmed` → visible, badge "provisoire", pas de CTA. `out_of_scope` → opacity-60, badge "hors scope", pas de CTA. Post-pricing + 0 requests → masqué. |
| `PartnerScopeCard` | Consomme `useServiceScope` + `qualifyScope` | `confirmed` → normal. `unconfirmed` → badge "non confirmé". `out_of_scope` → opacity-60, badge "hors périmètre". |
| `PricingLaunchPanel` | Consomme `useServiceScope` + `qualifyScope` | Si `hasCriticalUnconfirmed` → "Des services restent non confirmés". Sinon → texte actuel. Informatif, pas bloquant. |
| `PricingCommWarnings` | Migré sur `useCockpitState` | 3 queries HEAD redondantes supprimées, même rendu. |

### Lot 2 — Différé (validation lot 1 requise)

`NextActionBanner`, `ReadyActionsPanel` — dégrader la priorité "Lancer le pricing" si scope non confirmé.

### Blast radius lot 1

- 2 nouveaux fichiers (helper + hook)
- 4 fichiers runtime modifiés
- -5 queries réseau (2 scope dupliquées + 3 HEAD PricingCommWarnings)
- 0 migration DB, 0 edge function, 0 modification useCockpitState
