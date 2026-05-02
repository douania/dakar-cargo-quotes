# BACKLOG DIFFÉRÉ — DAKAR CARGO QUOTES

Source de vérité unique de tous les sujets volontairement reportés, laissés dormants, acceptés comme dette, ou déplacés à une phase ultérieure.

Dernière mise à jour : 2026-05-02 — **LOT2-REV-B+C** : bypass transport corrigé dans `quotation-engine/index.ts` — filtre `.in('evidence_level', ['official', 'validated_internal'])` ajouté, les lignes `to_confirm` ne sont plus servies comme OFFICIAL. LOT2-REV-B = `audit_complete_document_non_retrouve` (document source physique introuvable). LOT2-REV-C = `a_faire` (pending official transport document). INFRA-PUBLISH-VITE-ENV-001 inchangé (`preview_ok_publish_non_testable_projet_non_publie`). LOT2-REV-A rappel : 81 lignes Aksa quarantinées. INFRA-PREVIEW-AUTH-FETCH-001 CLOS.

Mise à jour antérieure : 2026-04-28 (INFRA-PUBLISH-VITE-ENV-001 cause racine **identifiée et confirmée par le support Lovable** : `.env` ajouté à `.gitignore` par un outil externe, ce qui empêche Lovable Cloud de versionner le fichier et donc d'injecter les `VITE_*` au build Preview/Publish. Correctif documenté : retrait ligne `.env` du `.gitignore` + création `.env.example` + garde sécurité « variables `VITE_*` publiques uniquement dans `.env`, jamais de secret backend ». Patch `.gitignore` à appliquer manuellement par l'opérateur — `code--line_replace` refuse `.gitignore` en écriture côté sandbox agent. Voir `docs/audits/INFRA-PUBLISH-VITE-ENV-001-evidence.md` § 8.)

Mise à jour antérieure : 2026-04-27 (INFRA-PUBLISH-VITE-ENV-001 périmètre élargi : `VITE_*` absentes du bundle publish confirmé 2026-04-25 par grep, et absentes au runtime preview directe hors iframe confirmé 2026-04-27 par affichage du guard `Configuration manquante` en navigation privée Edge InPrivate sans extension. INFRA-PREVIEW-AUTH-FETCH-001 ouvert puis INVALIDÉ comme ticket autonome / cause principale même journée — symptôme englobé par INFRA-PUBLISH-VITE-ENV-001. EDGE-BUILD-DENO-DEPS-001 distinct et corrigé via `supabase/functions/deno.json`.)

Mise à jour antérieure : 2026-04-25 (INFRA-PUBLISH-VITE-ENV-001 ouvert : écran noir production observé sur le bundle publié — variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` absentes du bundle servi. Mitigation fail-fast appliquée via `src/integrations/supabase/guard.ts`. Cause racine à confirmer parmi H1–H4 après republish — voir entrée dédiée).

---

## INFRA-PUBLISH-VITE-ENV-001 — Écran noir production : variables Supabase absentes du bundle publié

| Champ | Valeur |
|-------|--------|
| **ID** | INFRA-PUBLISH-VITE-ENV-001 |
| **Catégorie** | Infrastructure / Build / Publish Lovable |
| **Statut** | `preview_ok_publish_non_testable_projet_non_publie` (2026-05-02 — Preview fonctionne : login SODATRA s'affiche, guard ne se déclenche pas, variables `VITE_*` injectées correctement en preview. Publish **volontairement non testé** : l'application n'est pas publiée (`published_url: null`, ancien domaine `dakotation-pro.lovable.app` retourne HTTP 404). Aucun diagnostic publish à relancer tant que l'opérateur ne décide pas de republier. **Prochaine action** : relancer le diagnostic publish uniquement si décision de republier.) |
| **Cause racine confirmée** | `.env` listé à la ligne 26 du `.gitignore` (ajout par outil externe). Dans le modèle Lovable Cloud, `.env` est un fichier **versionné** dans le repo (différent d'un CI/CD type Vercel/Netlify) ; Vite l'inline au build-time. L'exclure du repo casse l'injection. Source : support Lovable (Sam, AI Support Agent, 2026-04-28). |
| **Correctif** | (1) Patch chirurgical `.gitignore` : retrait de la ligne `.env`, conservation de `.env.local` et `.env.*.local`, ajout commentaire d'avertissement. (2) Création `.env.example` à la racine (3 vars `VITE_*`, valeurs vides). (3) Garde sécurité non négociable : `.env` versionné **uniquement** s'il contient `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` — aucun secret backend (`SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, etc.) ne doit s'y trouver. **Action manuelle opérateur requise** : le sandbox agent refuse `.gitignore` en écriture ; le patch doit être appliqué via éditeur Lovable ou commit GitHub direct. |
| **Priorité** | P0 si récurrent, sinon P2 |
| **Phase d'origine** | Hors phase — incident production 2026-04-25 |
| **Constat runtime** | (1) Publish 2026-04-25 — site publié `https://dakotation-pro.lovable.app` : écran noir total sur toutes les routes, `Error: supabaseUrl is required.` au top-level de `createClient()` dans `src/integrations/supabase/client.ts`, `curl` + `grep` sur le bundle servi confirment que l'URL Supabase n'est pas embarquée → `VITE_*` **absentes du bundle publish confirmé par grep**. React ne monte jamais. (2) Preview directe hors iframe 2026-04-27 — `https://id-preview--c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef.lovable.app` ouverte directement (hors iframe Lovable Editor) en Edge InPrivate sans extension : guard `Configuration manquante` affiché listant `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`, React ne monte pas, aucune requête Supabase Auth émise → `VITE_*` **absentes au runtime preview directe confirmé par le guard** (capture du bundle preview non réalisée par grep, l'évidence preview reste runtime). Le périmètre n'est plus limité au build publish : la preview directe hors iframe est aussi affectée. |
| **Observation complémentaire** | La preview Lovable a aussi présenté l'écran noir, qui s'est "réveillée" après envoi d'un message dans le chat. Cela élargit l'hypothèse au-delà du seul build publish. |
| **Hypothèses cause racine (à discriminer)** | (H1) Variables `VITE_*` non injectées au build publish. (H2) Bundle stale / non reconstruit après publication antérieure. (H3) Lifecycle preview Lovable : variables réinjectées seulement après interaction chat. (H4) Cache CDN / asset / infra Lovable. |
| **Mitigation appliquée** | Nouveau fichier `src/integrations/supabase/guard.ts` importé en première ligne de `src/main.tsx`. Vérifie au boot la présence de `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. Si absentes : panneau d'erreur lisible (DOM APIs, sans React, sans `innerHTML`) + `console.error` + `throw`. Si présentes : no-op pur. Transforme un écran noir opaque en signal exploitable. |
| **Fichiers interdits respectés** | `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, `.env`, `supabase/config.toml` — tous non touchés. Aucune migration, edge function, RLS. Aucun hardcoding de clé. |
| **Plan de discrimination post-republish** | (1) Vérifier que le hash du bundle change (sinon : H2/H4). (2) `curl` + `grep snjewofqxfsdmaszapux` sur le nouveau bundle (présent → injection OK ; absent → injection KO). (3) Test navigateur sur `/`, `/login`, `/case/03ccf66d-...`. (4) Si guard s'affiche : injection `VITE_*` défaillante au runtime ; discriminer ensuite H1/H4 selon hash bundle et grep (H4 si bundle neuf + Vite a tourné mais variables non exposées au build, H1 si pipeline publish ne transmet pas les variables au build). (5) Si écran noir persiste sans guard : problème JS/asset/routing en amont. (6) Si preview redevient noire sans interaction chat : H3 confirmée. (7) Test preview directe hors iframe en navigation privée : si guard affiché → injection `VITE_*` défaillante côté preview Lovable elle-même, pas seulement publish (constat 2026-04-27 confirme ce cas). |
| **Déclencheur de réouverture / clôture** | Clôture après application de la grille de discrimination ci-dessus et identification formelle de la cause racine. Réouverture à toute récurrence d'écran noir post-publish. |
| **Garde-fou gouvernance** | Ne pas clôturer sur la seule base "vars absentes du publish". Si H1 ou H3 confirmée → escalade support Lovable, pas de workaround côté code (jamais de hardcoding des clés Supabase dans le bundle). |

---

## INFRA-PREVIEW-AUTH-FETCH-001 — Failed to fetch sur Supabase Auth depuis la preview Lovable

| Champ | Valeur |
|-------|--------|
| **ID** | INFRA-PREVIEW-AUTH-FETCH-001 |
| **Catégorie** | Infrastructure / Preview Lovable |
| **Statut** | **CLOS — résolu par redémarrage backend Lovable Cloud** (2026-05-01). Voir `docs/audits/INFRA-PREVIEW-AUTH-FETCH-001.md` § 8. |
| **Phase A (2026-04-27)** | Diagnostic initial invalidé comme cause principale : preview directe hors iframe bloquée par le guard `VITE_*` avant toute requête Auth. L'erreur `Failed to fetch` observée dans l'iframe Lovable Editor n'était pas représentative. |
| **Phase B (2026-05-01)** | Après correction `.gitignore` (`.env` non exclu), un vrai `Failed to fetch` au login a été observé avec `VITE_*` présentes. Cause réelle confirmée par Lovable Support : backend Lovable Cloud unhealthy (HTTP 521 / refus de connexion DB). Résolu par redémarrage DB côté Lovable. Login fonctionne. |
| **Cause réelle finale** | Backend Lovable Cloud unhealthy / HTTP 521 / refus DB |
| **Correctif applicatif requis** | Aucun |
| **Renvoi** | Voir `INFRA-PUBLISH-VITE-ENV-001` pour le volet `.env` / `.gitignore` (distinct). |
| **Garde-fou** | Si récurrence `Failed to fetch` avec `VITE_*` présentes dans le bundle → vérifier d'abord l'état du backend Lovable Cloud avant d'investiguer le code. |

---

## LOT2-SMOKE-RUNTIME-EXEC — Exécution runtime des smoke tests G6–G9

| Champ | Valeur |
|-------|--------|
| **ID** | LOT2-SMOKE-RUNTIME-EXEC |
| **Catégorie** | Validation runtime / Smoke tests |
| **Statut** | `pending_user_execution` |
| **Priorité** | P0 (clôture Lot 2) |
| **Phase d'origine** | TARIFF-PROVENANCE Lot 2 (2026-04-25) |
| **Constat** | Le sandbox de l'agent ne peut ni invoquer `run-pricing` (HTTP 401, pas de service-role), ni exécuter des scripts SQL transactionnels (méta-commandes `\set`/`\echo`, `BEGIN/COMMIT`, `ON_ERROR_STOP`) via les tools backend disponibles. Le CTO a explicitement refusé toute transcription en SQL pur non transactionnel (perte de la restauration atomique et du rollback en cas d'échec). |
| **Garde-fous techniques en place** | Scripts `scripts/lot2_smoke/03..04` réécrits id-safe : assertions `1 / CASE WHEN ... THEN 1 ELSE 0 END` (division par zéro réelle), `BOOL_AND(...)` au lieu de `MAX(uuid)`, transaction `BEGIN/COMMIT` + `ON_ERROR_STOP`, suppression strictement filtrée par `source_excerpt`, restauration par `baseline_fact_id` strict double-vérifié. |
| **Plan d'exécution** | (1) L'utilisateur exécute la séquence §7 du `LOT_2_REPORT.md` via vrai client `psql` ou SQL editor backend. (2) UUID `baseline_fact_id` à coller en dur dans le script 04 entre étapes 5 et 7. (3) Transmission de la sortie de `05_validate_results.sql` à l'agent. (4) L'agent finalise les verdicts G6–G9 dans `LOT_2_REPORT.md`. |
| **Déclencheur de réouverture / clôture** | Réception de la sortie du harness §05 → finalisation verdicts → clôture du Lot 2. |

---

## PORT-TARIFFS-NATURE-SPLIT — Séparation conceptuelle des natures dans `port_tariffs`

| Champ | Valeur |
|-------|--------|
| **ID** | PORT-TARIFFS-NATURE-SPLIT |
| **Catégorie** | Tariff governance / Schema |
| **Statut** | `deferred` |
| **Priorité** | P2 |
| **Phase d'origine** | TARIFF-PROVENANCE Lot 1 (2026-04-24) |
| **Constat** | La table `port_tariffs` héberge plusieurs natures métier distinctes : autorité portuaire (PAD), opérateur terminal (DPW), charges compagnies maritimes (Hapag), valeurs indicatives. Le Lot 1 a traité la **provenance** via `evidence_level`, pas la **nature**. La table reste hétérogène par construction. |
| **Recommandation** | Différer une refonte structurelle jusqu'à stabilisation des Lots 2 et 3. La gouvernance de provenance suffit à protéger le runtime. |
| **Déclencheur de réouverture** | Si un nouveau cas métier (ex: terminal alternatif, multi-port) rend l'hétérogénéité bloquante. |

---

## TARIFF-PROVENANCE-LOT2-AKSA — Isolation Aksa Energy & validation transport Sénégal

| Champ | Valeur |
|-------|--------|
| **ID** | TARIFF-PROVENANCE-LOT2-AKSA |
| **Catégorie** | Tariff governance / Client overrides |
| **Statut** | `ready` |
| **Priorité** | P0 commercial |
| **Phase d'origine** | TARIFF-PROVENANCE Lot 1 (2026-04-24) |
| **Constat** | Sur 91 lignes actives `local_transport_rates`, 81 sont spécifiques au client Aksa Energy (`evidence_level='client_override'`). Tant qu'elles vivent dans la table commune, elles sont matchables pour n'importe quel dossier. **Risque P0 commercial réel.** Les 10 lignes restantes (`TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS`) sont en `to_confirm` (candidates à officialisation, sous réserve de croisement avec `TARIF_TRANSPORT_ROUTIER.md`). |
| **Plan d'exécution** | (1) Sous-audit `pricing_client_overrides` : compatibilité colonnes, RLS, lecture déjà active runtime. (2) Décision documentée : réutiliser / étendre / créer si extension impossible. (3) Migration data : déplacer les 81 lignes Aksa vers la table cible avec rattachement `client_id`. (4) Filtre runtime : `price-service-lines` L878 + `quotation-engine` L1697 → `local_transport_rates` ne sert plus que `evidence_level='official'` ; overrides client lus séparément avec match `case.client_id`. (5) Croisement des 10 lignes restantes avec `TARIF_TRANSPORT_ROUTIER.md` → promotion `to_confirm` → `official` ligne par ligne. |
| **Déclencheur de réouverture** | Validation CTO Lot 2 + audit `pricing_client_overrides` complété. |

---

## TARIFF-PROVENANCE-LOT3-SODATRA-SERVICES — Refonte modèle services SODATRA

| Champ | Valeur |
|-------|--------|
| **ID** | TARIFF-PROVENANCE-LOT3-SODATRA-SERVICES |
| **Catégorie** | Tariff governance / Service modeling |
| **Statut** | `deferred` |
| **Priorité** | P2 (post-stabilisation Lots 1+2) |
| **Phase d'origine** | TARIFF-PROVENANCE Lot 1 (2026-04-24) |
| **Constat** | `pricing_service_catalogue` (11 lignes) modélise tous les services SODATRA en `pricing_mode=FIXED` sans dimensions métier (scope import/export/transit, freight_scope FCL/LCL/AIR, volume, régime douanier). Contournement actuel : `AGENCY` vs `AGENCY_TRANSIT` comme codes séparés. Frontière `pricing_service_catalogue` ↔ `pricing_rate_cards` floue. |
| **Qualification** | **Refonte métier**, pas extension technique. Impacte la frontière catalogue/rate cards, les packages (`EXPORT_SENEGAL`...), `service_quantity_rules`, et `price-service-lines`. |
| **Plan d'exécution** | (1) Atelier SODATRA : définition dimensions métier réelles. (2) Spec frontière catalogue ↔ rate cards. (3) Spec impact packages + règles de quantité. (4) Migration schéma + data progressive validée par SODATRA. (5) Refacto `price-service-lines`. |
| **Préconditions** | Lots 1 et 2 stabilisés. Signature SODATRA des dimensions cibles. |
| **Déclencheur de réouverture** | Atelier SODATRA planifié. |

---

## VALIDATED-INTERNAL-SUBLEVELS-SPLIT — Scinder `validated_internal` en deux sous-niveaux

| Champ | Valeur |
|-------|--------|
| **ID** | VALIDATED-INTERNAL-SUBLEVELS-SPLIT |
| **Catégorie** | Tariff governance / Provenance taxonomy |
| **Statut** | `deferred` |
| **Priorité** | P3 |
| **Phase d'origine** | TARIFF-PROVENANCE Lot 1 (2026-04-24) |
| **Constat** | Le niveau `validated_internal` recouvre deux réalités : (1) document fournisseur fiable (Hapag/CMA/ONE PDF) ; (2) validation interne SODATRA signée. Sous-cas volontairement non scindés au Lot 1 pour limiter le périmètre. |
| **Recommandation** | Évaluer le besoin métier après retour d'usage Lot 1. Si scission décidée : mise à jour CHECK constraint + reseed + pas d'impact runtime (les deux restent dans la whitelist). |
| **Déclencheur de réouverture** | Demande métier explicite ou cas d'audit nécessitant la distinction. |

---

## TARIFF-COLLECTION-CAMPAIGN — Campagne de collecte tarifaire SODATRA

| Champ | Valeur |
|-------|--------|
| **ID** | TARIFF-COLLECTION-CAMPAIGN |
| **Catégorie** | Documentation / Tariff governance |
| **Statut** | `in_progress` |
| **Priorité** | P1 |
| **Phase d'origine** | Post-Lot 4-A (2026-04-22) |
| **Date d'ouverture** | 2026-04-22 |
| **Objectif** | Préparer la collecte tarifaire SODATRA via grilles documentaires Markdown **avant toute injection en base**. Distinguer "valeur existante en base" de "validation SODATRA". |
| **Périmètre livré** | 11 fichiers `docs/tariff-collection/` : `TARIF_MASTER_INDEX.md`, `TARIF_AIR_IMPORT_DDP.md`, `TARIF_AIR_IMPORT_DAP.md`, `TARIF_SEA_LCL_IMPORT_DDP.md`, `TARIF_SEA_LCL_IMPORT_DAP.md`, `TARIF_EXPORT_SENEGAL.md`, `TARIF_TRANSPORT_ROUTIER.md`, `TARIF_FRAIS_COMPAGNIES_MARITIMES.md`, `TARIF_PORT_TERMINAL.md`, `TARIF_AEROPORT.md`, `TARIF_PARTENAIRES.md`. Colonnes communes : 26 champs incluant `Valeur existante en base`, `Validation SODATRA`, `Table cible future`, `Priorité`, `Impact si non renseigné`. Inventaire base read-only (snapshot 2026-04-22) intégré au master index. |
| **Garanties** | (1) Aucun runtime modifié ; (2) aucune migration DB ; (3) aucun tarif inventé ; (4) aucun changement UI / edge function / STATUS_REGISTRY / `.env` / `.gitignore` ; (5) respect mémoires `exact-official-tariffs-only`, `opaque-pricing-strategy`, `operator-in-the-loop-categorization-policy`, `pad-nomenclature-alignment-v2`, `outbound-email-governance-centralized-sender`. |
| **Lot futur** | `TARIFF-INGESTION-CAMPAIGN` (P1) — injection runtime des valeurs validées par SODATRA. À ouvrir uniquement quand les grilles sont remplies, relues et signées par l'équipe métier. |
| **Déclencheur de réouverture** | Grilles remplies, relues et validées par SODATRA → ouverture de `TARIFF-INGESTION-CAMPAIGN`. |
| **Recommandation** | Conversion optionnelle Markdown → Word/PDF (réunion) ou Excel/Google Sheet (saisie opérationnelle) à la main du métier. |
| **Version Excel livrée** | 2026-04-22 — `/mnt/documents/SODATRA_TARIFF_COLLECTION.xlsx` (12 onglets : Instructions + 11 grilles ; freeze panes + autofilter + mise en forme conditionnelle des statuts ; aucune valeur inventée — copie fidèle 1:1 des Markdown sources qui restent la source de vérité). |
| **Sous-lot anti-duplication v2 (2026-04-23)** | Stratégie minimale 3 blocs livrée sans réécriture des 11 grilles. **Bloc A** : 10 CSV figés exportés vers `/mnt/documents/SODATRA_VALIDATION_*.csv` (port_tariffs 98, carrier_billing_templates 59, pricing_customs_tiers 12, tax_rates 8, border_clearing_rates 6, destination_terminal_rates 10, demurrage_rates 35, demurrage_tiers 35, mali_transport_zones 17, service_quantity_rules 23). **Bloc B** : `docs/tariff-collection/VALIDATION_RATE_CARDS_AND_CATALOGUE.md` couvre `pricing_rate_cards` (35 lignes : 1 anomalie critique `TRUCKING import value=0/status=active` + 34 `to_confirm`) et `pricing_service_catalogue` (5 confirmés + 6 placeholders export à 0 XOF gérés par `EXPORT_PLACEHOLDER_SERVICE_KEYS` Lot 1-B). **Bloc C** : 4 services collectés via grilles existantes (`TARIF_AEROPORT.md` pour AIR_FREIGHT/AIR_HANDLING ; `TARIF_PARTENAIRES.md` pour PICKUP_ORIGIN/PRE_CARRIAGE). **Hors blocs** : `local_transport_rates` (91 lignes, couverture hétérogène) reporté en sous-lot dédié de `TARIFF-INGESTION-CAMPAIGN`. **Surcharges BAF/CAF/GRI** confirmées P2 (cf. ID `TARIFF-SURCHARGES-BAF-CAF-GRI` ci-dessous). Garde-fous : aucun fichier `src/`, `supabase/`, migration, `STATUS_REGISTRY`, `.env`, `.gitignore` modifié ; aucune des 11 grilles `TARIF_*.md` modifiée ; aucune nouvelle source de vérité parallèle. |
| **Déclencheur de réouverture v2** | Retour SODATRA sur les 10 CSV Bloc A + arbitrage Bloc B (anomalie `TRUCKING` + 34 lignes `to_confirm` + 6 placeholders export) + collecte Bloc C → ouverture de `TARIFF-INGESTION-CAMPAIGN`. |

---

## TARIFF-SURCHARGES-BAF-CAF-GRI — Surcharges saisonnières compagnies maritimes

| Champ | Valeur |
|-------|--------|
| **ID** | TARIFF-SURCHARGES-BAF-CAF-GRI |
| **Catégorie** | Tariff governance / Carrier surcharges |
| **Statut** | `deferred` |
| **Priorité** | P2 |
| **Phase d'origine** | TARIFF-COLLECTION-CAMPAIGN — sous-lot anti-duplication v2 (2026-04-23) |
| **Constat** | Les surcharges saisonnières compagnies maritimes (BAF, CAF, GRI, PSS, etc.) ne sont pas modélisées en base ni dans les grilles de collecte. |
| **Décision** | Reporté en P2. Aucun impact bloquant identifié sur les flux DAP/DDP/EXW couverts par le runtime actuel. |
| **Déclencheur de réouverture** | Réclamation client / partenaire sur surcharge appliquée hors devis, OU décision SODATRA d'industrialiser ces surcharges. |
| **Recommandation** | Modéliser dans une table dédiée `carrier_surcharges` avec dimension temporelle (effective_from/to) plutôt que dans `carrier_billing_templates`. |

---

## TARIFF-LOCAL-TRANSPORT-RATES-AUDIT — Audit ciblé `local_transport_rates`

| Champ | Valeur |
|-------|--------|
| **ID** | TARIFF-LOCAL-TRANSPORT-RATES-AUDIT |
| **Catégorie** | Tariff governance / Transport |
| **Statut** | `deferred` |
| **Priorité** | P2 |
| **Phase d'origine** | TARIFF-COLLECTION-CAMPAIGN — sous-lot anti-duplication v2 (2026-04-23) |
| **Constat** | Table `local_transport_rates` (91 lignes) à couverture hétérogène : ni assez stable pour validation ponctuelle Bloc A, ni anomalie ciblée pour Bloc B. Recouvrement potentiel avec lignes `TRUCKING` de `pricing_rate_cards`. |
| **Décision** | Sous-lot dédié reporté à `TARIFF-INGESTION-CAMPAIGN`, traité **après** retour SODATRA sur Blocs A et B. |
| **Déclencheur de réouverture** | Validation Blocs A/B par SODATRA → ouverture sous-lot `local_transport_rates` (audit doublons + harmonisation avec `pricing_rate_cards.TRUCKING`). |
| **Recommandation** | Avant industrialisation, croiser avec `pricing_rate_cards` pour décider d'une source unique (probable choix : `local_transport_rates` plus granulaire géographiquement). |

## Lot 4-A — DDP mono-lot provisional droits/taxes à confirmer

| Champ | Valeur |
|-------|--------|
| **ID** | LOT-4A-DDP-MONOLOT-PROVISIONAL |
| **Catégorie** | QQM / Pricing DDP / Snapshot integrity |
| **Statut** | `closed` |
| **Priorité** | P1 |
| **Phase d'origine** | Lot 4-A + 4-A-ter + 4-A-quinquies (2026-04-22) |
| **Date de clôture** | 2026-04-22 |
| **Périmètre livré** | (1) Un dossier DDP mono-lot sans `cargo.value` est désormais autorisé en devis **provisoire** (et plus en blocage dur). (2) Les droits/taxes sont matérialisés par une ligne dédiée `CUSTOMS_RESERVE` marquée `source.type === "TO_CONFIRM"` avec rendu PDF/email "À confirmer" (jamais "0 FCFA"). (3) Le total ferme exclut les éléments en réserve (`firmTotalPolicy: "excludes_reserved_items"`) et la version est qualifiée `provisional` avec reason `MISSING_CARGO_VALUE`. (4) Lot 4-A-quinquies : synchronisation UI — `QuotationVersionCard` se recharge automatiquement après création d'une nouvelle version via `PricingResultPanel`, sans rechargement de page (lift state up via `versionRefreshToken` au niveau `CaseView`). |
| **Validation PDF v2** | Capture validée 2026-04-22 : (a) badge `[v2]` visible ; (b) bandeau `DEVIS PROVISOIRE` ; (c) reason `Valeur marchandise en attente / Certains tarifs restent à confirmer` affichée ; (d) ligne droits/taxes = `À confirmer` (pas `0 FCFA`) ; (e) `TOTAL HT FERME (hors éléments en réserve) = 200 000 XOF`. |
| **Garanties** | (1) Snapshots historiques v1 (créés avant Lot 4-A-ter) **non réécrits** — voir `SNAPSHOT-V1-LOT4-LEGACY` ; (2) Aucun changement de calcul pricing ; (3) Aucune modification edge function `run-pricing` / `quotation-engine` ; (4) Aucune migration DB ; (5) Synchronisation UI sans `window.location.reload()` (refresh React local et traçable). |
| **Fichiers impactés (UI Lot 4-A-quinquies)** | `src/pages/CaseView.tsx`, `src/components/puzzle/PricingResultPanel.tsx`, `src/components/puzzle/QuotationVersionCard.tsx`. |
| **Hors périmètre** | Aucun fichier FROZEN modifié, aucune migration DB, aucun STATUS_REGISTRY, aucun `.env` / `.gitignore`. |

---

## SNAPSHOT-V1-LOT4-LEGACY — Snapshots v1 antérieurs au Lot 4-A-ter

| Champ | Valeur |
|-------|--------|
| **ID** | SNAPSHOT-V1-LOT4-LEGACY |
| **Catégorie** | Snapshot integrity / Historical data |
| **Statut** | `historical_note` (dette acceptée) |
| **Priorité** | P3 |
| **Phase d'origine** | Lot 4-A (2026-04-22) |
| **Date** | 2026-04-22 |
| **Constat** | Les versions `v1` créées avant l'application des patchs Lot 4-A / 4-A-ter conservent un rendu PDF ambigu (ligne droits/taxes pouvant apparaître à 0 ou sans réserve explicite) car leur snapshot a été figé avant l'introduction de la ligne `CUSTOMS_RESERVE` typée `TO_CONFIRM`. |
| **Décision** | **Ne pas réécrire les snapshots historiques** (principe d'immutabilité des snapshots respecté). Toute correction passe par la création d'une **nouvelle version** (v2, v3, …) qui hérite automatiquement des règles QQM en vigueur. |
| **Déclencheur de réouverture** | Demande métier explicite de back-correction d'un snapshot v1 historique pour un dossier client spécifique (à traiter au cas par cas, jamais en batch). |
| **Recommandation** | Documenter côté opérateur la consigne : "régénérer une nouvelle version" plutôt que tenter de corriger v1. |

---

## LOT4A-LINE12-ZERO — Lignes LINE_1 / LINE_2 affichées à 0 dans PDF v2

| Champ | Valeur |
|-------|--------|
| **ID** | LOT4A-LINE12-ZERO |
| **Catégorie** | PDF rendering / Pricing audit |
| **Statut** | `ouvert` (réserve non bloquante) |
| **Priorité** | P3 |
| **Phase d'origine** | Lot 4-A clôture (2026-04-22) |
| **Date** | 2026-04-22 |
| **Constat** | Sur le PDF v2 validé, les lignes `LINE_1` et `LINE_2` affichent encore un montant à `0`. Ces lignes **ne concernent pas** les droits/taxes DDP (qui sont correctement qualifiées `À confirmer` via `CUSTOMS_RESERVE`). |
| **Hypothèses** | Lignes correspondant potentiellement à : (a) services réellement gratuits (zero-rated légitime), (b) `no_match` non capté par la whitelist Lot 1, ou (c) placeholders catalogue résiduels hors scope export Lot 1-B. |
| **Hors périmètre Lot 4-A** | Le risque critique DDP "droits/taxes à 0" est corrigé. Cette réserve concerne d'autres typologies de lignes et fera l'objet d'un audit séparé si nécessaire. |
| **Déclencheur de réouverture** | Retour terrain opérateur ou client signalant une ambiguïté sur ces lignes spécifiques. |
| **Recommandation** | Audit ciblé sur le snapshot v2 réel (case_id du dossier de validation Lot 4-A) pour qualifier la nature de `LINE_1` / `LINE_2` : zero-rated légitime, no_match, ou placeholder. Décider ensuite d'étendre la whitelist `TO_CONFIRM` ou de masquer ces lignes en PDF. |

---

## Lot 1 — TO_CONFIRM export 0 XOF

| Champ | Valeur |
|-------|--------|
| **ID** | LOT-1-TO-CONFIRM-EXPORT |
| **Catégorie** | Pricing / Export signal |
| **Statut** | `closed` |
| **Priorité** | P1 |
| **Phase d'origine** | Lot 1 (2026-04-21) |
| **Date de clôture** | 2026-04-21 |
| **Périmètre livré** | Marquage `source.type === "TO_CONFIRM"` pour services export placeholder à 0 XOF. Whitelist : `THC_EXPORT`, `DOCUMENTATION_BL`, `VGM_WEIGHING`, `STUFFING_FACTORY`, `STUFFING_CFS`, `EMPTY_REPO`, `PORT_CHARGES`, `CUSTOMS_EXPORT`, `SEA_FREIGHT`. Déclenchement uniquement sur `pricingCtx.scope === "export"` + `no_match` + serviceKey whitelist. |
| **Garanties** | (1) `missing_quantity` non converti ; (2) `rate: null` préservé dans `price-service-lines` ; (3) Lignes restent dans `missing[]` (Option A — TO_CONFIRM ≠ résolu) ; (4) Audit DB préservé via `normalizeSourceForAudit` (TO_CONFIRM → no_match côté audit uniquement) ; (5) Runtime conserve `"TO_CONFIRM"` jusqu'au cockpit/PDF/email. |
| **Fichier impacté** | `supabase/functions/price-service-lines/index.ts` uniquement |
| **Hors périmètre** | Aucun fichier FROZEN modifié, aucune migration DB, aucun changement de montant, aucun changement PDF/email/version. |
| **Note non-bloquante** | Dette stylistique levée en Lot 1-B : la constante `EXPORT_PLACEHOLDER_SERVICE_KEYS` a été hissée au niveau module et est désormais accessible aux blocs catalogue et fallback. |

---

## Lot 1-A — Préservation `humanExplanation` TO_CONFIRM

| Champ | Valeur |
|-------|--------|
| **ID** | LOT-1A-HUMAN-EXPLANATION-TO-CONFIRM |
| **Catégorie** | Pricing / Operator UX |
| **Statut** | `closed` |
| **Priorité** | P2 |
| **Phase d'origine** | Lot 1-A (2026-04-21) |
| **Date de clôture** | 2026-04-21 |
| **Périmètre livré** | Court-circuit explicite dans `humanExplanation(pl)` pour préserver l'explication métier `"Tarif export à confirmer..."` au lieu d'un fallback trompeur de type `"Grille tarifaire : 0 FCFA"`. |
| **Fichier impacté** | `supabase/functions/price-service-lines/index.ts` uniquement |
| **Hors périmètre** | Aucun fichier FROZEN modifié, aucune migration DB, aucun changement de montant, aucun changement PDF/email/version, aucune modification de `normalizeSourceForAudit` ni de `missing[]`. |

---

## Lot 1-B — Catalogue 0 XOF export placeholders

| Champ | Valeur |
|-------|--------|
| **ID** | LOT-1B-CATALOGUE-PLACEHOLDER-EXPORT |
| **Catégorie** | Pricing / Export signal |
| **Statut** | `closed` |
| **Priorité** | P1 |
| **Phase d'origine** | Lot 1-B (2026-04-21) |
| **Date de clôture** | 2026-04-21 |
| **Périmètre livré** | Les entrées catalogue export `FIXED` à 0 XOF avec description normalisée `"tarif a confirmer"` ne sortent plus en `catalogue_sodatra` / confidence 0.95. Elles bypassent volontairement le catalogue et continuent vers les resolvers aval (transport rate, rate card, port tariff fallback) ; elles tombent en `TO_CONFIRM` (logique Lot 1) uniquement si aucun tarif réel n'est trouvé. |
| **Conditions strictes** | (1) `pricingCtx.scope === "export"` ; (2) `serviceKey ∈ EXPORT_PLACEHOLDER_SERVICE_KEYS` ; (3) `catalogueEntry.pricing_mode === "FIXED"` ; (4) `catalogueEntry.base_price === 0` ; (5) description normalisée (NFD + lowercase + trim) === `"tarif a confirmer"`. |
| **Garanties** | (1) `rate: null` préservé ; (2) `missing[]` conservé ; (3) `missing_quantity` inchangé ; (4) `CUSTOMS_EXPORT` à 300 000 XOF inchangé (non placeholder) ; (5) Imports inchangés ; (6) Aucun fichier FROZEN ; (7) Aucune migration DB ; (8) `normalizeSourceForAudit("TO_CONFIRM") → "no_match"` inchangé ; (9) `humanExplanation` Lot 1-A préservé. |
| **Fichier impacté** | `supabase/functions/price-service-lines/index.ts` uniquement (constante `EXPORT_PLACEHOLDER_SERVICE_KEYS` hissée au niveau module + helper `isTarifAConfirmer` + garde `isCatalogPlaceholder`). |
| **Hors périmètre** | Aucun fichier FROZEN modifié, aucune migration DB, aucun PDF/email/version, aucun import. |

---

## SEC-001 — Git hygiene : `.env` non protégé par `.gitignore`

| Champ | Valeur |
|-------|--------|
| **ID** | SEC-001 |
| **Catégorie** | Security / Git hygiene |
| **Statut** | `closed_pending_rotation_review` |
| **Priorité** | P1 |
| **Phase d'origine** | Lot 0 sécurisé (2026-04-21) |
| **Date d'ouverture** | 2026-04-21 |
| **Date de résolution snapshot** | 2026-04-21 |
| **État vérifié (snapshot ZIP courant)** | (1) `.gitignore` contient désormais `.env`, `.env.local`, `.env.*.local` (corrigé hors Lovable) ; (2) `.env` n'est plus présent dans le snapshot ZIP/repo courant ; (3) Correctifs runtime Lot 0 (`supabase/config.toml`, `src/pages/CaseView.tsx`, `supabase/functions/generate-response/index.ts`) appliqués et validés. |
| **Note de prudence** | `.env` ayant pu être visible dans l'historique Git public, un audit historique reste requis : `git log --all --full-history -- .env`. Si une clé sensible (service_role Supabase, secrets API tiers, mot de passe SMTP) a été exposée par un commit antérieur → **rotation immédiate obligatoire**. Si seul l'anon key Supabase + URL publique étaient présents → risque faible, rotation optionnelle. |
| **Condition de clôture définitive** | Audit historique Git effectué + rotation des clés sensibles exposées (le cas échéant) **OU** justification documentée d'absence de secret sensible dans l'historique. Tant que cette condition n'est pas remplie, le statut reste `closed_pending_rotation_review`. |
| **Recommandation** | Ne jamais lire, afficher, copier ou recréer `.env` depuis Lovable. L'audit historique et la rotation conditionnelle s'effectuent hors plateforme. |

---

## DEF-PKG-DDP-01 — Étendre packages DDP aux autres flows

| Champ | Valeur |
|-------|--------|
| **ID** | DEF-PKG-DDP-01 |
| **Catégorie** | Service packages / Incoterm-aware resolution |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | Micro-lot Package-DDP (2026-04-17) |
| **Date** | 2026-04-17 |
| **Déclencheur de réouverture** | Demande métier confirmée pour des dossiers DDP en `SEA_FCL_IMPORT`, `BREAKBULK_PROJECT` ou `IMPORT_PROJECT_DAP`. |
| **Recommandation** | Le micro-lot couvre uniquement `AIR_IMPORT`, `AIR_LCL_IMPORT` et `SEA_LCL_IMPORT`. Les autres flows resteront résolus en `_DAP` même sous incoterm DDP, par sécurité. À étendre uniquement sur déclencheur métier explicite. |

---

## DEF-PKG-DDP-02 — Différenciation services réelle DAP vs DDP

| Champ | Valeur |
|-------|--------|
| **ID** | DEF-PKG-DDP-02 |
| **Catégorie** | Service packages / Customs decomposition |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | Micro-lot Package-DDP (2026-04-17) |
| **Date** | 2026-04-17 |
| **Déclencheur de réouverture** | Besoin de décomposition customs au niveau package (ex: ligne dédiée droits/taxes incluse uniquement en DDP). |
| **Recommandation** | Aujourd'hui `_DDP` est strictement alias service-identique de `_DAP`. La sémantique DDP est portée par `routing.incoterm`, les blockers DDP et la logique customs/provisoire. Si un jour le pricing doit refléter la différence au niveau lignes de service, créer un vrai contenu différencié pour `AIR_IMPORT_DDP` / `LCL_IMPORT_DDP`. |

---

## DEF-PKG-DDP-03 — Backfill rétroactif des dossiers DDP historiques

| Champ | Valeur |
|-------|--------|
| **ID** | DEF-PKG-DDP-03 |
| **Catégorie** | Data backfill / Cohérence historique |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | Micro-lot Package-DDP (2026-04-17) |
| **Date** | 2026-04-17 |
| **Déclencheur de réouverture** | Besoin opérationnel de cohérence sur l'historique (reporting, audit métier, requêtes package-aware). |
| **Recommandation** | Aucun backfill automatique. Les dossiers DDP historiques conservent leur `service.package = AIR_IMPORT_DAP` figé. La correction s'applique uniquement aux nouveaux dossiers et aux rebuilds explicites via `build-case-puzzle`. À envisager un script de migration ciblée seulement si justifié par un besoin opérationnel. |

---

## SOURCE-GUARD-DEBT — Tagging systématique sender_role sur les emails

| Champ | Valeur |
|-------|--------|
| **ID** | SOURCE-GUARD-DEBT |
| **Catégorie** | Data provenance / Email pipeline |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | SOURCE-GUARD-1 + SOURCE-GUARD-2 |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | (1) Nouveaux domaines SODATRA ou partenaires non couverts par le domain matching. (2) Clients multi-domaines ou partenaires utilisant Gmail/Outlook. (3) Besoin de `fact_provenance` explicite et persisté dans `quote_facts`. |
| **Recommandation** | Implémenter un vrai champ `sender_role` (client/internal/partner) sur la table `emails` au moment de l'import (`sync-emails`). Cela remplacerait le domain matching heuristique de `classifyEmailProvenance()` par une classification persistée et fiable. À terme, ajouter un champ `fact_provenance` dans la chaîne d'extraction pour traçabilité complète. Le matching par domaine (SG-2) est prudent mais imparfait pour les cas multi-domaines. |

---

## FLOW-FIX-1 — Normalisation pays + inférence port Sénégal

| Champ | Valeur |
|-------|--------|
| **ID** | FLOW-FIX-1 |
| **Catégorie** | Flow detection / Routing |
| **Statut** | `done` |
| **Priorité** | Critique |
| **Phase d'origine** | FLOW-FIX-1 |
| **Date** | 2026-04-09 |
| **Déclencheur de réouverture** | (1) Étendre `COUNTRY_NAME_TO_ISO` en table DB pour maintenance sans redéploiement. (2) Étendre l'inférence port à d'autres pays mono-port (Gambie→Banjul, Guinée-Bissau→Bissau). |
| **Recommandation** | Map `COUNTRY_NAME_TO_ISO` (~45 pays) ajoutée inline dans build-case-puzzle. À terme, migrer en table `country_aliases` pour éviter les redéploiements. L'inférence port est strictement limitée aux flows maritimes import vers SN. |

---

## COCKPIT-11 — Scope fournisseur multi-postes

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-11 |
| **Catégorie** | Communication partenaire |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-11 |
| **Date** | 2026-04-09 |
| **Déclencheur de réouverture** | COCKPIT-11 Phase 2 — pré-création assistée de demandes multiples depuis le scope détecté |
| **Recommandation** | Helper déterministe `derivePartnerRequestScope`. Facts structurés prioritaires sur texte brut. 4 blocs détectés (freight, origin, stuffing factory, stuffing CFS). **11B livré** : agrégation multi-blocs avec déduplication. **11C livré** : PURPOSE_INCLUDES freight enrichi (8 items), origin_charges adapté SODATRA (sans customs clearance), promotion scope high/medium via `PROMOTION_LABELS`, `normalizeForDedup()` anti-doublons, `confidence ?? "medium"` backward compatible. **11D livré** : mapping cargo.containers (value_json) → clés synthétiques container_type/count/fcl_lcl, fallback value_number pour weight_kg/volume_cbm, support conteneurs hétérogènes, label "Poids total". Phase 2 : pré-création assistée de demandes multiples depuis le scope détecté. |

---

## PACKAGE-FILTER-1 — Filtrage contextuel des services compatibles

| Champ | Valeur |
|-------|--------|
| **ID** | PACKAGE-FILTER-1 |
| **Catégorie** | UI / Service packages |
| **Statut** | `done` |
| **Priorité** | Moyenne |
| **Phase d'origine** | PACKAGE-FILTER-1 |
| **Date** | 2026-04-09 |
| **Déclencheur de réouverture** | Ajout de nouveaux packages dans SERVICE_PACKAGES nécessitant une entrée dans PACKAGE_COMPATIBLE_EXTRAS |
| **Recommandation** | Whitelist explicite par package dans `helpers.ts`. Fallback sur `isServiceRelevant()` si package inconnu. TRUCKING exclu de EXPORT_SENEGAL (service destination). Évolution future possible : filtrage dynamique par facts corridor/pays. |

---

## COCKPIT-10 — Email partenaire professionnel

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-10 |
| **Catégorie** | Communication partenaire |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-10 |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | COM-1A — si le format email nécessite ajustement post envoi réel |
| **Recommandation** | Template déterministe partagé (src/lib + _shared). Variations par purpose. purpose_detail opérateur prioritaire. |

---

## COCKPIT-9 Phase 2 — Offre retenue opérateur

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-9-P2 |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-9-P2 |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | COM-1A — envoi réel des demandes partenaires |
| **Recommandation** | Migration is_selected/selected_at sur external_quote_requests. Edge function select-partner-request. Badge + bouton "Retenir" dans PartnerRequestsDetailView. Enrichissement de PartnerCollectionReadinessCard, NextActionBanner, PricingReadinessCard. |

---

## COCKPIT-9 Phase 1 — Suffisance de collecte partenaire

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-9-P1 |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-9-P1 |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | COCKPIT-9 Phase 2 — notion persistée d'offre retenue opérateur |
| **Recommandation** | Composant `PartnerCollectionReadinessCard` lecture seule. 2 queries. 4 verdicts (neutre/insuffisante/en cours/suffisante). Ligne "Offre retenue" placeholder. Placé au-dessus de PricingReadinessCard. |

---

## COCKPIT-7C — Verdict de complétude avant pricing final

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-7C |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-7C |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Si ajout de client_gap_requests dans le verdict |
| **Recommandation** | Composant `PricingReadinessCard` lecture seule. 2 queries. Verdict 4 niveaux (Prêt/Provisoire/Incomplet/Neutre). Placé au-dessus de PricingLaunchPanel. |

---

## COCKPIT-8 Phase 1 — Bandeau prochaine action prioritaire

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-8-P1 |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | COCKPIT-8 |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Phase 2 (CTA + scroll vers section concernée) |
| **Recommandation** | Composant `NextActionBanner` lecture seule. 6+2 queries. Hiérarchie 12 niveaux, STATUS_ORDER explicite. Placé avant CaseActionPlan. |

---


| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-7B |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Moyenne |
| **Phase d'origine** | COCKPIT-7B |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Si besoin d'actions inline (clôture, relance) depuis la vue détaillée |
| **Recommandation** | Composant `PartnerRequestsDetailView` lecture seule. 2 queries (requests + facts). Badge hiérarchique. Suite logique : COCKPIT-7C (complétude avant pricing final). |

---

## COCKPIT-7A — Vue synthétique "Offres attendues vs reçues"

| Champ | Valeur |
|-------|--------|
| **ID** | COCKPIT-7A |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `done` |
| **Priorité** | Moyenne |
| **Phase d'origine** | COCKPIT-7A |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Si des compteurs supplémentaires sont nécessaires (ex: réponses attendues vs reçues par partenaire) |
| **Recommandation** | Composant `PartnerRequestsSummary` lecture seule. 2 queries (requests + facts). Barre de progression clôturées/total. Suite logique : COCKPIT-7B (vue par partenaire). |

---

## PRICING-GUARD — Garde-fou communication avant pricing

| Champ | Valeur |
|-------|--------|
| **ID** | PRICING-GUARD |
| **Catégorie** | Orchestration |
| **Statut** | `done` |
| **Priorité** | Haute |
| **Phase d'origine** | PRICING-GUARD (post COCKPIT-6) |
| **Date** | 2026-04-08 |
| **Déclencheur de réouverture** | Si un guard backend supplémentaire est nécessaire dans `run-pricing` |
| **Recommandation** | Implémenté en 3 volets : (1) auto-pricing conditionné par état des boucles comm, (2) warning ambre au pricing manuel via `PricingCommWarnings`, (3) badge "Provisoire" sur `PricingResultPanel`. Aucune modification de `run-pricing` (FROZEN respecté). Guard backend optionnel à évaluer après retour terrain. |

---

## EXPORT-QE-FROZEN — quotation-engine FROZEN produit encore des honoraires import sur dossiers export

| Champ | Valeur |
|-------|--------|
| **ID** | EXPORT-QE-FROZEN |
| **Catégorie** | Moteur de pricing |
| **Statut** | `partially_resolved` |
| **Priorité** | Basse (risque mitigé) |
| **Phase d'origine** | Phase 15+ (export SENEGAL) |
| **Date** | 2026-04-07 |
| **Date de résolution partielle** | 2026-04-15 |
| **Déclencheur de réouverture** | Si un nouveau package EXPORT_* nécessite des enrichments spécifiques (PAD, terminal storage) non couverts par price-service-lines, ou si la classification honoraires/debours doit évoluer |
| **Résolution appliquée** | Guard export chirurgical dans `run-pricing` : les packages `EXPORT_*` bypass quotation-engine entièrement (mono-lot + multi-lot). Le pricing export s'appuie uniquement sur `price-service-lines` avec `scope: 'export'` et `pricing_context_override`. Aucune ligne import parasite ne peut être produite. Les enrichments PAD/terminal storage (import-oriented) sont naturellement skippés pour les flux export. |
| **Convention de classification (Option A — provisoire)** | `AGENCY` → honoraires SODATRA (soumis TVA 18%). Toutes les autres lignes export P5 (`PORT_CHARGES`, `THC_EXPORT`, `CUSTOMS_EXPORT`, `DOCUMENTATION_BL`, `VGM_WEIGHING`, `SEA_FREIGHT`) → opérationnel (non soumis TVA SODATRA). `debours = 0` (pas de droits & taxes de sortie en export sénégalais). Cette convention est minimale, locale au guard dans `run-pricing`, réversible et extensible. |
| **Bugs runtime corrigés** | (1) Mono-lot : totaux recalculés après enrichissement P5 avec classification Option A. (2) Multi-lot : `lotEngineParams` déclaré avant if/else pour éviter ReferenceError. (3) Multi-lot : totaux lotés recalculés après enrichissement P5 export. (4) Multi-lot : `lotSourceMap` complété après ajout des lignes P5 export. |
| **Dette résiduelle** | Le moteur `quotation-engine` reste FROZEN et structurellement import-oriented (`effectiveOperationType = isTransit ? 'TRANSIT' : 'IMPORT'`). La classification Option A est une convention provisoire — à réévaluer si la sémantique métier export évolue (ex: si CUSTOMS_EXPORT devait être en honoraires, ou si un package EXPORT_DDP apparaît). |
| **Recommandation** | Aucune action immédiate. Le guard + la classification Option A sont suffisants pour le périmètre export actuel (EXPORT_SENEGAL). Réévaluer si un package EXPORT_DDP ou EXPORT_CIF apparaît, ou si la distinction honoraires/opérationnel export doit être formalisée dans un modèle de données dédié. |

---

## Règle de mise à jour obligatoire

Tout sujet explicitement différé, laissé dormant, accepté comme dette, ou déplacé à une phase ultérieure **doit être ajouté ou mis à jour dans ce fichier immédiatement**.

Cela inclut les décisions formulées comme :
- "pas maintenant"
- "phase ultérieure"
- "dormant"
- "legacy conservé"
- "dette acceptée"
- "à revalider plus tard"

---

## Vocabulaire de statuts

| Statut | Signification |
|--------|---------------|
| `deferred` | Reporté volontairement — sera traité plus tard |
| `deferred-high` | Reporté mais priorité haute — à traiter au prochain cycle |
| `dormant` | Conservé dans le code, pas d'appelant actif, pas de suppression prévue |
| `legacy` | Code ou modèle ancien, conservé par prudence |
| `watchlist` | À surveiller — pourrait devenir un problème |
| `pending_validation` | Nécessite une vérification avant action |
| `historical_note` | Information contextuelle archivée, pas d'action requise |
| `closed` | Résolu ou explicitement abandonné |

---

## Backlog

| ID | Sujet | Catégorie | Statut | Priorité | Phase | Date | Pourquoi non traité | Déclencheur de réouverture | Surface probable | Source | Vérification | Recommandation |
|----|-------|-----------|--------|----------|-------|------|---------------------|---------------------------|-----------------|--------|--------------|----------------|
| E1 | MASTER_CONTEXT.md référence `generate-case-outputs` (§Cockpit, §Fonctions dormantes) — supprimée en M26b | doc | closed | — | M26b | 2026-03-26 | Corrigé par convergence documentaire E1+E2+E3 | — | `docs/MASTER_CONTEXT.md` | repo + chat | Fermé | Aucune action requise |
| E2 | SECURITY_CONTRACT.md référence `generate-case-outputs` (ligne 36, 74) | doc | closed | — | M26b | 2026-03-26 | Corrigé par convergence documentaire E1+E2+E3 | — | `docs/SECURITY_CONTRACT.md` | repo + chat | Fermé | Aucune action requise |
| E3 | STATUS_REGISTRY.md référence `generate-case-outputs` comme writer HUMAN_REVIEW | doc | closed | — | M26b | 2026-03-26 | Corrigé par convergence documentaire E1+E2+E3 | — | `docs/STATUS_REGISTRY.md` | repo | Fermé | Aucune action requise |
| E4 | PHASE_15_NOTES.md référence `generate-case-outputs` dans config verify_jwt | doc | historical_note | Moyenne | M26b | 2026-03 | Document historique | Lors de prochaine relecture | `.lovable/PHASE_15_NOTES.md` | repo | Confirmé | Annoter comme historique |
| C1 | CaseView.tsx monolithique — extraction progressive | dette | closed | — | C1 | 2026-03-26 | Objectif minimal atteint : C1.1 (constantes/types/helpers), C1.2a (FactHistoryPopover), C1.2b (ServiceOverridePanel). CaseView réduit de 2700+ à 2119 lignes (~21%). Smoke tests verts. | — | `src/pages/CaseView.tsx` | chat C1 | Fermé | Aucune action requise |
| C1-rest | Extractions CaseView restantes (PipelineStepper, TimelineTab, ClientClarifications) | dette | dormant | Basse | C1 | 2026-03-26 | Restant volontairement non extrait ; ratio gain/risque insuffisant hors changement UX majeur | Prochain changement UX majeur sur CaseView | `src/pages/CaseView.tsx` | chat C1 | Confirmé | Garder dormant |
| B1-A | Isolation email_drafts (CRUD ouvert → owner-scoped) | sécurité | closed | — | B1-A | 2026-03-28 | Implémenté : 4 policies USING(true) remplacées par owner-scoped. SELECT/DELETE : owner + legacy NULL transitoire. UPDATE/INSERT : owner strict. Impacts produit documentés (Dashboard cross-user, admin listing). | — | RLS `email_drafts` | repo + chat B1 | Fermé | Aucune action requise |
| B1-B | Isolation case_documents + storage bucket | sécurité | deferred | Moyenne | M23c | 2026-03-28 | Pré-audit B1-B complet (2026-03-28). 3 blocages structurels prouvés : (1) upload storage-first → policy storage par jointure DB impossible (CaseDocumentsTab.tsx L82-98, Intake.tsx L412-424), (2) delete DB-first → policy storage par jointure DB impossible (CaseDocumentsTab.tsx L176-180), (3) quote_cases en shared workspace → restreindre case_documents seul créerait une asymétrie produit (documents = pièces dossier partagé, ≠ email_drafts = artefact opérateur). Le problème est applicatif + produit, pas seulement RLS. Options évaluées : A (inverser flux applicatif), B (storage path-based), C (durcir DB SELECT only), D (statu quo documenté). Décision CTO : Option D retenue. | Ouverture multi-société, refonte flux upload/delete, ou incident réel de visibilité inter-opérateurs | Storage `case-documents`, RLS `case_documents`, `CaseDocumentsTab.tsx`, `Intake.tsx` | repo + chat B1 + pré-audit B1-B | Confirmé | Reconcevoir flux (Option A) si multi-société requis ; sinon statu quo justifié |
| B2 | Données historiques `route_port = 'Dakar'` non corrigées rétroactivement | dette | legacy | Basse | M23b-fix | 2026-03 | Migration données risquée | Jamais (accepté) | `quotation_history` | chat M23b-fix | Confirmé | Garder dormant |
| A1 | Fin commerciale post-SENT (ACCEPTED/REJECTED) | futur produit | closed | — | A1 | 2026-03-28 | Implémenté : migration enum, edge function `close-commercial-outcome` (FSM guard SENT-only, idempotence, cross-transition interdite, timeline status_changed), UI (labels, filtres, stepper, boutons outcome, bandeau), docs alignés. | — | Enum DB, FSM, CaseView, `close-commercial-outcome` | repo + chat A1 | Fermé | Aucune action requise |
| A2 | Statut ARCHIVED jamais écrit par le runtime | dormant | **closed** | — | M25 | 2026-03 | **Clos (2026-04-15).** Audit ciblé ARCHIVED-WRITER-1 : aucun writer canonique actif dans le runtime. 14 cas ARCHIVED en DB live attribués à un UPDATE SQL direct (batch, 2026-02-14/16) — absence de timeline `status_changed` → ARCHIVED, timestamps partagés au ms. Statut protégé par FROZEN_STATUSES dans `build-case-puzzle` et `sync-emails`. UI le traite comme terminal. Aucun writer à créer sauf décision produit future. | Besoin d'un bouton "Archiver" opérateur (lot dédié) | Enum DB, CaseView | repo + DB live | Fermé | Aucune action requise |
| A3 | Re-pricing après version (QUOTED_VERSIONED → re-priceable) | futur produit | deferred | Basse | M25 | 2026-03 | Choix produit assumé (irréversibilité) | Ticket produit dédié | `generate-quotation-version`, CaseView | repo | Confirmé | Garder tel quel |
| A4 | Emails de cotation IA (corps enrichi au lieu de template statique) | futur produit | closed | — | A4 | 2026-03-27 | Implémenté : template déterministe enrichi, branche IA optionnelle avec fallback, garde post-IA ci-joint, traçabilité timeline. Réserve mineure : replace fragmentaire sur formulations IA (élégance rédactionnelle, pas de risque métier). | — | `create-quotation-email-draft` | repo + chat A4 | Fermé | Aucune action requise |
| A5 | Persistance du rejet des suggestions dérivées | futur produit | dormant | Basse | M27 | 2026-03 | Acceptable avec 1 suggestion | ≥3 suggestions dérivées | CaseView, potentiellement table dédiée | repo | Confirmé | Garder dormant |
| A6 | Intégration SMTP réelle | futur produit | deferred | Conditionnelle | — | 2026-03 | Décision fondamentale "Pas d'auto-send" | Décision produit SMTP | Edge functions send-*, email_drafts | repo | Confirmé | Conditionnel |
| A7 | Filtrage lot-level demandes partenaires P1 Auto-EQ | dette | dormant | Basse | P1 | 2026-03 | Extension schéma quote_gaps nécessaire | Multi-lot mixte fréquent | `build-case-puzzle` (FROZEN) | repo | Confirmé | Garder dormant |
| C2 | Idempotence divergente entre 3 chemins learned_knowledge | dette | watchlist | Basse | M23a | 2026-03-28 | Pré-audit C2 (2026-03-28). 3 stratégies d'idempotence divergentes confirmées : learn-from-content (SELECT+UPDATE/INSERT applicatif), learn-quotation-puzzle (onConflict: "name,category" non sécurisé sans contrainte compatible), analyze-attachments (INSERT+catch 23505, protège uniquement index partiel source_type='attachment'). Aucun index UNIQUE (name, category) en base. Volume doublons marginal : 1 groupe doublon / 1 067 lignes. Cause exacte non prouvée, compatible avec insert concurrent ponctuel. | Volume élevé d'apprentissage auto, ou fréquence de re-runs puzzle/attachments en hausse | `learn-from-content`, `learn-quotation-puzzle`, `analyze-attachments` | repo + DB lecture seule | Confirmé | Dédoublonner d'abord, puis créer index UNIQUE (name, category), puis normaliser les 3 chemins vers stratégie commune |
| C3 | quotation_history à double usage (historique + comparaison) | dette | legacy | Basse | M23b | 2026-03 | Pas de scission envisagée | Jamais (accepté) | `quotation_history` | chat M23b | Confirmé | Garder tel quel |
| C4 | Idempotence P1 Auto-EQ applicative seulement (pas de UNIQUE DB) | dette | watchlist | Basse | P1 | 2026-03 | Mitigé par orchestration séquentielle | Re-runs concurrents fréquents | `build-case-puzzle` (FROZEN) | repo | Confirmé | Garder dormant |
| C5 | Fallback legacy multi-lot (raw_lines pré-M14b) | legacy | pending_validation | Basse | M14b | 2026-03-28 | Revalidation C5 (2026-03-28). Audit repo : fallback localisé uniquement dans `export-quotation-version-pdf/index.ts` L246-264. Vérification DB : 1 snapshot existant avec `lot_index` dans `raw_lines` (case a6a82a70, version a2d7150e, 22 lignes). Le code n'est donc PAS mort — au moins 1 version historique l'utilise potentiellement. `create-quotation-email-draft` n'utilise pas ce fallback. | Suppression sûre seulement si le snapshot a6a82a70 est migré ou supprimé | `export-quotation-version-pdf/index.ts` L246-264 | repo + DB lecture seule | Confirmé (1 cas vivant) | Conserver le fallback ; envisager migration du snapshot si nettoyage souhaité |
| D1 | Scroll-to-section auto sur changement de statut | UX | deferred | Basse | M27 | 2026-03 | Polish non prioritaire | Phase UX dédiée | `CaseView.tsx` | chat M27 | Confirmé | Garder dormant |
| D2 | Actions clôturées collapsibles par défaut | UX | deferred | Basse | M27 | 2026-03 | Mineur | Phase UX dédiée | `CaseView.tsx` | chat M27 | Confirmé | Garder dormant |
| D3 | Panels visibles sans contenu (ExternalRequests en INTAKE) | UX | deferred | Basse | M27 | 2026-03 | Bruit visuel mineur | Phase UX dédiée | `CaseView.tsx` | chat M27 | Confirmé | Garder dormant |
| F1 | Audit P0 métier (précision cotation, 30-50 dossiers) | audit | pending_validation | Opérationnelle | — | 2026-03 | Pré-audit F1.0 (6 dossiers) + revue F1.1 (4 dossiers prioritaires) complétés. Aucun bug moteur critique démontré. Défauts non bloquants identifiés (NULL_TO_ZERO, lignes P5 sans description, service_key absentes). Phase gelée après F1.1 — aucun correctif runtime engagé volontairement avant validation métier. Validation finale bloquée par absence de devis réels SODATRA. | Devis réels SODATRA disponibles pour comparaison E0-E4 | `AUDIT_METIER_P0_PROTOCOL.md`, `audit/p0/`, `/mnt/documents/f1_review_synthesis.json` | repo + runtime | Confirmé | Reprendre comparaison manuelle dès devis disponibles |
| F2 | Smoke test post-M24b (cargo.weight_kg = 22000) | audit | closed | — | M24b | 2026-03-27 | Fix M24b confirmé en runtime : case 29b96eec, weight_kg=840000 → cargoWeight=840 (run 31a65987, 2026-03-27T16:07:19Z) | — | `run-pricing`, `quotation-engine` | chat M24b + runtime proof | Fermé | Aucune action requise |
| S1 | ~~Label `sent` EQ1 sémantiquement ambigu~~ | dette | **closed** | — | EQ1 | 2026-04-08 | Résolu : `email_sent_at` + `email_draft_id` ajoutés, timer stale corrigé, badge UI brouillon/confirmé (emerald vs blue), toast corrigé. Micro-correctif badge couleur appliqué. | — | `external_quote_requests`, `ExternalRequestsPanel`, `getNextAction` | repo | Fermé | Aucune action requise |
| S2 | HUMAN_REVIEW dormant dans l'enum (jamais atteint canoniquement) | dormant | dormant | Basse | M25 | 2026-03 | Supporté défensivement | Jamais (conservé par design) | Enum DB, `generate-quotation-version` | repo | Confirmé | Garder dormant |
| P2B | `create_knowledge` dans `data-admin` inaccessible aux opérateurs non-admin | sécurité | **partially_resolved** | Moyenne | B1-audit | 2026-03-29 | **Option A appliquée (2026-04-15)** : `create_knowledge` reste admin-only (backend `data-admin` inchangé). UX corrigée dans `QuotationSheet.tsx` : détection explicite du 403 (via `error.context.status` + fallback catch) → toast « Action réservée aux administrateurs » au lieu du message générique. Bouton reste visible car `QuotationCompletedBanner` est FROZEN (Phase 4B). Convention provisoire : AGENCY = honoraires, autres = opérationnel, débours = 0. Résolution complète (masquer/désactiver le bouton) nécessite un dégel du composant ou une décision produit de déplacer `create_knowledge` vers un endpoint opérateur dédié. | Dégel de QuotationCompletedBanner, ou décision produit d'ouvrir create_knowledge aux opérateurs | `src/pages/QuotationSheet.tsx` L1206-1228, `supabase/functions/data-admin/index.ts` | repo | Confirmé | UX clarifiée. Backend admin-only préservé. Bouton visible (FROZEN). |
| RLS-ADMIN | Système de rôles (RBAC) pour pages admin | sécurité | historical_note | Basse | RLS-audit | 2026-03-29 | Évalué lors de l'audit admin/RLS/CRUD. ROI négatif en mono-équipe. Le modèle actuel est shared workspace authenticated CRUD pour les tables de référence, avec protection backend requireAdmin uniquement sur data-admin/email-admin. Les pages admin sont un regroupement UI, pas une frontière d'autorisation. | Ouverture multi-société ou ajout d'opérateurs non-fiables | Pages `/admin/*`, tables de référence, sidebar | repo + audit RLS | Confirmé | Ne pas implémenter tant que mono-équipe. Documenter dans SECURITY_CONTRACT.md. |
| RLS-FIX | DENY ALL sur documents + learned_knowledge corrigé | sécurité | closed | — | RLS-audit | 2026-03-29 | Policies DENY ALL (migration 20251217183036) bloquaient SELECT/DELETE sur `documents` et SELECT sur `learned_knowledge`. Corrigé : drop DENY ALL, ajout SELECT authenticated (+ DELETE authenticated pour documents). Écriture non touchée (passe par service_role via edge functions). | — | `documents`, `learned_knowledge` | repo + DB live | Fermé | Aucune action requise |
| RLS-REF | Write policies manquantes sur 5 tables de référence corrigé | sécurité | closed | — | RLS-audit | 2026-03-29 | Tables hs_codes, tax_rates, customs_regimes, port_tariffs, pricing_client_overrides avaient RLS activé avec uniquement SELECT → écriture bloquée par défaut. Corrigé : ajout INSERT/UPDATE/DELETE TO authenticated selon les besoins de chaque page admin. Modèle = shared workspace authenticated CRUD (choix produit, pas RBAC). | — | 5 tables de référence | repo + DB live | Fermé | Aucune action requise |
| LEG-LOCK | Verrouillage pipeline legacy dans QuotationSheet | architecture | closed | — | LEG-audit | 2026-03-29 | QuotationSheet peut encore créer des artefacts legacy (quotation_history, PDF, email) concurrents au pipeline canonique quand un quote_case existe. Corrigé : `isLegacyLocked` désactive save draft, generate response, exports PDF/Excel, mark as sent quand `quoteCase?.id` est défini. Guards défensifs dans handlers + masquage UI. | — | `QuotationSheet.tsx`, `QuotationHeader.tsx` | repo + audit pipeline | Fermé | Aucune action requise |
| LEG-CLEANUP | Retrait fonctions legacy pures (create-quotation-draft, generate-quotation, generate-quotation-pdf) | dette | deferred | Basse | LEG-audit | 2026-03-29 | Audit post-lockdown (2026-03-29). Ces 3 edge functions ne sont PAS du dead code : elles restent le seul pipeline de création pour `/quotation/new` (Dashboard → "Nouveau devis", QuotationHistory → "Charger comme modèle"). LEG-LOCK les rend inaccessibles quand un quote_case existe, mais le parcours manuel sans email les utilise activement. Retrait = régression produit. | Retrait possible uniquement si : (1) `/quotation/new` supprimé ou migré vers pipeline canonique, ET (2) "Charger comme modèle" redirigé vers CaseView | `create-quotation-draft`, `generate-quotation`, `generate-quotation-pdf`, `src/pages/Dashboard.tsx` L413, `src/pages/admin/QuotationHistory.tsx` L169 | repo + audit pipeline post-lockdown | Confirmé (legacy vivant, fallback actif) | Ne pas retirer. Garder tant que `/quotation/new` est un point d'entrée produit valide |
| FCL-OVR | Override manuel FCL non pris en compte par la détection build-case-puzzle | dette | deferred | Moyenne | PAD-phase3 | 2026-04-02 | Diagnostic complet et patch validé (CTO), hors scope d'exécution phase courante. Phase 3 PAD clôturée sans ce patch ; blocage FCL/LCL confirmé hors scope PAD. Pas d'incident production bloquant immédiat. | Ambiguïté FCL/LCL bloque un smoke test opérateur ou un flux pricing production | `supabase/functions/build-case-puzzle/index.ts` (détection L1755, `detectRequestType` L4249-4314) | repo + diagnostic chat PAD-phase3 | Confirmé (cause racine prouvée) | Patch ~15 lignes : après détection, si `ambiguous_lcl_fcl === true`, lire `quote_facts` manuels (`cargo.container_type`, `cargo.container_count`) source `manual_input`/`operator` ; si exploitable → forcer `SEA_FCL_IMPORT`, `ambiguous_lcl_fcl = false`. Garde-fous : valeur non vide, sources manuelles strictes, log explicite, pas de bypass autres ambiguïtés. Dépendance UI optionnelle : formulaire "Ajouter un fact" CaseView (ne résout rien sans ce patch) |
| DEM-LEGACY | Colonnes `day_1_7/8_14/15_plus` dans `demurrage_rates` — legacy, superseded progressively by `demurrage_tiers` | dette | legacy | Basse | DEM-V1 | 2026-04-02 | Nouveau modèle `demurrage_tiers` créé et peuplé avec 4 tiers prouvés. Colonnes legacy conservées comme fallback tant que le moteur n'est pas migré. | Moteur (`quotation-engine`, `analyze-risks`) branché sur `demurrage_tiers` | `demurrage_rates` colonnes `day_1_7_rate`, `day_8_14_rate`, `day_15_plus_rate` | repo + migration | Confirmé | Supprimer les colonnes legacy uniquement après migration complète du moteur vers `demurrage_tiers` |
| DEM-17FD | Interprétation "17 FD" MSC Dakar — franchise réelle vs franchise de calcul | donnée | pending_validation | Moyenne | DEM-V1 | 2026-04-02 | Mention "17 FD" observée sur factures MSC Dakar. Pourrait signifier 17 free days (vs standard 10j). Non utilisé comme règle métier tant que la logique exacte n'est pas confirmée. | Clarification obtenue de MSC Dakar ou d'un opérateur terrain | Factures MSC BL MEDUF8860316 + MEDUAK978032 | factures réelles | Confirmé | Ne pas modifier `free_days_import` MSC sans preuve formelle de la règle 17 FD |
| DT-NOMENCLATURE | Peuplement `commodity_categories` avec codes terminal Dakar Terminal (storage uniquement) | donnée | legacy | Basse | DT-V1 | 2026-04-02 | **Requalifié legacy (2026-04-03).** Peuplement partiel conservateur effectué : 3/10 catégories PAD peuplées (T05→410, T09→414, T14→412). 7 catégories laissées NULL. Ce mapping PAD→codes terminal est désormais reconnu comme **approximation provisoire, pas comme cible architecturale**. Le bon modèle de résolution du magasinage terminal est par désignation marchandise (cf. DT-DESIGNATION-MODEL), pas par catégorie PAD. **RÈGLE : Tant qu'un modèle par désignation terminale n'existe pas, le moteur ne doit pas consommer `commodity_categories.terminal_storage_code_p1/p2/p3` comme source normative de calcul du magasinage.** | Remplacement par DT-DESIGNATION-MODEL | `commodity_categories` colonnes `terminal_storage_code_p1/p2/p3` | repo + grille officielle 2014 + factures TOM | Confirmé | Ne pas utiliser ces colonnes comme clé d'entrée moteur. Données conservées sans rollback mais requalifiées comme non-cibles. |
| DT-DESIGNATION-MODEL | Modèle de résolution magasinage terminal par désignation marchandise (remplace DT-FINE-MAPPING) | architecture | deferred | Moyenne | DT-V3 | 2026-04-03 | **Remplace DT-FINE-MAPPING.** Phase 1 livrée : table `terminal_designations` créée. Phase 2 livrée : **956 lignes** importées. `tariff_position = int(handling_code)` — équivalence spécifique à ce référentiel, non généralisable. `handling_code` = métadonnée descriptive Dakar Terminal, non consommable moteur manutention DPW. **Phase 3-A livrée et validée métier (2026-04-03)** : résolution provisionnelle P1 dans `run-pricing`. Smoke tests : T1b match exact PASS, T2 non-match PASS (preuves isolées complètes) ; T3 vrac et T4 AIR confirmés indirectement via guards amont, non testés en isolation complète. Bugfix `unit` → `unit_basis` capturé et corrigé. **Phase 3-B.1-A livrée (2026-04-03)** : table `terminal_designation_aliases` créée, 9 alias sûrs seedés (is_validated=true), lookup alias intégré dans `run-pricing` avant match direct Phase 3-A. Smoke tests : T1 alias match PASS (`ceramic tiles` → CARREAUX → 446 040 FCFA), T2 no match PASS, chaîne de résolution DB prouvée. Phase 3-B.1-B (UI admin alias) et Phase 3-B.2 (fallback IA) : **deferred**. | Phase 3-B.1-B : UI admin alias. Phase 3-B.2 : fallback IA. Phase 3-B matching fin, P2/P3, jours réels après franchise | `public.terminal_designations`, `terminal_designation_aliases`, `terminal_tariff_codes`, `run-pricing/index.ts` | grille officielle 2014 (956 désignations importées) | Confirmé | Périmètre strictement magasinage / codification terminal. Ne pas étendre à la manutention ; DPW reste le référentiel séparé via `port_tariffs`. |
| DT-ALIAS-ADMIN-UI | UI admin pour gestion des alias BL → désignation terminale | UI | closed | — | DT-V3-B1 | 2026-04-03 | **Fermé (2026-04-04).** Phase 3-B.1-B livrée : onglet Alias BL dans TerminalStorage.tsx, CRUD complet, validation explicite, normalizeForMatch() cohérent moteur. Workflow validé en conditions réelles (S1-S4). | — | `src/pages/admin/TerminalStorage.tsx` | backlog Phase 3-B.1 | Fermé | Aucune action requise |
| DT-AI-FALLBACK | Fallback IA pour matching BL → désignation terminale (Phase 3-B.2) | architecture | closed | — | DT-V3-B2 | 2026-04-04 | **Phase 3-B.2-A livrée (2026-04-04).** Table `terminal_designation_suggestions` créée. Appel IA (Gemini 2.5 Flash) dans `run-pricing` après échec alias+direct. Anti-duplication (pas de re-appel si pending existe). Score filtré [0,1], max 3 suggestions. Aucune ligne pricing produite. UI admin 3e onglet "Suggestions IA" : accepter, rejeter, accepter+créer alias. Anti-doublon alias. Champ `alias_created` pour traçabilité capitalisation. Statuts : pending/accepted/rejected. | Phase 3-B.2-B éventuelle : multi-marchandise, auto-segmentation composite, P2/P3 | `run-pricing/index.ts`, `terminal_designation_suggestions`, `TerminalStorage.tsx` | backlog Phase 3-B.2 | Fermé | IA = aide à la proposition, pas décideur autonome. Validation opérateur obligatoire. |
| DT-AI-MULTI-CARGO | Auto-segmentation BL composites multi-désignations par IA | architecture | deferred | Basse | DT-V3-B2 | 2026-04-04 | L'IA détecte les textes composites et le signale dans le reasoning, mais aucun découpage automatique multi-désignation n'est implémenté. Validation opérateur obligatoire pour chaque suggestion. | Fréquence élevée de BL composites non traités correctement | `run-pricing/index.ts` | Phase 3-B.2-A | Confirmé | Ne pas implémenter sans analyse statistique des BL composites réels |
| DT-P2P3-ENGINE | Calcul P2/P3 magasinage terminal et jours réels après franchise | architecture | deferred | Moyenne | DT-V3-B | 2026-04-03 | Moteur actuel = provision P1 × 3 jours seulement. P2/P3 nécessitent : jours réels, franchise, paliers progressifs. | Besoin opérationnel de précision sur longue durée de stockage | `run-pricing/index.ts`, `terminal_tariff_codes` | Phase 3-A | Confirmé | Nécessite d'abord un modèle de jours réels après franchise |
| DT-RATE-TABLE | Table `terminal_tariff_codes` — 34 lignes storage (12 familles), handling et révision 419 à suivre | architecture | deferred | Moyenne | DT-V1 | 2026-04-02 | Table créée + peuplement storage Dakar Terminal 2014 : **34 lignes** (12 familles, P1/P2/P3). 33 `official`, 1 `to_confirm` (419/P1). Vague 2 (2026-04-03) : ajout familles 411 (RIZ en sacs, `tonne_per_day`) et 415 (animaux vivants, `unit`). Couverture résultante : P1=100%, P2/P3=98.5%. **Gap résiduel : codes 520/620 (véhicules P2/P3) — référencés dans la nomenclature des désignations (pages 28-29, 32) mais taux FCFA absents du barème officiel page 34 — gap de la source elle-même, non injectés (règle 0-extrapolation).** ~14 désignations véhicules non résolubles en P2/P3. Notes corroboration sur 519/619. **Handling non injecté. DPW non injecté.** | Prochaine étape : investigation écart 419, puis éventuel peuplement handling ou intégration moteur. Codes 520/620 : injectable si source secondaire (facture TOM véhicules, grille post-2014) obtenue. | `public.terminal_tariff_codes` | grille officielle 2014 p.34 + factures TOM | Confirmé | Périmètre strictement magasinage / codification terminal. Ne pas étendre à la manutention ; DPW reste le référentiel séparé via `port_tariffs`. |
| DT-2014-REVISION | Investigation écart taux P1 magasinage Dakar Terminal (grille 2014 vs facture TOM) | donnée | pending_validation | Basse | DT-V1 | 2026-04-02 | Écart observé à investiguer : code 419 (P1 magasinage) = 1 768 FCFA/T/j dans grille 2014 vs 1 964 FCFA/T/j sur facture TOM récente (+11%). P2 et P3 exacts. Cause possible : révision partielle, contexte TOM/TCD spécifique, arrondi, ou surcharge locale. | Obtention d'une grille Dakar Terminal post-2014, ou d'une deuxième facture TOM avec même code pour comparer | Grille 2014 page 34 (code 419), facture TOM (position 138) | grille officielle + facture réelle | Confirmé | Périmètre strictement magasinage / codification terminal. Ne pas étendre à la manutention ; DPW reste le référentiel séparé via `port_tariffs`. Ne pas utiliser le montant 2014 du code 419 comme vérité tarifaire sans consolidation. P2 (519) et P3 (619) exploitables tels quels |

---

## TARIFF-COHERENCE-1 — PORT_DAKAR_HANDLING vs DTHC/THC import

| Champ | Valeur |
|-------|--------|
| **ID** | TARIFF-COHERENCE-1-DEBT |
| **Catégorie** | Pricing / Déduplication |
| **Statut** | `deferred` |
| **Priorité** | Moyenne |
| **Phase d'origine** | TARIFF-COHERENCE-1 |
| **Date** | 2026-04-09 |
| **Déclencheur de réouverture** | Validation métier confirmant si PORT_DAKAR_HANDLING (15K) est un poste distinct ou un doublon du THC import DPW (930K). |
| **Recommandation** | Ne pas fusionner PORT_DAKAR_HANDLING dans le dedup_group TERMINAL_HANDLING tant que la doctrine métier n'est pas arbitrée. Si doublon confirmé, ajouter `'PORT_DAKAR_HANDLING': 'TERMINAL_HANDLING'` dans DEDUP_GROUP_MAP. Si poste distinct, documenter la différence et conserver séparé. |


---

## Top priorités futures

| Rang | ID | Sujet | Valeur |
|------|----|-------|--------|
| 1 | ~~CARRIER-CMACGM-TEMPLATES~~ | ~~Templates CMA CGM manquants~~ | **DONE** (2026-04-05) — 4 templates corrigés + activés, recheck ALL_MATCH |
| 2 | ~~CARRIER-MSC-EMANIF~~ | ~~Micro-gap MSC manifeste électronique~~ | **DONE** (2026-04-06) — template EMANIF 550 XOF/BL inséré, recheck D1 ALL_MATCH 100% |
| 3 | B1-B | Isolation case_documents + storage | Pré-requis ouverture multi-société (B1-A email_drafts déjà traité) |
| 4 | F1 | Audit P0 métier | Validation justesse tarifaire |
| 5 | CARRIER-GRIMALDI-RORO | Chantier Grimaldi RORO | Modèle facturation RORO quasi non couvert (1.1%) |
| 6 | EXPORT-PRICING-SOURCING | Sourcing tarifaire réel des 7 codes export | Priorité : SEA_FREIGHT > THC_EXPORT > DOCUMENTATION_BL > VGM_WEIGHING > STUFFING_FACTORY > STUFFING_CFS > EMPTY_REPO |
| 7 | EXPORT-HS-NORMALIZATION-MULTILOT | Incohérence HS 8 vs 10 digits inter-lots | **Phase A livrée et validée runtime** — garde mergeFactsForLot + fallback SH6 candidat unique. Validation run #6 (2026-04-07) : 5 lots homogènes sur `0801310000`, warning 8 digits disparu |
| 8 | EXPORT-CUSTOMS-SEMANTICS | Sémantique CUSTOMS_EXPORT / duties_total export | Clarification labels avant première offre client |
| 9 | COM-1A | Envoi réel emails partenaires (SMTP) — décision produit + secrets + traçabilité | Prérequis : S1 livré (email_sent_at). COM-1A remplira email_sent_at après transmission SMTP réussie. |
| — | ~~S1~~ | ~~Clarification sémantique statut partenaire (email_sent_at)~~ | **DONE (2026-04-08)** — Colonnes `email_sent_at` + `email_draft_id` ajoutées sur `external_quote_requests`. Timer stale basé sur `email_sent_at ?? sent_at`. Badge UI distinct brouillon/confirmé. Toast corrigé. Aucun changement d'enum. |
| 10 | COM-3 | SLA / relances partenaires | Badges overdue, relances brouillon, nécessite COM-1A |
| 11 | COM-4 | Comparaison multi-offres + réponse client consolidée | Vue comparative par lot/purpose, sélection offre retenue |
| — | ~~COM-2A~~ | ~~Auto-matching réponses partenaires~~ | **DONE (2026-04-07)** — table `partner_response_suggestions`, edge function `auto-match-partner-responses` (scan/confirm/reject), hook `usePartnerSuggestions`, UI intégrée dans ExternalRequestsPanel, correctif final confirm : analyse EQ1 avant passage à accepted |
| — | ~~A6~~ | ~~Intégration SMTP~~ | **closed — absorbé par COM-1A** |
| — | ~~COCKPIT-2~~ | ~~Garde-fous communication SendQuotationPanel~~ | **DONE (2026-04-08)** — Avertissements (non bloquants) dans SendQuotationPanel : demandes partenaires non clôturées (tout sauf `closed`), faits partenaires `proposed`, clarifications client `drafted`/`sent`/`answered`. Rappel dans dialog de confirmation. `canSend` inchangé (opérateur souverain). Fichiers : `useSendQuotation.ts`, `SendQuotationPanel.tsx`. Aucune migration DB. |
| — | ~~COCKPIT-3~~ | ~~Résumé communication dossier (widget case-level)~~ | **DONE (2026-04-08)** — Composant `CommunicationSummaryCard.tsx` dans CaseView, juste avant ExternalRequestsPanel. 3 requêtes parallèles (filtres COCKPIT-2). Badge global vert/amber. Mini-liste partenaires. staleTime 30s. Aucune migration DB. Aucune zone FROZEN. |

---

## Tableau de sourcing tarifaire export (EXPORT-PRICING-SOURCING)

État au 2026-04-07 — confirmé par run #3 dossier 76c9819c.

| Priorité | Service | Source visée | Nature tarif | Unité | Règle quantité | Mode MAJ | Statut catalogue |
|----------|---------|-------------|--------------|-------|-----------------|----------|-----------------|
| 1 | SEA_FREIGHT | Cotations compagnies maritimes (CMA CGM, MSC, Grimaldi) par destination/type conteneur | compagnie | EVP | `service_quantity_rules` existante | Rate card ou saisie manuelle | 0 XOF placeholder |
| 2 | THC_EXPORT | Barème terminal export (DP World / MPTC Dakar) | officiel | EVP | `service_quantity_rules` existante | Document officiel tarifaire | 0 XOF placeholder |
| 3 | DOCUMENTATION_BL | Compagnie maritime / agent | compagnie | BL | `service_quantity_rules` existante | Grille agent | 0 XOF placeholder |
| 4 | VGM_WEIGHING | Peseur agréé / terminal | prestataire | EVP | `service_quantity_rules` existante | Contrat prestataire | 0 XOF placeholder |
| 5 | STUFFING_FACTORY | Manutentionnaire usine | prestataire | EVP | `service_quantity_rules` existante | Contrat prestataire | 0 XOF placeholder |
| 6 | STUFFING_CFS | Terminal CFS / magasin | prestataire | EVP | `service_quantity_rules` existante | Contrat prestataire | 0 XOF placeholder |
| 7 | EMPTY_REPO | Dépôt conteneurs vides | prestataire | EVP | `service_quantity_rules` existante | Contrat dépôt | 0 XOF placeholder |

Note : AGENCY (frais agence) est dans le package mais déjà géré par la grille interne SODATRA — pas dans le scope sourcing externe.

---

## Éléments à revalider avant action

| ID | Sujet | Ce qu'il faut vérifier | Pourquoi |
|----|-------|----------------------|----------|
| E4 | PHASE_15_NOTES config | Vérifier si le document est encore consulté ou purement archivé | Si archivé, pas besoin de corriger |
| C5 | ~~Revalidé 2026-03-28~~ | ~~1 snapshot vivant trouvé (a6a82a70). Fallback conservé.~~ | ~~Ligne C5 mise à jour dans le backlog principal~~ |

---

## PAD — Sujets différés

| ID | Catégorie | Statut | Priorité | Phase d'origine | Date | Déclencheur de réouverture | Recommandation |
|----|-----------|--------|----------|----------------|------|---------------------------|----------------|
| PAD-IA | PAD matching IA | `deferred` | moyenne | PAD-1 | 2026-04-04 | Quand le dictionnaire d'alias PAD atteint ses limites de couverture (>20% de descriptions non résolues) | Implémenter un fallback IA similaire au magasinage (Phase PAD-2), avec validation opérateur obligatoire |
| PAD-ADMIN-UI | UI admin alias PAD | `closed` | — | PAD-1 | 2026-04-04 | ✅ Livré — onglet "Alias PAD" dans CommodityCategories.tsx, enrichissement T14 (6 alias), total 57 alias | Aucune action requise |
| PAD-MULTI-LOT | PAD multi-lot | `deferred` | basse | Phase 3 | 2026-04-02 | Quand un dossier multi-lot nécessite des catégories PAD différentes par lot | Extension du schéma quote_gaps et des facts par lot |
| PAD-T06-T08-T10-T11 | Audit référentiel catégories PAD absentes (T06, T08, T10, T11) | `deferred` | moyenne | PAD-1 | 2026-04-05 | Non-matchs réels en exploitation montrant des descriptions relevant de ces catégories | Mini-audit : vérifier dans les données existantes (commodity_designation_matches, emails, quotations) si ces catégories sont un oubli ou un choix de périmètre volontaire |
| PAD-GRIMALDI-T09 | Écart tarif PAD Grimaldi : facture 2 715 XOF/t vs DB 4 367 XOF/t — régime RORO à clarifier | donnée | `pending_validation` | moyenne | Blind-F1.0 | 2026-04-05 | Clarification obtenue de Grimaldi/PAD ou 2e facture Grimaldi avec même code pour comparer | Ne pas modifier le tarif T09 sans preuve formelle. Écart peut être dû à régime RORO spécifique, tarif négocié, ou classification facture différente |
| CARRIER-CMACGM-TEMPLATES | Templates carrier billing CMA CGM — 4 templates corrigés et activés | carrier | `closed` | P0 | Blind-F1.0 | 2026-04-05 | — | **DONE.** ISPS_TERM (8.85 EUR), LOC_TERM (11.50 EUR), TBL (25 000 XOF), SVC (18 000 XOF) corrigés, activés, source_documents tracés (D5/D6 blind audit). Recheck post-patch : ALL_MATCH sur D5 et D6. Réserve : montants dérivés de 2 factures, reclassables en `is_variable` si 3e dossier contredit |
| CARRIER-GRIMALDI-RORO | Templates carrier billing Grimaldi RORO — carrier lines corrigées | carrier | `closed` | P2 | Blind-F1.0 | 2026-04-06 | — | **DONE carrier.** 3 templates corrigés/activés (TBL 25 000 XOF, SVC 18 000 XOF, TRL 15 000 XOF) + 1 inséré (EMANIF 550 XOF). Recheck D4 : ALL_CARRIER_LINES_MATCH 5/5 carrier (100%). Ligne Taxe de Port (38 010 XOF) exclue → PAD-GRIMALDI-T09 scope. Réserves : TRL=Telex Release provisoire (matched by amount/carrier/invoice context), montants dérivés d'1 seule facture RORO |
| CARRIER-MSC-EMANIF | Micro-gap MSC manifeste électronique — template EMANIF ajouté | carrier | `closed` | P1 | Blind-F1.0 | 2026-04-06 | — | **DONE.** Template EMANIF inséré : 550 XOF/BL, PER_BL, DOCUMENTATION, is_active=true. Source : D1 blind audit sample - MSC invoice. Recheck D1 post-insert : ALL_MATCH 8/8 lignes, 100% couverture. Réserve : montant fixe 550 dérivé d'1 facture, reclassable is_variable si 2e dossier contredit |
| EXPORT-DB-ENUM | Badge request_type ne peut pas stocker EXPORT_SENEGAL — enum DB import-only | dette | `deferred` | basse | Export-patch | 2026-04-07 | Enum `quote_request_type` ne contient que des types import. Le patch export gap profile (STRUCTURAL_PATCH_ALLOWED 2026-04-07) corrige la logique de gaps via `gapProfileType` mais le badge DB reste un type import. | Migration DB ajoutant `EXPORT_SENEGAL` à l'enum `quote_request_type` + mise à jour de `build-case-puzzle` L3667/L3853 pour écrire le type export | Pas d'impact fonctionnel immédiat : la gap analysis utilise `gapProfileType`, seul le badge UI est affecté |
| EXPORT-PRICING-SOURCING | Sourcing tarifaire réel des 7 codes export à 0 XOF | pricing | `deferred` | moyenne | P7-export | 2026-04-07 | Verrou technique levé : 6 codes dans whitelist moteur, catalogue placeholder FIXED à 0 XOF, quantification OK. Tarifs réels à alimenter via pricing_rate_cards ou mise à jour catalogue. Confirmé run #3 dossier 76c9819c : 7 lignes P5/lot injectées correctement, PORT_CHARGES (12 000) et CUSTOMS_EXPORT (200 000) valorisés, les 5 autres à 0 XOF source catalogue_sodatra. | Rate cards reçues de l'opérateur ou source officielle port/terminal | Pas de régression : lignes à 0 visibles dans l'offre, filtrables par l'opérateur |
| EXPORT-HS-NORMALIZATION-MULTILOT | Incohérence normalisation HS code entre lots sur dossiers export multi-lot | moteur/normalisation | `confirmed — Phase A livrée et validée runtime` | moyenne | P7-export | 2026-04-07 | Dossier 76c9819c run #3 : lots 1-2 évalués avec HS `08013100` (8 digits, non trouvé dans hs_codes), lots 3-5 évalués avec `0801310000` (10 digits, trouvé). **Cause racine prouvée par audit DB** : lots 1-2 portent `cargo.hs_code = "08013100"` dans `extracted_facts_json`, qui écrase le global 10 digits via `mergeFactsForLot()`. **Phase A livrée dans le repo (2026-04-07)** : (1) garde dans `mergeFactsForLot()` empêche écrasement du global 10-digit par un lot-level court avec même SH6, (2) fallback SH6 candidat unique dans `quotation-engine` — exact match prioritaire, puis résolution SH6 seulement si 1 seul candidat 10-digit existe, sinon non-résolu. Exception STRUCTURAL_PATCH_ALLOWED documentée dans MASTER_CONTEXT.md. **Validation runtime (run #6, 2026-04-07)** : après redéploiement edge functions, lots 1-2 résolus en `0801310000`, warning HS 8 digits disparu, 5 lots homogènes. | Phase B (architecture multi-couche HS source/ancrage/Sénégal) : cf. HS-MULTI-LAYER-ARCHITECTURE | Patch Phase A minimal et défensif. Aucune sur-correction arbitraire. |
| HS-MULTI-LAYER-ARCHITECTURE | Architecture multi-couche HS : source → ancrage SH6 → code Sénégal | architecture | `deferred` | moyenne | P7-export | 2026-04-07 | **Phase B du chantier HS.** Règle métier : le SH est harmonisé mondialement à 6 chiffres seulement. Au-delà, chaque pays/union applique ses propres subdivisions. L'architecture cible doit séparer : `cargo.hs_code_source` (code brut client), `cargo.hs6_anchor` (6 digits harmonisés), `cargo.hs_code_sn` (code Sénégal/UEMOA résolu), `cargo.hs_confidence`, `cargo.hs_resolution_method` (exact/sh6_match/operator_confirmed/unresolved). Le moteur pricing doit consommer `cargo.hs_code_sn` à terme. UI opérateur requise pour résolution ambiguë (plusieurs candidats sous un même SH6). | Fréquence élevée de codes clients non-10-digits, ou premier dossier multi-SH6 ambiguë | Nécessite : nouveaux fact keys dans build-case-puzzle, résolution enrichie, UI opérateur, migration moteur pricing vers cargo.hs_code_sn |
| EXPORT-CUSTOMS-SEMANTICS | Sémantique CUSTOMS_EXPORT et duties_total en contexte export sénégalais | métier/sémantique | `watchlist` | basse | P7-export | 2026-04-07 | Le dossier export 76c9819c affiche encore des lignes `duties_total` et `CUSTOMS_EXPORT` à 200 000 XOF/lot. À l'export sénégalais, il n'y a pas de droits et taxes de sortie comparables à l'import. Le montant CUSTOMS_EXPORT couvre les frais de dédouanement export (honoraires/formalités), pas des droits de douane. Le label et la présentation au client doivent refléter cette distinction. `duties_total` est un artefact du moteur FROZEN import (cf. EXPORT-QE-FROZEN). | Première offre export envoyée à un client — le libellé doit être clair avant envoi | Clarifier le label CUSTOMS_EXPORT comme "Frais de dédouanement export" (pas "droits de douane"). Filtrer ou annoter `duties_total` dans le rendu export. Ne pas confondre honoraires dédouanement et taxation douanière. |
| COCKPIT-4B | Plan d'actions dossier — 12 étapes orientées communication réelle | cockpit/UX | `DONE` | moyenne | COM/COCKPIT | 2026-04-08 | Livré zip 39. CaseActionPlan.tsx : 12 étapes décomposant boucles partenaire (préparer/confirmer envoi/traiter réponses) et client (envoyer clarifications/analyser réponses). Étape 4 "Confirmer l'envoi" honnête pré-COM-1A (done seulement si email_sent_at renseigné). 3 queries supplémentaires (draftPartnerRequests, unsentPartnerRequests, draftedClientGaps). Filtres alignés COCKPIT-2/COCKPIT-3. Contrôle PDF corrigé (quotation_documents). Composant autonome, lecture seule, aucune mutation, aucune migration. |
| COCKPIT-4C | Séparation visuelle Communication / Consolidation dans le plan d'actions | cockpit/UX | `DONE` | basse | COM/COCKPIT | 2026-04-08 | Livré. Ajout de labels de section "Communication" et "Consolidation commerciale" dans CaseActionPlan.tsx pour séparer visuellement les 12 étapes en 2 groupes logiques. Aucune logique métier modifiée, aucune query ajoutée, rendu uniquement. |
| COCKPIT-5-P1 | Suggestion prudente des partenaires à contacter | cockpit/UX | `DONE` | moyenne | COM/COCKPIT | 2026-04-08 | PartnerSuggestionPanel autonome. Croise routing.transport_mode (quote_facts) avec known_business_contacts (rôle supplier/partner/agent). Maritime → filtre Armateur + agents. Préremplissage formulaire ExternalRequestsPanel via onPrefill. Badge "déjà contacté" par croisement normalisé partner_name. Aucune migration, aucune mutation nouvelle, aucun matching route-carrier (données absentes). Validé fonctionnellement sur dossier maritime réel (case 57f0043c, MSC, freight_rate). |
| COCKPIT-5-P2 | Enrichissement known_business_contacts (contact_email, service_types) | cockpit/données | `DONE` | moyenne | COM/COCKPIT | 2026-04-08 | Livré. Migration : contact_email TEXT NULL, service_types TEXT[] NOT NULL DEFAULT '{}'. PartnerSuggestionPanel enrichi : derivePurpose() priorise service_types, affiche icône email, passe email dans onPrefill. ExternalRequestsPanel : préremplissage email. |
| COCKPIT-6 | Brief intelligent partenaire + compteurs opérationnels honnêtes | cockpit/UX | `DONE` | moyenne | COM/COCKPIT | 2026-04-08 | Livré. Volet A : query autonome quote_facts dans PartnerSuggestionPanel, buildBriefText() génère brief 3-6 lignes (route, cargo, client, timing), injection dans purpose_detail si vide. Volet B : badges conditionnels dans CaseActionPlan (à préparer, envois à confirmer, faits à valider, clarifications à envoyer, gaps bloquants). Aucune migration, aucune mutation, données déjà calculées. |

---

## PAD-GAP-1-DEBT — Fallback tarif max PAD si client ne répond pas

| Champ | Valeur |
|-------|--------|
| **ID** | PAD-GAP-1-DEBT |
| **Catégorie** | Pricing / PAD |
| **Statut** | `reporté` |
| **Priorité** | Basse |
| **Phase d'origine** | PAD-GAP-1 |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | Client ne répond pas à la demande de clarification dans un délai configurable (ex: 48h). |
| **Recommandation** | Option 2 alternative : appliquer le tarif PAD maximal (T01 = 28 100 FCFA/t) comme fallback conservateur si le gap `pricing.pad_category` reste ouvert au-delà d'un seuil. Permet de débloquer le pricing sans sous-estimer. À valider avec doctrine métier avant implémentation. |

---

## ORCH-ACTION-2 — Envoi SMTP réel depuis le panneau d'actions

| Champ | Valeur |
|-------|--------|
| **ID** | ORCH-ACTION-2 |
| **Catégorie** | Communication client / Orchestration |
| **Statut** | `reporté` |
| **Priorité** | Haute |
| **Phase d'origine** | ORCH-ACTION-1 |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | Dépend de COM-1A (envoi SMTP réel). Quand COM-1A sera livré, le bouton "Marquer envoyé" pourra être remplacé par un vrai bouton "Envoyer" avec envoi effectif. |
| **Recommandation** | Ajouter un envoi SMTP réel derrière le bouton "Envoyer la clarification" dans ReadyActionsPanel. Nécessite l'intégration SMTP (COM-1A). En attendant, le workflow est : copier le message → envoyer manuellement → marquer envoyé dans l'app. |

---

## PORT-DAKAR-HANDLING-AUDIT — Validation métier PORT_DAKAR_HANDLING

| Champ | Valeur |
|-------|--------|
| **ID** | PORT-DAKAR-HANDLING-AUDIT |
| **Catégorie** | Pricing / Tariff validation |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | PRICING-AUDIT-1 |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | (1) Retour métier sur la légitimité du poste PORT_DAKAR_HANDLING distinct de THC IMPORT. (2) Confiance actuelle = 69% (faible). (3) Le commentaire L302 dans run-pricing exclut explicitement ce poste du dedup DTHC en attendant validation. |
| **Recommandation** | Ne pas supprimer le poste. Attendre validation métier explicite avant de l'inclure ou l'exclure définitivement. Le `dedup_group` est `PORT_DAKAR_HANDLING` (distinct de `TERMINAL_HANDLING` pour DTHC), donc pas de doublon technique, mais la justification métier reste à confirmer. |

---

## CARRIER-PORT-TAX-1B — Provisionnement prudent carrier inconnu (Option B)

| Champ | Valeur |
|-------|--------|
| **ID** | CARRIER-PORT-TAX-1B |
| **Catégorie** | Pricing / Décision produit |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | CARRIER-PORT-TAX-1B |
| **Date** | 2026-04-10 |
| **Déclencheur de réouverture** | (1) Décision métier explicite sur le périmètre des postes à provisionner (TXI seul ? EDO ? ISPS ?). (2) Arbitrage sur la comparabilité PER_BL vs PER_CNT pour le calcul du "max". (3) Validation de l'introduction de `source.type: 'ESTIMATED'` dans le pipeline. (4) MSC THO et Maersk FAI restent variables sans montant exploitable — à enrichir quand des montants réels seront collectés. |
| **Recommandation** | Ne pas implémenter tant que les questions métier ne sont pas tranchées. Option A (carrier connu uniquement) est en place. La distinction "À confirmer" vs "Estimé" vs "Calculé" est saine en principe mais nécessite un cadrage produit avant injection dans le moteur. |

---

## TIMELINE-DEDUPE-1 — quotation_email_draft_v1 sans dedupe_key ✅

| Champ | Valeur |
|-------|--------|
| **ID** | TIMELINE-DEDUPE-1 |
| **Catégorie** | Timeline contract / Idempotence |
| **Statut** | `patched` (deployed 2026-04-15) |
| **Priorité** | Basse |
| **Phase d'origine** | P1-C |
| **Date** | 2026-04-11 |
| **Clôture** | `dedupe_key: quotation_email_draft_v1:${versionId}` ajouté dans `create-quotation-email-draft/index.ts` L370. Aligné sur le pattern canonique `{kind}:{id}` de `generate-reply-draft`. Aucune migration, aucun FROZEN touché. |

---

## P2-C-AIR-SCOPE — Garde-fou aérien non validé par signal réel

| Champ | Valeur |
|-------|--------|
| **ID** | P2-C-AIR-SCOPE |
| **Catégorie** | Scope contractuel / Suggestions partenaires |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | P2-C |
| **Date** | 2026-04-11 |
| **Déclencheur de réouverture** | (1) Dossier aérien où le fret est hors scope (rare mais possible). (2) Ajout d'un champ `air_scope` dans `service_scope_v1`. |
| **Recommandation** | Le garde-fou P2-C utilise `freightScope` de `service_scope_v1` pour bloquer `freight_rate` et `air_tariff` symétriquement. Mais `air_scope` n'existe pas encore comme champ distinct dans le payload de `analyze-service-scope`. Le garde-fou aérien est conservatif par symétrie mais non validé par un signal réel dédié. À terme, envisager un champ `air_scope` séparé si les cas aériens hors-scope deviennent fréquents. |

---

## P2-D-LOT2 — Scope-driven dégradation NextActionBanner + ReadyActionsPanel

| Champ | Valeur |
|-------|--------|
| **ID** | P2-D-LOT2 |
| **Catégorie** | Cockpit opérateur |
| **Statut** | `fermé` |
| **Priorité** | Moyenne |
| **Phase d'origine** | P2-D |
| **Date de fermeture** | 2026-04-11 |
| **Résolution** | Implémenté via `useQualifiedScopeGate(caseId)`. NextActionBanner step 8 : dépromotion "Confirmer le périmètre du dossier" (amber). ReadyActionsPanel step 8 : priorité "later". Seul `unconfirmed + scope_confirmed` déclenche. `out_of_scope` et `scope_absent` neutres. 1 query facts légère partagée ajoutée (7 keys). |

---

## P2-D-PRICING-SCOPE — Brancher PricingLaunchPanel sur qualifyScope avec facts réels

| Champ | Valeur |
|-------|--------|
| **ID** | P2-D-PRICING-SCOPE |
| **Catégorie** | Scope / Pricing UI |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | P2-D Lot 1 |
| **Date** | 2026-04-11 |
| **Déclencheur de réouverture** | PricingLaunchPanel reçoit les facts réels du dossier (via prop ou query dédiée) |
| **Recommandation** | Réintroduire le wording conditionnel dérivé de `qualifyScope()` dans PricingLaunchPanel uniquement quand les facts structurants (hs_code, cargo_value, transport_mode, etc.) sont disponibles dans le composant. Ne pas passer `facts: {}` ni `caseStatus: "INTAKE"` en dur. |

---

## PJ-BODYSTRUCTURE-FALLBACK — Fallback BODYSTRUCTURE pour images dans import-thread

| Champ | Valeur |
|-------|--------|
| **ID** | PJ-BODYSTRUCTURE-FALLBACK |
| **Catégorie** | pipeline/import |
| **Statut** | `dormant` |
| **Priorité** | P3 |
| **Phase d'origine** | P0-3 |
| **Date** | 2026-04-11 |
| **Déclencheur de réouverture** | Preuve d'une PJ image manquée à l'import IMAP (pas seulement à l'analyse). Cas concret où le fallback BODYSTRUCTURE de `import-thread`/`sync-emails` ne détecte pas une extension image dans sa regex de secours. |
| **Recommandation** | Élargir la regex BODYSTRUCTURE fallback dans `import-thread` et `sync-emails` pour couvrir `.jfif`, `.webp`, `.jpeg` en plus des formats actuels. Non traité car aucune preuve sur le runtime actuel que des PJ sont perdues à l'import (le problème observé était à l'analyse, pas à l'import). |

---

## CLAIM-BULK-POSTGREST — Bulk fetch filter encore dépendant de PostgREST

| Champ | Valeur |
|-------|--------|
| **ID** | CLAIM-BULK-POSTGREST |
| **Catégorie** | Edge Function / PostgREST cache |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | Hotfix RPC claim bypass (2026-04-11) |
| **Date** | 2026-04-11 |
| **Déclencheur de réouverture** | Le mode bulk/start de `analyze-attachments` (sans `attachmentId`) est utilisé en production et échoue avec `column does not exist` sur `analysis_claimed_at`. |
| **Recommandation** | Le pattern E (ligne ~1109 de `analyze-attachments/index.ts`) utilise `.or('analysis_claimed_at.is.null,analysis_claimed_at.lt...')` via PostgREST pour le fetch bulk. Ce filtre reste vulnérable au cache PostgREST obsolète. Solution : créer une RPC `fetch_unclaimed_attachments(p_limit int)` qui retourne les PJ non analysées et non claimées, ou claimées depuis >15 min. Non bloquant pour le flux `build-case-puzzle` qui passe toujours un `attachmentId` explicite. |

---

## ATT-ERROR-RETRY — Mécanisme de reset pour relancer l'analyse des PJ en erreur terminale

| Champ | Valeur |
|-------|--------|
| **ID** | ATT-ERROR-RETRY |
| **Catégorie** | Email pipeline / Attachments |
| **Statut** | `done` |
| **Priorité** | Basse |
| **Phase d'origine** | Stabilisation pipeline PJ (P0+P1) |
| **Date clôture** | 2026-04-13 |
| **Résolution** | RPC `reset_attachment_for_retry` (SECURITY DEFINER) remet la PJ en état vierge (`is_analyzed=false`, `analysis_claimed_at=null`, `extracted_text=null`, `extracted_data=null`) uniquement si `extracted_data->>'type' = 'error'`. Bouton "Relancer l'analyse" ajouté dans `EmailAttachments.tsx` pour statut `error` uniquement. `unsupported` et `skipped` restent non relançables. |
| **Dette résiduelle pipeline PJ** | Observabilité des retries (compteur, historique), chemins parallèles d'analyse, et traçabilité enrichie des resets restent hors périmètre de ce lot. |

---

## COMPOSITE-DOC-2 — Exploitation de documents[] dans build-case-puzzle

| Champ | Valeur |
|-------|--------|
| **ID** | COMPOSITE-DOC-2 |
| **Catégorie** | Extraction / Puzzle pipeline |
| **Statut** | `ouvert` |
| **Priorité** | Haute |
| **Phase d'origine** | COMPOSITE-DOC-1 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Dès que COMPOSITE-DOC-1 est déployé et validé sur un PDF composite réel. |
| **Recommandation** | Dans `build-case-puzzle`, exploiter `extracted_data.documents[]` pour un mapping différencié par `doc_type` : priorité de source par type documentaire (ex: `commercial_invoice` pour `cargo.value`, `bill_of_lading` pour `transport.bl_number`). Ne pas fusionner aveuglément les sous-documents. |

---

## COMPOSITE-DOC-3 — Affichage UI des sous-documents

| Champ | Valeur |
|-------|--------|
| **ID** | COMPOSITE-DOC-3 |
| **Catégorie** | UI / Case documents |
| **Statut** | `done` — implémenté dans `AnalysisResultsDisplay.tsx` (section Collapsible avec doc_type/page_range/confidence/summary) |
| **Priorité** | Moyenne |
| **Phase d'origine** | COMPOSITE-DOC-1 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Quand COMPOSITE-DOC-2 est en place et que les sous-documents sont exploités dans les faits. |
| **Recommandation** | Afficher dans `AnalysisResultsDisplay` et/ou `CaseDocumentsTab` les sous-documents détectés (`documents[]`) avec leur type, plage de pages, et résumé. Permettre à l'opérateur de voir la provenance des données extraites. |

---

## ATT-REANALYZE — Mécanisme de re-analyse pour PJ non-error

| Champ | Valeur |
|-------|--------|
| **ID** | ATT-REANALYZE |
| **Catégorie** | Attachment pipeline / Lifecycle |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | COMPOSITE-DOC-1 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Besoin de re-analyser une PJ déjà analysée (type ≠ error) avec un prompt enrichi. |
| **Recommandation** | `reset_attachment_for_retry` est réservé aux PJ en statut `error`. Il faut un mécanisme propre (ex: RPC dédiée ou flag `force_reanalyze`) pour permettre la re-analyse d'une PJ déjà traitée sans contourner le runtime par manipulation manuelle du type. |

---

## COMPOSITE-DOC-3 — Affichage UI des sous-documents

| Champ | Valeur |
|-------|--------|
| **ID** | COMPOSITE-DOC-3 |
| **Catégorie** | UI / Attachments |
| **Statut** | `done` — fusionné avec l'entrée COMPOSITE-DOC-3 ci-dessus |
| **Priorité** | Basse |
| **Phase d'origine** | COMPOSITE-DOC-2 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Besoin opérateur de voir les sous-documents individuels d'un PDF composite dans l'UI. |
| **Recommandation** | Ajouter un affichage des `documents[]` dans le panneau PJ du CaseView, avec type documentaire et page range. |

---

## FOB-FACT-KEY — Fact key canonique pour valeurs FOB

| Champ | Valeur |
|-------|--------|
| **ID** | FOB-FACT-KEY |
| **Catégorie** | Data model / Cargo values |
| **Statut** | `ouvert` |
| **Priorité** | Moyenne |
| **Phase d'origine** | COMPOSITE-DOC-2 (micro-correction Bonus C) |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Dossier avec valeur FOB distincte de la valeur CIF/CAF et du fret. |
| **Recommandation** | Décider d'une fact key canonique dédiée (`cargo.fob_value` ?) et l'intégrer dans le pipeline d'extraction. FOB ne doit pas être mappé vers `freightValue` (métierment faux). |

---

## COMPOSITE-DOC-TIMELINE — Traçabilité doc_type dans timeline events

| Champ | Valeur |
|-------|--------|
| **ID** | COMPOSITE-DOC-TIMELINE |
| **Catégorie** | Traçabilité / Timeline |
| **Statut** | `ouvert` |
| **Priorité** | Basse |
| **Phase d'origine** | COMPOSITE-DOC-2 |
| **Date** | 2026-04-14 |
| **Déclencheur de réouverture** | Besoin d'audit ou de traçabilité fine sur la provenance documentaire des facts injectés. |
| **Recommandation** | Enrichir `event_data` des timeline events avec le `doc_type` source lors de l'injection COMPOSITE-DOC-2. Retiré du lot initial par consigne CTO. |

---

## Audit CTO consolidé — 2026-04-14

> Cette section distingue strictement les constats prouvés par le repo, les constats issus du runtime/cloud externe, et les sujets restant à confirmer. Aucun point runtime externe ne doit être promu au rang de vérité repo sans preuve dans le dépôt.
>
> Tout correctif technique futur doit mettre à jour cette section au moment du patch.

### A. Confirmé par le repo

| ID | Sévérité | Statut | Preuve | Impact | Plus petit correctif sûr |
|----|----------|--------|--------|--------|--------------------------|
| AUTH-HIST-1 | critical | **patched** (deployed 2026-04-15) | `quotation-engine/index.ts` L383-387 envoie `Bearer ${serviceKey}` à `suggest-historical-lines`. `suggest-historical-lines/index.ts` L152-167 validait via `anonClient.auth.getClaims(token)` — un service role key n'est pas un JWT GoTrue → échec systématique. **Correctif** : dual-path auth ajouté dans `suggest-historical-lines`. Si token === service role key → accepté comme appel interne (userId null, traçabilité via meta `auth_mode: "service_role"`, `caller: "quotation-engine"`). Chemin JWT utilisateur inchangé. Aucun FROZEN touché. Clôture définitive après validation runtime. |
| OUTCOME-AUTH-1 | high | **patched** (deployed 2026-04-15) | `close-commercial-outcome/index.ts` L87 : `userId = authResult.id` corrigé en `userId = authResult.user.id`. `_shared/auth.ts` L15-18 : `AuthResult = { user: { id }, token }` — l'accès direct `authResult.id` retournait `undefined`. **Correctif** : 1 ligne modifiée. Traçabilité opérateur restaurée sur tous les `logRuntimeEvent` et `actor_user_id` des timeline events `status_changed` (SENT→ACCEPTED/REJECTED). Aucun FROZEN touché, aucune migration, logique FSM/idempotence inchangée. |
| UI-ADMIN-1 | medium | **partially_resolved** (= P2B, 2026-04-15) | `QuotationSheet.tsx` L1206 appelle `data-admin` action `create_knowledge`. 403 désormais détecté explicitement côté UI → toast « Action réservée aux administrateurs ». Backend inchangé. Bouton visible (FROZEN Phase 4B). | UX clarifiée, incohérence supprimée. | Résolution complète : dégeler QuotationCompletedBanner ou déplacer endpoint. Voir P2B. |
| TIMELINE-DEDUPE-1 | low | **patched** (deployed 2026-04-15) | `create-quotation-email-draft/index.ts` L370 : ajout `dedupe_key: quotation_email_draft_v1:${versionId}` dans `event_data`. Aligné sur le pattern canonique `{kind}:{id}` utilisé dans `generate-reply-draft`. Aucune migration, aucun FROZEN touché, try/catch best-effort inchangé. |
| GENERATE-RESPONSE-LIVE | medium | watchlist | `emailService.ts` L105, L500 ; `Emails.tsx` L367 ; `QuotationSheet.tsx` L1366 — `generate-response` encore appelé depuis l'UI (fallback C1 + legacy paths). | Fonction legacy vivante, appelle `quotation-engine` (FROZEN). Pas morte. | Aucun correctif immédiat — legacy vivant par design. |

### B. Confirmé par runtime/cloud externe (source : audit Lovable 2026-04-14)

> Les constats ci-dessous proviennent d'observations runtime et requêtes DB live effectuées lors de l'audit. Ils ne sont pas prouvables par le seul dépôt de code.

| ID | Sévérité | Source | Impact | Statut |
|----|----------|--------|--------|--------|
| OBS-HIST-1 | info | `runtime_events` : 126 erreurs AUTH_INVALID_JWT pour `suggest-historical-lines` | Confirmait AUTH-HIST-1 en production réelle. **Résolu** : le patch dual-path auth (2026-04-15) empêche les nouvelles occurrences. Les 126 erreurs historiques restent en base comme trace. | résolu (lié à AUTH-HIST-1 patched) |
| ATTACH-OPS-1 | medium | DB live : 114/259 PJ non analysées (44%) | **Résorbé (2026-04-15).** Batch exécuté : 106 images signature/logo marquées `skipped` (heuristique conservatrice, exclusion dossiers actifs), 2 WMZ clipart marqués `non_document_attachment`. 1 PDF métier analysé (`dap maroc embassy.pdf` → type quotation, 10 lignes). 1 image (`InsertPic_0AB6.jpg`) skippée par pipeline (image temporaire). **Reliquat** : 4 PJ sans `storage_path` (2 ZIP sur DECISIONS_PENDING, 1 PDF sur READY_TO_PRICE, 1 PDF orpheline) — nécessitent `force-download-attachment` si config IMAP disponible. État final : 255/259 PJ traitées (98.5%). | **resolved** (batch opérationnel exécuté, reliquat mineur sans storage) |
| PRICING-RUNS-WATCH-1 | low | DB live : 30 pricing runs `failed`, 20 `blocked` sur 133 total | À surveiller — vérifier si récurrents ou ponctuels anciens | watchlist |
| CONTACTS-DENY-1 | low | pg_policies live : DENY ALL sur table `contacts`. Aucun usage UI actif identifié lors de la revue repo. | Table dormante de facto. | dormant |
| TENDER-POLICY-1 | low | pg_policies live : 2 policies SELECT identiques sur `tender_segments` | Doublon fonctionnel, pas d'impact | watchlist |

### C. Clôturés par audit ciblé (2026-04-15)

| ID | Conclusion | Preuve | Statut |
|----|-----------|--------|--------|
| COMM-SCHEMA-1 | **Pas de drift repo ↔ DB réel** sur les 5 tables canoniques (`external_quote_requests`, `external_quote_responses`, `external_quote_response_facts`, `client_gap_requests`, `partner_response_suggestions`). Colonnes migrations = types générés = DB live. **Drift mineur local uniquement** : interface `ExternalRequest` dans `src/hooks/useExternalRequests.ts` manque `is_selected` et `selected_at` (pas de bug runtime — les composants consommateurs ont leurs propres types inline). Aucune migration manquante. | repo + DB live + types générés | **closed** (drift documentaire mineur, correction facultative) |
| ARCHIVED-WRITER-1 | **Aucun writer canonique actif** identifié dans le runtime. Aucun chemin legacy actif écrivant ARCHIVED. 14 cas ARCHIVED en DB live : absence de timeline `status_changed` → ARCHIVED, 4 cas partagent un `updated_at` identique au ms (`2026-02-16 17:24:02.457612+00`) → batch UPDATE SQL direct (nettoyage pré-production, 2026-02-14/16). Statut protégé par `FROZEN_STATUSES` dans `build-case-puzzle` et `sync-emails`. | repo (recherche exhaustive) + DB live (14 cas, 0 timeline events) | **closed** (origine établie, pas de writer manquant) |
| ATTACH-OPS-1 | **Batch exécuté 2026-04-15.** 108 PJ non pertinentes marquées `skipped` (106 images signature/logo + 2 WMZ clipart) via script SQL ponctuel (pas de migration). 1 PDF analysé avec succès (`dap maroc embassy.pdf`). Heuristique conservatrice : `filename ~ '^[0-9a-f]{8}\.'` ou `LIKE 'Outlook-%'` ou WMZ, avec exclusion explicite des PJ sur dossiers actifs. Aucun `extracted_text` injecté (resté NULL). Reliquat : 4 PJ sans `storage_path` nécessitant re-download IMAP. État final : 255/259 traitées (98.5%). | repo (pipeline code) + DB live (batch vérifié) | **resolved** (batch exécuté, reliquat mineur documenté) |

### D. Ordre exact recommandé des prochains lots

1. ~~**AUTH-HIST-1**~~ — ✅ Patched 2026-04-15 (dual-path auth déployé)
2. ~~**OUTCOME-AUTH-1**~~ — ✅ Patched 2026-04-15 (userId extraction corrigée)
3. ~~**TIMELINE-DEDUPE-1**~~ — ✅ Patched 2026-04-15 (dedupe_key ajoutée)
4. ~~**COMM-SCHEMA-1 / ARCHIVED-WRITER-1**~~ — ✅ Closed 2026-04-15 (audit ciblé, aucun drift structurel, aucun writer manquant)
5. ~~**ATTACH-OPS-1**~~ — ✅ Resolved 2026-04-15 (batch exécuté : 108 PJ skippées, 1 PDF analysé, 4 PJ sans storage en reliquat)
6. EXPORT-QE-FROZEN (déjà deferred)
7. Dette secondaire (tender policy doublon, CaseView taille)

---

## QUOTE-QUALIFICATION-MODEL — Modèle canonique de qualification commerciale du devis

| Champ | Valeur |
|-------|--------|
| **ID** | QUOTE-QUALIFICATION-MODEL |
| **Catégorie** | Contrat produit / Pricing output |
| **Statut** | `in_progress` |
| **Priorité** | Haute |
| **Phase d'origine** | QQM-1 |
| **Date** | 2026-04-16 |
| **Déclencheur de réouverture** | Chaque lot terminé déclenche le suivant |
| **Recommandation** | Modèle à 3 niveaux (firm/provisional/partial) porté par le snapshot de version, pas par le statut FSM. |

### Décision produit

La qualification commerciale du devis est distincte du statut FSM dossier (`quote_cases.status`). Elle est portée par `quotation_versions.snapshot.meta.quoteQualification`.

### Ordre des lots

1. **Lot 1 — Documentation canonique** : définitions, reason codes, distinction qualification/statut FSM → `done` (2026-04-16)
2. **Lot 2 — Version snapshot** : `generate-quotation-version` enrichit `snapshot.meta.quoteQualification` avec fallback `firm` → `done` (2026-04-16)
3. **Lot 3 — Wording surfaces & harmonisation TO_CONFIRM** : PDF, email draft, QuotationVersionCard, PricingResultPanel affichent la qualification et les réserves ; garantie d'intégrité writer + lecture historique → `done` (2026-04-21)
   - **Sous-lot 3D-1** — Backend snapshot writer : helper pur `qqm-resolver.ts` + intégration `generate-quotation-version/index.ts`. Un snapshot ne peut plus être stocké `firm` si `tariff_lines` contient `TO_CONFIRM`. Test Deno `qqm_lot3d_snapshot_resolver.test.ts` (9/9 PASS) → `closed` (2026-04-21)
   - **Sous-lot 3D-2** — Garde lecture historique sur 3 helpers consommateurs : `export-quotation-version-pdf/index.ts`, `create-quotation-email-draft/index.ts`, `src/components/puzzle/QuotationVersionCard.tsx`. Upgrade `firm` → `provisional` à la lecture pour les versions persistées avant 3D-1 → `closed` (2026-04-21)
   - **Sous-lot 3D-3** — Preview pricing : `src/components/puzzle/PricingResultPanel.tsx`. Helper local `resolveQualificationFromRun`, badges `Ferme` / `Provisoire` / `Partiel`, badge legacy `isProvisional` renommé "Communication en cours", bandeau étendu pour `provisional` sans TO_CONFIRM (DDP `MISSING_CARGO_VALUE`) → `closed` (2026-04-21)
   - **Détection TO_CONFIRM** : supporte `source: "TO_CONFIRM"` (legacy string) ET `source: { type: "TO_CONFIRM" }` (format actuel) sur les 5 surfaces.
   - **Risque corrigé** : un devis avec ligne TO_CONFIRM ne peut plus être stocké ni rendu `firm` sur writer, lecture historique (PDF/email/UI) ou preview pricing.
   - **Hors périmètre 3D** : aucun FROZEN modifié, aucune migration DB, aucun `STATUS_REGISTRY` (QQM = qualification commerciale, pas statut FSM dossier), aucun pricing recalculé.
4. **Lot 4 — Pilote DDP** : assouplir le blocage `cargo.value` pour DDP en utilisant `provisional` + `MISSING_CARGO_VALUE` → `planned`

**Garde-fou** : No relaxation of DDP hard blocker before version/PDF wording is ready (Lot 3 requis avant Lot 4 → satisfait 2026-04-21).

---

## QQM-FACTORIZE — Factorisation différée des helpers de qualification QQM

| Champ | Valeur |
|-------|--------|
| **ID** | QQM-FACTORIZE |
| **Catégorie** | Dette technique / Refactor |
| **Statut** | `deferred` |
| **Priorité** | P3 (basse) |
| **Phase d'origine** | Lot 3D (2026-04-21) |
| **Date** | 2026-04-21 |
| **Déclencheur de réouverture** | Ajout d'un nouveau reason code QQM **OU** ajout d'une nouvelle surface qui consomme la qualification commerciale |
| **Recommandation** | Factoriser ou centraliser la table de décision QQM dans un helper partagé si un nouveau reason code ou une nouvelle surface de rendu est ajoutée. Maintenir la duplication actuelle tant que les 5 implémentations restent stables. |

### Contexte

Lot 3D a délibérément accepté la duplication de la table de décision QQM sur 5 implémentations :

1. **Backend writer canonique** : `supabase/functions/generate-quotation-version/qqm-resolver.ts` (Deno, helper pur testé)
2. **Consumer PDF** : `supabase/functions/export-quotation-version-pdf/index.ts` (garde lecture historique)
3. **Consumer email draft** : `supabase/functions/create-quotation-email-draft/index.ts` (garde lecture historique)
4. **Consumer UI version card** : `src/components/puzzle/QuotationVersionCard.tsx` (garde lecture historique)
5. **Consumer UI preview pricing** : `src/components/puzzle/PricingResultPanel.tsx` (résolution live depuis `outputs_json` + `tariff_lines`)

### Justification de la duplication actuelle

- Refactor cross-runtime (Deno edge functions / React frontend / `_shared`) coûteux.
- Les 5 implémentations partagent la même table de décision validée par les tests Deno de 3D-1 + diff réel de 3D-2/3D-3.
- ROI insuffisant tant qu'aucune évolution fonctionnelle n'est prévue.

### Réserve non-bloquante observée

`PricingResultPanel.tsx` : le compteur `toConfirmCount` et le highlight de lignes lisent encore uniquement `l.source?.type === 'TO_CONFIRM'` (pas la string legacy). Compatible cas courant (format actuel = objet). À traiter dans le micro-lot factorize si déclenché, pas en réouverture isolée.

---

Cet inventaire couvre les sources suivantes :
- **Repo** : `MASTER_CONTEXT.md`, `STATUS_REGISTRY.md`, `SECURITY_CONTRACT.md`, `PHASE_15_NOTES.md`, `DECISIONS.md`, `AUDIT_METIER_P0_PROTOCOL.md`, `.lovable/plan.md`, code runtime
- **Chats** : phases M18d → M27b (session de stabilisation complète)
- **Audit CTO consolidé** : 2026-04-14 (repo + runtime/cloud externe)

Les sujets reportés dans des conversations antérieures (pré-M18d) qui n'auraient laissé aucune trace dans le code ou la documentation ne sont **pas** listés ici. Pour les capturer, fournir les résumés/prompts des anciens chats.

---

## LOT12-COVERAGE — Couverture smoke tests Lot 1.2 incomplète

| ID | Catégorie | Statut | Priorité | Phase d'origine | Date | Déclencheur de réouverture | Recommandation |
|----|-----------|--------|----------|----------------|------|---------------------------|----------------|
| LOT12-COVERAGE-A | Smoke multi-lot non-export | `deferred` | basse | Lot 1.2 (G1.2) | 2026-04-25 | Apparition d'un pricing_run multi-lot non-export en base | Rejouer un smoke test ciblé sur la branche `[LOT1.2][multi-lot N]` côté `run-pricing` |
| LOT12-COVERAGE-B | Symétrie log branche export | `deferred` | basse | Lot 1.2 (G1.2-D) | 2026-04-25 | Lot 2 ou audit de la branche export | Ajouter un log `[LOT1.2][export-direct]` côté `run-pricing/index.ts:1042` pour symétriser la preuve avec la branche non-export |
| LOT12-D-DRIFT | Dérive non-régression export `76c9819c…` | `deferred` | moyenne | Lot 1.2 (G1.2-D) | 2026-04-25 | Avant Lot 2 ou en parallèle | Investiguer la dérive 750k→1M XOF / 60→35 lignes entre 2026-04-07 et 2026-04-25 sur `EXPORT_SENEGAL` (cause probable : clôture Lot 1 Taleb_Quote / port_tariffs). Hors-périmètre Lot 1.2 (`client_code` reste `null`). |

---

## LOT2-REV-A — Quarantaine Aksa Energy (CLOS)

| Champ | Valeur |
|-------|--------|
| **ID** | LOT2-REV-A |
| **Catégorie** | Pricing / Data Governance |
| **Statut** | **CLOS — exécuté 2026-05-02** |
| **Priorité** | P1 |
| **Phase d'origine** | Lot 2 révisé |
| **Date** | 2026-05-02 |
| **Action** | 81 lignes `AKSA_ENERGY` mises en quarantaine : `is_active=false`, `evidence_level='historical_only'`, note de quarantaine idempotente. Aucune suppression physique. |
| **Preflight** | 6 contrôles SELECT passés (avec `IS DISTINCT FROM`). |
| **Post-migration** | 0 Aksa active, 81 quarantinées, 10 génériques intactes. |
| **Smoke tests** | G7 PASS (0 fuite Aksa), G9 PASS (non-régression aérien), anti-fuite globale PASS. G6-REV non exécutable (blocking gap `pad_category` pré-existant sur `03ccf66d`). |
| **Tests abandonnés** | G6 ancien (injection Aksa), G8 ancien (injection Velingara) — plus pertinents. |
| **Décision CTO** | Les 81 lignes Aksa proviennent d'une cotation ponctuelle historique, pas d'un tarif client contractuel. Elles ne doivent plus alimenter le moteur de pricing. |

---

## LOT2-REV-B — Audit transport officiel Sénégal

| Champ | Valeur |
|-------|--------|
| **ID** | LOT2-REV-B |
| **Catégorie** | Pricing / Data Governance |
| **Statut** | `à_faire` |
| **Priorité** | P2 |
| **Phase d'origine** | Lot 2 révisé |
| **Date** | 2026-05-02 |
| **Objectif** | Retrouver et auditer le document officiel `TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS`. Vérifier s'il couvre plus que les 5 destinations actuellement en base. Comparer document vs base. Lister les lignes manquantes. |
| **Déclencheur** | Disponibilité du fichier officiel complet. |
| **Recommandation** | Ne promouvoir aucune ligne sans preuve documentaire. |

---

## LOT2-REV-C — Ingestion officielle transport Sénégal

| Champ | Valeur |
|-------|--------|
| **ID** | LOT2-REV-C |
| **Catégorie** | Pricing / Data Governance |
| **Statut** | `à_faire` — dépend de LOT2-REV-B |
| **Priorité** | P2 |
| **Phase d'origine** | Lot 2 révisé |
| **Date** | 2026-05-02 |
| **Objectif** | Insérer / activer uniquement les lignes prouvées par document officiel ou validation SODATRA. `evidence_level='official'` ou `'sodatra_grid'`. |
| **Déclencheur** | Clôture LOT2-REV-B avec mapping complet destinations × container types. |
| **Recommandation** | Migration data traçable. Aucun tarif inventé. |
