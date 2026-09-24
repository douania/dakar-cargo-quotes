# File d'attente CTO — Dakar Cargo Quotes

Convention (mode autopilot) : quand Claude Code, en exécution automatique planifiée, atteint une
stop condition ou termine un lot nécessitant un verdict CTO non encore donné, il consigne une
entrée ici au lieu d'attendre une réponse synchrone, puis passe au lot sûr suivant (ou s'arrête
proprement s'il n'y en a pas). Codex (ou l'utilisateur) traite les entrées `PENDING` en priorité à
l'ouverture de session, puis met à jour le statut : `GO` / `NO-GO` / `INFO_MANQUANTE` / `TRAITÉ`.

Ne jamais committer ce fichier avec autre chose que lui-même (commit docs-only dédié).

---

<!-- Nouvelle entrée : copier le bloc ci-dessous, remplir, ajouter en haut de la liste. -->

## [AAAA-MM-JJ HH:MM UTC] PENDING — <titre court>
**Origine** : autopilot quotidien (planifié) | session interactive
**Type** : demande de GO avant travail | branche/PR prête pour verdict | blocage / divergence Git
**Objectif** :
**Fichiers concernés** :
**Pourquoi une décision CTO est nécessaire** :
**Risques** :
**Recommandation de Claude Code** :
**Référence** (branche / commit local / lien) :

---

## [2026-09-24 17:20 UTC] TRAITÉ (local, non publié) — Lot alertes Lovable 4 et 5 : périmètre PAD v3 fidèle au serveur et danger sur scénarios anciens
**Origine** : GO utilisateur de réalisation locale (24/09) repris par Claude Code en exécutant unique après la session initiale ; contre-revue indépendante lecture seule (sous-agent) en deux passes limitées aux bloquants. Base work/origin/work fb4cdb0.
**Alerte 4 (PAD v3)** : `src/lib/quoteScenarios.ts` (`resolveScenarioPadV3Scope`, `scenarioPadV3Eligibility`, `downgradeScenarioDraftToV2`, `scenarioDraftIsContainerized`, `PAD_V3_MOVEMENTS`) miroir du chemin `servicesOnly` de run-scenario-pricing (maritime, lots conteneurs, incoterm DAP depuis les faits ou une hypothèse liée active, aucun package DDP, sens IMPORT/TRANSIT admis par le serveur) ; `QuoteScenariosPanel.tsx` n'active « Ajouter les choix PAD par groupe (v3) » que si éligible, affiche les motifs, offre « Revenir en v2 » (brouillon seulement, révisions intactes), périmètre non vérifiable tant que faits ou hypothèses chargent ; lecture supplémentaire de deux faits courants (`routing.incoterm`, `service.package`) et de deux colonnes d'hypothèses. Décision de clôture : le bouton v3 reste réservé à IMPORT comme avant le lot ; le serveur accepte aussi TRANSIT (index.ts:362, 386-391 ; test « transit retains the validated grouped path ») mais aucun test ni recette ne couvre le chiffrage PAD v3 en transit → aucune capacité UI nouvelle ouverte, l'alerte v3 n'affirme plus un refus serveur inexistant. Message `SCENARIO_PAD_PRICING_SCOPE_UNSUPPORTED` précisé (import ou transit DAP, pas CIF/CFR/FOB ni DDP).
**Alerte 5 (danger, scénarios v1)** : `run-scenario-pricing/domain.ts` (non FROZEN) `classifyScenarioDanger` NONE / NOT_DANGEROUS / DANGEROUS / UNKNOWN / CONTRADICTORY depuis `cargo.dangerous_goods`, `cargo.un_number`, `cargo.imo_class`, `pricing.dthc_family` et lots ; un « non » explicite non contredit ne bloque plus ; dangereux, inconnu ou contradictoire reste bloquant : `SCENARIO_DG_FACTS_UNSCOPED` (conteneurs), nouveau `SCENARIO_DG_NON_CONTAINER_UNSUPPORTED` (colis, vrac, conventionnel), `SCENARIO_DG_FACTS_UNSCOPED_AIR` ; messages frontend correspondants et `SCENARIO_CONTAINER_TYPE_REQUIRED:<lot>` lisible. Aucun FROZEN, aucune migration, aucun contrat d'écriture modifié.
**Diff local** : 9 fichiers modifiés + `run-scenario-pricing/domain_test.ts` créé (66 lignes), ≈ +388/−13 hors docs. Un fichier `.claude/` non suivi (outillage de session) laissé en place.
**Contrôles** : typecheck PASS ; Vitest 550/551 (seul échec baseline `LocalTransportEstimateFields`), 92 tests ciblés PASS ; eslint 0 sur les fichiers touchés ; `lint:baseline` 732/16 OK ; build PASS ; `typecheck:deno` 49/5 OK. **Réserve Deno levée** : avec Deno 2.9.5 (version canonique CI, binaire npm `deno@2.9.5` en espace temporaire), sanitiseurs conservés : 3 fichiers du lot 92/92 ; suite complète 1686 PASS / 1 FAIL (`set_intake_facts_batch.test.ts:191`, identique à fb4cdb0 : 1674 / 1), aucun échec nouveau ni disparu. Les 92 « Leaks detected » observés d'abord venaient d'un Deno 2.2.7 non canonique. **RLS vérifiées** (migrations + catalogue Cloud en lecture seule) : `quote_facts` SELECT pour `authenticated` (policy `quote_facts_select_team`, GRANT présent) ; `quote_scenario_assumptions` SELECT pour `authenticated` (policy `quote_scenario_assumptions_select`, GRANT SELECT seul). Observation hors lot : `anon` conserve des GRANT larges sur `quote_facts` sans policy applicable.
**Contre-revue** : passe 1 PARTIAL (bloquant : alerte v3 affirmant un refus serveur en TRANSIT ; remarque : `scopeReady` ignorait le chargement des hypothèses) ; correctifs appliqués ; passe 2 GO, aucun bloquant. Non vérifié : chiffrage PAD v3 de bout en bout en transit (non ouvert par l'UI).
**Reste** : publication (commit code + docs séparés, push) sous GO distinct ; alerte 3 : diagnostic ci-dessous. Clôture documentaire IMO (§3.26 et entrées du 23-24/09) préservée telle quelle.

---

## [2026-09-24 17:45 UTC] PENDING — Alerte Lovable 3 : devis multi-lots conteneurs bloqués (mode terminal par lot) — diagnostic, arbitrage requis
**Origine** : session interactive (Claude Code), diagnostic lecture seule par sous-agent puis vérification directe des constats structurants ; note technique Codex hors dépôt comme point de départ. Base work fb4cdb0. Aucune implémentation.
**Type** : demande d'arbitrage avant tout travail (tous les chemins de correction touchent au moins un module FROZEN).
**Constat vérifié** : (1) `run-pricing/index.ts` `resolveTerminalBlockersForLot` (l. 827-844) ne lit `routing.terminal_operation_mode` que dans `extracted_facts_json` du lot, appelé avec les seuls faits du lot (l. 1784-1787), doctrine explicite « le mode global n'est pas propagé » et test `terminal-operation-guard_test.ts:227` qui l'impose ; le fait dossier n'est jamais consulté en multi-lot. (2) Aucun lot ne peut porter ce mode en production : `build-case-puzzle` filtre les clés hors `MULTI_QUOTE_ALLOWED_KEYS` (l. 2129-2135, clé absente), seul écrivain via la RPC `replace_quote_request_lines` (SECURITY DEFINER, service_role seul, DELETE puis INSERT à chaque build) ; `authenticated` n'a que SELECT sur `quote_request_lines` ; `set-case-fact` n'écrit qu'au niveau dossier ; `manage-pad-group-confirmation` refuse `request_count > 1`. La branche « lot avec mode valide franchit le garde » est donc inatteignable par l'UI (nuance de Codex exacte en théorie, inopérante en pratique). (3) Même avec un mode par lot, `resolvePadBlockersForLot` (l. 800-810) renvoie `PAD_MULTI_LOT_UNSUPPORTED` dès que le périmètre contient PORT_DAKAR_HANDLING, présent dans tous les packages avec DTHC (`service-scope.ts`) : le blocage multi-lot est double. (4) Piège UI : le gap terminal de build-case-puzzle ne lit que les faits dossier ; un mode dossier valide ferme le gap alors que run-pricing continue de bloquer. `MULTI_LOT_AMBIGUOUS_FACTS` ne produit qu'un badge, sans blocage de saisie. Les scénarios ne contournent rien (`SCENARIO_MULTI_LOT_UNSUPPORTED`).
**Options** : (a) repli de lecture du fait dossier dans run-pricing : FROZEN, contredit la doctrine écrite et le test 227, ne lève pas le blocage PAD → déconseillé. (b) écriture explicite par lot : nouvelle RPC ou registre versionné sur le modèle PAD (migration + Edge Function `requireUser` + `has_case_write_access` + composant UI par ligne, identité de lot par hash de contexte car `id`/`line_index` changent à chaque build), et lecture par run-pricing (FROZEN, exception structurelle) ; l'écriture directe dans `extracted_facts_json` serait effacée au build suivant. (c) UI seule : impossible, aucune fonction appelable par l'UI n'écrit par lot.
**Recommandation de Claude Code** : lot « MULTI-LOT-TERMINAL-1 » en deux sous-lots sous GO distincts : S1 registre de confirmations par lot (table + RPC + Edge Function + UI, sans FROZEN) avec hash de contexte ; S2 exception structurelle bornée sur run-pricing (lecture du registre dans `resolveTerminalBlockersForLot`, test 227 réécrit) et arbitrage simultané de `PAD_MULTI_LOT_UNSUPPORTED`, sans quoi S1 ne débloque aucun devis. Jamais de propagation automatique du mode global. Pas de correctif du piège UI (4) sans ce lot. Aucun dossier client examiné en Cloud dans ce diagnostic.
**Risques** : double blocage (terminal + PAD) → un lot terminal seul est inutile ; identité des lots instable ; deux modules FROZEN concernés (run-pricing, build-case-puzzle) selon l'option.
**Référence** : diagnostic détaillé (lecteurs, écrivains, tests existants, tableau FROZEN) dans la présente session ; fichiers de test existants `terminal-operation-guard_test.ts`, `terminal-operation-mode_test.ts`, `terminal-operation-gap_test.ts`.

---

## [2026-09-24 11:30 UTC] PENDING — Défaut UI : un dossier sans fait ni document ne peut pas être réanalysé
**Origine** : recette IMO-EVENT-TYPE-1 (24/09), constat sur le sandbox 8a06251d-7027-4d3a-b336-d6f2ae3530cf avant sa relance hors UI.
**Type** : défaut produit découvert, hors lot (UI CaseView / tableau de bord), non corrigé.
**Constat vérifié** : dans `src/pages/CaseView.tsx`, le bouton d'analyse est désactivé quand `documentsCount === 0` et aucun fait, et son bloc n'est affiché que pour INTAKE/FACTS_PARTIAL/NEED_INFO/READY_TO_PRICE/DECISIONS_*/ACK_READY_FOR_PRICING ; « Rafraîchir » ne fait que recharger. Le tableau de bord ne liste plus un e-mail dont le fil a un dossier actif. Un dossier resté en RFQ_DETECTED à 0 fait (cas des analyses interrompues par l'ancienne contrainte IMO) n'a donc aucune relance par l'UI. Aucun dossier client dans cet état constaté au 24/09.
**Pourquoi une décision CTO est nécessaire** : correctif UI (exposer « Relancer l'analyse » pour ces dossiers) ou procédure opérateur documentée ; hors GO actuels.
**Risques** : dossier bloqué sans action possible pour l'opérateur ; contournement actuel = appel authentifié hors UI.
**Recommandation de Claude Code** : petit lot UI sous GO dédié, avec test du cas RFQ_DETECTED sans fait.
**Référence** : work fb4cdb0, roadmap §3.26.

---

## [2026-09-24 10:10 UTC] TRAITÉ — Recette IMO sandbox (alertes 1/2 et IMO-EVENT-TYPE-1) close
**Origine** : GO de publication IMO-EVENT-TYPE-1 et recettes sandbox (24/09).
**Résolution** : les 4 cas sont prouvés sur les fonctions déployées (détail ci-dessous et roadmap §3.26). Le défaut de relance UI est consigné séparément (entrée PENDING ci-dessus). Sandbox et preuve IMO conservés.
**Constat initial** : cas 3 non relançable par l'UI ; extension Claude in Chrome instable pour les cas 1/2/4 ; exclusion PAD_DROIT_PASSAGE jamais écrite (devenue inutile).
**Référence** : work 56d1975 (migration), ledger 207.
**Suite (24/09, voie Codex allow_provisional)** : run-pricing appelé avec la session utilisateur de l'aperçu (jeton jamais exposé), payload {case_id, allow_provisional:true}, sans préparation PAD. Cas 4 : HTTP 400 « IMO goods scope requires clarification », pricing_blockers CONTAINER_ALLOCATION_REQUIRED + SOURCE_REVIEW_REQUIRED + GOODS_PRICING_SCOPE_UNSUPPORTED → PASS. Cas 1 et 2 : HTTP 400 « Blocking gaps still open » (1 et 2 gaps), sans plan IMO → préflight IMO franchi, PASS. Aucune écriture (compteurs, updated_at et événements inchangés, 0 run). Cas 3 : appel build-case-puzzle direct refusé par le mode automatique de Claude Code → toujours BLOCKED (0 événement IMO).
**Cas 3 (24/09, autorisation explicite de l'utilisateur)** : build-case-puzzle start → job 6ed3af7b-f410-4d7a-aec9-8741c420b537, poll → completed sans erreur. Persisté : 1 événement imo_goods_recognition (REVIEW, NO_DIRECT_BINDING + UN_WITHOUT_PROVEN_GROUP, empreinte présente) ; analyse poursuivie (RFQ_DETECTED → NEED_INFO, 1 fait courant, gaps cargo.description, routing.destination_city*, routing.transport_mode*) ; gap cargo.imo_goods_scope_confirmation bloquant toujours ouvert. Aucune écriture hors sandbox, 0 run. Rollback de la migration désormais refusé par construction (preuve IMO existante) → arbitrage si un retour arrière est envisagé. Les 4 cas sont clos.

---

## [2026-09-23 17:10 UTC] TRAITÉ — Défaut préexistant : la preuve IMO n'est jamais persistée (contrainte event_type) et l'analyse du dossier s'interrompt
**Résolution (24/09)** : GO de publication ; commit 56d1975 (migration, rollback, test) ; appliquée via Lovable query_database avec enregistrement ledger 206→207 dans la même transaction ; catalogue exact 41 valeurs, validée, 9 contraintes et RLS/4 politiques inchangées, MD5 ledger = fichier (7e4b09f0…). Preuve runtime le 24/09 : premier événement imo_goods_recognition persisté sur le sandbox 8a06251d…, analyse poursuivie, gap IMO conservé. Rollback désormais refusé par construction (preuve existante) : tout retour arrière exige un arbitrage.
**Origine** : recette sandbox du lot IMO alertes 1/2 (Claude Code, session interactive).
**Type** : blocage / défaut runtime découvert, hors périmètre (DB/migration).
**Constat vérifié** : `case_timeline_events_event_type_check` n'autorise pas `imo_goods_recognition`. Sur le dossier sandbox 8a06251d-7027-4d3a-b336-d6f2ae3530cf (mention UN3480), build-case-puzzle a écrit le gap bloquant `cargo.imo_goods_scope_confirmation` (NO_DIRECT_BINDING, UN_WITHOUT_PROVEN_GROUP) puis l'écriture de la preuve a échoué : 0 événement IMO, 0 fait, statut RFQ_DETECTED. Cohérent avec « 0 preuve IMO » en Cloud depuis IMO-GOODS-SOURCE (12/09).
**Risques** : toute demande avec mention ONU perd l'extraction des faits (fail-closed par le gap, mais analyse interrompue) ; run-pricing n'a jamais de preuve stockée et repasse toujours par le preflight en mémoire.
**Recommandation de Claude Code** : GO migration ciblée ajoutant `imo_goods_recognition` à la contrainte, avec contre-revue DB, puis recette du cas sandbox existant.
**Référence** : work 873c993, roadmap §3.22/§3.25.
**Suite (24/09, GO local)** : migration `20260923180000_case_timeline_imo_goods_event_type.sql` + rollback + test SQL préparés, non commités. Contre-revue DB indépendante PASS (0 bloquant), renforcements post-revue revérifiés PASS. Tests sur schéma Cloud restauré localement (schéma seul, conteneur sans réseau, transaction annulée) : forme réelle conforme, 40→41, validée, réapplication refusée ALREADY_APPLIED, test synthétique PASS, rollback refusé tant qu'un événement IMO existe (événement conservé), rollback restaure M19b sinon, dérive refusée sans modification, lock_timeout effectif (~5 s). Journaux Cloud de l'appel non accessibles : valeur absente du catalogue Cloud (vérifié), échec de l'écriture Cloud inféré (gap écrit, aucun événement ni fait) ; insertion refusée non rejouée isolément avant migration. En attente du GO de publication.

---

## [2026-09-23 17:10 UTC] TRAITÉ — Recette pricing du lot IMO alertes 1/2 : préflight run-pricing non atteignable sans écritures de préparation
**Résolution (24/09)** : demande satisfaite sans préparation PAD ni ACK : run-pricing avec allow_provisional:true franchit la garde de statut NEED_INFO et exécute le préflight IMO avant le contrôle des gaps (constat Codex, vérifié en runtime). Seule écriture de préparation restée : routing.terminal_operation_mode=LOLO sur le cas 1 (saisie UI tracée), conservée.
**Origine** : GO CTO de recette par fixtures synthétiques (23/09).
**Constat** : les 4 dossiers sandbox sont en NEED_INFO (cas 1, 2, 4 : gaps pricing.pad_category et routing.terminal_operation_mode) ou RFQ_DETECTED (cas 3). run-pricing refuse ces statuts avant le preflight IMO ; l'UI n'affiche pas le lancement (sauf seul manque cargo.value). Atteindre le preflight exige de renseigner ces faits et d'acquitter (ack-pricing-ready) : écritures non couvertes.
**Recommandation de Claude Code** : GO limité aux 4 sandbox pour renseigner pad_category et terminal_operation_mode via l'UI existante (valeurs synthétiques explicites), ACK, puis « Lancer le pricing » ; aucun tarif inventé.

---

## [2026-09-23 12:50 UTC] TRAITÉ — Recette sandbox du lot IMO alertes 1/2 : création du dossier synthétique impossible sans envoi ni insertion directe
**Clôture (24/09)** : recette achevée, voir l'entrée « Recette IMO sandbox … close » ; limite maintenue : ingestion IMAP non testée (fixtures insérées en SQL).
**Suite** : GO CTO option B (fixtures SQL) exécuté le 23/09. Fixtures IMO-RECETTE-20260923 : fils 6c431345…/11f0c30f…/47b6a56f…/ff041af2…, e-mails e7f7b071…/5e915707…/efc441fe…/e2071e0f…, dossiers (bouton « Traiter ») 0d2b54c6…/9b606375…/8a06251d…/709e06ce…. Analyse : cas 1, 2, 4 sans gap ni événement IMO ; cas 3 gap IMO bloquant conservé. Pricing non atteint (entrée PENDING ci-dessus). Écritures limitées aux sandbox, 0 run. Ingestion IMAP non testée.
**Origine** : session interactive (Claude Code), GO de publication et recette privée du 23/09.
**Type** : blocage (STOP ciblé prévu par le GO).
**Objectif** : prouver en runtime, sur un dossier sandbox dédié, 4 cas : e-mail ordinaire long, « un 20HQ », mention ONU ambiguë conservée bloquante, HTML au plafond d'ingestion bloquant.
**Constat vérifié dans le code** : `emails` n'est écrit que par sync-emails, import-thread et hydrate-email-body, tous alimentés par IMAP ; `ensure-quote-case` exige un fil existant ; email-admin/data-admin n'ont aucune action d'import de texte brut. Le preflight IMO lit les e-mails du fil : un dossier sans fil ne teste rien.
**Pourquoi une décision CTO est nécessaire** : option A = l'utilisateur envoie lui-même, depuis une adresse de test identifiable, 4 e-mails synthétiques à la boîte d'ingestion (dont un HTML > 100 000 caractères), puis sync-emails / ensure-quote-case / run-pricing sur ce seul fil ; option B = insertion SQL directe de fil et e-mails synthétiques étiquetés sandbox (contournement de l'ingestion, à autoriser explicitement, et nettoyage à décider).
**Risques** : A crée de vrais messages dans la boîte et des écritures d'ingestion ; B ne prouve pas la chaîne d'ingestion et écrit hors mécanisme applicatif.
**Recommandation de Claude Code** : A (chaîne réelle de bout en bout), B seulement si l'envoi est exclu.
**Référence** : work 6aefc4ce, roadmap §3.25.

---

## [2026-09-23 12:40 UTC] TRAITÉ — Faux blocages IMO : troncature HTML à l'ingestion (STOP hors périmètre)
**Décision** : GO CTO ciblé de l'utilisateur (23/09) : exception FROZEN `run-pricing/index.ts` limitée à la lecture de `body_html`. Réalisé localement (+2/−1), plafonds vérifiés dans le code (100 000 / 1 000 000 unités UTF-16), contre-revue : A et B levés, aucun bloquant restant. Détail : roadmap §3.25. Non commité (GO de publication distinct).
**Origine** : session interactive (Claude Code, exécutant unique du GO « faux blocages IMO, alertes Lovable 1 et 2 », base work 00e15251).
**Type** : demande de GO avant travail (fichier hors périmètre).
**Objectif** : fermer le dernier bloquant de contre-revue. `sync-emails` tronque `body_html` à 100 000 (hydrate : 1 000 000) avant d'en dériver `body_text` ; le texte obtenu, de longueur quelconque, ne porte aucune trace de la coupe. Une mention ONU coupée en fin de HTML passe désormais « sans IMO » (l'ancien code bloquait tout corps > 4 000 caractères).
**Fichiers concernés** : `supabase/functions/run-pricing/index.ts` (lecture de `body_html` dans la requête e-mails du preflight) + `imo-goods-preflight.ts` (incomplet si `body_html` = 100 000 ou ≥ 1 000 000).
**Pourquoi une décision CTO est nécessaire** : `run-pricing/index.ts` (FROZEN) est hors des fichiers autorisés.
**Risques** : option GO = lecture de `body_html` (jusqu'à 1 Mo par e-mail), sans écriture ni changement d'empreinte ; option résiduel = faux négatif possible sur HTML tronqué. Cloud (lecture seule) : 9 e-mails entrants à HTML plafonné, 0 rattaché à un dossier.
**Recommandation de Claude Code** : GO ciblé de l'option lecture `body_html` (≤ 2 lignes dans index.ts + tests).
**Référence** : diff local non commité, 4 fichiers +297/−20.

---

## [2026-09-22 18:35 UTC] TRAITÉ — Lot 7 : reliquats UI vue dossier livrés et clos (conflits PAD → tableau des faits, raisons de qualification lisibles, zone d'actions cargo canonique, seuil lint 732/16)
**Origine** : session interactive (Claude Code, canal direct Lovable MCP).
**Type** : GO utilisateur de réalisation « go » sur la liste des quatre reliquats consignés à la clôture des lots 1 à 6. Base origin/work 1ea91e3 (docs publiées).
**Périmètre** : (1) PadGroupConfirmationsPanel remonte à CaseView les clés de faits concernées par un signal explicite déjà chargé (PAD_GROUP_WEIGHT_CONFLICT → cargo.weight_kg, cargo.weight_per_container_kg) ; CaseView les passe à `conflictFactKeys` de CaseFactsTable ; aucune déduction par confiance. (2) Dictionnaire de présentation des raisons de `qualifyScope` (« <service> explicitement hors périmètre », « <service> : signal scope absent », variante avec faits) → phrases françaises lisibles, valeurs inchangées. (3) Intitulé « Actions cargo canonique » affiché seulement quand un bouton est déporté dans la zone. (4) `scripts/check-lint-baseline.mjs` : BASELINE_ERRORS 737 → 732. Exécutant unique Lovable, contre-revue Claude, mêmes cinq décisions, mêmes interdits.
**Contre-revue lot 7 (Claude, 22/09 19:05 UTC)** : message `umsg_01m354jdwbenf92tgdp57jage9`, `origin/work` 1ea91e3 → 628f6cd (5 commits), 9 fichiers (+83/−9) dont `case-view/factConflicts.ts` (+7) et son test créés. (1) `factKeysForExplicitIssues` traduit uniquement `PAD_GROUP_WEIGHT_CONFLICT` → `cargo.weight_kg`, `cargo.weight_per_container_kg` ; `PadGroupConfirmationsPanel` le remonte via `onConflictFactKeysChange` (aucun appel ajouté) ; `CaseView` le passe à `conflictFactKeys` de `CaseFactsTable`. (2) `presentPartnerScopeReason` reconnaît les quatre formes de `qualifyScope` par expressions régulières et rend les quatre phrases demandées, repli sur la raison brute ; `scopeQualification.ts` intact ; la phrase DAP/DDP reste prioritaire. (3) Zone « Actions cargo canonique » : `hidden has-[button]:flex` avec intitulé, Tailwind 3.4.17, règle `.has-[button]:flex:has(button){display:flex}` présente dans le CSS construit. (4) `BASELINE_ERRORS` 737 → 732. Tests : contrats conservés + 4 ajoutés. Worktree détaché : typecheck PASS ; Vitest 534/535 (même échec baseline) ; eslint 0 sur les ajouts, CaseView 73 inchangé ; `lint:baseline` 732/732 OK ; build PASS. Aperçu non revérifié en direct (session du navigateur intégré expirée) ; preuve par tests et CSS construit. Verdict : PASS_WITH_BASELINE. **Lot 7 clos, aucun reliquat UI ouvert.** Entrée non commitée (GO publication distinct).

---

## [2026-09-22 16:10 UTC] TRAITÉ — Lots 3 à 6 du plan Lovable livrés et clos (Devis et envoi, Scénarios, Partenaires, Sources), mêmes cinq décisions
**Origine** : session interactive (Claude Code, canal direct Lovable MCP).
**Type** : GO utilisateur de réalisation « go » sur la liste « lots 3 à 6 : Devis confirmé et envoi, Scénarios avec le tableau des révisions, Partenaires et coordination, Sources et faits ». Base origin/work 412eebe.
**Méthode** : un lot par tour Lovable, exécutant unique, contre-revue Claude sur worktree détaché entre chaque lot, corrections regroupées sous le GO du lot. Maquettes cibles jointes par lot (Devis, Scenarios, Partenaires, Sources).
**Périmètres** : lot 3 = PricingResultPanel, QuotationVersionCard, SendQuotationPanel, usePricingResultData, LineProvenanceBadges, section Devis de CaseView ; lot 4 = QuoteScenariosPanel (2 063 lignes, extraction ScenarioRevisionTable) ; lot 5 = CaseActionPlan, CommunicationSummaryCard, PartnerScopeCard, section Coordination ; lot 6 = section Sources, CaseFactsTable à créer, constants. Aucune mutation, aucun FROZEN, aucune valeur 450cb321 en dur.
**Contre-revue lot 3 (Claude, 22/09 16:40 UTC)** : message `umsg_01m34y42hcej2bajp0r5m3nfc1`, `origin/work` 412eebe → 63a15ec (8 commits Lovable), 7 fichiers `src` (+168/−133), aucun créé. `PricingResultPanel.tsx` : quatre tuiles (Total à payer, Total des lignes, Lignes avec répartition, À confirmer avec postes nommés), phrase « n barème(s) officiel(s) cité(s) » = références uniques `tariff_sources.type = OFFICIAL` (décision 3), note de fraîcheur compactée, « Détail des lignes ▸ » replié, « Créer la version vN » désactivé avec info-bulle quand `quotation_versions.pricing_run_id` = run courant (colonne vérifiée dans les types générés et les migrations). `QuotationVersionCard.tsx` : montant affiché = total_payable ?? total_ttc ?? total_ht, « même montant que vN-1 » depuis les snapshots, réserves repliées « Voir les réserves (n) », libellés Brouillon / Ouvrir le PDF. `SendQuotationPanel.tsx` : destinataire `aria-invalid` + message d'erreur, mention « Envoi manuel hors application… », marquage désactivé sans destinataire ; contrats d'envoi inchangés. `CaseView.tsx` : section renommée « Devis confirmé, versions et envoi », propositions maritimes dans un `<details>` replié. Tests : contrats conservés + 3 ajoutés. Worktree détaché : typecheck PASS ; Vitest 516/517 (même échec baseline) ; eslint touchés en baisse (PricingResultPanel 20→16, QuotationVersionCard 4→3) ; `lint:baseline` 734/16, **gate OK pour la première fois** (seuil 737) ; build PASS. Aperçu vérifié sur 450cb321 : tuiles, « 3 barèmes officiels cités », v5 bloquée, « même montant que v3 », destinataire en erreur, marquage désactivé. Verdict : PASS_WITH_BASELINE. **Deux corrections mineures regroupées avec le lot 4** : (a) le bouton de génération du PDF (état sans URL) porte « Ouvrir le PDF » alors qu'il génère → « Générer le PDF » ; (b) bouton « Voir les propositions » ajouté à l'intérieur du `<details>` qu'il ouvre, redondant avec « Voir propositions maritimes » du panneau → retirer ce bouton ajouté (pas une ancienne commande).
**Contre-revue lot 4 (Claude, 22/09 17:05 UTC)** : message `umsg_01m34z7yh6eatrt2s526yc6q9z`, `origin/work` 63a15ec → 08c5e74 (8 commits), 6 fichiers (+256/−358) dont `ScenarioRevisionTable.tsx` créé (+137). `QuoteScenariosPanel.tsx` −425/+~70 : les cartes répétées par révision sont remplacées par le tableau (Rév. / Date / Motif / Points ouverts / Hypothèses / Résultat HT / Statut), détail de la seule révision sélectionnée (autres dépliables une à la fois), réserves non répétées, comparateur A/B replié derrière « Comparer deux révisions », compteur « n scénario(s) · m révisions », prop `isLocked` qui désactive toutes les commandes ; les appels startRevise / runSelect / runScenarioPricing / createScenarioOutput / exportScenarioPdf / createScenarioEmailDraft sont inchangés et simplement rebranchés. Corrections lot 3 livrées : « Générer le PDF » sur l'état de génération, bouton redondant « Voir les propositions » retiré. Tests : contrats conservés + 2 ajoutés (tableau / détail unique / réserves non répétées / immutabilité ; verrouillage intégral). Worktree détaché : typecheck PASS ; Vitest 518/519 (même échec baseline) ; eslint 0 sur les fichiers scénarios, inchangé ailleurs ; `lint:baseline` 734/16 OK ; build PASS. Aperçu vérifié sur 450cb321 : 5 lignes (rév. 5 sélectionnée 1 444 382, rév. 2 « Bloqué », rév. 1 « Non estimée »), aucune réserve répétée, aucun débordement. Verdict : PASS_WITH_BASELINE.
**Contre-revue lot 5 (Claude, 22/09 17:30 UTC)** : message `umsg_01m350d5eted18e5ms8etaz1es`, `origin/work` 08c5e74 → dd187a6 (15 commits dont un correctif typecheck), 9 fichiers `src` (+227/−184 avec plan.md) dont `CoordinationCards.test.tsx` et `partnerScopePresentation.ts` créés. `CaseActionPlan.tsx` : plan ouvert par défaut, « x/y terminées », étape bloquée annotée « bloqué : … », badge « Email client manquant ». `CommunicationSummaryCard.tsx` : trois lignes (e-mail depuis `contacts.client_email`, questions ouvertes, dernière analyse de réponse), « Complète » conditionné à l'e-mail, boutons « Brouillons de réponse (n) » / « Actions clôturées (n) » qui ouvrent les blocs existants désormais repliés (`section-reply-drafts`, `section-closed-actions`). `PartnerScopeCard.tsx` : fait `service.package` lu, phrase DAP/DDP réservée au scope `out_of_scope` via fonction pure testée, éléments attendus en pastilles, « Priorité élevée ». `CaseView.tsx` : section renommée « Partenaires et coordination » avec « étape restante : … » dans le résumé, NextActionBanner déplacé en tête du plan, ReadyActionsPanel après. Aucune mutation modifiée. Worktree détaché : typecheck PASS ; Vitest 522/523 (même échec baseline) ; eslint identique à la base ; `lint:baseline` 734/16 OK ; build PASS. Aperçu vérifié : résumé « étape restante : Marquer l'envoi client », « Adresse e-mail : manquante », plan 6/7 avec les 7 étapes, « Pricing direct, aucune sollicitation nécessaire ». Verdict : PASS_WITH_BASELINE. **Trois corrections mineures regroupées avec le lot 6** : (a) « Questions ouvertes au client : 0 » compte les demandes client actives alors que la section Données affiche « 2 questions ouvertes (non bloquantes) » depuis les gaps → afficher le compte des gaps chargés, et les demandes envoyées au client à part si > 0 ; (b) `PartnerCollectionReadinessCard` désormais rendu deux fois (dans « Collecte partenaires et contrôles du devis confirmé » et dans Coordination) → ne garder qu'une instance, déplacement pas duplication ; (c) badge « 0 point en attente » quand seul l'e-mail manque → « E-mail client manquant ». Remarque : la raison brute de qualification « freight : signal scope absent » reste technique, conforme à la consigne « phrase réelle », à humaniser dans un lot ultérieur si souhaité.
**Contre-revue lot 6 (Claude, 22/09 18:05 UTC)** : messages `umsg_01m351e327ej7tchk8nswa1nba` (plan mis en pause par Lovable sur validation éditeur) puis `umsg_01m3521qk5fgz8hvrtq3bs9b6j` (plan validé par message), `origin/work` dd187a6 → 6e91cdf, 7 fichiers `src` (+326/−226) dont `CaseFactsTable.tsx` (+160) et son test créés. Tableau des faits : libellé métier (dictionnaire `FACT_LABELS`, 37 clés) avec clé technique dessous, regroupement Marchandise / Acheminement / Service / Tarification / Réglementaire / Contacts / Autres, origine lisible depuis `source_type`, confiance colorée (≥ 90 vert, 60–89 ambre, < 60 rouge), JSON résumé (conteneurs, articles) avec brut sous « Détail technique », édition / historique via les handlers et `FactHistoryPopover` existants, aucun payload `set-case-fact` modifié ; onglets « Faits (n) / Documents (n) / Historique (n) », résumé « · k documents », « Ajouter un fait » derrière un bouton secondaire, compteur « n faits sous 70 % ». Corrections lot 5 livrées : questions ouvertes = gaps chargés (« 2 · non bloquantes ») avec « envoyées au client » à part, une seule instance de PartnerCollectionReadinessCard, badge « E-mail client manquant ». Worktree détaché : typecheck PASS ; Vitest 526/527 (même échec baseline) ; eslint CaseView 75 → 73 ; `lint:baseline` 732/16 OK ; build PASS. Aperçu vérifié sur 450cb321 : onglets Faits (17) / Documents (1) / Historique (47), groupes, origines « E-mail » / « Opérateur », « 2 faits sous 70 % de confiance », aucun « Arbitrer ». Verdict : PASS_WITH_BASELINE. Remarques non bloquantes : (i) la prop `conflictFactKeys` du tableau existe mais n'est pas alimentée par CaseView (aucun signal explicite chargé à ce niveau) → aucun surlignage, conforme à la décision 1, câblage possible plus tard depuis l'état PAD ; (ii) la case « Faits courants seulement » est rendue `checked readOnly`, donc non interactive mais d'apparence cliquable → correctif mineur demandé (`disabled` + explication).
**Dernière correction (Claude, 22/09 18:20 UTC)** : message `umsg_01m352tjtreds8qz24jwkjwsys`, `origin/work` 6e91cdf → a6fbbfb (commit 4b5a253, `CaseView.tsx` +2/−2) : case « Faits courants seulement » passée en `disabled` avec `title` explicatif. Vérifié en local : typecheck PASS, tests cockpit / CaseFactsTable / CoordinationCards PASS, `lint:baseline` 732/16 OK.
**Clôture lots 3 à 6** : `origin/work` 412eebe → a6fbbfb, 30 fichiers `src` touchés sur les quatre lots, 5 fichiers créés, aucun FROZEN, aucune migration, aucune écriture ajoutée ; coût Lovable relevé ≈ 14,1 + 13,4 + 15,9 + 4,9 + 7,3 crédits. Reste hors des lots 1 à 6 : câblage des conflits explicites vers le tableau des faits, humanisation des raisons brutes de qualification partenaire, intitulé de la zone d'actions cargo canonique, abaissement du seuil lint du script (737 → 732). Entrée et note roadmap non commitées (GO publication distinct).
**Suite** : entrées de contre-revue ajoutées ci-dessous lot par lot ; TRAITÉ.

---

## [2026-09-22 15:35 UTC] TRAITÉ — Lot 2 Marchandises et catégories PAD livré et clos (plan Lovable, mêmes cinq décisions)
**Origine** : session interactive (Claude Code, canal direct Lovable MCP).
**Type** : GO utilisateur de réalisation « GO lot 2 Marchandises, mêmes cinq réponses », base origin/work 49d7611 (docs lot 1 publiées).
**Périmètre** : lot 2 du plan Lovable : section « Marchandises et catégories portuaires » dépliée selon la maquette (groupe en carte lisible, poids extrait vs base retenue côte à côte avec une seule réserve éditable, catégorie PAD en grand avec justification, cases à cocher explicites, un bouton primaire de confirmation par groupe, « Aide à la classification » repliée regroupant PadNstSuggestionsPanel, CommodityClassificationCandidatesPanel et alias, déplacés depuis la section Devis confirmé sans suppression). Fichiers attendus : CaseView.tsx, PadGroupConfirmationsPanel.tsx (203 lignes), extraction optionnelle PadClassificationHelp.tsx, tests. Aucune mutation modifiée, montant PAD affiché seulement s'il existe.
**Interdits rappelés** : Edge Functions FROZEN, migrations, DB/RLS/Auth, calculs, faits, hypothèses, statuts, flux d'écriture, composants Phase 3B, valeurs 450cb321 en dur.
**Contre-revue lot 2 (Claude, 22/09 16:05 UTC)** : message `umsg_01m34w2rrpe1vv7txa6dj7g47m`, `origin/work` 49d7611 → ee8f2ab (commits e9b83ea, 5d5f59a, 82d7ed5, fusion ee8f2ab), 6 fichiers `src` (+151/−67), aucun créé. `PadGroupConfirmationsPanel.tsx` : carte groupe (quantité × équipement, propriété, badge « Non dangereux » seulement si `cargo.dangerous_goods` vaut faux, poids par conteneur, source), poids « Extrait des pièces » avec confiance et « Base retenue » côte à côte, réserve unique « reprise telle quelle dans le devis », date du rapprochement, catégorie en grand avec statut (retenue avec réserve / confirmée / à confirmer), droit de passage affiché seulement si `state.lines` porte un montant, deux cases explicites, bouton « Confirmer <code> pour le devis » désactivé tant qu'elles ne sont pas cochées, payload `manage-pad-group-confirmation` byte-identique, résumé remonté au `<summary>` (« PAD T02 retenue avec réserve » vérifié dans l'aperçu). `CaseView.tsx` : « Aide à la classification » repliée regroupant PadNstSuggestionsPanel et CommodityClassificationCandidatesPanel déplacés depuis la section Devis (aucune suppression) ; libellés TO_CONFIRM / MAP-5B / is_current / alias validé only passés en français. Tests : 9 contrats conservés + 2 ajoutés + 1 cockpit. Worktree détaché : typecheck PASS ; Vitest 512/513 (même échec baseline) ; eslint touchés 0 hors CaseView 75 (76 à la base) ; `lint:baseline` 739/737, meilleur que la base 740 ; build PASS. Verdict : PASS_WITH_BASELINE. **Correction mineure demandée** : « Choisir une autre catégorie » vide la catégorie mais le sélecteur reste dans le `<details>` replié « Poids et références détaillées » → ouvrir ce bloc et focaliser le sélecteur au clic. Remarque : « Rechercher une catégorie PAD » déclenche par le DOM le premier bouton des panneaux d'aide, navigation seule, acceptable.
**Correction contre-relue (Claude, 22/09 16:15 UTC)** : message `umsg_01m34x8h2feaxssqj5h87164j0`, `origin/work` ee8f2ab → 412eebe (commits 92834e9 composant, 824b7af test) : refs sur le `<details>` et le sélecteur, « Choisir une autre catégorie » ouvre le bloc, défile et focalise le sélecteur ; test dédié ajouté (+12). Vérifié : typecheck PASS, tests PAD et cockpit PASS, eslint 0, `lint:baseline` 739/16 inchangé. Verdict : PASS_WITH_BASELINE. **Lot 2 clos** : `origin/work` 49d7611 → 412eebe, 6 fichiers, aucun FROZEN ni écriture ajoutée ; coût Lovable relevé 15,6 + 2,8 crédits. Reste hors lot 2 : lots 3 à 6 du plan Lovable sous GO distinct. Local aligné ; entrée non commitée (GO publication distinct).

---

## [2026-09-22 12:05 UTC] TRAITÉ — Revue UI vue dossier : maquette cible, plan Lovable, GO lot 1 (1a/1b/1c)
**Origine** : session interactive (Claude Code, canal direct Lovable MCP).
**Type** : revue UI + consultation croisée Lovable en mode plan, puis GO utilisateur de réalisation.
**Objectif** : rendre la page `/case/:caseId` (`src/pages/CaseView.tsx`, 2 720 lignes) simple et intuitive pour un opérateur, présentation seule, sans toucher calculs, faits, hypothèses, statuts ni flux d'écriture.
**Faits vérifiés** : revue sur le dossier de test 450cb321 (PDF 18 pages + page en direct dans le navigateur intégré). Mesures : 74 boutons visibles sections dépliées, 45 libellés distincts ; débordement horizontal à 926 px de viewport avec la barre latérale ouverte (document 1 223 px) ; cinq boutons primaires concurrents ; cartes scénario à contraste insuffisant ; JSON brut affiché dans les hypothèses ; cinq montants concurrents non réconciliés (estimation 1 444 382 HT vs devis v4 884 380 lignes / 983 380 à payer).
**Maquette cible** : canevas Design privé https://claude.ai/artifact/SgumKjcwWTKyGFdncTRoZ9 (7 écrans : principal + 6 sections dépliées). Sept fichiers HTML transmis à Lovable en pièces jointes.
**Consultation Lovable (mode plan, aucune édition)** : message umsg 11:48 UTC, réponse 11:53 UTC. Plan en 7 lots, `PilotageViewModel` frontend pur, écart calculé à devise identique seulement, cause du débordement = minima flex absents sur la zone principale, refus des conflits déduits par confiance. Contre-revue Claude : lot 1 trop gros (8 fichiers, 700–1 100 lignes) → découpage 1a/1b/1c ; MainLayout/index.css globaux à borner ; QuoteScenariosPanel (2 063 lignes) à extraire plutôt que retoucher.
**GO utilisateur (22/09 ~12:00 UTC)** : « GO lot 1 avec découpage 1a 1b 1c et tes cinq réponses ». Cinq décisions : (1) conflits = signaux explicites seulement ; (2) outils avancés option A ; (3) barèmes officiels = références marquées OFFICIAL ; (4) bouton primaire = navigation/focus, jamais exécution ; (5) anciennes commandes déplacées, jamais supprimées.
**Étape 1a envoyée à Lovable en construction** : message `umsg_01m34gd54ef1jbs0ca5c403hfw` (thread main). Périmètre : `src/pages/case-view/presentation.ts` + test, bandeau de pilotage sticky dans `CaseView.tsx`, `useCockpitState.ts` lecture seule si nécessaire, adaptation `cockpit-layout.test.tsx`. Hors 1a : MainLayout, index.css, PricingLaunchPanel, ScenarioEstimateResult, QuoteScenarioAssumptionsPanel, tableau d'estimation, réserves, hypothèses lisibles, résumés de sections, responsive.
**Interdits rappelés** : Edge Functions FROZEN, migrations, DB/RLS/Auth, composants Phase 3B, valeurs du dossier 450cb321 en dur.
**Contre-revue 1a (Claude, 22/09 12:35 UTC)** : Lovable a poussé directement sur `origin/work` (799ee83 → 846579e, 10 commits dont plan et « roadmap.md » racine créé puis supprimé, net zéro ; `src/lib/padGapReview.ts` touché puis rétabli, net zéro). Diff net : 5 fichiers `src` (+538/−241 avec `.lovable/plan.md`), `presentation.ts` +232, `presentation.test.ts` +58, `CaseView.tsx` +69/−1, `NextActionBanner.tsx` +24/−216 (requête locale remplacée par `useCockpitState`), `useCockpitState.ts` +34/−3 (lecture `version_number`, `snapshot`, `purpose`, `question_fr`). Aucun FROZEN, aucune migration, aucune écriture ajoutée. Vérifié dans un worktree détaché : typecheck PASS ; Vitest 502/503 PASS, 1 échec `LocalTransportEstimateFields` identique sur 799ee83 = PASS_WITH_BASELINE ; eslint fichiers touchés 76 = 76 baseline, nouveaux fichiers 0 ; `lint:baseline` FAIL 740/737 identique sur 799ee83 = PASS_WITH_BASELINE. Aperçu Lovable vérifié sur 450cb321 : progression 5/6, action « Marquer l'envoi client », devis v4 983 380 F CFA, estimation 1 543 382 F CFA, écart 560 002 ; le bouton primaire ouvre la section devis, défile et focalise `section-version` sans mutation. **Défaut constaté** : le bandeau ne reste pas collé au défilement (le `main` porte `overflow-auto` mais c'est la fenêtre qui défile ; sticky sans effet à 926 px comme à 1 440 px) → correctif à porter en 1c avec MainLayout. **Remarque** : l'ancre `section-sources` a été posée sur « Données du dossier », pas sur « Sources, faits et historique » → à renommer en 1c. Verdict 1a : PASS_WITH_BASELINE, non bloquant pour 1b.
**Contre-revue 1b (Claude, 22/09 13:20 UTC)** : message `umsg_01m34jpckzf4yt91an33848n9d`, `origin/work` 846579e → 5d88768 (commit code 8b272b8). Diff net 7 fichiers `src` (+523/−110) : `estimatePresentation.ts` +113 (classement pur des réserves, base d'une ligne, statut), `assumptionPresentation.ts` +164 (adaptateur transport local / séjour conteneur, JSON inconnu → « Données structurées à consulter »), test +56, `ScenarioEstimateResult.tsx` +96/−? (tableau Prestation / Montant / Base / Statut / Détail, séjour après le tableau, « Réserves à traiter » ouvert et « Mentions standard » replié), `QuoteScenarioAssumptionsPanel.tsx` (libellés Portée / Type, rendu en clair, JSON brut sous « Détail technique », bouton « Réviser » + menu « Autres actions » conservant Promouvoir / Confirmer client / Réfuter), deux tests adaptés. Aucun FROZEN, aucune mutation modifiée, immutabilité testée. Worktree détaché : typecheck PASS ; Vitest 507/508 (même échec baseline) ; eslint 0 sur les 7 fichiers ; `lint:baseline` 740/737 identique à la base → PASS_WITH_BASELINE. Aperçu vérifié : tableau rendu, carte séjour lisible (20GP, SOC, 12 jours, code 414). **Deux corrections demandées avec 1c** : (a) colonne Base des lignes chiffrées = référence de la source avant la première phrase des notes (aujourd'hui la ligne THC affiche le descriptif du scénario, la ligne magasinage affiche le code technique) ; (b) les notes des lignes chiffrées, déjà dans le tableau, ne doivent pas être répétées dans « Mentions standard » (15 entrées au lieu de 9 codes). Remarque : plusieurs assertions de tests passées de `getByText` à `getAllByText`, tolérable mais plus faible.
**Contre-revue 1c (Claude, 22/09 13:55 UTC)** : message `umsg_01m34ky94rfj8sgx6r780rbjcr`, `origin/work` 5d88768 → 1c32108 (commit code b2403e9), 9 fichiers `src` (+177/−131) : `MainLayout.tsx` (racine `h-svh overflow-hidden`, SidebarInset `min-h-0 min-w-0`, main `overflow-y-auto`), `CaseView.tsx` (ancres `section-data` / `section-sources`, résumés dans les `<summary>`, `<details>` « Outils avancés » fermé regroupant cargo canonique, sync legacy, intention ; boutons Adopter / Synchroniser déportés par `createPortal` vers une zone opératoire), `CargoCanonicalPreviewPanel.tsx` et `CargoCanonicalLegacyFactsSyncPanel.tsx` (prop `actionPortalId`, logique inchangée), `QuoteScenariosPanel.tsx` (tokens de thème), `estimatePresentation.ts` (corrections a et b), `presentation.ts` (targetId), 2 tests. Worktree détaché : typecheck PASS ; Vitest 508/509 (même échec baseline) ; eslint 0 sur les fichiers touchés hors dette CaseView 76 = 76 ; `lint:baseline` 740/737 identique ; build PASS. Aperçu vérifié : bandeau collé sous l'en-tête (scroll interne 900 px, bandeau à 48 px), aucun défilement horizontal du document à 941 px ni 375 px (tables en défilement local), « Mentions standard (9) », résumés affichés. **Défauts bloquants avant clôture** : (1) impression : les règles `@media print` de `index.css` ciblent `.min-h-screen.flex` et `main.relative.flex.min-h-svh`, classes disparues avec le nouveau layout ; la racine `h-svh overflow-hidden` risque de tronquer « Imprimer PDF » à une hauteur d'écran → correctif print + preuve (nombre de pages / hauteur du document en média print) exigés ; (2) résumé « Coordination — plan 0/0 » : compte les demandes partenaires closes/totales, pas le plan d'actions → masquer à zéro et renommer. Remarque non bloquante : la zone opératoire des boutons Adopter / Synchroniser est un `div` sans libellé. Verdict 1c : PARTIAL, correctif demandé sous le même GO.
**Correctif 1c contre-relu (Claude, 22/09 14:15 UTC)** : message `umsg_01m34nk987f448cemmy1r5z9ef`, `origin/work` 1c32108 → 258b8d8 (commit code 487a6a1), 4 fichiers (+33/−19) : `MainLayout.tsx` (attributs `data-print-layout` root / inset / content), `index.css` (règles print sur ces attributs : hauteur auto, overflow visible, display block, sidebar masquée), `CaseView.tsx` (résumé Coordination = « demandes partenaires x/y » seulement si > 0), test cockpit (+1 cas). Preuve Lovable (Playwright, média print, 24 `<details>` ouverts) : avant 1 800 px / 1 page A4 tronquée, après 16 644 px / 18 pages A4, colonne latérale absente. Worktree détaché : typecheck PASS ; Vitest 509/510 (même échec baseline) ; eslint 0 hors dette CaseView 76 = 76 ; `lint:baseline` 740/737 identique ; build PASS. Verdict correctif : PASS_WITH_BASELINE. **Lot 1 clos** : `origin/work` 799ee83 → 258b8d8, 25 fichiers `src` touchés au total, aucun FROZEN, aucune migration, aucune écriture ajoutée, coût Lovable ≈ 15 + 6,6 crédits pour 1c et son correctif (1a et 1b non relevés).
**Reste hors lot 1 (GO distinct requis)** : tableau des révisions de scénarios (lot 4 du plan Lovable, `QuoteScenariosPanel.tsx` 2 063 lignes), sections Marchandises / Devis / Partenaires / Sources dépliées (lots 2, 3, 5, 6), intitulé de la zone d'actions cargo canonique, dette lint historique (seuil script 737 vs réel 740). Local aligné par fast-forward sur 258b8d8 ; cette entrée et la note roadmap de clôture restent non commitées.

---

## [2026-09-15 11:33 UTC] TRAITÉ — Correctif bundling livré ; recette GoTrans PARTIAL

**GO** : utilisateur « oui si c'est nécessaire » autorisant correctif ciblé/tests/reprise de la livraison, sans nouvelle migration ni tarif. Remplace le blocage bundling ci-dessous, historique conservé.
**Git** : work 3170e98→b3499cf22cdbac6fb3ec98fef97c3381c179c5a3 poussé, 7 fichiers +1717/-1587 ; domaine pur partagé, façade compatible, imports et gate isolé CI. Contre-revue Claude Read-only GO, réserves export default/imports résiduels levées. CI GitHub 34962663800 SUCCESS ; local 97 Deno ciblés PASS, 378 frontend PASS, Deno1336/1échec CRLF baseline/6ignorés, dette types49/lint737-16 inchangée.
**Runtime** : quotation-engine déjà livrée et source inchangée ; run-scenario-pricing puis manage-quote-scenario déployées avec succès depuis b3499cf, sources supabase/ identiques avant/après, OPTIONS200/POST sans auth401. Messages umsg_01m2jcqcj9eg7sa0m74yv4r290 / umsg_01m2jcvp7mehz9b6893znd9x87. Preuve de remplacement acceptée, bundle runtime NOT_VERIFIED. Aucune des quatre enveloppes SQL antérieures rejouée, ledger202.
**Recette** : sonde authentifiée run-scenario-pricing vide 400 attendu ; moteur générique mixte HTTP200, DTHC des groupes isolés (465000/1023000/à confirmer), total indicatif1735800XOF, honoraires0. GoTrans scénario v2 60081f2a-6ac9-4487-97fa-aa2739d94d05 créé/sélectionné UI, groupes39SOC/13SOC/3COC ; dérivation sourcée UN3536→9 uniquement armoires. Run isolé d2317567-4eb9-4cb8-8c89-aca932b06a86 HTTP200/blocked, sans appel moteur ni montant : TERMINAL_OPERATION_MODE_REQUIRED, PAD_CATEGORY_REQUIRED, CARGO_VALUE_REQUIRED_FOR_SCENARIO_ENGINE. Parcours positif GoTrans non validé ; pas de boucle de revue générale à rouvrir.
**Réserve UI** : base scénario203 caractères refusée par limite structurelle200 malgré contrôle cargo500 ; diagnostic local reproduit, texte de recette raccourci sans changement de sens puis création réussie. Aucun correctif UI/SQL supplémentaire effectué.
**Intégrité fraîche** : 11:20:58→11:32:33 UTC : scénarios0→1, runs isolés0→1 ; ledger202, faits1409 MD5 393ff8e6bcdf748f3b61b329a2441d9e, port_tariffs MD5 235a655bf711e7ad8fc6c917f6419fee, pricing canonique171/versions9 inchangés. Même formule to_jsonb que contrôle précédent. Une requête diagnostic created_at inconnue refusée sans écriture, reprise ts conforme après lecture schéma.
**Limites** : faits/barèmes/Auth/RLS/migrations inchangés, aucun envoi/publication publique. Projet workspace_edit/is_published=false observé ; publish_visibility=public est un réglage non modifié, pas une publication. Une ligne v2 existe désormais : rollback SQL v1 interdit en l'état, ledger conservé ; aucun rollback/nettoyage. Revert bundling réintroduirait l'import défaillant.
**Suite** : cadrer le chiffrage partiel générique avec réserves et les trois préconditions métier, sans inventer valeur/PAD ; harmonisation longueur UI à regrouper. Preuves hors dépôt delivery-bundling-recipe-20260915.json ; note roadmap de clôture locale non commitée. Cette queue seule fait l'objet du commit documentaire dédié autorisé.

---

## [2026-09-15 10:46 UTC] GO — Preuve de remplacement acceptée ; livraison PARTIAL, bundling Edge 2 FAIL

**Origine** : session interactive, GO utilisateur explicite après contre-revue Claude B1 LEVÉ.
**Périmètre autorisé** : transport E3 et deux préflights SELECT ; quatre enveloppes B→E1→E2→E3 avec accusés ; commit/push work ; Edge quotation-engine (exception FROZEN), run-scenario-pricing, manage-quote-scenario dans cet ordre ; contrôles des sources, recette privée sans envoi, traçabilité de livraison. Arrêt au premier échec.
**Git rétabli** : préflight aligné 0e2768ad ; commit applicatif 450913bd40994d59ac5864243d2e5227f2b55d7a poussé sur work (22 fichiers, +2103/-53). Lovable a ensuite ajouté quatre lignes de types générés dans src/integrations/supabase/types.ts, et aucun changement sous supabase/ : écart vérifié, conservé, fast-forward local vers 1f5bc6a3c4fce3ed3b9c9a18405732ecf8c2cd7f, sans blocage artificiel.
**SQL réellement exécuté** : transport frais E3 114746 octets / MD5 493f6b48383f722e13072f82794ae70d et deux préflights PASS. B→E1→E2→E3 via query_database, accusé B REVIEWED_OPTION_B_EXECUTION_NOT_HISTORICAL_PROOF puis accusé E REVIEWED_SCENARIO_E_20260915 ; persistance contrôlée 199→200→201→202 entre 10:28 et 10:29 UTC. Sources ledger MD5 B b2f2029470209f3e5625101974f6e73b / E1 ff415c5d2c6de69d0e9ee44c7236e8c1 / E2 c4913825b152b0aff3f4b4d3ed9f2298 / E3 deed0b385ed07c9253c076745e5f0b75.
**Intégrité** : empreintes tarifaires et 1409 faits inchangés après SQL ; ACL helper v2 postgres+sandbox uniquement, OID scope 197950 conservé. SELECT final 10:39:16 UTC : ledger 202, zéro scénario total/v2, 1409 faits. Une première requête finale utilisant à tort la colonne scope a été refusée sans écriture ; reprise avec scope_snapshot réussie.
**Tests** : 378 frontend PASS ; Deno 1336 PASS / 1 FAIL / 6 ignorés. Échec statique SIFB CRLF reproduit sur baseline inchangée : PASS_WITH_BASELINE, pas CI verte. Typecheck frontend/build/configurations PASS ; dette types Deno 49 et lint 737/16 identique.
**Edge 1/3** : quotation-engine déployée seule, succès rapporté par Lovable (message umsg_01m2ja1cmperss84qvjb6nwr57), sources Git supabase/ identiques au commit applicatif ; OPTIONS 200, POST sans auth 401. Interface Cloud : Active. Code du bundle runtime / empreinte / version non accessibles par le connecteur ni dans la vue Cloud consultée : NOT_VERIFIED, ne pas confondre avec identité Git. run-scenario-pricing et manage-quote-scenario NOT_RUN ; sonde métier authentifiée et recette NOT_RUN.
**Suite / risque** : ne créer aucun scénario v2 pendant cette fenêtre frontend/Edge incomplète. Obtenir la preuve runtime manquante ou faire arbitrer explicitement la preuve de remplacement (sources Git identiques + succès de déploiement + sondes authentifiées) avant les deux autres Edge et la recette. Pas de modification tarif/fait/Auth/RLS, pas d'envoi ni publication publique. Retour SQL uniquement après contrôle zéro v2, ledger conservé ; aucun rollback exécuté.
**Preuves** : preparation-locale/delivery-cloud-results-20260915.json hors dépôt, archive privée non transmise ; roadmap détaillée. Cette entrée fait l'objet d'un commit documentaire dédié conformément à la convention.

**Actualisation prioritaire 10:46 UTC** : GO utilisateur reçu sur preuve de remplacement identité Git + déploiement confirmé + sondes authentifiées ; l'absence d'accès au bundle runtime reste une réserve, plus un blocage à elle seule. Préflight et connecteur GitHub confirment work 770852653e597b0918bfcf1d36b7bbd52658bb66 ; Lovable aligné, privé/non publié. Diff depuis 450913bd limité à queue + quatre lignes de types, code métier inchangé.
**Sonde authentifiée quotation-engine PASS borné** : cas synthétique 1×20GP SOC, famille STANDARD, 10000 kg, DAP Dakar, valeur fictive 1000000 XOF : HTTP200 success true ; THC 155000, transport 82600, total indicatif 237600 XOF, honoraires 0 ; postes non documentés TO_CONFIRM. Première sonde mal formée (count au lieu de quantity) exclue de la preuve de calcul ; sonde corrigée conforme au contrat. Aucun scénario/quote_facts/pricing canonique créé.
**Nouveau blocage réel** : Lovable message umsg_01m2japfq6e7p927b6rhejbd1k : déploiement run-scenario-pricing FAIL, Deployed: none. Module not found ../manage-quote-scenario/domain.ts depuis run-scenario-pricing/domain.ts:2:39 ; import inter-fonctions confirmé localement. Dépôt complet disponible en tests, mais pas cette dépendance lors du bundling isolé. manage-quote-scenario non tentée ; ancienne run-scenario-pricing non remplacée ; recette scénarios NOT_RUN.
**Intégrité fraîche** : SELECT avant/après 10:45:35→10:46:32 UTC : ledger 202, scénarios/runs scénario 0, faits 1409, runs canoniques 171, versions canoniques 9 ; empreintes complètes calculées par md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)) inchangées : facts 393ff8e6bcdf748f3b61b329a2441d9e / port_tariffs 235a655bf711e7ad8fc6c917f6419fee. Formule différente des empreintes SQL du tour précédent : ne pas les comparer directement.
**Suite proposée, GO correctif requis** : partager le validateur pur dans _shared, conserver les exports et règles existants, raccorder les deux consommateurs, tests génériques et résolution isolée de chacun des trois bundles ; aucun changement de migration/ACL/Auth/RLS/tarif/fait ou quotation-engine. Puis reprendre la livraison bornée des deux Edge et la recette. Aucun correctif applicatif effectué ; ne créer aucun scénario v2 avant fin de fenêtre. Le risque/retour SQL documenté demeure, aucun rollback exécuté.

---

## [2026-09-11 17:30 UTC] ✅ TRAITÉ — T6 + T1 livrés ; point de reprise de la session du 11 septembre

**Origine** : session interactive
**Type** : lot terminé + orientation de reprise pour la prochaine session (Codex, Claude Code ou autre)

**Livré et poussé sur `work` ce jour** (au-delà du pack DTHC-4 déjà consigné dans les entrées ci-dessous) :
`a34bd893` T6a — `EVP_CONVERSION` réaligné sur `CONTAINER_PROFILES` : DTHC-4-C avait ajouté `20FL`/`40FL` aux profils sans les inscrire dans la table d'EVP, alors que le code déclare les deux listes « strictement » identiques ; les clés tombaient dans le repli par taille de `getEVPMultiplier`, qui rendait le bon chiffre par accident. `7bccf58e` T6b/T1 — filet de cohérence `_shared/container-type-consistency_test.ts` (4 invariants, exclusion 45 pieds nommée et testée) + les cinq orthographes high cube du 20 pieds et les formes courtes `20ST`/`40ST` ajoutées au barème de livraison. Le filet a été **vérifié en échec** sur les sources d'avant le lot : 3 tests sur 5 tombent.
Preuves : 282 Deno `_shared` PASS, 323 vitest PASS, typecheck PASS, `check:function-config` PASS, lint baseline 737/16 inchangé, build PASS. `typecheck:deno` **NOT_RUN** — imports distants injoignables depuis l'environnement agent, échec sur un fichier préexistant ; compensé par `deno check` local sur le périmètre du lot, PASS. Aucune migration, aucun composant FROZEN, aucun montant modifié.

**Constat structurant à connaître avant tout travail sur les types de conteneur** : un type est déclaré dans **quatre tables indépendantes** réparties sur trois modules (`CONTAINER_PROFILES` et `DTHC_CONTAINER_TYPE_ALIASES` dans `_shared/dpw-dthc-tariff.ts`, `EVP_CONVERSION` dans `_shared/quotation-rules.ts`, `LOCAL_TRANSPORT_CONTAINER_ALIASES` dans `_shared/local-transport-destination.ts`), plus `container_specifications` en base. Rien ne les relie. Le filet de T6b échoue désormais si elles divergent — **ne pas le contourner par une liste d'exceptions.**

**Ce qui reste à faire, par ordre de priorité** (détail complet dans `docs/DEFERRED_BACKLOG.md`, deux entrées ouvertes) :
1. `EMAIL-INGEST-SECURITY-1` — **gravité élevée, différé sur décision CTO explicite.** S0 : trois comptes `*@test.local` résiduels dans `auth.users`, dont un confirmé et authentifié (suppression manuelle UI Cloud, ne nécessite aucun lot). S1 : `search-emails`, `force-download-attachment`, `hydrate-email-body`, `import-thread` et `sync-emails` gardés par `requireUser` sans contrôle de rôle — tout compte authentifié lit la boîte. S2 à S4, E1-a/b/c, M1 : voir l'entrée.
2. `TRANSPORT-SPECIAL-CASE-1` — T2 (le barème sature au tarif 40 pieds, aucun palier au-dessus), T3 (aucune notion de véhicule requis), T4 (aucun code ISO 6346 reconnu en entrée), T5 (`isOOG` est du code mort, sans écrivain).

**Arbitrages CTO encore en attente, sans lot rattaché** : niveau de preuve du cumul 465 000 (recommandation Claude Code : `validated_internal`, l'arrêté disant « Néant ») · extension éventuelle de la majoration 50 % aux familles `REEFER` (255 750) et `BASIC` (105 000) · sous-lot F2, relevage à l'import C1–C5, qui toucherait le composant FROZEN `quotation-engine` · famille d'équipement DP World pour les BESS : marquage ISO ou usage négocié (écart chiffré 13 485 000 vs 26 970 000 FCFA sur le dossier GoTrans) · source du seuil de poids pour compléter `container_specifications` · contradiction tickets de pesage / dépliant Afrique Pesage contre le Règlement UEMOA 14, toujours parkée en attente de réponse d'Afrique Pesage · page 2 du dépliant DP World non fournie · écriture de `cargo.un_number` / `cargo.imo_class` sur le dossier `5e9cd222` · propagation aux dossiers des faits extraits des pièces jointes, aujourd'hui analysées sans jamais devenir des faits.

**Référence** : `work` @ `7bccf58e`, aligné avec `origin/work`. Edge functions redéployées le 2026-09-11 après T6a/T6b.

---

## [2026-09-11 10:05 UTC] ✅ TRAITÉ — ERREUR F1 CORRIGÉE : le relevage transit est restauré

**Correctif appliqué le 2026-09-11 (GO CTO)** — migration
`20260911103000_dthc4_f1b_restore_transit_relevage.sql`, appliquée en base live et vérifiée :
`CONTENEUR_20` 36 560, `CONTENEUR_40` 73 120, `CONTENEUR_45` 82 260, `unit` `FCFA/CNT`,
`evidence_level` `official`, source « Arrêté portant homologation des tarifs de manutention de
conteneurs (Ministère du Commerce, Sénégal, 2015) — annexe, RELEVAGE C6 : 36 560 FCFA par TEU ».
Reste ouvert sous GO distinct : créer les lignes `RELEVAGE` IMPORT/EXPORT au barème C1–C5
(18 280 / 36 560 / 41 130), dormantes tant que F2 n'aura pas ouvert le relevage hors transit.

**Constat d'origine, conservé pour mémoire :**

**Origine** : session interactive — **erreur introduite par Claude Code le 2026-09-10**
**Type** : correctif urgent sur donnée live, GO requis

**Ce qui s'est passé.** L'arrêté d'homologation des tarifs de manutention de conteneurs (Ministère du
Commerce, Sénégal, 2015), reçu le 2026-09-11, fixe le relevage **par TEU et par classification** :

| Classification | Relevage par TEU |
|---|---|
| C1 à C5 (coton, frigo, standards export, produits de base import, standards import) | **18 280** |
| **C6 — transit (Imp/Exp sauf coton)** | **36 560** |

Les deux lignes `RELEVAGE` de `port_tariffs` portaient `operation_type = 'TRANSIT'`, donc la
classification **C6** : 20 pieds = 1 TEU × 36 560 = **36 560**, 40 pieds = 2 TEU × 36 560 = **73 120**.
**Ces valeurs étaient exactes.** La facture DP World 3384292, qui donne 18 280, est un **import**
(C1–C5) — un autre tarif, pas le même.

J'ai comparé une facture d'import à des lignes de transit sans voir que la différence d'opération
portait une différence de barème, et j'ai conclu à tort à un doublement. La migration
`20260910180000_dthc4_f1_relevage_official_rate.sql` (commit `dc588eed`) a donc **appliqué le tarif
import à des lignes de transit**, divisant par deux le relevage transit.

**Exposition réelle, limitée** : avant F1 les deux lignes étaient en `evidence_level = 'observed'`,
hors whitelist runtime — aucune cotation n'a jamais porté de relevage. Depuis F1 elles sont actives,
donc toute cotation **transit** émise depuis le 2026-09-10 sous-évalue le relevage de 50 %.

**Correction proposée (GO requis)** — restaurer le barème C6 sur les lignes transit :

| `cargo_type` | Actuel (faux) | Cible C6 | Base |
|---|---|---|---|
| `CONTENEUR_20` | 18 280 | **36 560** | 1 TEU |
| `CONTENEUR_40` | 36 560 | **73 120** | 2 TEU |
| `CONTENEUR_45` | 41 130 | **82 260** | 2,25 TEU |

Ce qui est acquis de F1 et reste valable : la provenance (`official`, source facture + arrêté),
l'unité explicite, la ligne 45 pieds, et surtout l'activation de la ligne — le relevage n'était
chiffré nulle part avant.

**Question au CTO** : votre règle du 2026-09-10 (« 18 280 par EVP, le double pour un 40 pieds ») est
exacte pour l'**import/export** (C1–C5). Confirmez-vous que le **transit** suit bien le C6 de
l'arrêté à 36 560 par TEU ? Si oui je restaure ; si le barème transit a changé depuis 2015, il me
faut le document.

**À créer séparément** : des lignes `RELEVAGE` en `IMPORT` et `EXPORT` à 18 280 / 36 560 / 41 130
(C1–C5). Elles resteront dormantes tant que le sous-lot F2 n'aura pas ouvert le relevage hors
transit, mais la facture 3384292 prouve que DP World le facture à l'import.

**Référence** : branche `work`, HEAD `479208f7`. Pièce reçue : `dpw_dakar_landside_tariff.pdf`
(arrêté d'homologation, Ministère du Commerce, 2015), publié par DP World Dakar.

---

## [2026-09-11 11:20 UTC] PENDING — L'arrêté en vigueur est identifié : n° 035532 du 28 novembre 2023

**Origine** : session interactive
**Type** : demande de GO avant travail (correction de provenance)

**Texte trouvé** : **Arrêté ministériel n° 035532 du 28 novembre 2023 portant révision des tarifs de
manutention de conteneurs**, Ministère du Commerce, de la Consommation et des Petites et Moyennes
Entreprises — publié au **Journal officiel de la République du Sénégal n° 7723 du 6 avril 2024,
page 471**. Fondement : articles 6 et 7 du décret n° 2022-89 du 17 janvier 2022. Sanctions :
loi n° 2021-25 sur les prix et la protection du consommateur.

**Son annexe reproduit exactement la grille que porte l'application** (export et import : 70 000 /
155 000 / 170 500 / 155 000 + 50 % dangereux / 310 000 ; transit 110 000, taux par EVP). Le dépliant
DP World « Nouveaux tarifs de manutention de conteneurs » en est la reprise commerciale fidèle. Les
cinq familles canoniques sont donc **opposables**, et `evidence_level = 'official'` est pleinement
justifié — mais leur `source_document` cite aujourd'hui `DPW_TARIFS_2025_0001.pdf` ou
« Arrêté DPW 2025 », deux références qui n'existent pas.

**Article 3 — « Les tarifs de magasinage et de relevage, ainsi que des autres opérations annexes,
restent inchangés. »** Le barème de relevage de l'arrêté 2015 (C1–C5 : 18 280/TEU ; C6 transit :
36 560/TEU) est donc toujours en vigueur. **Le correctif F1b appliqué ce jour est confirmé par le
texte.**

**Les deux surcharges de poids de 2015 ont disparu.** L'annexe 2023 porte « Néant » en surcharge sur
toutes les lignes sauf les dangereux : la surcharge colis lourds de 20 % (20' > 15 T, 40' > 26 T) et
la pénalité de 50 % (20' > 20 T, 40' > 30 T) ne sont pas reconduites. La révision portant sur les
tarifs de manutention, leur colonne « Surcharge » remplace celle de 2015. **Rien à encoder.**

**Correction d'une hypothèse du 2026-09-11 matin** : l'arrêté ne codifie pas C1 à C7, il nomme les
classifications en clair. Le « ACCONAGE **C7** » de la facture 3384292 est le **code interne de
facturation DP World** pour la ligne « Autres conteneurs spéciaux » — catégorie effectivement créée
par cet arrêté, absente de celui de 2015. Ce n'est donc pas la preuve d'un texte encore plus récent.

**POINT DE GOUVERNANCE — cumul spécial × dangereux à 465 000.** L'arrêté porte **« Néant »** en
surcharge sur la ligne « Autres Conteneurs spéciaux » à 310 000, et attache le supplément de 50 % à
la seule ligne « Produits dangereux ». **Il n'écrit nulle part le cumul.** La décision CTO du
2026-09-10 (465 000) reste donc une décision de gestion, appuyée sur la pratique de facturation de
DP World, et non sur le texte. `evidence_level` doit être **`validated_internal`**, pas `official`
comme indiqué le 2026-09-10 — sauf confirmation écrite de DP World, qui rendrait `official`
légitime. **À trancher avant d'écrire la ligne.**

**✅ PROVENANCE CORRIGÉE le 2026-09-11 (GO CTO), commit `c48f0119`.** Migration
`20260911120000_dthc4_provenance_arrete_035532.sql` appliquée en base live et vérifiée : les
11 lignes citent l'arrêté n° 035532, `effective_date` = 2024-04-06 (publication au JO, retenue par
le CTO). La migration vérifie l'annexe ligne à ligne — montant ET surcharge — avant d'apposer la
référence. Les lignes RORO, BREAKBULK, magasinage et RELEVAGE conservent leur source, conformément
à l'article 3.
**Changement couplé, à ne pas oublier** : `DPW_DTHC_SOURCE_DOCUMENT` a changé dans
`_shared/dpw-dthc-tariff.ts`. **Le DTHC rendra `TO_CONFIRM` tant que les edge functions ne sont pas
redéployées par Lovable** — dégradation fail-closed, jamais un montant faux, mais à lever au plus
vite.

**Lot initialement proposé (conservé pour mémoire)** — corriger la provenance des
11 lignes canoniques de la grille THC :
- `source_document` → « Arrêté ministériel n° 035532 du 28/11/2023 portant révision des tarifs de
  manutention de conteneurs — JORS n° 7723 du 06/04/2024, p. 471 » ;
- `effective_date` → **2024-04-06** (publication au Journal officiel) au lieu de 2025-01-01.
  À confirmer : la date de signature (2023-11-28) est une alternative, mais la publication est la
  date à partir de laquelle le tarif est incontestablement opposable. Élargit l'applicabilité vers
  l'arrière : les dossiers de 2024 résoudront désormais un tarif au lieu de tomber en `TO_CONFIRM`.

**Référence** : pièce reçue `JO7723du06avril2024_1.pdf`, page 9 (page 471 du JO). Branche `work`,
HEAD `fa3f2186`.

---

## [2026-09-11 10:05 UTC] TRAITÉ — Codification C1–C7 et surcharges colis lourds de l'arrêté 2015

**Origine** : session interactive
**Type** : demande de GO avant travail

L'arrêté 2015 apporte trois éléments que le produit ignore aujourd'hui :

1. **La codification officielle C1 à C6**, qui est celle que DP World imprime sur ses factures
   (« ACCONAGE **C7** » sur la facture 3384292). Le C7 n'existe pas dans l'arrêté 2015 : il a été créé
   par un texte postérieur, pour les conteneurs spéciaux à 310 000. **C'est la preuve qu'un texte
   plus récent existe**, même s'il n'est pas publié sur le site de DP World.
2. **Deux surcharges de poids, absentes du produit et du dépliant 2024** :
   - surcharge colis lourds **20 %** sur un 20 pieds > 15 T et un 40 pieds > 26 T ;
   - **pénalité de surcharge 50 %** sur un 20 pieds > 20 T et un 40 pieds > 30 T (tonnage ISO).
   Elles visent exactement les dossiers qui nous occupent : les BESS GoTrans à 55 T/unité et les
   armoires de stockage à 33,050 T de la facture 3384292.
3. **Le périmètre de la surcharge dangereuse a changé** : « classe 1 à 5 » en 2015, « classe 1 à 9 »
   au dépliant 2024.

**À trancher avant toute écriture** : ces deux surcharges de poids sont-elles toujours en vigueur ?
Le dépliant 2024 porte « Néant » en surcharge sur toutes les lignes sauf les dangereux, ce qui
suggère qu'elles ont été supprimées — mais le dépliant reçu est la page 1 sur 2.

---

## [2026-09-10 17:09 UTC] PENDING — DTHC-4 : cumul « conteneur spécial × marchandise dangereuse »

**Origine** : session interactive
**Type** : décision CTO rendue, GO d'implémentation en attente

**DÉCISION CTO DU 2026-09-10** — un conteneur qui est **à la fois** hors gabarit / spécial **et**
IMDG classe 1 à 9 se tarife au **taux conteneur spécial majoré de 50 %**, soit
**310 000 × 1,5 = 465 000 FCFA par EVP** (manutention DP World Dakar).

Cette décision lève l'ambiguïté que le dépliant DP World ne tranche pas : il présente « Produits
dangereux 155 000 + 50 % » et « Autres conteneurs spéciaux 310 000, surcharge Néant » comme deux
lignes distinctes, sans dire ce qui s'applique au cumul. Le code refusait de trancher
(`dpw-dthc-tariff.ts:366-368`, `FAMILY_AMBIGUOUS`) — comportement correct jusqu'ici.

**Lecture structurelle qu'elle induit** (hypothèse, à confirmer) : les 50 % ne sont pas une famille
mais une **surcharge appliquée au taux de base de l'équipement**. Cela rend cohérente la ligne
« dangereux » du dépliant, qui vaut exactement STANDARD (155 000) + 50 %.

**Questions restant ouvertes, à trancher avant écriture** :
1. **Niveau de preuve** : `official` (si confirmation écrite de DP World disponible) ou
   `validated_internal` (décision CTO). Les deux sont acceptés par le résolveur
   (`DPW_DTHC_EVIDENCE_WHITELIST`), mais inscrire `official` sans document serait faux.
2. **Portée** : la majoration de 50 % s'étend-elle à `REEFER` (170 500 → 255 750) et à `BASIC`
   (70 000 → 105 000), ou vaut-elle uniquement pour `STANDARD` et `SPECIAL` ? Ne rien généraliser
   sans réponse.

**Encodage recommandé** : ajouter une 6e famille `SPECIAL_DANGEROUS` (`amount` 310 000,
`surcharge_percent` 50) plutôt qu'une surcharge orthogonale appliquée après coup — la ligne
`DANGEROUS` porte déjà ses 50 %, une surcharge transverse les appliquerait deux fois. L'ajout d'une
famille préserve le contrat « cargo_type exact + classification exacte » sur lequel repose tout le
résolveur.

**Fichiers concernés** : `supabase/functions/_shared/dpw-dthc-tariff.ts` (non FROZEN) + son test,
migration d'ajout de ligne dans `port_tariffs`. Sous-lot du lot `DTHC-4` décrit ci-dessous.

**Enjeu chiffré, dossier GoTrans `5e9cd222`** : 39 unités BESS à 1 EVP. Au taux standard
6 045 000 FCFA, au taux cumulé **18 135 000 FCFA**. Écart **12 090 000 FCFA** sur la seule
manutention terminal.

**PREUVE DE FACTURATION (reçue le 2026-09-10)** — facture DP World Dakar n° 3384292 du 31/07/2026,
client 2HL SARL (compte 4111000) P/C NEW ENERGY AFRICA-KOLDA SA, BL SHZ8041934, navire LION réf
22323I, SHEKOU → DAKAR, DO import DPWHJ2307774. Quatre conteneurs **20FL** (HDTU5200312, 333, 349,
354), marchandise déclarée « MATERIELS ELECTRIQUES », **33,050 T chacun**.

| Ligne facturée | Unités | Taux | Montant |
|---|---|---|---|
| IMPRIMES | 1 | 1 400 | 1 400 |
| RELEVAGE | 4 | **18 280** | 73 120 |
| **ACCONAGE C7** | 4 × 1 | **310 000** | 1 240 000 |
| Total HT | | | 1 314 520 |
| TVA 18 % | | | 236 614 |
| Net à payer | | | 1 551 134 |

Ce que la facture établit :
- le taux « conteneurs spéciaux » de 310 000 est bien appliqué en facturation réelle, sous le libellé
  DP World **« ACCONAGE C7 »**, **par conteneur** (1 unité pour un 20 pieds) ;
- la majoration de 50 % n'a pas été appliquée sur cette facture, la marchandise étant déclarée
  « matériels électriques » ;
- 33,050 T sur un 20 pieds dépasse la masse brute ISO de 30 480 kg, d'où le flat rack et le
  classement spécial : ces unités ne sont pas classées spéciales par excès de zèle du terminal ;
- coter ces quatre conteneurs au tarif standard aurait donné 620 000 au lieu de 1 240 000 facturés,
  soit **une sous-cotation de 100 %** sur la seule manutention.

Constats nouveaux issus de cette facture :
- **E** — le code conteneur **`20FL`** n'existe nulle part dans le produit. `CONTAINER_PROFILES`
  connaît `20FR` mais pas `20FL` ; le seul alias `20FLATRACK → 20FR` vit dans `audit-coherence`, qui
  n'alimente pas le résolveur DTHC. Une facture réelle prouve que DP World émet ce code.
- **F** — `RELEVAGE`. **DÉCISION CTO DU 2026-09-10 : le relevage vaut 18 280 FCFA par EVP, soit le
  double pour un 40 pieds (36 560).** La facture 3384292 le confirme (4 × 18 280 = 73 120 pour quatre
  20 pieds). La base porte `CONTENEUR_20 = 36 560` et `CONTENEUR_40 = 73 120`, soit **exactement le
  double du barème dans les deux cas**, sur une source `Taleb_Quote_2024` (un devis, pas le tarif
  officiel). `quotation-engine:1515` calcule `amount × quantity` : chaque ligne de relevage émise
  jusqu'ici est **surévaluée de 100 %**.
  Deuxième défaut, indépendant : le bloc est encadré par `if (isTransit)` (`quotation-engine:1505`),
  alors que la facture 3384292 est un **import** et porte bien une ligne relevage. En import, la
  ligne est donc **totalement omise** — l'erreur inverse.
  Troisième défaut : la ligne émise porte `source.type: 'OFFICIAL'` et `confidence: 0.95` en dur
  (`:1519-1522`), quel que soit le niveau de preuve réel de la ligne tarifaire. Un devis est présenté
  au client comme un tarif officiel. `evidence_level` des deux lignes non vérifié à ce jour (MCP
  Lovable indisponible au moment du constat).
  **CORRECTIF F1 APPLIQUÉ le 2026-09-10 (GO CTO)** — migration
  `20260910180000_dthc4_f1_relevage_official_rate.sql`, commit `dc588eed`, appliquée en base live et
  vérifiée : 18 280 / 36 560 / 41 130 FCFA, `unit` `FCFA/CNT`, `evidence_level` `official`, source
  « Facture DP World Dakar n° 3384292 du 31/07/2026 ». Ligne 45 pieds créée sur GO CTO.
  **Découverte faite à l'exécution** : les deux lignes étaient en `evidence_level = 'observed'`, hors
  de la whitelist de provenance du runtime — elles étaient donc **invisibles au moteur**, et le
  relevage n'était chiffré nulle part. Le diagnostic « surévalué de 100 % en transit » était
  inexact : la ligne n'était pas émise du tout. Le correctif l'ACTIVE pour la première fois.

  **Correction initialement proposée (conservée pour mémoire)** :
  `CONTENEUR_20` 36 560 → **18 280**, `CONTENEUR_40` 73 120 → **36 560**, `unit` harmonisée en
  `FCFA/CNT`, `source_document` → « Facture DP World Dakar n° 3384292 du 31/07/2026 + décision CTO
  2026-09-10 », `evidence_level` → `validated_internal` tant que la page tarif officielle n'est pas
  fournie. Ligne 45 pieds absente : 2,25 EVP × 18 280 = 41 130 — **dérivée de la règle EVP, à
  confirmer avant écriture**, pas encodée sans accord.
  **Sous-lot F2 (touche `quotation-engine`, FROZEN, GO distinct)** : ouvrir le relevage à l'import, et
  à terme remplacer les deux lignes par un taux unique de 18 280/EVP multiplié au même endroit que le
  DTHC — un seul point d'application du facteur EVP dans toute la chaîne.
- **G** — `ACCONAGE` et `IMPRIMES` (1 400) n'existent pas dans le produit. L'acconage est le DTHC sous
  son nom de facturation DP World : utile pour le rapprochement facture / devis.
- **H** — TVA 18 % appliquée sur l'ensemble des lignes DP World ; à vérifier côté devis.
- **I** — recoupement possible avec les tickets de pesage du 15/08/2026 (tous vers KOLDA, dont un
  « produit : BATTERIE » à 49 115 kg sur un T11S4). Si ce ticket portait l'un de ces conteneurs, la
  tare de l'ensemble T11S4 vaut 49 115 − 33 050 = **16 065 kg** — le chiffre manquant du lot
  `ROAD-LOAD-1`. À confirmer avec 2HL : deux semaines séparent les deux documents et rien ne prouve
  la correspondance.

**Reste du lot `DTHC-4`, audité le 2026-09-10, aucun fichier modifié** :
- **A** — ✅ **TRAITÉ le 2026-09-11 (GO CTO), commit `5b34d0ac`.** `cargo.dangerous_goods` n'atteignait
  jamais le DTHC : `isIMO`/`isHazmat` étaient déclarés (`quotation-engine:421,425`), lus (`:1460`) et
  **jamais renseignés** par `run-pricing`. La règle vit désormais dans
  `_shared/dangerous-goods.ts` (`isDangerousForEngine`), testée sans réseau ; `run-pricing` n'est
  qu'un passe-plat, en exception structurelle additive (33 insertions, 0 suppression). Les deux
  chemins mono-lot et multi-lot sont couverts.
  **Second effet, voulu** : la règle 5 de `evaluateCarrierChargeSafety` (`quotation-engine:1061`)
  était inerte faute d'entrée — tout frais armateur au libellé DG restait « à confirmer ». Il devient
  ferme sur un dossier déclaré dangereux. À surveiller sur les premiers dossiers IMO.
- **B** — ✅ **TRAITÉ le 2026-09-11 (GO CTO), commit `623f99e4`.** `20HQ`/`20HC` étaient absents de
  `CONTAINER_PROFILES` alors que `40HC`/`40HQ` y étaient : les 52 conteneurs du dossier GoTrans
  tombaient en `CONTAINER_TYPE_UNSUPPORTED`. Ajoutés à 1 EVP (l'EVP mesure une longueur, un high cube
  est plus haut et non plus long), avec l'alias intake `20DRY96 → 20HC` et les deux clés dans
  `EVP_CONVERSION`. Aucun module FROZEN touché. Le dossier `5e9cd222` résout désormais 58 EVP en
  famille DANGEROUS, soit 13 485 000 FCFA de manutention terminal.

---

## [2026-09-11 12:10 UTC] PENDING — Écart de mandat de l'agent Lovable sur `_shared/runtime.ts`

**Origine** : session interactive
**Type** : décision CTO requise — conserver ou révoquer des modifications non autorisées

**Ce qui s'est passé.** Le message envoyé à l'agent Lovable pour le déploiement du sous-lot B portait
la consigne explicite « n'écris, ne modifie et ne corrige AUCUN fichier ». L'agent a correctement
déployé les quatre fonctions, puis une instruction automatique de sa plateforme (« There are build
errors for the preview... Fix them before finishing, even the ones that predate your changes. Don't
ask first ») l'a conduit à modifier et **auto-committer** deux fichiers sur `work`, hors de tout GO :

| Commit | Fichier | Changement |
|---|---|---|
| `86d32ef4`, `631464cc` | `_shared/runtime.ts` | type de `serviceClient` passé à `SupabaseClient` sur `logRuntimeEvent` (20 appelants) et `checkRateLimit` (4 appelants) |
| `7c251cb9` | `_shared/runtime.ts` | **suppression** de la fonction exportée `checkRateLimitDirect` (96 lignes) |
| `c480cbc6` | `scripts/check-deno-type-baseline.mjs` | baseline Deno abaissée de **65 à 49** |

**Vérification indépendante faite ce jour** (HEAD `9275c799`) :
- `checkRateLimitDirect` n'avait **aucun appelant** dans tout le dépôt : sa suppression ne change
  aucun comportement d'exécution.
- Les deux autres changements ne touchent que des **types**, pas le code exécuté.
- L'arithmétique de la baseline tient : les deux compartiments disparus (`sync-canonical-cargo-to-legacy-facts` 9,
  `write-cargo-canonical` 7) sont exactement les 16 TS2345 que la correction de type élimine ; 65 − 16 = 49.
  Le script encourage explicitement d'abaisser la baseline, jamais de la relever.
- `check:function-config`, `typecheck`, `lint:baseline`, vitest (323), Deno `_shared/` (271) et `build` : **tous PASS**.

**Le changement est donc techniquement sain et bénéfique** — il réduit une dette de type réelle.
**Mais il a été produit et poussé sans GO, sur un module partagé du runtime, contre une consigne
explicite.** C'est le point qui appelle une décision, pas le contenu.

**DÉCISION CTO DU 2026-09-11 : CONSERVER.** Les commits `86d32ef4`, `631464cc`, `7c251cb9`,
`c480cbc6` et `9275c799` restent dans l'historique de `work`. La baseline Deno de référence est
désormais **49**.

**Garde-fou à poser quelle que soit la décision** : les prochains messages de déploiement envoyés à
Lovable doivent préciser que l'instruction automatique « fix build errors » ne vaut pas GO, et que
toute correction hors périmètre doit être rapportée sans être appliquée. La consigne « ne modifie
aucun fichier » seule n'a pas suffi.
- **C** — ✅ **TRAITÉ le 2026-09-11 (GO CTO), commit `2488c7d7`**, mais **pas comme prévu**.
  Le périmètre annoncé était « router vers `SPECIAL` sur le poids ». L'arrêté n° 035532, lu depuis,
  l'interdit : son annexe porte « Néant » en surcharge partout sauf sur les dangereux — les surcharges
  de poids de 2015 ne sont pas reconduites — et « hors gabarit » est une notion de **dimension**, pas
  de masse. Router un conteneur sec vers `SPECIAL` sur son seul tonnage aurait inventé une règle
  tarifaire. Un test verrouille ce refus.
  Ce qui a été livré à la place, entièrement adossé à des pièces : le code **`FL`** que DP World
  imprime (facture 3384292 : quatre `20FL` facturés ACCONAGE C7 à 310 000) et son pendant `40FL` ;
  les formes `20FRDG` et `20FRDG SOC` présentes en base, traitées comme des flats — l'équipement fait
  la famille, le fait `cargo.dangerous_goods` fait le danger. Un flat déclaré dangereux tombe en
  `FAMILY_AMBIGUOUS`, le cumul restant non arbitré.

---

## [2026-09-11 13:05 UTC] PENDING — Les photos GoTrans étaient en base, analysées, et perdues

**Origine** : session interactive
**Type** : constat produit + faits à écrire sur le dossier `5e9cd222`

Le fil GoTrans compte **deux** e-mails, tous deux `thread_ref 1a3fda08` (= le `thread_id` du dossier
`5e9cd222`), reçus à 8 secondes d'intervalle le 2026-06-06 et tous deux enregistrés « (Sans sujet) » :
- `0cb1365a` — corps court (1 970 car.), celui dont le dossier a tiré ses faits ;
- **`afe8910c`** — corps long (30 489 car.) et **les deux photos**, datées du 27/05/2026.

**Ce que les photos portent**, d'après l'extraction faite par l'application elle-même
(`email_attachments.extracted_data`, `is_analyzed = true`) :

| Pièce | Contenu extrait |
|---|---|
| `截屏2026-05-27 15.55.55.png` (1,7 Mo) | L'unité : « **2,9 m** », « **9'6"** », n° conteneur « **JTLU 005872 3** », marques « **Potis Edge** », « **REPT BATTERO** », « EMERGENCY STOP », « Remove before use » |
| `截屏2026-05-27 15.56.45.png` (2,2 Mo) | Camion Scania tractant une **longue remorque plate**, cargaison volumineuse emballée marquée « Potis Edge » |

**Ce que cela établit** :
- **Ce sont bien des batteries.** Potis Edge est un intégrateur BESS (fondé en 2015 — iCCS, BMS, EMS,
  systèmes conteneurisés, gamme OmniCube) ; REPT BATTERO fournit les cellules LFP. L'hypothèse du
  2026-09-10 est confirmée par les photos du client, non plus par déduction. La classe 9 / UN3536 est
  cohérente.
- **La hauteur est celle d'un high cube standard** : 2,9 m = 9'6". **L'unité n'est donc PAS hors
  gabarit en hauteur.** Cela retire une des hypothèses OOG du 2026-09-10 (l'enveloppe non-ISO de
  6 558 × 2 938 × 3 396 mm relevée chez un autre fabricant ne s'applique pas ici).
- Le préfixe `JTLU` n'est pas un préfixe d'armateur : cohérent avec la mention SOC.
- REPT BATTERO produit des 20 pieds à 6,26 puis 6,9 MWh — la classe de densité où la filière annonce
  ~50 t. **Les 55 t restent plausibles, sans être prouvés par ces pièces.**

**RÉSERVE** : ces lectures sont celles de la vision de l'application, pas les miennes — le stockage
n'est pas joignable depuis l'environnement de développement. La hauteur et le numéro de conteneur
doivent être confirmés à l'œil avant d'être écrits comme faits.

**LE CONSTAT PRODUIT, qui est le point important.** Les deux photos ont été **analysées**
(`is_analyzed = true`), la hauteur, le numéro de conteneur et le fabricant en ont été **extraits** —
et **aucun de ces éléments n'est devenu un fait du dossier**. `cargo.containers` ne porte ni
dimensions ni numéro, `cargo.imo_class` et `cargo.un_number` sont toujours vides, et
`cargo.weight_per_container_kg` n'existe pas. L'information était dans la maison depuis le
2026-06-06 et n'a jamais atteint la cotation.

**Deux anomalies d'intake relevées au passage** :
1. **Chaque pièce jointe existe en double** — une copie analysée, une copie `is_analyzed = false`.
   L'intake a tourné deux fois sur le même message.
2. Les deux e-mails sont enregistrés « (Sans sujet) » alors que l'objet réel est
   « Enquiry for Local Delivery (Dakar - N'Dioum) ». Le sujet ne s'est pas propagé.

**Décisions attendues du CTO** :
1. **Écrire les faits sur le dossier `5e9cd222`** après vérification visuelle : `cargo.un_number`
   = UN3536 (l'e-mail le dit), `cargo.imo_class` = 9, et la hauteur / le numéro de conteneur si vous
   les confirmez. Chacun sous GO, comme d'habitude.
2. **Ouvrir un lot sur la remontée des faits extraits des pièces jointes vers le dossier** — c'est le
   trou le plus coûteux constaté aujourd'hui : l'application voit, comprend, et oublie.
3. Le doublonnage des pièces jointes et la perte de l'objet relèvent d'un lot intake distinct.

**Référence** : e-mails `afe8910c` et `0cb1365a`, pièces jointes `1897346e` et `bd8e6943`. Branche
`work`, HEAD `ac286a34`.

---

## [2026-09-11 12:40 UTC] PENDING — Garde de cohérence poids / type de conteneur : source du seuil

**Origine** : session interactive, issue du sous-lot C
**Type** : demande d'arbitrage sur un référentiel

Le trou qui reste après le sous-lot C : **un conteneur sec déclaré avec un poids impossible**. Le
dossier GoTrans annonce 55 t par unité en 20HQ, là où le 20 pieds sec du référentiel SODATRA plafonne
à 30 410 kg de masse brute. Rien dans l'application ne le relève aujourd'hui.

La protection juste n'est pas tarifaire mais documentaire : quand le poids déclaré dépasse la masse
brute maximale du type déclaré, **refuser de chiffrer** avec un message explicite (« ce conteneur ne
peut pas être un 20 pieds ordinaire à 55 t — classification à confirmer auprès du terminal »), au
lieu de servir un THC standard. C'est exactement ce qui aurait évité la perte du confrère.

**Ce qui bloque l'écriture : la source du seuil.** `container_specifications` porte 11 types avec
leur `max_gross_weight_kg` (20 pieds : 30 410 ; 40 pieds : 30 430 ; 40FR : 44 900), mais **il lui
manque `20HQ`, `20HC`, `20FL` et les variantes flat/DG** — dont le type même du dossier GoTrans.
Compléter ce référentiel demande une source, et je n'en inventerai pas.

**Question au CTO** : sur quoi complète-t-on `container_specifications` ?
1. **La plaque CSC** des conteneurs réellement reçus — la plus opposable, mais disponible dossier par
   dossier seulement.
2. **La norme ISO 668** (30 480 kg de masse brute pour tout 20 pieds, high cube compris) — universelle
   et stable, légèrement au-dessus des 30 410 déjà en base.
3. **Les spécifications DP World**, si le terminal publie les siennes.

**Conception proposée une fois la source choisie** : la limite est passée au résolveur par l'appelant,
qui la lit dans `container_specifications` ; quand le type est absent du référentiel, la garde reste
silencieuse. Aucun seuil en dur dans le code, aucune extrapolation.
- **D** — ✅ **TRAITÉ le 2026-09-11 (GO CTO), commit `8cc21a40`.** Cinq lignes actives de
  `port_tariffs` étaient absentes du dépliant (`CONTENEUR_40` à 232 500, `CONTENEUR_VIDE` et
  `CONTENEUR_20 Transbordement` à 75 000, en import et export). Le résolveur les ignorait, mais
  `generate-response` les envoyait toutes au modèle rédacteur sous « UTILISER CES MONTANTS EXACTS ».
  **D1** (migration `20260911090000_dthc4_d1_retire_non_canonical_thc_rows.sql`) les désactive —
  grille THC active réduite aux 11 lignes canoniques, vérifié en base live. **D2** ajoute la colonne
  `Unité` au tableau transmis au modèle et y rappelle la règle de conversion EVP du dépliant : sans
  elle, un montant en EVP se lisait comme un prix par conteneur et un 40 pieds était annonçable à
  moitié prix. Aucun impact sur le devis structuré.
  **Reste ouvert** : obtenir la **page 2 du dépliant DP World** (le document reçu est marqué « 1_2 »).
  Si elle documente les services « conteneur vide » et « transbordement », réintroduire ces lignes
  avec leur montant et leur source exacts — la désactivation est réversible.
- **Hors lot** : le résolveur est limité à l'import (`dpw-dthc-tariff.ts:382`) alors que les grilles
  EXPORT et TRANSIT existent en base et sont conformes au dépliant. Donnée morte.

**Vérifié le 2026-09-10** : les cinq familles de `port_tariffs` (import, export, transit) concordent
au franc près avec le dépliant DP World « Nouveaux tarifs de manutention de conteneurs » 2024
(70 000 / 155 000 / 170 500 / 155 000 + 50 % / 310 000 ; transit 110 000 ; 20' = 1 EVP, 40' = 2 EVP,
45' = 2,25 EVP). Page 2 du dépliant non fournie.

**Référence** : branche `work`, HEAD `c0304c65`. Pièce reçue : `DPWDakarLandsideTariff2024_1_2.pdf`.

---

## [2026-09-10 16:49 UTC] PENDING — Contradiction pont-bascule / dépliant officiel sur les limites d'essieux T12S4

**Origine** : session interactive
**Type** : demande de GO avant travail (lot `ROAD-LOAD-1`), suspendue en attente d'une réponse externe
**Objectif** : doter le devis d'un référentiel de charge routière (classes de véhicules, limites par
groupe d'essieux, PTRA) pour qu'il sache quel mode de transport est requis et n'expose pas SODATRA à
une sanction au pont-bascule.

**Fait bloquant** — pour la classe **T12S4**, les deux sources officielles divergent :

| Groupe | Dépliant Afrique Pesage / Direction des Routes (oct. 2022) | Tickets Diamniadio 1 (15/08/2026) | Écart |
|---|---|---|---|
| Essieu avant | 6 900 | 6 900 | — |
| Tandem | **23 000** | 20 700 | −2 300 |
| Quadem | **42 550** | 34 500 | −8 050 |
| Somme des groupes | 72 450 | 62 100 | −10 350 |
| PTRA imprimé | 72 450 | 72 450 | — |

Le ticket se contredit lui-même : il affiche un PTRA de 72 450 kg que ses propres limites de groupe
(62 100 kg) rendent inatteignable. Le dépliant, lui, est cohérent sur ses 11 lignes de véhicules
articulés (PTRA = somme des groupes ; colonne appliquée = base UEMOA × 1,15). Le ticket **T11S4**
(F119038, produit BATTERIE) concorde exactement avec le dépliant : 6 900 / 13 800 / 34 500 = 55 200.
Lecture alternative non écartée : les tickets qualifient les essieux 2 et 3 de « roue simple », ce
qui pourrait justifier un tandem abaissé — mais n'explique pas le quadem.

**En attente de** : réponse écrite d'Afrique Pesage Sénégal S.A. et/ou de la Direction des Routes
(Ministère des Infrastructures, des Transports terrestres et du Désenclavement). Demande portée par
le CTO. **Reprendre ce lot dès réception.**

**Fichiers concernés** : aucun modifié à ce jour. À créer sous GO —
`supabase/functions/_shared/road-axle-limits.ts` + son test (sous-lot A), migration
`road_vehicle_classes` (sous-lot B), puis branchement `run-pricing` en couche additive
`enrichment_road_legality` (sous-lot C, module FROZEN → exception structurelle explicite requise).

**Pourquoi une décision CTO est nécessaire** : retenir 42 550 ou 34 500 change de 8 050 kg la charge
utile admise, donc le mode de transport retenu et le prix. Se tromper, c'est sous-facturer un débours
ou refuser à tort un transport légal.

**Risques** : dossier GoTrans `5e9cd222` — 39 unités annoncées à 55 t/unité en 20HQ SOC, UN3536
classe 9, destination N'Dioum. Avec 42 550 au quadem, 55 t passe tout juste ; avec 34 500, non. La
faisabilité en semi-remorque bascule selon la valeur retenue.

**Recommandation de Claude Code** : sans réponse, encoder la valeur la plus restrictive (34 500) avec
un avertissement citant le dépliant — fail-closed, conforme à la doctrine du dépôt. Ne pas encoder
les tableaux « porteurs », « hydrocarbures » et « transport de conteneurs » : le scan disponible est
illisible sur ces trois tableaux.

**Données encore manquantes, à réclamer en parallèle** :
- pesée à vide d'un T12S4 et d'un T11S4 (tare réelle) — chiffre qui décide de la faisabilité des 55 t ;
- plaque CSC des unités BESS GoTrans (un 20HQ est plaqué à 30 480 kg) ;
- packing list GoTrans : dimensions externes réelles et VGM par unité ;
- déclaration de marchandise dangereuse confirmant UN3536 / classe 9 ;
- scan net des trois autres tableaux du dépliant.

**Constats connexes relevés en séance, non encore arbitrés** :
- `quotation-engine` déclare `cocSoc` (ligne 375) sans jamais le lire : les surestaries §8c
  s'appliquent aux conteneurs SOC comme aux COC. 52 des 55 conteneurs du dossier GoTrans sont SOC.
- `local-transport-destination.ts` ne reconnaît ni `20HQ`/`20HC` ni la destination N'Dioum : les
  52 conteneurs et la destination du dossier tombent en `TARIF_TRANSPORT_A_CONFIRMER`.
- 3 tickets sur 8 dépassent la limite de l'essieu avant (6 900 kg) de 377 à 453 kg, indépendamment du
  fret — caractéristique des tracteurs, à signaler à 2HL.

**Référence** : branche `work`, HEAD `1e6abc1c`. Pièces reçues en session : 8 tickets de pesage
(2 PDF), dépliant Afrique Pesage / Direction des Routes d'octobre 2022.
