# Dakar Cargo Quotes — feuille de route CTO canonique

## 1. Objet et statut

Ce document est le point de reprise canonique du développement après l'audit CTO du 22 août 2026.

Il sert à :

- conserver l'état vérifié du dépôt Git et de Lovable Cloud ;
- distinguer les travaux terminés de ceux restant à livrer ;
- imposer l'ordre P0, P1 puis P2 ;
- définir les tests, risques, conditions d'arrêt et autorisations nécessaires ;
- permettre à une nouvelle session de reprendre sans dépendre de l'historique d'une conversation.

Statut produit au 29 août 2026 : **PASS du P0 technique, de la recette LoLo privée et de P1-A1 à P1-A5 Git + Lovable runtime avec nettoyage ; NO-GO maintenu pour une production générale**.

Mise à jour du 1er septembre 2026 : **PASS P1-B Git + recette privée Lovable et nettoyage.** Le défaut de synchronisation sélection/brouillon est corrigé dans le commit `f54951f081e426bf204c7c87f84385e890f4fdc1`, aligné GitHub/Lovable, CI `33337511099` réussie. Nouvelle recette : sélection v1/v2 sans rechargement, brouillon absent ou historique correctement isolé, éditions non sauvegardées non réutilisées, aucun envoi ; concurrence RPC sur deux transactions réellement chevauchantes, une seule décision créée puis même ID en rejeu, conflits refusés. Les 23 lignes fictives créées ont été supprimées ; baselines 64 dossiers/162 runs/9 versions/45 brouillons/5 users/0 décision et 35 empreintes retrouvées, six catalogues et migration inchangés. Les preuves précédentes de calcul/PAD/PDF complètent cette recette ciblée, qui utilise des snapshots synthétiques et ne constitue pas une nouvelle preuve de génération ou d'envoi. **P1-C1, P1-C2-A et P1-C2-B, y compris la saisie humaine typée des assertions, sont terminés et testés localement.** P1-C2-B ajoute l'orchestration Edge authentifiée, la consolidation manuelle sourcée et la revue opérateur, toujours sans pricing. L'extraction automatique reste volontairement hors périmètre ; l'activation Git/runtime et P1-C3 (projection contrôlée) restent à livrer. Aucun runtime P1-C, commit ou push n'a été effectué ; cette mise à jour reste locale.

Mise à jour du 11 septembre 2026 : **pack DTHC-4 livré et déployé ; deux risques structurels découverts et consignés, non traités.** Grille THC rattachée à sa source réelle — arrêté ministériel n° 035532 du 28/11/2023, JORS n° 7723 du 06/04/2024 p. 471 (`c48f0119`), après correction d'une erreur d'analyse de Claude Code sur le relevage transit, restauré à 36 560 / 73 120 / 82 260 FCFA par TEU (`fa3f2186`, migration appliquée en base live et vérifiée). Sous-lots : A — le fait `cargo.dangerous_goods` atteint enfin le moteur DTHC (`5b34d0ac`) ; B — le 20 pieds high cube entre dans la grille (`623f99e4`) ; C — les équipements spéciaux réellement déclarés résolvent, `20FL`/`40FL` adossés à la facture DP World 3384292 (`2488c7d7`) ; D1/D2 — lignes THC non canoniques retirées et colonne « Unité » explicitée au devis. Décision CTO actée : spécial × dangereux = 310 000 + 50 % = 465 000 ; relevage 18 280 par EVP, doublé au 40 pieds. Refus assumé et verrouillé par test : la hauteur ne fait pas le hors gabarit au sens DP World, et aucun routage tarifaire ne se fait sur le poids sans texte le prévoyant.

Mise à jour du 11 septembre 2026 (suite) : **T6 — filet de cohérence des types de conteneur, et T1 — le 20 pieds high cube à la livraison terrestre** (`a34bd893`, `7bccf58e`). Constat structurant : un type de conteneur est déclaré dans quatre tables indépendantes réparties sur trois modules, sans aucun lien entre elles ; un type ajouté d'un seul côté produit un devis à moitié chiffré sans erreur visible. Le filet (`_shared/container-type-consistency_test.ts`) verrouille quatre invariants et nomme la seule exclusion légitime (45 pieds, hors barème 20P/40P) ; relancé sur les sources d'avant le lot, il échoue sur 3 de ses 5 tests, il n'est donc pas décoratif. Il a révélé une dérive introduite par DTHC-4-C lui-même (`20FL`/`40FL` absents d'`EVP_CONVERSION`, corrigés) et deux trous côté livraison (`20HC`/`20HQ` et les formes courtes `20ST`/`40ST`). Preuves : 282 tests Deno `_shared` PASS, 323 vitest PASS, typecheck PASS, lint baseline 737/16 inchangé, build PASS ; `typecheck:deno` NOT_RUN (imports distants injoignables depuis l'environnement agent), compensé par `deno check` local sur le périmètre, PASS. Aucune migration, aucun composant FROZEN touché, aucun montant modifié.

Risques découverts le 11 septembre 2026, **consignés et volontairement différés par décision CTO** — détail dans `docs/DEFERRED_BACKLOG.md` : `EMAIL-INGEST-SECURITY-1` (ingestion IMAP manuelle et trouée par construction ; cinq fonctions mail gardées par `requireUser` sans contrôle de rôle, donc lisibles par tout compte authentifié ; comptes de test résiduels en production ; mot de passe IMAP stocké en clair) et `TRANSPORT-SPECIAL-CASE-1` (la règle de poids TRUCKING-22T sature au tarif 40 pieds, `isOOG` n'est jamais positionné par aucun écrivain, aucune notion de véhicule requis, aucun code ISO 6346 reconnu en entrée). Ces deux entrées sont **ouvertes** et prioritaires à la reprise.

La reconstruction et la réconciliation des migrations sont terminées. Le parcours authentifié LoLo a été prouvé jusqu'au brouillon non envoyé puis intégralement nettoyé. P1-A2 fournit sur Git et Lovable l'objet scénario versionné, sa sélection et sa comparaison, sans pricing. P1-A3 ajoute la promotion explicite, unitaire et attestée d'une hypothèse vers un fait non monétaire. P1-A4 fournit sur Git et Lovable un ledger et un calcul de pricing isolés par scénario, sans contamination des faits ni du pricing canonique. P1-A5 fournit sur Git et Lovable des sorties de travail versionnées, PDF et brouillons non envoyés qui exposent le scénario, les hypothèses, exclusions, réserves et doubles totaux sans jamais devenir un devis canonique ou ferme ; la recette runtime partielle/bloquée, l'idempotence, la non-sélection, l'absence d'envoi et le nettoyage intégral sont prouvés. La production générale reste conditionnée par la gouvernance des comptes Auth et par la validation des familles tarifaires encore hors du périmètre ferme ; RoRo/ConRo reste fail-closed sans barème Dakar Terminal vérifié.

## 2. Sources de vérité et règles d'autorité

- Dépôt : `douania/dakar-cargo-quotes`.
- Branche obligatoire : `work`.
- Source statique principale : GitHub, branche `work`.
- Runtime canonique : Lovable Cloud.
- Projet Lovable : `c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef` (`dakotation-pro` / Dakar Cargo Quotes).
- Dernier alignement applicatif Git local/GitHub : `f54951f081e426bf204c7c87f84385e890f4fdc1`, revérifié à la clôture locale P1-C2-B le 1er septembre 2026 ; `origin/work` et GitHub au même SHA. Précontrôle Lovable strictement read-only le 1er septembre : projet privé attendu, dernier élément d'historique au même intitulé que ce commit et aucun événement plus récent ; la vue consultée n'expose pas le SHA cryptographique complet, donc ne pas revendiquer cette preuve byte-identique. La migration `20260831120000`, les huit tables `final_request_*`, les fonctions `frs_%` et l'Edge `manage-final-request-state` sont absentes, sans collision. Le compte cotateur SODATRA est confirmé/non bloqué et un compte `test.local` confirmé, déjà connecté et non bloqué existe pour la future preuve négative ; aucune session n'a été créée. La CI GitHub `33337511099` réussie concerne P1-B seulement. Diff local attendu : la roadmap ; les deux fichiers P1-C1 ; les quatre fichiers P1-C2-A, dont migration et test SQL amendés par le hotfix de hash ; les dix nouveaux fichiers P1-C2-B incluant l'adaptateur/éditeur typés ; l'insertion du panneau dans `CaseView.tsx` et la section de fonction dans `supabase/config.toml`. Tous sont non commités. P1-C1 et l'adaptateur/test P1-C2-A sont restés byte-identiques. Contrôler ce périmètre exact à chaque reprise. Les anciens SHA cités ci-dessous sont des preuves historiques.
- Preview observée : `https://id-preview--c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef.lovable.app`.
- État Lovable observé : projet privé, prêt, authentification visible, non publié.

L'identité du commit ci-dessus est un point de repère historique, pas une exigence permanente. Toute reprise doit relever le nouveau `HEAD`, `origin/work` et le SHA Lovable, puis expliquer tout écart avant de travailler.

Règles non négociables :

- aucun patch, commit, push, migration, déploiement ou changement runtime sans GO CTO correspondant ;
- une seule IA applique un même lot à la fois ;
- corrections chirurgicales uniquement, sans refactor global ;
- préserver Auth, RLS, idempotence, intégrité des données, traçabilité et stabilité runtime ;
- ne jamais transformer une hypothèse ou une proposition tarifaire en montant ferme sans validation explicite ;
- ne jamais modifier un composant FROZEN sans justification et validation CTO ;
- Lovable Cloud ne doit être interrogé ou modifié que dans le périmètre exact du GO CTO ;
- les requêtes runtime de diagnostic doivent être en lecture seule sauf autorisation explicite contraire.

### 2.1 Organisation des lots et contre-revues — décision utilisateur du 14 septembre 2026

- Règle durable approuvée par l'utilisateur : travailler par lot cohérent, pas par succession de micro-GO ; ne pas redemander l'approbation de cette méthode à chaque reprise.
- Au départ, fixer objectif utile à l'application entière, fichiers/composants autorisés et interdits, exécutant unique, critères de réussite, tests proportionnés, risques, rollback et actions nécessitant une autorisation distincte.
- Un GO de réalisation couvre les corrections et tests nécessaires dans ce périmètre jusqu'à satisfaction des critères. Le découpage technique interne, le nombre de fichiers déjà autorisés et une reprise de session ne créent pas de nouveaux GO ; aucun élargissement implicite.
- Une seule IA écrit ; l'autre reste en lecture seule. Une contre-revue indépendante complète est requise pour migrations/DB, Auth/RLS, sécurité, pricing/tarifs, intégrité/provenance des données ou rollback sensible ; pour un lot simple sans ces risques, auto-revue du diff et tests suffisent, sauf demande utilisateur.
- La contre-revue regroupe les observations en une liste : BLOQUANT (preuve, risque, critère non satisfait, correction attendue) ou NON BLOQUANT (amélioration différable). Corriger ensemble les observations retenues dans le GO, puis revoir seulement les points bloquants et les parties affectées ; ne pas recommencer un audit général.
- Ne rouvrir un point accepté que sur preuve nouvelle, régression ou changement de périmètre, en nommant précisément ce qui a changé. Un désaccord persistant entre IA donne un arbitrage utilisateur unique et argumenté, pas une boucle exploratoire. L'avis d'une IA n'est pas un GO utilisateur.
- À la clôture, un seul bilan compact : critères atteints/restants, diff, tests PASS/FAIL/NOT_RUN, réserves et retour arrière. Un lot non vérifié reste PARTIAL/BLOCKED ; ne jamais limiter artificiellement les revues au prix d'un défaut critique ignoré.
- Un GO de publication distinct peut regrouper commit, push sur work, migrations, déploiement privé et recette si chaque action et son périmètre y sont explicitement nommés. Aucune action non incluse, aucun envoi client implicite ; contrôler les résultats dans l'application après livraison.
- Application immédiate au lot scénarios D/E/G + option B : Codex exécutant, Claude contre-relecteur ; prochaine revue de clôture sur les blocages précis avant publication. Ce GO d'organisation n'autorise ni nouvelle correction applicative, ni commit/push, ni écriture Cloud/déploiement.
- Les règles FROZEN, sources tarifaires, sécurité et STOP restent applicables. Un nouveau risque bloquant ou une action hors GO impose un arbitrage ciblé, pas une remise en discussion de toute l'organisation.
- Portée de cette mise en place : consignes locales AGENTS/CLAUDE et roadmap uniquement ; contrôle documentaire et diff-check, tests applicatifs NOT_RUN car aucun code modifié. Retour arrière : retirer seulement ces changements de gouvernance, préserver le lot applicatif antérieur ; aucun impact DB/Auth/RLS/runtime.

## 3. Travaux vérifiés comme terminés

### 3.1 Réconciliation des migrations

- Le dépôt local peut reconstruire la base avec un premier reset intégralement vert.
- Les migrations locales manquantes nécessaires à la reconstruction ont été restaurées ou précédées par des migrations de réconciliation idempotentes.
- Les blocages successifs concernant `quote_service_pricing`, `email_drafts.created_by`, `demurrage_rates`, `demurrage_tiers` et PAD ont été analysés puis réconciliés localement.
- Les versions Git et Lovable identifiées pendant le chantier ont été rapprochées.
- Le rattrapage autorisé du ledger de migrations Lovable a été effectué sans dérive observée des données métier ou des catalogues.
- Le dépôt, `origin/work` et Lovable étaient alignés sur le SHA indiqué à la section 2 à la fin de ce chantier.

Ne pas recommencer ce chantier sans nouvelle preuve de divergence.

### 3.2 Fondations fonctionnelles déjà présentes

- Architecture React/Vite, routes opérateur et administration.
- Authentification et protections backend présentes sur les Edge Functions auditées ; `healthz` est le seul endpoint volontairement public identifié.
- RLS activée sur les tables métier critiques contrôlées.
- Modèle dossiers, faits, gaps, exécutions pricing et versions de devis.
- Fondation multi-cargo et lignes cargo canoniques.
- Import/adoption/synchronisation du cargo canonique.
- Table `quote_scenario_assumptions` et panneau de consultation en lecture seule.
- Moteur et panneau de propositions de frais maritimes en mode strict `proposal_only`.
- Garde PAD présente dans `run-pricing` via `resolvePadScopeBlocker`.
- Versionnement des devis et brouillons de demandes d'informations/partenaires.

Ces fondations ne signifient pas que les parcours opérationnels associés sont tous complets.

### 3.3 Lot dégraissage n°1 — suppression des orphelins vérifiés et déroutage `/quotation` (4 septembre 2026)

GO CTO reçu après audit de trajectoire du 4 septembre 2026. Périmètre exécuté, sans toucher aux zones FROZEN, migrations, DB/RLS/Auth :

- suppression de 4 Edge Functions sans aucun appelant dans le dépôt (frontend, inter-fonctions, migrations, scripts) : `find-similar-quotations`, `import-historical-quotation`, `reclassify-threads`, `hs-lookup`, et de leurs 4 sections `supabase/config.toml` (gate bidirectionnelle repassée : 96 fonctions / 96 sections) ;
- suppression de 8 modules frontend jamais importés : `QuotationRequestCard.tsx`, `NavLink.tsx`, `truck-loading/OptimizationConfig.tsx`, `truck-loading/LoadingPlanViewer.tsx`, `HistoricalSuggestionsCard.tsx`, `useHistoricalSuggestions.ts`, `useEmails.ts`, `lib/api/firecrawl.ts` ;
- `src/lib/fetchWithRetry.ts`, initialement candidat, a été **retiré du lot** après contre-vérification : il est importé par `Dashboard.tsx` et `admin/Emails.tsx` ;
- déroutage du chemin legacy : `/quotation/new` redirige vers `/intake`, `/quotation/:emailId` vers `/` ; les 4 points d'entrée internes (`Dashboard`, `KnowledgeSearch`, `HistoricalRateReminders`, `admin/QuotationHistory`) ne pointent plus vers `/quotation`. La fonctionnalité « Utiliser comme modèle » de l'historique, déjà morte (elle écrivait un `sessionStorage` que plus rien ne lit), a été retirée ;
- `src/pages/QuotationSheet.tsx` est conservé volontairement (réversibilité) ; sa suppression, ainsi que la clôture de la lignée `quotation_history` (`create-quotation-draft`, `generate-quotation`, `generate-quotation-pdf`, `useQuotationDraft`), relève d'un lot dégraissage n°2 sous GO distinct après recette runtime ;
- baseline lint verrouillée à la baisse : 756 → **749** erreurs.

Preuves locales : gate configuration 96 fonctions PASS ; typecheck app/node PASS ; 372 tests Vitest PASS (20 fichiers) ; lint baseline 749/27 PASS ; build PASS (avertissement de taille connu). Les deux gates Deno n'ont pas pu tourner localement (`deno.land` bloqué par la politique réseau de l'environnement d'exécution) ; aucun test Deno ne référence les fonctions supprimées et la CI GitHub reste le juge sur ces deux gates. Aucune migration, donnée runtime ou composant FROZEN touché.

### 3.4 Lot dégraissage n°2 — clôture de la lignée devis legacy (4 septembre 2026)

GO CTO reçu dans la continuité du lot n°1. Périmètre exécuté, sans migration, DB/RLS/Auth ni composant FROZEN :

- suppression de `src/pages/QuotationSheet.tsx` (déroutée au lot n°1, plus aucun importeur), de `src/features/quotation/hooks/useQuotationDraft.ts` et de `src/components/QuotationPdfExport.tsx` (importé uniquement par QuotationSheet, seul invocateur de `generate-quotation-pdf`) ;
- suppression des 3 Edge Functions de la lignée legacy `quotation_history` : `create-quotation-draft`, `generate-quotation`, `generate-quotation-pdf`, et de leurs sections `supabase/config.toml` (gate bidirectionnelle : 93 fonctions / 93 sections) ;
- nettoyage des références résiduelles : 6 entrées du smoke test live `phase15_smoke_test.ts` et 2 entrées de rate-limit dans `_shared/runtime.ts` (fichier non FROZEN) ;
- la table `quotation_history` et la page admin de consultation restent intactes ; `generate-quotation-version` / `export-quotation-version-pdf` (lignée courante) sont désormais l'unique chemin de génération devis/PDF ;
- les modules rendus orphelins par cette suppression (dont les six composants FROZEN Phase 3B, `SimilarQuotationsPanel`, `LearnFromEmailPanel`, `QuotationExcelExport`, `CargoLinesForm`, `ServiceLinesForm`, `QuotationPreview`, `QuotationTotalsCard`, `useCargoLines`, `useServiceLines`) sont **volontairement conservés** : leur sort relève d'un lot n°3 sous GO distinct, avec vérification individuelle des importeurs et arbitrage FROZEN ;
- baseline lint verrouillée à la baisse : 749/27 → **744/19**.

Preuves locales : gate configuration 93 fonctions PASS ; typecheck app/node PASS ; 372 tests Vitest PASS ; lint baseline 744/19 PASS ; build PASS. Gates Deno locaux toujours bloqués par la politique réseau ; juge : CI GitHub.

### 3.5 Lot dégraissage n°3 — orphelins induits par le déroutage legacy (4 septembre 2026)

GO CTO reçu. Méthode : analyse d'atteignabilité complète du graphe d'imports depuis `main.tsx`, comparée entre l'état antérieur au lot n°1 et l'état courant, pour ne supprimer que les modules rendus injoignables par la clôture du parcours legacy — jamais de la dette antérieure sous ce GO.

- **32 fichiers supprimés (~4 800 lignes)**, tous vérifiés sans importeur vivant : `HistoricalRateReminders`, `LearnFromEmailPanel`, `SimilarQuotationsPanel`, `puzzle/ClarificationPanel`, les 11 composants `features/quotation/components` (dont les **six FROZEN Phase 3B** — arbitrage : le gel protégeait leur comportement dans le parcours legacy, désormais clos ; tableau README mis à jour), `domain/` complet, `useCargoLines`, `useServiceLines`, `threadLoader`, `types.ts`, `utils/{parsing,consolidation,detection}`, `useQuotationHistory`, `useTariffSuggestions`, et les 3 fichiers de tests de ces modules (−23 cas Vitest, tous sujets morts).
- `features/quotation/constants.ts` conservé (encore importé par l'app vivante). `BlockingGapsPanel` et `QuotationExcelExport` conservés (utilisés par les modales admin).
- **Dette morte antérieure au lot n°1, volontairement hors périmètre et à arbitrer séparément** : 17 primitives shadcn `src/components/ui/*` jamais importées, et `src/lib/pad/{resolvePadClassification,invoiceLabelAliases,types}.ts` + test (copie frontend morte du résolveur PAD, doublonnant `_shared/pad/` backend — sensible, ne pas supprimer sans arbitrage PAD).
- Baseline lint verrouillée : 744/19 → **742/19**.

Preuves locales : typecheck app/node PASS ; 349 tests Vitest PASS ; lint baseline 742/19 PASS ; build PASS ; configuration 93 fonctions inchangée. Aucune fonction Edge, migration, donnée ni policy touchée.

Contrôle runtime Lovable du 4 septembre 2026, lecture seule (portée : lots n°1-3) : projet synchronisé sur `9d49a452`, preview fonctionnelle ; baselines métier intactes (162 runs / 9 versions / 45 brouillons / 5 users ; 72 dossiers vs 64 au 31 août, croissance organique email) ; `quotation_history` intacte (87 lignes) ; ledger migrations aligné (`20260902120000`). **Résiduel connu** : sondes HTTP (`healthz` 200, `hs-lookup` 401) — les 7 fonctions supprimées du dépôt restent déployées en zombie dans le runtime, authentification et RLS toujours actives, plus aucun appelant dans le code. **Résiduel clos le 4 septembre 2026** : sous GO runtime dédié, l'agent Lovable a dépublié les 7 fonctions via `supabase delete_edge_functions` et vérifié les sondes HTTP à 404 (7/7), sans toucher aucun fichier, fonction restante, migration, donnée ni secret ; sandbox Lovable aligné sur le HEAD `work` du moment (`eeab68a5`, lot n°4).

### 3.6 Lot dégraissage n°4 — dette morte antérieure, volet PAD inclus (4 septembre 2026)

GO CTO reçu (« lot n°4 complet avec le volet PAD »). Atteignabilité re-vérifiée après le lot n°3 : exactement 20 fichiers morts restants, tous supprimés :

- **17 primitives shadcn `src/components/ui/`** jamais importées (~1 830 lignes) : aspect-ratio, breadcrumb, carousel, chart, context-menu, drawer, dropdown-menu, form, hover-card, input-otp, menubar, navigation-menu, pagination, resizable, toggle, toggle-group, use-toast. Réintroduction possible à tout moment via la CLI shadcn.
- **Copie frontend du résolveur PAD** `src/lib/pad/{resolvePadClassification,invoiceLabelAliases,types}.ts` + test Vitest (26 cas). Arbitrage PAD : les trois fichiers ont été prouvés **byte-identiques** à `supabase/functions/_shared/pad/` (seule différence : suffixes d'import `.ts` Deno) — doublon pur, aucune logique ni doctrine perdue ; la source de vérité unique reste le backend `_shared/pad/`, couvert par son propre test Deno en CI.
- Baseline lint verrouillée : 742/19 → **742/16**.

Preuves locales : typecheck app/node PASS ; 323 tests Vitest PASS (−26, doublons PAD) ; lint baseline 742/16 PASS ; build PASS ; 93 fonctions Edge inchangées. Aucune migration, donnée, policy ni fichier backend touché. Le frontend ne contient plus aucun fichier applicatif injoignable depuis `main.tsx`.

### 3.7 Décision tarifaire — transport intérieur Sénégal (4 septembre 2026)

Décision métier SODATRA explicite : le transport intérieur Sénégal est coté **exclusivement** par la grille officielle `TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS` (60 lignes `local_transport_rates` actives, `validated_internal`, débours TTC — héritage P0-D). Tous les autres tarifs applicatifs pour les mêmes destinations sont éliminés :

- **6 `pricing_rate_cards` rejetées** (live + migration Git idempotente `20260904140000`) : TRUCKING zone urbaine 20DV/40HC, Dakar→Saint-Louis, Dakar→Kédougou (3 500 000 XOF contre 1 739 320 officiel — divergence qui justifiait à elle seule le rejet), ON_CARRIAGE zone Dakar, et la ligne LCL à 0 XOF. État live vérifié après application : 29 `to_confirm` + 6 `rejected`.
- Les TRUCKING transit (Bamako/Banjul) ne sont pas de l'intérieur Sénégal : conservées `to_confirm` pour la phase 2.
- Les 81 `local_transport_rates` `historical_only` inactives restent en l'état (historique, non cotable) ; aucune suppression de données.
- Constat annexe : la « formule par km » évoquée n'existe ni dans le code ni dans les docs — seule la grille fixe par destination est intégrée. Si un tarif hors des 30 destinations officielles est demandé, c'est un gap, pas un calcul improvisé.

Extension DTHC (même jour, même décision métier) : le DTHC import est coté exclusivement par le tarif officiel DP World (`port_tariffs`, `DPW_TARIFS_2025_0001.pdf`, `official`, module fail-closed DTHC-1 branché sur `quotation-engine` et `price-service-lines`). Les **4 rate cards DTHC import**, doublons divergents (250 000 vs 155 000 XOF pour un 20' standard ; 350 000 vs 310 000 pour un 40' ; 450 000 vs 341 000 reefer), sont rejetées — live + migration `20260904150000`. État live vérifié : 25 `to_confirm` + 10 `rejected`. Les 3 DTHC transit restent `to_confirm` (phase 2 : la ligne officielle Transit TRIE existe mais inactive ; fail-closed maintenu). Extension EMPTY_RETURN (même jour) : décision métier SODATRA explicite — le retour de conteneur vide est une **obligation contractuelle, pas un service facturable**. Le moteur appliquait déjà cette doctrine (règle V4.1.6 de `price-service-lines` : `EMPTY_RETURN = 0`, « Obligation contractuelle client, non facturé en import SN »). Les **5 rate cards EMPTY_RETURN** (import ×3, transit ×2, 150 000/200 000 XOF), contradictoires avec le moteur, sont rejetées — live + migration `20260904160000` (rejet par `service_key`). État live vérifié : 20 `to_confirm` + 15 `rejected`. Un éventuel cas transit facturable futur passera par une nouvelle ligne sourcée + décision CTO, jamais par réactivation.

**Promotion des premiers tarifs cotables (même jour, GO SODATRA explicite)** : `AGENCY` import (200 000 XOF forfait) et `CUSTOMS_DAKAR` import (350 000 XOF/déclaration) promus `status=active` comme **forfaits provisoires d'honoraires internes** — live + migration `20260904170000` ; cohérents avec `pricing_service_catalogue` (mêmes montants, FIXED, actifs). État live vérifié : 2 `active` + 18 `to_confirm` + 15 `rejected`. Reste au périmètre FCL import : `PORT_DAKAR_HANDLING` (15 000/tonne, à valider sur pièce) et la question breakbulk.

**Extension PORT_DAKAR_HANDLING (même jour, preuve documentaire)** : dépouillement de 10 factures réelles de sortie de conteneur fournies par le métier (MSC, Hapag-Lloyd, Maersk, CMA CGM, Grimaldi, DP World). Confirmations croisées : l'acconage DP World facturé est **155 000 XOF/EVP** (= DTHC STANDARD officiel intégré, validé au franc près) ; RELEVAGE 18 280 XOF par 20', double par 40' ; taxe de port T12 constante à **4 780 XOF/tonne** chez les consignataires (recoupe la famille PAD) ; invariants compagnies : timbre BL 25 000, consignation 18 000, commission sur débours 2,80 %. Décisions : les **2 rate cards `PORT_DAKAR_HANDLING`** (15 000/t, sans pièce, divergentes du barème DPW conventionnel) rejetées — live + migration `20260904180000`. État live : 2 `active` + 16 `to_confirm` + 17 `rejected`. **Constat d'architecture qui annule le retrait envisagé de `PORT_DAKAR_HANDLING` des packages conteneur** : cette clé y est le *marqueur du droit de passage PAD*, exclue de l'enrichissement des lignes facturables (tests P0-E) — aucun devis FCL ne génère de ligne manutention/tonne ; la retirer ouvrirait le garde PAD en fail-open, et déplacer le déclencheur sur DTHC casserait le chiffrage de l'acconage (DTHC exclu de l'enrichissement). Patch tenté puis **proprement annulé** ; toute clarification sémantique (renommer le marqueur) relève du lot d'architecture paramétrage, avec environnement Deno exécutable.

**Décision d'architecture consignée (lot futur, non implémenté)** — paramétrage tarifaire opérateur :
- **Ne pas créer de nouveau système** : étendre `pricing_rate_cards`, qui porte déjà sens (import/export/transit), type de conteneur, tranches de poids, minimum, unité et fenêtres de validité. Manquent : la dimension **régime douanier**, d'éventuels **paliers par quantité**, et surtout une **page d'administration** (aucune n'existe pour cette table — vérifié).
- **Deux classes de tarifs aux règles distinctes** : `internal_fee` (honoraires SODATRA — l'opérateur habilité fixe librement, traçabilité seule exigée) vs **débours tiers** (pièce justificative obligatoire). Les débours évoluent dans le temps : modification par **versionnement** — nouvelle ligne avec nouvelle pièce et nouvelle fenêtre de validité qui remplace l'ancienne (`effective_to`), jamais d'édition en place silencieuse.
- Sélection au pricing : réutiliser le pattern fail-closed DTHC-1 (zéro ou plusieurs correspondances ⇒ TO_CONFIRM, jamais de premier-match).

### 3.8 Lot DTHC-2 — famille tarifaire DP World fournie par l'opérateur (8 septembre 2026)

GO CTO reçu après le premier run de pricing réel (dossier Cogoport `7f6fcf04`, 50 × 20GP lubrifiants, DAP Dakar) : l'acconage DP World sortait « famille non déterminable » alors que le tarif officiel est actif — le résolveur DTHC-1 n'infère STANDARD que depuis une liste validée à une seule désignation, et son entrée `family` (conçue, testée) n'était branchée nulle part. Lot purement additif (192 lignes, 0 suppression), fail-closed conservé : sans le fait, comportement strictement identique.

- **Sous-lot A1 (pricing)** : `price-service-lines` lit le fait `pricing.dthc_family`, le normalise (`normalizeDpwDthcFamily`, liste fermée `DPW_DTHC_FAMILIES`) et le transmet en `family` aux deux appels du résolveur. `set-case-fact` (**FROZEN — exception structurelle, précédent TERMINAL-GAP du 25 août**) : clé ajoutée à l'allowlist, valeur texte stricte BASIC/STANDARD/REEFER/DANGEROUS/SPECIAL canonicalisée avant le RPC. `run-pricing` non touché.
- **Sous-lot A2 (module pur)** : `dpw-dthc-tariff.ts` exporte la liste des familles et la normalisation ; alias intake exacts `20/40 DRY 8'6 → DV`, `40 DRY 9'6 → 40HC` (le libellé « 40 DRY 9'6 » du dossier CASSIS tombait en type non supporté). 3 tests Deno ajoutés (alias hauteur, famille opérateur 50 × 20DV = 7 750 000 XOF, normalisation stricte).
- **Sous-lot B (UI)** : liste déroulante des cinq familles sur le fait, et carte **« Ajouter un fait »** dans l'onglet Faits — clés autorisées absentes du dossier — car un fait sans ligne ni gap n'était inscriptible nulle part (constat du même dossier : poids, famille DTHC).

Preuves locales : typecheck app/node PASS ; 323 tests Vitest PASS ; lint baseline 742/16 PASS ; build PASS ; `deno lint` des 4 fichiers backend : 0 finding dans les lignes ajoutées (12 préexistants). Tests Deno **NOT_RUN localement** (`deno.land` bloqué par la politique réseau de l'environnement) — juge : CI GitHub. Recette runtime à faire sur le dossier Cogoport : fait `pricing.dthc_family = STANDARD` → re-pricing → ligne acconage 155 000 × 50 EVP = 7 750 000 XOF ferme.

Constats annexes du même run, à arbitrer (non traités ici) : les honoraires proviennent d'une troisième source `sodatra_fee_rules` (suivi 35 000/conteneur, dédouanement 0,4 % CAF × 0,6 min 75 000) qui **écrase** par dédoublonnage les rate cards AGENCY/CUSTOMS_DAKAR promues le 4 septembre ; ligne « Droits & taxes » à confirmer émise même en DAP ; surestaries « armateur non détecté ». Bug conteneurs (regex sur corps cité) et sync boîte `douane@sodatra.sn` consignés au §3.7.

### 3.9 Lot DTHC-3 — passe-plat de la famille DP World jusqu'au moteur (8 septembre 2026)

Recette DTHC-2 sur le dossier Cogoport : fait `pricing.dthc_family = STANDARD` écrit, mais la ligne « Terminal (DPW) » restait `TO_CONFIRM / FAMILY_UNDETERMINED`. Cause : la ligne retenue par le dédoublonnage `TERMINAL_HANDLING` est celle de `quotation-engine` (structurelle), qui appelait le résolveur partagé sans la famille ; `run-pricing` ne lisait pas le fait et ne le transmettait pas au moteur. Le câblage DTHC-2 ne couvrait que `price-service-lines`.

GO CTO « lot DTHC-3 » : exception structurelle sur deux modules FROZEN, limitée à un passe-plat (commit `650f3417`, 2 fichiers, +12/−1) :
- `run-pricing` : `buildPricingInputs` (commun mono-lot / multi-lot) lit `pricing.dthc_family` dans `inputs.dthcFamily`, transmis en `dthcFamily` dans les deux constructeurs de requête moteur.
- `quotation-engine` : champ `dthcFamily?: string | null` sur `QuotationRequest`, et `family: normalizeDpwDthcFamily(request.dthcFamily)` dans le bloc DTHC-1. Famille absente ou invalide ⇒ `null` ⇒ inférence fail-closed strictement inchangée.

Preuves : typecheck PASS, 323 Vitest PASS, lint 742/16 PASS, build PASS, `deno lint` sans finding sur les lignes ajoutées ; CI GitHub run 83 verte (gates Deno incluses). Runtime : `run-pricing` + `quotation-engine` redéployées par l'agent Lovable depuis `650f3417`, sondes 401. **Recette réelle PASS** — run 4 Cogoport (15:11) : « THC IMPORT 20GP » = 50 EVP × 155 000 = **7 750 000 XOF**, source OFFICIAL `port_tariffs` (DPW_TARIFS_2025_0001.pdf) ; total HT 12 687 000 → **20 437 000**, TTC 20 772 700.

Reste ouvert sur ce dossier (voir §3.8) : arbitrage honoraires `sodatra_fee_rules` vs forfaits promus, ligne « Droits & taxes » en DAP, surestaries sans armateur, puis version → PDF → comparaison avec l'offre concurrente.

### 3.10 Lot TRUCKING-22T — règle des 22 tonnes du barème syndical de livraison conteneur (8 septembre 2026)

Pièce fournie par SODATRA : barème syndical « Dakar et villes de l'intérieur, à compter du 15 mai 2002 » (HT). Vérification contre `local_transport_rates` : même grille — colonne 20' identique au franc, colonne 40' identique + 1 000 XOF de frais de dossier, stockée en TTC (× 1,18) et classée débours tiers (P0-D-2/3). Aucun montant modifié. Trois destinations « suivant cotation » dans le PDF (Bignona, Ziguinchor, Cap Skirring) gardent leurs montants fermes en base — décision CTO. La règle « TC 20' > 22 t = tarif 40' » n'existait nulle part : le résolveur partagé ne recevait aucun poids.

Décisions CTO (8 septembre) : strictement > 22 t ⇒ tarif 40', exactement 22 t reste 20' ; **tare incluse** dans le seuil ; 20' sans poids ⇒ tarif 20' servi avec mention « supposé ≤ 22 t » (jamais un blocage).

- **A — module pur + tests** (`2bb84081`) : `resolveOfficialLocalTransportRate` reçoit `cargoWeightPerContainerKg` (poids marchandise) ; la tare de référence du 20' Dry (`container_specifications` 20DV = 2 230 kg, migration 20251219230618) est ajoutée avant comparaison au seuil 22 000 kg ; au-delà, la ligne 40' Dry est servie. La résolution porte `requestedContainerType` et une évaluation `weight` (règle, kg, mention FR). Helper `deriveCargoWeightPerContainerKg` : fait explicite, sinon poids total ÷ boîtes si un seul type canonique, sinon null. 8 tests Deno ajoutés, **43/43 PASS en local** (std shimmé, `--allow-read`).
- **B — exception structurelle FROZEN** (`656a4f5b`, précédent DTHC-3) : `run-pricing` lit `cargo.weight_per_container_kg` et le transmet au moteur ; `quotation-engine` dérive le poids par boîte et le passe au résolveur ; libellé suffixé « tarif 40' (> 22 t) », mention portée en `notes`.
- **C — `price-service-lines`** (`1a360345`) : même dérivation, même paramètre, explication enrichie de la règle.

Gates locales : typecheck PASS, 323 Vitest PASS, lint 742/16 PASS, function-config OK, build PASS, `deno lint` sans nouveau finding (137 / 7 inchangés). CI GitHub run 86 verte (gates Deno incluses) ; `run-pricing`, `quotation-engine`, `price-service-lines` redéployées par l'agent Lovable depuis `17cba92a`, sondes 401. **Recette réelle PASS** — run 5 Cogoport (8 septembre, 18:16) : « Transport 20GP → FORFAIT ZONE 1 <18 KM — tarif 40' (> 22 t) » = 50 × 125 080 = **6 254 000 XOF** (au lieu de 4 130 000), note « 28 000 kg + tare 2 230 kg = 30 230 kg », source OFFICIAL barème 20P/40P ; acconage DTHC 7 750 000 conservé ; total HT 20 437 000 → **22 561 000**, TTC 22 896 700.

### 3.11 Lot HONORAIRES-1 — source unique paramétrable des honoraires internes (9 septembre 2026)

Constat (run 5 Cogoport) : cinq sources concurrentes d'honoraires — `sodatra_fee_rules` (11 lignes semées en février, sans pièce, lues par le moteur : dédouanement 0,4 % CAF × 0,6 min 75 000, suivi 35 000/conteneur, dossier 25 000, documentation 15 000 = 1 865 000), repli codé en dur, `pricing_customs_tiers` (12 paliers), rate cards AGENCY 200 000 / CUSTOMS_DAKAR 350 000 promues le 4 septembre, catalogue. Les lignes structurelles du moteur couvraient CUSTOMS_DAKAR et masquaient tout paramétrage ; AGENCY était absent des packages import conteneur ; les quatre tables sont en lecture seule (RLS SELECT). Décisions CTO : source unique = `pricing_rate_cards` (source `internal`), deux clés (AGENCY, CUSTOMS_DAKAR), AGENCY inclus d'office, paramétrage libre par l'administrateur à concevoir (H2/H3).

- **A** (`9f13d3ff`) : module pur `_shared/internal-fees.ts` (clés, bloc, `sumFirmInternalFeePackageLines`, 2 tests) ; `price-service-lines` sert AGENCY / CUSTOMS_DAKAR uniquement depuis les rate cards (paliers et catalogue court-circuités, override client conservé, sinon TO_CONFIRM).
- **B** (`88f2ec91`, exception structurelle FROZEN) : `quotation-engine` n'émet plus le bloc honoraires (−202 lignes : bloc, loader, imports) ; `run-pricing` marque les lignes package internes `bloc: honoraires` et ajoute leurs montants fermes à `totals.honoraires / dap / ddp` après enrichissement P5 (mono et multi-lot, hors export déjà classé) — la TVA SODATRA 18 % s'applique une seule fois.
- **C** (`b6adfe69`) : AGENCY dans DAP_PROJECT_IMPORT, DDP_PROJECT_IMPORT, DAP_PROJECT_IMPORT_EXW (partagé + miroir frontend) ; baseline lint verrouillée 742 → 737.

`sodatra_fee_rules` et `pricing_customs_tiers` ne sont plus lus pour ces clés (tables conservées, suppression en H2). Gates locales : typecheck PASS, 323 Vitest PASS, lint 737/16 PASS, function-config OK, build PASS ; tests Deno des packages NOT_RUN localement (imports `jsr:` hors ligne), CI juge. Test P0-E réaligné (`2a9f8eba`), CI run 90 verte ; trois fonctions redéployées par l'agent Lovable depuis `2a9f8eba`, sondes 401. **Recette réelle PASS** — run 6 Cogoport (9 septembre, 10:45) : lignes « Frais d'agence » 200 000 et « Dédouanement Dakar » 350 000, bloc honoraires, source `internal` (rate cards), plus aucune ligne moteur ; `honoraires_ht` 550 000, TVA 99 000 ; total HT 22 561 000 → **21 246 000**, TTC 21 345 000. Acconage 7 750 000 et transport 6 254 000 inchangés. Suite : H2 (modèle dédié lignes + règles, écran administrateur, politiques d'écriture — GO DB/RLS), H3 (bascule du lecteur et retrait des rate cards honoraires).

### 3.12 Programme convenu après HONORAIRES-1 — ordre à respecter (9 septembre 2026)

Rappel CTO du 9 septembre : la documentation DP World / PAD (IMO, OOG, HSSE) ne remplace pas le travail engagé avant son partage. Ordre convenu :

1. **H2 — honoraires paramétrables** (GO attendu « go H2-a »). Décisions déjà prises : source unique rate cards en H1 puis modèle dédié `fee_lines` + `fee_rules` ; conditions cumulatives (mode, sens, régime, type d'envoi, famille de conteneur, tranche poids, tranche valeur CAF, client), OU par règles disjointes, exactement une règle applicable sinon « à confirmer » ; méthodes forfait / par conteneur avec montants 20' et 40' sur la même règle / par tonne / % valeur CAF avec min-max, CAF absente ⇒ « à confirmer » jamais 0 ; registre clients (code, raison sociale, NINEA facultatif, domaines) ; critères « famille de conteneur » et « marchandise dangereuse » ; versionnement par date d'effet. Restent à trancher : écriture réservée au rôle `tariff_admin` (recommandé) et bouton « simuler sur un dossier » (recommandé). Sous-lots : a migration, b résolveur pur, c bascule `price-service-lines`, d écran.
2. **Premier livrable réel Cogoport** dès H2 recetté : version de devis → PDF → comparaison avec l'offre concurrente → conversion USD. Points §3.8 encore ouverts : ligne « Droits & taxes » en DAP, surestaries sans armateur.
3. **Programme IMO / OOG / HSSE** (recommandations du 9 septembre, non encore GO) : DG-1 fait marchandise dangereuse ; IMO-RULES-1 table de référence Annexe 1 v4.0 (mode de séjour, franchise 0/3 jours au lieu de 15) ; livraison sous palan ; CHECKLIST-1 documents et échéances ETA ; OOG-1 dimensions vers le moteur ; PARTNERS-1 registre transporteurs avec attestation HSSE.
4. **Lots consignés antérieurement** : regex conteneurs sur corps cité (`build-case-puzzle`), parseur de chaîne citée, synchronisation boîte `douane@sodatra.sn`, corrections barèmes armateurs (factures ONE / Maersk / Hapag-Lloyd attendues), suppression de `sodatra_fee_rules` et `pricing_customs_tiers` en H2.

### 3.13 Lot H2-a — modèle dédié d'honoraires paramétrables, registre clients, rôle `tariff_admin` (9 septembre 2026)

GO CTO « go H2-a avec tes recommandations ». Migration `20260909120000_h2a_fee_lines_rules_clients.sql` (commit `43525177`), appliquée sur Lovable Cloud le 9 septembre. Aucune fonction Edge ne lit encore ces tables : les rate cards AGENCY / CUSTOMS_DAKAR restent servies jusqu'à H2-c.

- `has_tariff_admin_role()` : miroir de `has_pad_admin_role()` (PAD-C2), rôle `tariff_admin` dans `app_roles`. Écriture des trois tables réservée à ce rôle, lecture pour tout utilisateur authentifié. Attribution du rôle par SQL en service_role uniquement ; aucun utilisateur seedé.
- `clients` : code stable (référencé par `client.code`, surcharges client, règles), raison sociale, NINEA facultatif unique, domaines email. Amorcé avec les deux codes déjà présents (AI0CARGO, AKSA_ENERGY), raison sociale = code à compléter.
- `fee_lines` : lignes créées librement par l'administrateur ; code = clé de service de la ligne de devis ; TVA ; comportement sans règle applicable (`TO_CONFIRM` ligne attendue / `SKIP` supplément conditionnel).
- `fee_rules` : conditions cumulatives facultatives (mode, sens, type d'envoi, régime, famille de conteneur, marchandise dangereuse, tranches poids et valeur [min, max), client) ; méthodes FIXED / PER_CONTAINER (montants 20' et 40') / PER_TONNE / PERCENT_OF_VALUE (assiette CAF ou valeur marchandise) avec min-max ; date d'effet, `supersedes_rule_id`. Trigger `fee_rules_reject_overlap` : une ligne est une grille sans cases qui se recouvrent, par scope client ; primauté client sur générique laissée au résolveur (H2-b).
- Amorçage : AGENCY 200 000 et CUSTOMS_DAKAR 350 000, FIXED, IMPORT, effet 2026-09-04 (reprise des forfaits provisoires).

Preuves : PostgreSQL 16 jetable avec stubs Supabase, deux passes idempotentes, 12 politiques, 4 triggers, 24 contrôles comportementaux PASS (recouvrement, tranches adjacentes, scope client, contraintes, RLS avec et sans rôle). Live : `clients=2 fee_lines=2 fee_rules=2 policies=12 triggers=4`, garde-fou vérifié (insertion en doublon refusée, code 23P01, rien persisté). Suite : H2-b résolveur pur + tests, H2-c bascule `price-service-lines`, H2-d écran ; attribution du rôle `tariff_admin` au compte administrateur sur décision CTO.

### 3.14 Lots H2-a2 (gestion des rôles) et H2-b (résolveur d'honoraires) — 9 septembre 2026

- **H2-a2** (`b8c666ae`, migration `20260909140000_h2a2_role_admin_self_service.sql`, appliquée en production) : la contrainte de `app_roles` n'admettait que `pad_admin` / `pad_supervisor` ; elle admet désormais `tariff_admin` et `role_admin`. `has_role_admin_role()` (même patron que PAD-C2) ; politiques `app_roles` pour les `role_admin` (lecture de tout, attribution, retrait), lecture « ses propres lignes » conservée pour les autres ; trigger interdisant de supprimer ou rétrograder le dernier `role_admin`. Validé sur PostgreSQL 16 jetable (stubs `auth.uid()`, contrainte PAD-C2 reproduite) : deux passes, 12 contrôles PASS. **Compte CTO doté de `tariff_admin` et `role_admin` en production** (opération service_role, aucun identifiant dans Git).
- **H2-b** (`1d92fe1e`) : module pur `_shared/fee-rules.ts`. Conditions cumulatives ; fait absent = condition indéterminée, ni oui ni non ; scope client d'abord puis générique ; exactement une règle certaine, sinon conflit ou « donnée manquante » nommée, sinon comportement de ligne (à confirmer / absente). Méthodes forfait, par conteneur 20'/40' (45' compté 40', famille restreignant les boîtes comptées), par tonne entamée, pourcentage CAF ou valeur marchandise (assiette absente ⇒ à confirmer, jamais 0), minimum puis maximum, arrondi XOF, message et détail FR. `deriveShipmentProfile` traduit type de demande et package en mode / sens / type d'envoi. `dpw-dthc-tariff` exporte `resolveContainerProfile` sans changement de comportement. 17 tests Deno PASS en local (parité Cogoport avec HONORAIRES-1, grille groupage, mixte 20'/40', frigo, pourcentage, primauté client sans repli silencieux, conflits, validité) ; suite DTHC 37/37 inchangée ; lint 737/16.

Suite : H2-c bascule `price-service-lines` sur le résolveur (contexte dossier depuis les faits, retrait des rate cards honoraires), H2-d écran `/admin/honoraires` (lignes, règles, nouvelle version à date d'effet, simulation sur dossier, gestion des rôles).

### 3.15 Lot H2-c — honoraires internes servis par les règles paramétrables (9 septembre 2026)

GO CTO « go H2-c ». Deux sous-lots : `e0346f0a` (`buildFeeCaseContext` dans le résolveur, 18 tests Deno PASS) et `fe08aabb` (`price-service-lines` + migration `20260909150000_h2c_supersede_fee_rate_cards.sql`). CI run 98 verte ; `price-service-lines` redéployée par l'agent Lovable (sources byte-identiques à `fe08aabb`, sonde 401) **avant** l'application de la migration en production.

- `price-service-lines` charge `fee_lines` / `fee_rules` actives, construit le contexte du dossier depuis les faits (type de demande, package, scope, conteneurs, poids, CAF, valeur marchandise, client, régime ; marchandise dangereuse inconnue jusqu'à DG-1) et sert AGENCY / CUSTOMS_DAKAR par `resolveFeeLine` : montant déjà multiplié (ligne au forfait, source `fee_rule` / `fee_rule_client`), ligne conditionnelle absente ⇒ 0 en règle métier, sinon `TO_CONFIRM` avec le message FR du résolveur. Surcharges client, paliers douaniers et catalogue ne s'appliquent plus à ces clés ; repli rate cards H1 conservé seulement s'il n'existe aucune ligne d'honoraires. Audit : `fee_rule*` ⇒ `internal`.
- Migration (validée deux fois sur PostgreSQL 16 jetable, appliquée live) : les deux rate cards provisoires passent en `superseded` ; la surcharge client AI0CARGO sur CUSTOMS_DAKAR (forfait 200 000) est reprise à l'identique comme règle client de la ligne puis désactivée — source unique sans perte du tarif négocié. État live : `AGENCY/*/200 000`, `CUSTOMS_DAKAR/*/350 000`, `CUSTOMS_DAKAR/AI0CARGO/200 000`.

**Recette réelle PASS** — run 7 Cogoport (9 septembre, 15:30) : « Frais d'agence » 200 000 et « Dédouanement Dakar » 350 000, bloc honoraires, source `fee_rule`, explications du résolveur (« forfait 200 000 XOF = 200 000 XOF ») ; honoraires HT 550 000, TVA 99 000, total HT 21 246 000, TTC 21 345 000 — identique au franc au run 6. Reste H2-c2 (exception structurelle `run-pricing`) pour que les lignes créées librement par l'administrateur, hors AGENCY / CUSTOMS_DAKAR, entrent d'elles-mêmes dans le devis et l'assiette TVA ; puis H2-d écran.

### 3.16 Lot H2-c2 — lignes d'honoraires libres de l'administrateur dans le devis (9 septembre 2026)

GO CTO « go H2-c2 ». Deux sous-lots : `128b2e5d` (aide partagée `_shared/internal-fees.ts` : clés internes = AGENCY / CUSTOMS_DAKAR + tout code de ligne d'honoraires active ; 3 tests Deno PASS en local) et `4d857312` (exception structurelle bornée sur `run-pricing` + `price-service-lines` ; 4 fichiers sur le lot). CI run 102 verte ; `run-pricing` et `price-service-lines` redéployées par l'agent Lovable depuis `4d857312` (sondes 401).

- `run-pricing` charge les `fee_lines` actives (code, libellé) une fois par run et ajoute leurs codes aux clés manquantes de l'enrichissement P5 (mono-lot et multi-lot import / transit ; export intact) : libellé FR de la ligne, bloc `honoraires`, ligne `fee_rule_skipped` (règle conditionnelle non applicable) absente du devis ; les honoraires fermes issus des lignes paramétrées s'ajoutent à `totals.honoraires` (assiette TVA 18 % SODATRA) puis DAP / DDP.
- `price-service-lines` accepte tout code de ligne d'honoraires active comme clé de service et le sert par le résolveur H2-b (surcharges client, paliers douaniers et catalogue court-circuités pour ces clés).

**Recette réelle PASS** — ligne temporaire `TEST_H2C2` (« Test technique H2-c2 (0 XOF) », forfait 0, IMPORT) créée en base ; run 8 Cogoport (9 septembre, 16:06) : 10 lignes contre 9 au run 7, la ligne de test apparaît à 0 dans le bloc honoraires avec source `fee_rule`, AGENCY 200 000 et CUSTOMS_DAKAR 350 000 inchangés, total HT 21 246 000 / TTC 21 345 000 identiques au run 7. Ligne et règle de test supprimées après recette (état live : AGENCY 1 règle, CUSTOMS_DAKAR 2 règles). Reste H2-d : écran `/admin/honoraires` (lignes, règles, nouvelle version par date d'effet, simulation sur un dossier) + onglet rôles, avec interdiction des codes de ligne entrant en collision avec les clés de service réservées.

### 3.17 Lot H2-d — écrans d'administration des honoraires et des rôles (9 septembre 2026)

GO CTO « go H2-d ». Six sous-lots, chacun ≤ 3 fichiers : `d6c73701` (écran honoraires), `7e4ba5f3` (écran rôles), `e834a757` (garde-fou base de données des codes réservés), `e5ffb679` (module partagé de contexte), `1c103816` (fonction de simulation), `89ffabc6` (simulation et versionnement à l'écran). CI runs 104 à 106 vertes.

- **Écran `/admin/honoraires`** : registre clients, lignes `fee_lines` et règles `fee_rules` par ligne (toutes les conditions et méthodes du modèle H2-a), validation miroir des contraintes SQL. Écriture masquée hors rôle `tariff_admin` ; la RLS reste le seul garde-fou serveur. **Écran `/admin/roles`** : attributions `app_roles` par identifiant utilisateur, avec le garde-fou du dernier `role_admin`. Aucune fonction Edge de résolution email vers identifiant n'a été créée : cela aurait touché l'API admin Auth, hors périmètre du GO.
- **Garde-fou des codes réservés en base** (migration `20260909170000`, appliquée live) : `fee_line_code_is_reserved()` et trigger sur `fee_lines`. Trois familles couvertes — clés servies par `price-service-lines`, clés structurelles et groupes de déduplication de `run-pricing`, et clés **dynamiques** `<compagnie>_<code de charge>` reconstituées depuis `carrier_billing_templates` (48 clés actives en production, non énumérables statiquement, d'où un trigger et non une contrainte CHECK). `AGENCY` et `CUSTOMS_DAKAR` restent autorisés : ce modèle est leur source depuis H2-c. Validé sur 10 cas en PostgreSQL 16 jetable puis 4 sondes en production.
- **Défaut de H2-d1 corrigé dans le même lot** : la validation du code refusait aussi la *modification* des lignes `AGENCY` et `CUSTOMS_DAKAR` existantes. Le contrôle ne s'applique plus qu'à la création et la liste d'écran est alignée sur la base.
- **Simulation fidèle** : nouveau module partagé `_shared/fee-case-facts.ts` (13 tests Deno) qui dérive le contexte d'honoraires des faits du dossier ; `price-service-lines` bascule dessus en transmettant son contexte déjà calculé en override, donc comportement strictement inchangé, multi-lot compris. Nouvelle fonction `simulate-fee-lines`, en lecture seule stricte (aucune écriture, aucun `pricing_run`), utilisée par l'écran : ce qu'elle affiche est ce que produirait un chiffrage. Un dossier multi-lot est signalé, la simulation portant alors sur le dossier entier.
- **Versionnement par date d'effet** : la règle remplacée est clôturée la veille avant création de la nouvelle (sans quoi le trigger anti-chevauchement H2-a la refuserait), avec `supersedes_rule_id` et annulation de la clôture si la création échoue.

Reste ouvert : le fait DG-1 (marchandise dangereuse), sans lequel toute règle conditionnée sur ce critère reste « à confirmer » ; la raison sociale et le NINEA des deux clients amorcés, à compléter par l'administrateur.

### 3.18 Lot DG-1 — fait canonique « marchandise dangereuse » (10 septembre 2026)

GO CTO « go DG-1 ». Trois sous-lots : `03836000` (module et exception structurelle), `2afb1c03` (branchement au contexte d'honoraires), `dc0f1077` (saisie opérateur). CI verte sur `dc0f1077`. `set-case-fact` doit être redéployée pour que le fait soit inscriptible : redéploiement demandé à l'agent Lovable, à confirmer avant recette.

- **Le fait** : `cargo.dangerous_goods`, valeurs canoniques `YES` / `NO`, porté par le module pur `_shared/dangerous-goods.ts`. Les formes usuelles (oui/non, true/false, 1/0) sont acceptées à l'écriture puis ramenées à la valeur canonique ; toute autre chaîne est refusée plutôt qu'interprétée. **Fait absent ou illisible vaut INCONNU, jamais « non dangereux »** : la règle conditionnée sort « à confirmer ».
- **Repli sûr et unidirectionnel** : une famille tarifaire DP World `DANGEROUS` est une déclaration explicite de danger et vaut « oui » ; aucune autre famille ne prouve l'absence de danger. Le fait explicite prime toujours, dans les deux sens.
- **Exception structurelle sur `set-case-fact`** (FROZEN), strictement additive (26 insertions, 0 suppression) : sans entrée dans l'allowlist le fait ne serait inscriptible par personne — même justification et même patron de validation que TERMINAL-GAP et DTHC-2.
- **Propagation** : le module partagé de contexte d'honoraires (H2-d2) étant le point d'entrée unique, le fait alimente d'un coup le chiffrage réel et la simulation, sans modifier `price-service-lines` ni `simulate-fee-lines`.
- **Écran** : le fait est ajoutable et modifiable sur un dossier (liste Oui / Non) et signalé comme ambigu en multi-lot, la dangerosité pouvant différer d'un lot à l'autre.

Tests : 13 cas Deno pour le module, 5 ajoutés au contexte d'honoraires ; suite `supabase/functions/_shared` complète 218 PASS avec les options de la CI. Frontend : typecheck, lint (baseline inchangée), 323 tests Vitest, build.

Reste ouvert : la classe IMDG et le numéro ONU relèvent d'IMO-RULES-1 (non engagé) ; aucune règle d'honoraires conditionnée à la dangerosité n'existe encore en production, le paramétrage revient à l'administrateur.

### 3.19 Lot IMO-RULES-1 — classification IMDG et régimes de séjour du terminal (10 septembre 2026)

GO CTO « go IMO-RULES-1 ». Cinq sous-lots : `56433911` (nomenclature et faits), `ba1cc3d3` (cohérence avec DG-1), `e3028264` (saisie opérateur), `47e9ba80` (table de référence) et `97cf3020` (résolveur). Le lot a d'abord été bloqué faute du document, puis débloqué le jour même par sa transmission.

**Livré — partie normative, sans dépendance documentaire.** Faits `cargo.imo_class` (nomenclature IMDG complète, 20 classes et divisions, norme publique de l'OMI, libellés français) et `cargo.un_number` (format UN + quatre chiffres, `0000` exclu). Le format seul est vérifié pour le numéro ONU : le dépôt ne détient pas la liste officielle des numéros attribués et ne certifie donc pas qu'un numéro bien formé existe. Exception structurelle additive sur `set-case-fact` (42 insertions, 0 suppression). Une classe déclarée classe la marchandise comme dangereuse (repli unidirectionnel), le fait explicite DG-1 primant toujours. Ordre de résolution : fait explicite, classe IMDG, famille tarifaire DP World, sinon inconnu.

**Livré — table de référence, source fournie.** L'Annexe 1 v4.0 ayant été transmise, la table `imo_terminal_rules` encode ses 25 lignes de règles (feuilles VF et VA concordantes), chacune citant sa ligne d'origine, au standard de traçabilité de `terminal_tariff_codes`. **Le séjour standard de 15 jours ne s'applique pas aux conteneurs IMO** : c'est la livraison sous palan (aucun séjour, entrée 12 h avant navire au chargement, transbordement interdit), 3 jours au chargement et déchargement avec 7 jours en transbordement, ou un régime non précisé. Les classes 6.2 et 7 sont interdites au terminal. Répartition en production : 7 règles sous palan, 10 à 3 jours, 8 non précisées, 2 interdictions, séjour maximum 3 jours.

Le résolveur `_shared/imo-terminal-rules.ts` applique la précédence numéro ONU, puis « les autres », puis la classe entière ; une règle écrite au niveau de la classe couvre ses divisions sans déborder en sens inverse. Fail-closed : classe absente, numéro ONU absent sur une classe qui distingue ses numéros, ou régime non précisé donnent « à confirmer » avec la donnée manquante nommée, jamais un repli implicite sur 15 jours.

**Trois ambiguïtés du document, signalées et non tranchées en base.** Les numéros 3231 et 3232 (classe 4.1) relèvent à la fois du sous-palan et des 3 jours ; 3111 et 3112 (classe 5.2) des 3 jours et d'un régime non précisé ; l'accord PAD est absent pour 1942-2067-2426-3375 (classe 5.1). Le résolveur retient la règle la plus restrictive et signale le conflit dans son explication. **À faire confirmer par DP World.**

**Risque découvert, non traité faute de GO.** La table `imo_classes` (16 lignes, créées le 19 décembre 2025 par la génération initiale du projet) porte des surcharges portuaires et de magasinage de 25 % à 300 %, **sans colonne de source ni de niveau de preuve**, contrairement à `terminal_tariff_codes` qui cite systématiquement son document et son niveau de preuve. Ces valeurs ne passent pas dans le pipeline de chiffrage canonique, mais `analyze-risks` les injecte dans le contexte textuel des réponses rédigées au client par `generate-response` : une surcharge inventée peut donc être annoncée à un client. À arbitrer.

### 3.20 Lot IMO-STORAGE-1 — le régime de séjour IMO entre dans le devis (10 septembre 2026)

GO CTO « go pour le branchement magasinage et surestaries ». Trois sous-lots : `42411db2` (ligne d'information), `82aeb4b4` (exception structurelle `run-pricing`), `54b35d14` (clé réservée). CI verte, migration appliquée en production.

**Défaut corrigé.** Le moteur annonçait la franchise magasinage standard à tout conteneur — 15 jours en FCL au barème PAD, 10 au barème DP World — y compris pour une marchandise dangereuse dont la procédure impose la livraison sous palan (aucun séjour) ou 3 jours. Un client qui se croyait couvert 15 jours découvrait la pénalité au 4e. La nouvelle couche `enrichment_imo_storage` ajoute, quand le dossier porte une classe IMDG, une ligne portant le régime réel et signalant explicitement que la franchise annoncée par ailleurs ne s'applique pas.

**La ligne ne facture rien** : montant nul en toutes circonstances, aucun tarif de dépassement propre aux conteneurs IMO n'étant publié dans l'Annexe 1. Une classe interdite au terminal produit une ligne bloquante. Bloc entièrement sous try/catch : un référentiel indisponible ne fait pas échouer un chiffrage, et aucune ligne n'est émise sans classe IMDG — donc aucun devis existant n'est modifié.

**SURESTARIES NON BRANCHÉES, décision assumée.** Elles proviennent de `demurrage_rates` (barème armateur) ; l'Annexe 1 est un document de terminal et ne les mentionne pas. Aucune source ne relie les deux, les brancher aurait exigé d'inventer ce lien. **En attente d'un document qui l'établisse.**

**Contradiction de sources à arbitrer.** `warehouse_franchise` contient déjà une ligne `cargo_type = 'IMO'` à 5 jours (provider PAD, « Tarifs PAD 2024 », zone IMO, 500 XOF/tonne/jour). Elle n'est jamais sélectionnée par le moteur, qui ne teste que FCL / VEHICLE / BREAKBULK / EMPTY, et elle contredit les 0/3 jours du terminal DP World (juillet 2025). Port et terminal sont deux entités distinctes : la ligne n'a donc PAS été écrasée.

Conséquence du garde-fou H2-d2 : la clé `IMO_TERMINAL_STORAGE_REGIME` est devenue un code réservé, sans quoi une ligne d'honoraires homonyme serait entrée en collision avec la ligne réglementaire.

### 3.21 IMO-UN-AUTO — conversion ONU vers classe IMDG (12 septembre 2026)

GO CTO confirmé : raccordement à l'affichage, aux honoraires et à `run-pricing`, avec blocage des contradictions. **Livré dans `75810f65`, PASS_WITH_BASELINE**, base `work@206ef31c`. Commit, push et déploiement des trois fonctions confirmés le 12 septembre ; Git local/GitHub/Lovable alignés, privé/non publié.
Référentiel BAM IMDG amendement 42-24 : projection exacte des 3 246 lignes source vers 2 347 numéros ONU ; licence dl-de/by-2-0, URL et SHA256 conservés dans `_shared/imo-un-reference.ts`.
Module pur `_shared/imo-un-resolution.ts` : classe dérivée avec provenance, confirmation d'une classe concordante, contradiction explicite, numéro inconnu sans extrapolation.
UN3536 résout en classe 9 ; UN0190, UN1950 et UN2037 exigent une division déclarée. Les groupes de compatibilité explosifs sont conservés en référence, distincts de la division.
Projection commune `_shared/imo-pricing-facts.ts` : classe dérivée au pricing, danger au contexte d'honoraires réel/simulé, preuve dans les inputs du run ; aucun fait client écrit.
Contradictions ONU/classe et ONU/NO bloquées avant moteur, y compris pricing provisoire ; un numéro inconnu sans classe ou une division manquante bloque. Précédence DG-1 conservée hors ONU.
Multi-lot : ONU global non attribué implicitement aux lots ; classification locale ou NO explicite requis, contexte d'honoraires transmis par lot. Les régimes de séjour multi-lots ne sont pas ajoutés par ce lot.
UI : notice sourcée dans les faits, aperçu pendant saisie, contradictions visibles ; aucune écriture automatique de classe ni changement de tarif.
Exception ciblée `run-pricing` justifiée par le manque de propagation ; `quotation-engine`, `set-case-fact`, Auth et RLS inchangés. Aucune migration.
Tests : 367 Vitest PASS (44 nouveaux), 5 nouveaux tests d'intégration Deno PASS ; suite Deno 1173 PASS / 1 FAIL / 6 ignorés. Échec Intake reproduit sur une exportation propre de `origin/work` (206ef31c), identique.
`npm run ci` s'arrête sur cet échec baseline ; contrôles complétés séparément : typecheck PASS, Deno 49 diagnostics/5 groupes inchangés, lint 737/16 inchangé, fonction-config 94 PASS, build PASS, diff-check PASS. Test live NOT_RUN.
Comparaison exhaustive aux 3 246 lignes du TSV et SHA256 PASS. `run-pricing`, `price-service-lines`, `simulate-fee-lines` déployés ; preview : UN3536 → classe 9 et source BAM observés sans sauvegarde. Probes Lovable OPTIONS 200 / POST sans auth 401 ; chiffrage client NOT_RUN.
Rollback après livraison : revert du commit du lot et redéploiement des trois fonctions, sans restauration de données client.

### 3.22 IMO-GOODS-SOURCE — reconnaissance des groupes (12 septembre 2026)

GO CTO : exceptions ciblées `build-case-puzzle`, puis `run-pricing` / `quotation-engine`, sans modifier les barèmes ni dupliquer les frais dossier. **PASS livraison privée le 12 septembre, commit `12eb2ce62606d8b72922dc755ad3b1b1ee5786b3`**, base `work@75810f65`. Git local/GitHub/Lovable alignés ; sept fichiers, +951/−60.
Reconnaissance conservatrice des listes numérotées : ONU lié à sa ligne, classe dérivée BAM distincte de la déclaration ; source client exacte, citations/historique, troncature, révision et contradictions contrôlés. Aucun NO déduit d'une absence d'ONU.
Projection pure par groupe : correspondance bijective équipement/quantité/conteneur SOC-COC ; unités de marchandise ≠ conteneurs. Statut inconnu, allocation ambiguë ou fait global contradictoire bloquent, sans écraser les faits.
À chaque analyse : preuve timeline, empreinte des sources brutes et identité client, gap protégé ; levée du seul gap IMO après extraction si tous les groupes sont prouvés. Pièces jointes et autres formats hors couverture.
Pricing : relecture des sources, cardinalité complète, preuve et faits avant calcul ; plan et référence BAM figés dans inputs_json. Export/aérien, multi-devis et mode provisoire avec groupes bloqués ; dossiers sans preuve IMO inchangés.
Un seul appel moteur pour le dossier : THC par conteneurs rattachés ; frais communs une seule fois. Chargement mixte : honoraires conditionnés DG et surcharges DG armateur (IMPORT/ALL) à confirmer, jamais appliqués à tous les conteneurs.
Séjour IMO informatif par groupe ; franchise standard exclut les groupes IMO. Provision magasinage globale non appliquée aux groupes faute de répartition poids/durée. Désignation dry non validée reste TO_CONFIRM ; aucune famille tarifaire inventée.
Rejeu sans nouvelle preuve identique, UUID de transition déterministe et index unique de gap ouvert conservés. Concurrence DB réelle et recette Lovable NOT_RUN ; aucune garantie transactionnelle nouvelle revendiquée.
Tests : 81 nouveaux Deno PASS (46 reconnaissance + 35 projection/moteur), dont moteur réel sur DB simulée, montants par groupe et frais dossier uniques ; 367 Vitest PASS. Suite finale Deno 1254 PASS / 1 FAIL Intake préexistant / 6 ignorés.
CI locale PASS_WITH_BASELINE (Intake :193 préexistant) ; typecheck/config 94 PASS, Deno 49/5 et lint 737/16 sans aggravation, build/diff-check PASS. [CI GitHub 34699507023](https://github.com/douania/dakar-cargo-quotes/actions/runs/34699507023) entièrement PASS sur `12eb2ce6`. Deux TS2345 préexistants signalés par Lovable dans run-pricing, non corrigés.
Diagnostic Lovable antérieur : original base64 présent et décodable, client_email du fil vide, aucune quote_request_lines. GoTrans nécessite encore identité client prouvée, allocation réelle des conteneurs et statut des autres groupes ; aucun fait ni devis runtime modifié.
Livraison via connecteur GitHub (Git HTTPS indisponible), sept blobs et arbre Git byte-identiques au local, mise à jour fast-forward sans force. Lovable a déployé dans l'ordre quotation-engine → run-pricing → build-case-puzzle ; OPTIONS 200 / POST sans auth 401 (3/3), aucun fichier supplémentaire modifié. Projet revérifié private/is_published=false.
Contrôle DB avant/après identique : 73 dossiers, 171 runs, 9 versions, 45 brouillons, 1409 faits, 159 gaps, 0 preuve IMO ; empreinte des faits GoTrans inchangée. Aucune réanalyse ni écriture métier ; recette client et concurrence DB NOT_RUN. Message Lovable `umsg_01m2b0fxwjf0csgxw0jpqj708x` ; identifiants de versions Edge non exposés.
Recette GoTrans du 14 septembre : PARTIAL. Rejeu local des sources/faits Cloud réels PASS (REVIEW/BLOCKED, aucun groupe chiffrable, rejeu mémoire idempotent) ; scénario hypothétique identité seule : classe 9 sur les seules armoires mais allocation et statuts groupes 2/3 encore bloquants. 81 tests ciblés PASS avec les options Deno du dépôt ; premier lancement sans `--node-modules-dir=none` en échec de résolution npm, sans patch.
Contrôle Cloud/UI authentifiée du 14 septembre : identité client du fil NULL, aucune preuve IMO, gap PAD ouvert malgré complétude 100 %. Relance pricing réellement tentée via cockpit : refus « Blocking gaps still open », aucun nouveau run ; dossier, compteurs métier et empreinte des faits identiques avant/après. PASS du refus PAD, pas de preuve runtime du garde IMO.
Défaut de reprise confirmé UI/code : `PRICED_DRAFT` masque la relance d'analyse ; sans preuve timeline, run-pricing conserve le chemin legacy. Recommandation sous GO distinct : contrôle IMO avant pricing même sans preuve antérieure, sans modifier les faits/barèmes. Réanalyse, calcul positif GoTrans et concurrence DB NOT_RUN ; aucune version ni brouillon ni envoi créé.
Aucune migration, Auth/RLS/barèmes inchangés. Rollback après livraison : revert du commit de ce lot puis redéploiement coordonné des trois fonctions, sans restauration de faits client.

### 3.23 IMO-PRICING-PREFLIGHT — reprise sans analyse antérieure (14 septembre 2026)

GO CTO : correctif ciblé de run-pricing (FROZEN) avec tests, sans faits client ni barèmes ; commit/push sur work, déploiement privé de run-pricing et recette authentifiée autorisés le 14 septembre. Base work/origin/work : 12eb2ce6, GitHub vérifié via connecteur après échec DNS Git direct.
PASS_WITH_BASELINE local : lecture complète du fil avant gaps/statut ; sans preuve timeline, reconnaissance IMO et plan calculés en mémoire. Identité exacte exigée ; aucune identité inférée, aucun NO déduit. Preuve existante conservée et contrôle de fraîcheur inchangé.
Périmètre : run-pricing/index.ts (+22/−9), nouveau module local imo-goods-preflight.ts et son test ; roadmap complétée en préservant les notes locales de livraison/recette. Décodeur MIME copié à l'identique du puzzle et verrouillé par test de parité, sans import du handler ni modification de build-case-puzzle.
36 nouveaux tests PASS, dont 10 sur le handler réel avec HTTP simulé (auth, refus avant écriture, autres gaps, erreurs/cardinalité, périmètres exclus). Rejeu local du snapshot Cloud GoTrans : REVIEW/BLOCKED sans événement préalable, données inchangées ; copies temporaires supprimées.
CI : config 94 et typecheck frontend PASS, 367 Vitest PASS ; Deno 1290 PASS / 1 FAIL Intake :193 préexistant / 6 ignorés, fichiers Intake/test identiques à origin/work. Typecheck Deno 49 erreurs/5 compartiments et lint 737/16 inchangés ; build et diff-check PASS. npm run ci reste arrêté sur l'échec Intake, pas de PASS intégral revendiqué.
Risque : e-mail entrant vide, illisible ou tronqué bloque désormais la reprise sans preuve (absence d'IMO non démontrable). Deux lectures supplémentaires pour les anciens fils sans preuve. Couverture pièces jointes/documents seuls non étendue ; aucun mécanisme transactionnel nouveau.
Livraison : work 12eb2ce6 → dd5e2cf0, 4 fichiers +451/−12, arbre local/GitHub identique ; [CI 34830556854](https://github.com/douania/dakar-cargo-quotes/actions/runs/34830556854) SUCCESS. Git direct indisponible : fast-forward non forcé via API GitHub, références locales alignées ; 36 tests ciblés rejoués PASS.
Lovable privé/non publié synchronisé sur dd5e2cf0 ; run-pricing seul déployé, helper embarqué (message umsg_01m2fnhtf9f7cb3b85a2jpj72z). OPTIONS 200, POST sans auth 401. Aucun changement Auth/RLS, migration, barème, autre fonction ni publication.
Recette authentifiée GoTrans PASS pour le refus : HTTP 400 « IMO goods scope requires clarification », CONTAINER_ALLOCATION_REQUIRED + SOURCE_REVIEW_REQUIRED, plan BLOCKED sans lignes, sans analyse préalable. Fiche dossier et empreinte intégrale des faits identiques ; compteurs runs/versions/brouillons/faits/gaps/événements IMO inchangés. Aucun envoi.
Réserve PARTIAL qualité Lovable : TS2339 signalé dans le mock de test :161 (RequestInit.method), absent de la CI GitHub réussie ; deux TS2345 historiques également signalés. Aucun correctif supplémentaire hors mandat. UI inchangée : ancien résultat provisoire et complétude 100 % restent affichés ; ce n'est pas une validation du devis. Chiffrage positif et concurrence runtime NOT_RUN.
Suite : vérifier l'écart de typage du mock sous GO ciblé, puis clarifier identité source et allocation avant recette positive. Rollback : revert dd5e2cf0 et redéploiement de run-pricing, sans restauration de faits. Note de clôture locale non commitée (pas de commit docs-only).

### 3.24 IMO-PREFLIGHT-TEST-TYPE — normalisation du mock et clarifications (14 septembre 2026)

GO utilisateur : résoudre l'écart technique signalé par Lovable, puis vérifier les données GoTrans avant recette positive. Base locale/GitHub work dd5e2cf0 confirmée par ls-remote ; note de clôture §3.23 locale préservée. Aucun nouveau GO tarif, seuil de poids, faits client ou runtime déduit des entrées PENDING.
Correctif local uniquement : imo-goods-preflight_test.ts +4/−2 ; new Request(input, init) fournit URL/méthode normalisées sans lire RequestInit.method, sans any ni suppression de diagnostic. Aucun code de production modifié.
Diagnostic : Deno local 2.9.5 ne reproduit pas TS2339 avant patch ; contrôle isolé retrouve seulement les deux TS2345 historiques. Différence de déclarations ambiantes Lovable suspectée, cause exacte non prouvée ; disparition du signalement dans Lovable NOT_RUN.
Preuves après patch : 117 tests ciblés IMO PASS (dont 36 preflight), ESLint du fichier PASS, typecheck:deno 49 erreurs/5 compartiments avant et après = PASS_WITH_BASELINE ; diff-check PASS. CI complète et nouveaux contrôles Cloud NOT_RUN ; aucune baseline relevée.
GoTrans relu dans Cloud : identité client du fil NULL ; original décodé confirme ONU lié aux armoires, quantités de marchandises pour les groupes 1/2 et trois conteneurs pour le groupe 3. Ni allocation des groupes 1/2 ni déclaration DG/non-DG des groupes 2/3 confirmées. Recherche IMAP échouée (DNS) : absence de nouvelle réponse non démontrée.
GO de livraison reçu le 14 septembre : commit/push du test et de la roadmap puis vérification Lovable, sans redéploiement moteur. Base dd5e2cf0 local/GitHub/Lovable confirmée ; Git direct indisponible, connecteur GitHub autorisé pour le fast-forward non forcé. 117 tests et contrôle Deno 49/5 rejoués PASS_WITH_BASELINE, lint du test PASS.
IMAP rétabli : deux messages client et accusé SODATRA du 27 mai relus dans INBOX, sans confirmation supplémentaire d'allocation ou du statut DG des autres groupes. Aucun contenu client brut ajouté au dépôt. Obtenir packing list/allocation et déclaration par groupe, puis validation tracée de l'identité du fil.
Livraison : work dd5e2cf0 → 0e2768ad, 2 fichiers +20/−4 ; blobs/arbre local et GitHub identiques, fast-forward non forcé via connecteur puis références locales alignées. [CI 34833331743](https://github.com/douania/dakar-cargo-quotes/actions/runs/34833331743) SUCCESS. Aucun code de production modifié, aucun redéploiement moteur.
Lovable (message umsg_01m2fqbqcrevqb254db4zbq09e) : HEAD 0e2768ad et worktree propre sur branche interne d'édition ; contrôle de typage frais et journal confirment TS2339 disparu, exactement 2 TS2345 historiques restants. Deno 2.6.10 / TS 5.9.2 : 27 tests PASS, 9 FAIL pour deux intervalles non libérés chacun, aucun échec d'assertion rapporté. Origine liée à la version supposée, non prouvée ; ne pas désactiver les sanitizers ni masquer ces échecs. Local/CI utilisent Deno 2.9.5.
IMAP : INBOX, Archive, quatre dossiers indésirables et deux dossiers envoyés interrogés ; seuls les trois échanges déjà relus ont été retrouvés. Aucune confirmation supplémentaire, aucun envoi ni changement de lecture. Données nécessaires à la recette positive toujours absentes des messages consultés.
État final : PASS livraison et correction TS2339, PARTIAL qualité multi-environnement ; recette positive GoTrans NOT_RUN. Aucun fait/gap/timeline/prix/brouillon/envoi/DB/Auth/RLS modifié. Rollback : revert du seul commit test/docs, sans redéploiement moteur. Clôture locale non commitée (pas de commit docs-only).

### 3.25 IMO-FALSE-POSITIVES — alertes Lovable 1 et 2 (23 septembre 2026)

GO CTO de réalisation locale puis GO ciblé « HTML tronqué » ; base work/origin/work 00e15251. Claude Code exécutant unique ; contre-revue indépendante (sous-agent, lecture seule) en trois passes limitées aux bloquants.
Reproduit sur HEAD : e-mail ordinaire de 5 180 caractères, corps vide et phrase initiale de 40 lettres sans ponctuation → INCOMPLETE_EMAIL_SOURCE ; « un 20HQ », « un 2ème conteneur » → marqueur ONU invalide.
Reconnaissance (`_shared/imo-goods-recognition.ts`, partagée avec build-case-puzzle) : « un »/« Un » + espace = article sauf quatre chiffres hors décimale ; UN/ONU majuscule ≤ 2 chiffres = quantité ; formats UN3536, UN 3536, UN-3536, ONU: 3536, un-3536 conservés ; séparateur linéaire.
Preflight run-pricing : décodeur gelé inchangé (parité) ; hors fenêtre 4 000, relecture du corps entier (MIME imbriqué ou sans en-tête, base64 strict toute largeur, QP, charset, HTML). Corps vide = aucune mention. Restent incomplets : indécodable/binaire, sans partie texte, délimiteur MIME fermant absent, texte ou HTML au plafond d'ingestion.
Plafonds vérifiés dans le code (unités UTF-16, substring) : sync-emails texte 50 000 / HTML 100 000 ; hydrate-email-body 500 000 / 1 000 000 ; body_text dérivé du HTML tronqué ; import-thread sans plafond. Exception FROZEN run-pricing/index.ts : lecture de body_html (+2/−1), signal seul, empreinte et relecture de fraîcheur inchangées.
Preuve enregistrée conservée ; HTML au plafond ne peut que la rendre plus stricte (REVIEW + INCOMPLETE_EMAIL_SOURCE), objet stocké non muté.
Diff : 5 fichiers de code/test (+404/−34). Tests : 193 IMO ciblés PASS dont handler réel (select body_html, 100 000 → 400 SOURCE_REVIEW_REQUIRED, 99 999 → pas de blocage IMO) ; 25 nouveaux tests en échec sur origin/work.
Suite Deno 1674 PASS / 1 FAIL Intake :191 identique à origin/work ; typecheck:deno 49/5 et lint:baseline 732/16 inchangés ; ESLint fichiers et diff-check PASS. Vitest/build NOT_RUN (aucun frontend).
Cloud lecture seule : 0 preuve IMO, 0 gap IMO ; 19 dossiers estimés (SQL, sans contenu) touchés par l'ancien blocage en mémoire, dont 2 avec mention ONU réelle à conserver ; 9 e-mails entrants à HTML plafonné, aucun rattaché à un dossier. Aucune réparation.
Résiduels : base64 brut coupé hors plafond sur multiple de 4 ; lecture body_html jusqu'à 1 Mo par e-mail hydraté ; build-case-puzzle lit toujours 4 000 caractères (pricing rattrape sans preuve) ; décodeur gelé quadratique sur HTML pathologique.
Publication (GO distinct du 23/09) : work 00e15251 → 6aefc4ce, 5 fichiers +404/−34, push fast-forward sans force ; Lovable synchronisé, privé/non publié. CI 35861289169 FAIL au seul Vitest LocalTransportEstimateFields, identique à 00e15251 (run 35846061829) ; étapes suivantes non exécutées en CI, exécutées localement (config 97, bundles, typecheck, Deno, lint, build PASS/baseline).
Déploiement privé run-pricing puis build-case-puzzle (message Lovable umsg_01m374fgfbf1s8pw03xvps2tpb) : OPTIONS 200, POST sans auth 401 ; sondes techniques, pas une recette métier.
Recette sandbox BLOCKED : les e-mails n'entrent que par ingestion IMAP (sync-emails, import-thread, hydrate-email-body) ; aucun mécanisme applicatif ne crée un fil/e-mail synthétique sans envoi réel ni insertion directe. Aucune écriture sandbox, aucun dossier client recalculé. Arbitrage consigné dans la file CTO.
Rollback : revert de 6aefc4ce puis redéploiement de run-pricing et build-case-puzzle, sans restauration de données. Alertes 3 à 8 non commencées.

## 4. Preuves de l'audit du 22 août 2026

### 4.1 Dépôt et qualité locale

- 824 fichiers environ, 285 fichiers sous `src`.
- 91 Edge Functions avec un `index.ts` métier, hors dossiers partagés et tests.
- 202 migrations.
- 8 fichiers Vitest : **72 tests réussis**.
- 39 fichiers de tests Deno : **431 cas `Deno.test` recensés mais non exécutés**, Deno et Supabase CLI n'étant pas disponibles dans l'environnement d'audit.
- Build Vite de production : **réussi**.
- TypeScript : **échec sur une seule erreur**, directive `@ts-expect-error` inutilisée dans `src/lib/fetchWithRetry.ts`.
- ESLint : **797 problèmes** (770 erreurs, 27 avertissements), majoritairement `no-explicit-any`.
- Aucune GitHub Action détectée : aucun filet CI distant ne bloque une régression.
- Bundle JavaScript principal observé : environ **3,27 Mo**.

### 4.2 État runtime Lovable, agrégats en lecture seule

Instantané du 22 août 2026 :

- 64 dossiers de cotation ;
- 34 dossiers avec des gaps déclarés ;
- 27 dossiers avec au moins une exécution pricing ;
- 162 exécutions pricing : 108 `success`, 24 `blocked`, 30 `failed` ;
- aucune exécution pricing durant les 30 jours précédant l'audit ;
- 9 versions de devis, toutes `draft` ;
- 11 lignes de demande et 2 lignes cargo canoniques courantes ;
- 9 demandes d'information client : 3 `drafted`, 6 `sent` ;
- 2 demandes de prix partenaires, toutes `draft` ;
- 0 hypothèse de scénario enregistrée ;
- 675 faits courants, tous observés avec `is_validated = false` ; la doctrine et l'usage réel de ce champ doivent être clarifiés avant d'en déduire un défaut ;
- 35 cartes tarifaires, toutes `to_confirm` ;
- 91 tarifs de transport local : 10 actifs mais `to_confirm`, 81 `historical_only` ;
- dernière exécution pricing observée : 28 juin 2026 ;
- dernière version de devis observée : 5 juin 2026.

### 4.3 Sécurité et configuration

- Les 11 tables critiques contrôlées avaient RLS activée et au moins une policy.
- L'audit statique des 91 Edge Functions n'a trouvé aucune mutation volontairement anonyme hors `healthz`.
- Neuf fonctions PAD récentes n'ont pas de section explicite dans `supabase/config.toml` :

  - `create-pad-recommendation-candidates` ;
  - `get-commodity-classification-candidates` ;
  - `get-pad-nst-suggestions` ;
  - `produce-pad-classification-candidates` ;
  - `propagate-classification-candidate-to-facts` ;
  - `propose-pad-alias-enrichment` ;
  - `recommend-pad-category` ;
  - `update-commodity-classification-candidate` ;
  - `validate-pad-alias-enrichment`.

Leur code contient des contrôles d'authentification, mais l'écart de configuration doit être résolu pour rendre les déploiements déterministes.

## 5. P0 — prérequis avant production générale

Le P0 doit être terminé avant de commencer l'intégration des fonctions P1 dans un runtime destiné à la production.

### PACK P0-A — filet de sécurité technique

Objectif : rendre chaque modification vérifiable et bloquer les régressions essentielles.

Statut local au 22 août 2026 : **PASS — implémenté et contre-vérifié, non commité**.

Preuves :

- correction chirurgicale de l'unique erreur TypeScript dans `src/lib/fetchWithRetry.ts`, sans changement runtime ;
- scripts npm explicites pour typecheck, Vitest, Deno local/live, baselines lint/Deno et chaîne CI ;
- workflow `.github/workflows/ci.yml` préparé pour `work`, mais pas encore actif sur GitHub faute de commit/push autorisé ;
- 8 fichiers Vitest / 72 tests réussis ;
- 34 fichiers Deno locaux : 400 tests réussis, 0 échec, 6 tests explicitement ignorés ;
- 5 fichiers de smoke tests live isolés et non exécutés, car ils exigent un runtime et des secrets ;
- dette de typage Deno préexistante mesurée : 65 diagnostics dans 7 couples code/fichier, protégés par une baseline de non-aggravation ;
- baseline lint : 770 erreurs et 27 avertissements, protégés contre toute aggravation ;
- build de production réussi ;
- Deno 2.9.5 portable installé hors repo avec checksum vérifié ;
- aucune dépendance, migration, Edge Function ou donnée runtime modifiée.

Risques résiduels acceptés localement : les imports Deno Supabase restent flottants, les 65 diagnostics ne sont pas encore corrigés, les 5 tests live restent à exécuter sous GO runtime et la CI doit encore être prouvée par un run GitHub après autorisation de commit/push.

Travaux :

1. Corriger chirurgicalement l'unique échec TypeScript dans `src/lib/fetchWithRetry.ts`.
2. Installer ou utiliser un environnement Deno compatible sans modifier le runtime Lovable.
3. Exécuter les 431 tests Deno et classifier les échecs éventuels : régression réelle, test obsolète ou dépendance d'environnement.
4. Ajouter une CI GitHub exécutant au minimum :
   - typecheck ;
   - 72 tests Vitest existants ;
   - tests Deno ;
   - build de production.
5. Ne pas rendre immédiatement les 797 problèmes lint bloquants. Publier une baseline, empêcher toute aggravation et réduire la dette par lots ciblés.
6. Ajouter des commandes npm explicites pour le typecheck et les gates retenus si nécessaire.

Critère de sortie : typecheck, tests frontend, tests backend et build verts dans un environnement reproductible ; CI active sur `work` ou sur les PR ciblant `work` selon la décision CTO.

### PACK P0-B — preuve directe du garde-fou PAD

Objectif : garantir qu'une catégorie PAD obligatoire absente bloque le pricing au bon scope sans masquer d'autres lots.

Statut local au 22 août 2026 : **PASS LOCAL — preuve runtime directe reportée à P0-E**.

Preuves :

- extraction chirurgicale du garde-fou dans `supabase/functions/run-pricing/pad-scope-blocker.ts`, sans changement des deux call sites ;
- 18 tests directs couvrant scope/hors scope, catégorie cargo ou pricing, taux absent/invalide, normalisation, isolation multi-lots, idempotence et contrat exact ;
- suite Deno locale portée à 418 tests réussis, 0 échec et 6 ignorés ;
- baseline de typage Deno inchangée à 65 diagnostics dans 7 couples code/fichier ;
- vérification en lecture seule que `build-case-puzzle` protège `pricing.pad_category` de la résolution automatique des gaps orphelins ;
- baseline lint améliorée et verrouillée à 764 erreurs / 27 avertissements ;
- typecheck frontend, Vitest et build réussis ;
- aucun runtime, migration ou donnée modifié.

Risque résiduel : `PAD_CATEGORY_REQUIRED` est aussi retourné lorsque la catégorie existe mais que le taux PAD officiel est absent ou invalide. Le comportement existant est désormais explicitement testé, sans changement de doctrine. Le smoke direct Lovable de cette branche reste requis sous un GO runtime distinct dans P0-E.

Travaux :

1. Ajouter des tests dédiés à `resolvePadScopeBlocker` dans `supabase/functions/run-pricing/index.ts` ou extraire uniquement la partie pure si cette extraction est strictement nécessaire au test.
2. Couvrir au minimum :
   - PAD hors scope : aucun blocage ;
   - PAD dans le scope avec catégorie valide : aucun blocage ;
   - PAD dans le scope sans catégorie : `PAD_CATEGORY_REQUIRED` ;
   - multi-lots : blocage limité au lot concerné et résultat global cohérent ;
   - réexécution idempotente.
3. Vérifier la conservation de `pricing.pad_category` dans la reconstruction du puzzle.
4. Préparer un smoke test runtime direct. Son exécution nécessite un GO CTO Lovable séparé et ne doit pas altérer un dossier métier réel.

Critère de sortie : tests locaux verts et preuve runtime directe de la branche `PAD_CATEGORY_REQUIRED`, ou verdict BLOCKED documenté si aucune fixture sûre n'est disponible.

### PACK P0-C — configuration déterministe des Edge Functions

Objectif : aligner la configuration de déploiement avec les fonctions réellement présentes.

Statut local au 22 août 2026 : **PASS — configuration et gate statique implémentées, non commitées**.

Preuves :

- audit statique des neuf fonctions PAD/classification manquantes : chacune valide réellement le JWT via `requireUser` ou `supabase.auth.getUser()` avant toute opération ;
- les mutations restent soumises à RLS et, pour `validate-pad-alias-enrichment`, à un contrôle de rôle PAD administrateur ;
- neuf sections explicites `verify_jwt = false` ajoutées à `supabase/config.toml`, conformément au contrat ES256 existant ;
- gate `scripts/check-edge-function-config.mjs` ajoutée à la chaîne CI ;
- contrôle bidirectionnel vérifié : 91 fonctions déployables, 91 sections uniques, 91 valeurs `verify_jwt = false` ;
- sondes négatives vérifiées pour omission, doublon, section obsolète, flag absent, non booléen ou `true` ;
- typecheck frontend, 72 Vitest, baseline Deno, 418 tests Deno locaux, baseline lint 764/27 et build réussis ;
- aucun code d'Edge Function, runtime, RLS, donnée ou migration modifié.

Risque résiduel : la gate prouve l'exhaustivité de la configuration, pas l'authentification applicative future. Toute nouvelle fonction nécessite toujours une revue de son code Auth/RLS. La CI reste locale tant que commit/push ne sont pas autorisés.

Travaux :

1. Auditer les neuf fonctions listées à la section 4.3.
2. Déterminer explicitement pour chacune la politique `verify_jwt` cohérente avec le contrat de sécurité du projet.
3. Ajouter uniquement les sections nécessaires dans `supabase/config.toml`.
4. Vérifier que les contrôles applicatifs `requireUser` ou `requireAdmin` restent présents.
5. Tester les chemins anonyme, utilisateur et administrateur applicables.

Critère de sortie : aucune fonction déployable sans configuration explicite et aucune réduction des protections Auth/RLS.

### PACK P0-D — validation des référentiels tarifaires

Objectif : permettre des cotations fermes uniquement à partir de sources validées.

Statut au 24 août 2026 : **PARTIEL — quarantaine tarifaire reconstruite dans Git (P0-D-1), grille officielle de livraison stagée et contrat applicatif débours livré localement (P0-D-2), sélection déterministe fail-closed et migration locale de promotion des 60 lignes exécutées et vérifiées sur PostgreSQL 17 jetable (P0-D-3 PASS local) ; aucune application Lovable, et les autres familles tarifaires restent BLOCKED**.

Faits statiques vérifiés après P0-C :

- `quotation-engine` charge `border_clearing_rates` et `destination_terminal_rates` avec le seul filtre `is_active = true` ;
- les montants positifs de ces deux familles sont ajoutés au devis avec `source.type = 'OFFICIAL'` et une confiance de 0,9 ou 0,85 ;
- les 6 lignes frontière et les 10 lignes terminal du seed Git proviennent de `Taleb_Tiakabougou_Quote_2024`, datée du 1er octobre 2024 ;
- ces deux tables n'ont pas de colonne `evidence_level` et leurs lignes seedées sont actives par défaut ;
- aucune migration Git antérieure au 22 août 2026 ne désactivait `border_clearing_rates` ou `destination_terminal_rates` ;
- `docs/SYNTHESE_TARIFAIRE_POST_NETTOYAGE.md` affirme que ces 16 lignes ont été désactivées par LOT3-A ; cette affirmation reste non reconstructible depuis Git, mais l'extraction live du 22 août confirme qu'elles sont bien inactives côté Lovable ;
- la migration de mai 2026 trouvée avec `is_active = false` concerne uniquement des lignes legacy de `port_tariffs` ;
- le document `docs/tariff-collection/VALIDATION_RATE_CARDS_AND_CATALOGUE.md` contient le checklist SODATRA des 35 rate cards et des 11 services catalogue, mais décrit un état antérieur désormais contredit par le snapshot runtime du 22 août ;
- les 35 rate cards et les 91 tarifs locaux ne sont pas seedés dans les migrations Git : une extraction runtime récente est indispensable avant toute décision.

Risque traité : si les lignes Taleb étaient rebâties actives par un reset Git, un transit Mali recevrait des montants issus d'une cotation client 2024 présentés et totalisés comme officiels. Le risque venait donc de l'écart Git/live, pas de l'état live lui-même.

Extraction live du 22 août 2026 (GO CTO Lovable **strictement read-only**, réalisée) :

- `border_clearing_rates` : exactement 6 lignes, **toutes `is_active = false`**, `source_document = 'Taleb_Tiakabougou_Quote_2024'`, `effective_date = 2024-10-01` ;
- `destination_terminal_rates` : exactement 10 lignes, **toutes `is_active = false`**, mêmes source et date d'effet ;
- `demurrage_rates` : 9 lignes non vérifiées (COSCO, EVERGREEN, ONE) **inactives**, `effective_date = 2025-12-20`, `notes = 'TO_CONFIRM — pas de barème officiel Sénégal vérifié, données estimatives'`, sources suffixées `(non vérifié Sénégal)` ; les 26 autres lignes restent actives et hors périmètre ;
- les 35 `pricing_rate_cards` live sont toutes `status = to_confirm`, or `price-service-lines` ne charge que `status = active` : aucune ne peut donc être cotée fermement aujourd'hui ;
- les 91 `local_transport_rates` live se répartissent en 81 `false/historical_only` et 10 `true/to_confirm`, alors que `quotation-engine` et `price-service-lines` exigent `evidence_level` dans `official`/`validated_internal` : aucune n'est cotable fermement non plus.

Conclusion de l'extraction : la quarantaine tarifaire existe **déjà** dans Lovable ; elle n'existait pas dans Git. C'est cet écart, et lui seul, que P0-D-1 corrige.

#### P0-D-1 — reconstruction Git de la quarantaine live (appliqué localement)

`supabase/migrations/20260822140700_reconcile_unverified_tariff_quarantine.sql` reconstruit dans Git l'état de quarantaine observé en lecture seule sur Lovable, en un unique bloc `DO` atomique et idempotent :

- désactive les 6 lignes frontière et les 10 lignes terminal Taleb **sans toucher à un seul de leurs attributs métier** (montants, méthodes, devises, sources, dates d'effet) ;
- réaligne les 9 lignes demurrage non vérifiées sur les métadonnées live (`effective_date`, `notes`, `source_document`) puis les désactive, sans modifier carrier, type de conteneur, franchises, devise ni taux journaliers ;
- refuse d'agir — `RAISE EXCEPTION`, transaction annulée — sur toute ligne surnuméraire, manquante ou divergente, chaque ligne devant correspondre soit à l'empreinte seed Git exacte, soit à l'état cible live exact ;
- n'active jamais un tarif : `is_active` ne se déplace que de `TRUE` vers `FALSE` ;
- n'exécute aucun `INSERT`, `DELETE`, DDL de table ni changement RLS, et n'encode aucun UUID live ;
- laisse les 26 autres lignes `demurrage_rates` — dont les deux parents épinglés par `20260402152121` — prouvées intactes par une empreinte `md5` prise avant et après la passe de mutation ;
- `effective_date` est volontairement exclue de l'empreinte seed demurrage, le seed `20251220103347` la laissant à `DEFAULT CURRENT_DATE` donc non déterministe ;
- l'empreinte cible frontière/terminal valide aussi `charge_name` et `notes` : l'extraction live exhaustive les a bien renvoyés pour les 16 lignes Taleb et ils sont identiques aux libellés seed. Les lignes cibles frontière et terminal ne diffèrent donc de leurs lignes seed que par `is_active`.

Portée exacte : il s'agit d'une **réconciliation technique d'un état live observé**, pas d'une validation métier SODATRA des tarifs concernés. Elle empêche un reset Git de réactiver 25 tarifs non validés ; elle ne rend aucun tarif cotable et ne tranche aucune question de doctrine.

Preuve runtime locale au 22 août 2026 : la version finale durcie de la migration a été exécutée dans une base **PostgreSQL 17 locale jetable**, montée avec des schémas et des seeds minimaux fidèles aux migrations sources (`20260114114407` pour les 16 lignes Taleb, `20251220103347` pour les 9 lignes demurrage), plus une ligne sentinelle MSC hors périmètre.

- première application : **6 lignes frontière désactivées, 10 lignes terminal désactivées, 9 lignes demurrage réconciliées**, sentinelle MSC hors périmètre restée active et inchangée ;
- seconde application sur la même base : **0 / 0 / 0**, donc no-op et idempotence réels, empreinte `md5` hors périmètre identique ;
- altération volontaire de la note de la ligne Taleb `SCANNER` : migration refusée avant écriture avec `RAISE EXCEPTION`, preuve que l'empreinte cible durcie échoue bien sur une dérive documentaire ;
- aucune action live : ni Lovable, ni projet Supabase distant, ni écriture hors de la base jetable.

Ceci valide la **syntaxe**, la **mutation ciblée** et l'**idempotence** du bloc `DO`. Cela ne remplace pas encore un `supabase db reset` intégral : la chaîne complète des migrations Git, dans son ordre réel et avec le schéma complet, n'a pas été rejouée (CLI Supabase absente de l'environnement). Exécuter le reset complet dès qu'un environnement le permet.

#### P0-D-2 — grille officielle de livraison et contrat débours (PASS Git/Lovable via P0-D-3)

Les deux PDF fournis par le responsable métier, `TARIFS DE LIVRAISONS DES CONTENEURS 20P.pdf` et `TARIFS DE LIVRAISONS DES CONTENEURS 40P.pdf`, ont été rapprochés avec l'état Lovable observé. Ils portent 30 destinations pour deux types de conteneurs, soit exactement 60 montants TTC. La doctrine métier explicitement confirmée est : **la livraison sous-traitée est un débours tiers tant que SODATRA n'exploite pas sa propre flotte**.

La migration locale `supabase/migrations/20260823130000_stage_official_local_transport_debours.sql` :

- stage les 60 montants avec `SOURCE_BASIS=TOTAL_TTC`, `is_active=false` et `evidence_level=to_confirm` ;
- conserve les 10 lignes Lovable déjà présentes comme no-op exact et ajoute 50 lignes uniquement dans l'état Lovable-like ;
- insère les 60 lignes lors d'un reset Git vierge ;
- n'active, ne promeut, ne met à jour et ne supprime aucun tarif ;
- encode la provenance PDF et les empreintes SHA-256 dans les notes ;
- reste invisible aux deux lecteurs pricing, qui exigent `is_active=true` et une preuve `official` ou `validated_internal`.

Le lot applicatif local associé établit un contrat orthogonal au champ `bloc` historique :

- `accounting.classification = DEBOURS_TIERS` ;
- `accounting.amount_basis = SUPPLIER_TTC` ;
- inclusion commerciale dans DAP et DDP ;
- aucune TVA SODATRA additionnelle sur ce montant fournisseur TTC ;
- aucune commission automatique sur le transport local ;
- maintien temporaire de `bloc=operationnel` pour compatibilité, avec extraction du montant hors du sous-total opérationnel par le calcul canonique ;
- séparation explicite entre débours transport local, débours douaniers, enrichissements et honoraires ;
- calcul commun mono-lot/multi-lot, exclusion de `TO_CONFIRM` et protection contre le double comptage ;
- conservation du détail comptable dans les versions immuables ;
- présentation des nouveaux devis en `Sous-total avant TVA SODATRA`, `TVA SODATRA sur honoraires` et `Total à payer` dans l'interface, le PDF et le brouillon email ; les anciennes versions conservent leur rendu historique.

Preuves locales du 24 août 2026 :

- `424` tests Deno passés, `0` échec, `6` tests live volontairement exclus ;
- barrière de dette TypeScript Deno : `65` diagnostics préexistants, aucune aggravation ;
- typecheck frontend complet vert ;
- `72` tests frontend passés ;
- configuration des `91` Edge Functions vérifiée ;
- dette lint inchangée (`764` erreurs, `27` warnings), aucune aggravation ;
- build production vert ; bundle principal observé à environ `3,48 Mo`, dette P2 inchangée ;
- aucun commit, push, déploiement, email réel, migration live ni écriture Lovable.

Barrières restantes avant toute promotion tarifaire :

1. SODATRA doit confirmer par écrit la date d'effet, l'émetteur, la période de validité et l'actualité opérationnelle des deux PDF ; ces éléments ne sont pas visibles dans les documents fournis.
2. La qualification fiscale/comptable du débours fournisseur TTC et la preuve du mandat ou de la refacturation au réel doivent être validées par le responsable comptable/fiscal ; le code implémente la doctrine métier, pas un avis juridique.
3. Le rapprochement de destination doit devenir déterministe avant activation : la recherche actuelle par `ilike '%terme%'` suivie de `limit(1)` ne suffit pas pour promouvoir 60 lignes partageant des zones ou libellés composés.
4. La future migration de promotion devra échouer fermement sur toute collision, dérive de montant, cardinalité inattendue, source absente ou date invalide, et ne promouvoir que la liste expressément signée par SODATRA.
5. Une recette sandbox devra prouver, pour 20P et 40P, l'absence de double comptage, la cohérence DAP/DDP, la TVA limitée aux honoraires, la commission transport nulle et le rendu PDF/email avant toute action Lovable.

Conclusion historique de P0-D-2 : à la fin de ce sous-lot, le code était prêt à **représenter correctement** ces tarifs, mais les 60 lignes restaient volontairement non cotables. Les décisions métier et les protections techniques ajoutées par P0-D-3 lèvent ensuite ce blocage **localement seulement** ; aucune ligne Lovable n'est encore promue.

#### P0-D-3 — sélection déterministe fail-closed et promotion des 60 lignes (PASS Git/Lovable)

Décisions métier explicites du responsable SODATRA reçues le 24 août 2026 : les deux PDF constituent le barème en vigueur sans date d'expiration ; les 60 lignes sont approuvées pour promotion ; le transport local reste un débours fournisseur TTC sans commission ni TVA SODATRA additionnelle ; priorité au tarif exact ; la formule kilométrique ne sert qu'au contrôle de cohérence ; toute destination inconnue, non couverte ou ambiguë doit rendre `TO_CONFIRM` / `TARIF_TRANSPORT_A_CONFIRMER` avec un montant `null`.

Ces décisions lèvent les barrières de sélection et de promotion de P0-D-2. Pour le périmètre actuel de **cotation** — et non de facturation — la doctrine fournisseur TTC, sans commission ni TVA SODATRA additionnelle, est suffisante pour le contrat applicatif local. Une validation comptable/fiscale reste recommandée avant tout usage de facturation ou de comptabilisation ; la recette sandbox de bout en bout reste obligatoire avant toute action Lovable.

Résolveur pur partagé `supabase/functions/_shared/local-transport-destination.ts` :

- normalisation déterministe des libellés (accents, casse, ponctuation, espaces, espaces autour du `/`) et des types de conteneur ;
- index des 30 destinations canoniques + 18 composants de libellés composés + 4 aliases de zone explicitement validés (`DAKAR` → zone 1 ; `POUT`, `SEBIKHOTANE`, `SEIKHOTANE` → zone 2) ; toute clé revendiquée par deux destinations est marquée ambiguë et ne résout rien ;
- aucune correspondance par sous-chaîne, préfixe ou similarité : les villes de zone non couvertes par une décision écrite (Pikine, Guédiawaye, Rufisque, Diamniadio, Keur Massar…) redeviennent `TO_CONFIRM` ;
- conteneurs : whitelist explicite des variantes dry 20 et 40 vers `20' Dry` / `40' Dry` ; reefer, flat rack, open top, tank, 45', LCL et low bed ne résolvent pas ;
- filtrage `is_active` + whitelist de preuve + fenêtre de validité + scope client, puis exigence d'**exactement un** candidat ; zéro ou plusieurs ⇒ `TO_CONFIRM`, montant `null` ;
- la formule kilométrique est délibérément absente du module runtime, pour qu'aucun montant ne puisse en dériver.

`supabase/functions/quotation-engine/index.ts`, patch structurel autorisé et strictement borné au bloc de résolution du transport local (le reste du moteur reste FROZEN) :

- l'enchaînement `ilike '%terme%'` puis `.limit(1)`, qui pouvait servir le tarif d'une autre destination, est supprimé ;
- le barème validé exact passe désormais **avant** toute donnée historique ;
- pour une destination inconnue ou ambiguë, l'historique ne produit plus aucun montant ferme : il ne subsiste qu'en information non chiffrante dans les notes, la ligne restant à `null` / `TO_CONFIRM` ;
- le scope client du dossier est propagé au résolveur, ce qui ferme la fuite possible vers une ligne client-spécifique.

`supabase/functions/price-service-lines/index.ts` : `findLocalTransportRate` consomme le même résolveur pur ; le mapping ville→zone par sous-chaîne, le match partiel de destination et le premier-match conteneur sont supprimés. Après un éventuel override client contractuel existant, le barème local exact passe avant catalogue et `pricing_rate_cards` ; zéro candidat, ambiguïté ou destination inconnue produit immédiatement `TO_CONFIRM` et ne peut plus tomber sur un tarif générique. La même priorité est appliquée au calcul de base des overrides en pourcentage. Les gardes anti-fuite client du Lot 2A et le refus des lignes `to_confirm` sont conservés, portés par le résolveur.

`supabase/migrations/20260824120000_promote_official_local_transport_grid.sql` :

- promeut les 60 lignes de `source_document = TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS` en `is_active = true` et `evidence_level = 'validated_internal'` — **pas** `'official'` : le barème est approuvé par SODATRA mais les PDF ne portent ni autorité réglementaire, ni émetteur, ni signature ;
- `UPDATE` de ces deux seules colonnes ; aucun `INSERT`, `DELETE`, DDL, RLS ni Auth ;
- `validity_start` n'est ni inventé ni homogénéisé : les 10 dates live `2026-03-30` et les 50 `NULL` stagés sont préservés, prouvé par un digest de toutes les colonnes non promues pris avant et après l'écriture ; `validity_end` reste `NULL` ;
- gardes avant écriture : cardinalité exacte de 60, unicité des 60 clés métier, unicité des destinations une fois normalisées, montant TTC exact, devise, origine, catégorie cargo, `client_code`/`provider`/`source_attachment_id`/`rate_includes` `NULL`, états d'entrée limités à stagé / live observé / déjà promu, et absence de toute ligne active et cotable hors périmètre en collision sur l'une des 60 clés ;
- contrôle de cohérence kilométrique encodé comme garde : 20P `57 000 + 1 000/km` (exceptions `ZONE −5 000`, `BIGNONA +2 000`, `ZIGUINCHOR +6 000`, `CAP SKIRING +27 000`), 40P `69 000 + 2 000/km` (exceptions `BIGNONA +74 000`, `ZIGUINCHOR +23 000`, `CAP SKIRING +99 000`), plus la reconstitution TTC = transport + frais de dossier + TVA 18 %. Ce contrôle ne calcule jamais `rate_amount` ;
- postconditions : 60 lignes actives et cotables, 30 par taille, exactement une ligne générique active et cotable par clé métier sur toute la table, empreinte hors périmètre et cardinalité totale inchangées ;
- idempotence : l'`UPDATE` ne cible que les lignes hors état final, donc le second passage touche 0 ligne et ne déclenche même pas le trigger `updated_at`.

Preuves exécutées le 24 août 2026 :

- le contrôle kilométrique a été vérifié à la main sur les 60 montants transcrits : les 30 valeurs 20P et les 30 valeurs 40P se reconstituent exactement par la formule et ses exceptions ;
- les `32` tests ciblés de `local-transport-destination_test.ts` passent, dont les 30 libellés canoniques, les 18 composants de libellés composés, les aliases de zone approuvés, les collisions, les fenêtres de validité, le scope client, les types de conteneur, les 60 montants et la reconstitution TTC ;
- suite Deno locale complète : **456 tests passés, 0 échec, 6 tests live volontairement exclus** ;
- barrière de dette TypeScript Deno : **65 diagnostics préexistants dans 7 couples code/fichier, aucune aggravation** ;
- typecheck frontend complet vert ; **72 tests frontend passés** ; configuration des **91 Edge Functions** vérifiée ; baseline lint inchangée (**764 erreurs, 27 warnings**) ; build production vert, bundle principal environ **3,48 Mo** ;
- PostgreSQL 17 jetable, état reset vierge : staging de 60 lignes, première promotion **60 mises à jour**, seconde promotion **0 mise à jour**, empreinte `updated_at` identique et sentinelle hors périmètre intacte ;
- PostgreSQL 17 jetable, état Lovable-like : 10 lignes live `true/to_confirm` datées `2026-03-30` + staging de 50 lignes ; promotion finale **60 `true/validated_internal`**, avec **10 dates préservées et 50 `validity_start = NULL`**, sentinelle intacte ; second passage **0 mise à jour** avec empreinte identique ;
- test négatif : l'ajout d'une unique ligne active `validated_internal` concurrente sur `KAOLACK / 20' Dry` fait échouer la migration avant écriture avec la garde de collision attendue ;
- le conteneur PostgreSQL jetable a été supprimé après les preuves ; aucune donnée projet ou runtime n'y était stockée ;
- rien n'a été commité, poussé, déployé ni appliqué en live.

Contrôle Lovable Cloud strictement en lecture seule du 24 août 2026, réalisé après les preuves locales :

- projet confirmé : `c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef`, état `ready`, commit Lovable `6913c297ceb1ebaab7119b8fd0ddccc0a243831e`, identique au `HEAD` local et à `origin/work` ;
- les versions `20260823130000` (staging) et `20260824120000` (promotion) sont absentes du ledger live ;
- `local_transport_rates` contient toujours **91 lignes** : **81** lignes `Aksa Energy Container pricing.xlsx` inactives et non cotables, plus **10** lignes de la grille officielle ;
- les 10 lignes officielles live sont exactement les cinq destinations `KEDOUGOU`, `KIDIRA / BISSAU`, `KOLDA / MATAM`, `ROSSO / NIOKOLOKO` et `VELINGARA / GOUDIRI`, chacune en `20' Dry` et `40' Dry` ; elles correspondent toutes aux montants TTC et attributs épinglés localement, sont `is_active=true`, `evidence_level=to_confirm`, datées du `2026-03-30`, sans date de fin ni notes ;
- face aux 60 lignes attendues : **10 correspondances exactes, 50 lignes absentes, 0 ligne supplémentaire, 0 attribut divergent, 0 doublon de clé métier et 0 collision active + cotable hors de la source** ;
- l'index `uq_local_transport_rates_official_delivery_grid` est absent du live, résultat attendu puisque la migration de staging qui le crée n'a pas été appliquée ;
- aucune écriture, migration, fonction, message Lovable, déploiement ou donnée runtime n'a été modifié pendant ce contrôle.

Verdict de précondition : l'état Lovable observé est exactement l'état à 10 lignes accepté par la migration de staging, puis par la migration de promotion. Cela prouve la compatibilité de l'instantané ; cela n'autorise pas l'application. L'ordre runtime sûr doit conserver une barrière non cotable : staging des 50 lignes manquantes en `inactive/to_confirm`, déploiement et vérification du résolveur fail-closed et du contrat débours, puis seulement promotion des 60 lignes et contrôles post-migration. Aucun intervalle ne doit exposer les 60 lignes actives à l'ancien résolveur du commit canonique.

Exécution Git/Lovable contrôlée du 24 août 2026 :

- les six lots P0-A à P0-D3 ont été commités atomiquement sur `work`, poussés et validés par la CI ; l'ajout Auth d'aperçu créé automatiquement par Lovable a été neutralisé par le revert traçable `a8983bdfff4ab99246796ca7e86ac7fd5838c999`, sans réécriture d'historique ;
- la CI GitHub du commit final est entièrement verte : configuration des 91 Edge Functions, typecheck, 72 tests frontend, baseline Deno, 456 tests Deno locaux, baseline lint et build production ;
- Lovable est `ready`, privé, non publié et synchronisé sur le même SHA `a8983bdfff4ab99246796ca7e86ac7fd5838c999` ; les six fichiers critiques du résolveur, du pricing et de la présentation PDF/email ont été comparés exactement entre Git et Lovable ;
- les fonctions `quotation-engine`, `price-service-lines`, `run-pricing`, `create-quotation-email-draft`, `export-quotation-version-pdf` et `generate-quotation-version` ont été déployées avant l'activation des tarifs, sans publication publique ;
- précontrôle live conforme : 91 lignes de transport local, dont les 10 lignes officielles attendues dans l'état `active/to_confirm`, 81 lignes hors périmètre, aucun doublon ni version déjà enregistrée ;
- migration `20260823130000` appliquée puis enregistrée dans le ledger : 50 insertions inactives `to_confirm`, 10 lignes préexistantes conservées, 60 lignes dans la grille, 81 lignes hors périmètre inchangées et index d'unicité présent ;
- migration `20260824120000` appliquée puis enregistrée dans le ledger : 60 lignes `active/validated_internal`, 30 en 20P et 30 en 40P, 10 dates `2026-03-30` et 50 dates `NULL` préservées, aucune date de fin, aucun attribut hors contrat et zéro clé non déterministe ;
- rejeu live de la promotion : no-op confirmé, empreinte incluant `updated_at`, activation et preuve inchangée sur les 60 lignes ;
- recette ciblée : 7 contrôles live PASS sur 20P, 40P, extrêmes de grille et destination inconnue ; 59 tests spécialisés PASS sur sélection fail-closed, DAP/DDP, double comptage, débours fournisseur TTC, commission nulle et présentation commerciale PDF/email ;
- aucun email réel, aucune autre famille tarifaire activée, aucune publication publique et aucun résidu sandbox créé pendant cette exécution ;
- limite historique : le parcours UI authentifié complet n'était pas encore exécuté à la clôture de P0-D3. Le smoke authentifié décrit dans P0-E a ensuite confirmé le garde-fou PAD, sans permettre d'aller jusqu'à une version de devis faute de classification PAD matérialisée pour ce dossier sandbox ; la grille officielle était déjà intégrée.

Premier blocage métier externe restant : validation/signature SODATRA du checklist `VALIDATION_RATE_CARDS_AND_CATALOGUE.md`, notamment les doublons BORDER/TRUCKING, la doctrine `EMPTY_RETURN`, l'anomalie à 0 XOF et les placeholders export.

Pour les familles autres que cette grille de livraison, ne corriger le moteur ni activer un tarif tant que la doctrine attendue n'est pas confirmée par SODATRA.

Travaux métier et données :

1. Faire valider par SODATRA les 35 `pricing_rate_cards` actuellement `to_confirm`.
2. Grille de livraison 20P/40P : validation métier, déploiement fail-closed, staging et promotion Lovable terminés ; 60 lignes `validated_internal` sont actives, sans commission ni TVA SODATRA additionnelle.
3. Maintenir les 81 tarifs `historical_only` hors pricing ferme.
4. Obtenir ou confirmer les sources officielles manquantes : terminaux, frontières, demurrage transporteurs et services export concernés. La grille de livraison est classée `validated_internal`, conformément à sa preuve actuelle.
5. Définir la date d'effet, la date d'expiration, la devise, le périmètre, la source et la preuve de validation de chaque tarif activé.
6. Ne jamais activer un tarif par simple déduction depuis les données historiques.
7. Exécuter le `supabase db reset` complet dès qu'un environnement local le permet, pour compléter la preuve PostgreSQL 17 jetable de P0-D-1 par un rejeu intégral de la chaîne de migrations.

Critère de sortie : chaque famille annoncée comme cotable fermement possède une source vérifiable et un statut autorisé par la doctrine pricing, et aucun reset Git ne peut réactiver un tarif non validé.

Ce pack dépend d'un responsable métier SODATRA. Il ne peut pas être achevé par le code seul.

### PACK P0-E — recette authentifiée de bout en bout

Objectif : démontrer le parcours réel sur Lovable avant toute publication.

Statut runtime au 26 août 2026 : **PASS CIBLÉ LoLo — parcours authentifié complet jusqu'au brouillon non envoyé, contrôles Auth/RLS et nettoyage intégral vérifiés ; aucun email réel ni publication**.

Preuves vérifiées sur l'aperçu Lovable privé et non publié :

- session applicative authentifiée avec un compte autorisé ; aucun dossier client existant n'a été modifié ;
- création d'un dossier strictement fictif `SANDBOX-P0E-20260824`, puis sélection opérateur du package `DAP_PROJECT_IMPORT` et correction de la destination finale vers `Mbour` ;
- observation d'une anomalie d'intake : une demande texte contenant `1 x 20 pieds` et `1 x 40 pieds` n'a conservé que le 20P, et `Dakar` a été retenu comme destination finale au lieu de `Mbour` ;
- première analyse sans email ni document : échec explicite et traçable `No emails or documents found for this case`, sans effet de pricing ;
- ajout d'une fixture sandbox non sensible avec texte déjà extrait, faute de sélection de fichier local disponible dans le contrôleur navigateur ; analyse réussie vers `NEED_INFO`, 40 % de complétude et trois gaps dont un bloquant ;
- résolution du gap `cargo.description` par l'interface, reconstruction réussie vers `READY_TO_PRICE`, 80 % de complétude, 15 faits et un seul gap non bloquant `contacts.client_email` ;
- deux tentatives de pricing — une automatique après résolution du gap puis une manuelle confirmée — toutes deux enregistrées `blocked` avec l'unique garde `PAD_CATEGORY_REQUIRED` et le message `Catégorie PAD / droit de passage requise pour chiffrer le service portuaire inclus dans le devis.` ;
- les deux runs bloqués ont `tariff_lines = NULL`, `total_ht = NULL` et `total_ttc = NULL` ; aucune ligne `quote_service_pricing`, aucune version de devis, aucun PDF, aucun brouillon et aucun email n'ont été créés ;
- nettoyage transactionnel strict du dossier sandbox et de sa fixture : zéro résidu dans `quote_cases`, `case_documents`, `quote_facts`, `quote_gaps`, `case_puzzle_jobs`, `case_timeline_events`, `pricing_runs`, `quote_service_pricing` et `quotation_versions` ; la fixture locale temporaire a également été supprimée.

Correction locale vérifiée, non déployée sur Lovable :

- le parseur texte de l'intake publie désormais tous les groupes conteneurs sous le contrat canonique `{ type, quantity }`, conserve le total, omet le type legacy lorsqu'il est mixte et reste fail-closed en cas de déclaration ambiguë ;
- le port de déchargement reste distinct de la destination finale : le cas observé produit `Dakar` comme POD et `Mbour` comme destination ;
- tests du cas runtime exact et des formats historiques : suite frontend complète portée à 107 tests PASS ; typecheck PASS ; configuration des 91 Edge Functions PASS ; baseline Deno inchangée à 65 erreurs connues dans 7 groupes ; 476 tests Deno PASS, 6 ignorés ; dette lint améliorée et verrouillée à 756 erreurs et 27 warnings ; build production PASS ;
- aucun commit, push, déploiement, changement de donnée ou action runtime n'a été effectué pour cette correction. Une nouvelle recette Lovable restera obligatoire après déploiement autorisé.

Reprise P0-E avec désignation officielle non ambiguë, vérifiée le 24 août 2026 :

- le runtime contient bien l'alias validé officiel `PIECES DETACHEES DE MACHINES ET APPAREILS` → `T02`, référencé `REDEVANCES_PORTUAIRES_2006.pdf, Section 2.3.1, Page 15` ;
- le barème PAD contient une ligne active IMPORT / CONTENEUR / T02 à `9 678 FCFA` par tonne, source `pdf_redevances_portuaires_2006`, sans date d'expiration ; une ancienne ligne identique inactive subsiste mais n'est pas éligible au pricing ;
- une première saisie sandbox utilisant la syntaxe `1 x conteneur 20 pieds Dry` a révélé un désaccord live entre le parseur et le validateur de `cargo.containers` : le parseur live produisait un type nul, ensuite refusé par `set-case-fact` ; la variante est désormais couverte et corrigée localement ;
- avec la syntaxe historique acceptée `1 conteneur 20' DV`, l'analyse a correctement extrait la désignation exacte, 10 000 kg, DAP, Mbour, Le Havre / Dakar et le package `DAP_PROJECT_IMPORT` ; le `build-case-puzzle` live non corrigé a néanmoins déclaré prématurément `READY_TO_PRICE` sans catégorie ni tarif PAD ;
- le correctif local partage désormais la même résolution de périmètre de services entre `build-case-puzzle` et `run-pricing`, crée ou renforce idempotemment le gap bloquant `pricing.pad_category`, ne le résout qu'avec catégorie et tarif officiel positif, et interdit fail-closed `READY_TO_PRICE` si la garde PAD ne peut pas être lue ou écrite ;
- avant son déploiement ultérieur, deux appels authentifiés au workflow opérateur `Rechercher catégorie PAD depuis description` avaient échoué en HTTP 404 avant création de candidat ; zéro candidat n'avait été créé pendant cette recette historique ;
- le second dossier sandbox, sa fixture et toutes leurs dépendances ont été supprimés transactionnellement ; contrôle post-nettoyage à zéro sur dossiers, documents, faits, gaps, jobs, candidats, pricing, versions et lignes tarifaires ; seuls les événements runtime append-only restent disponibles comme trace forensique normale ;
- aucun devis, PDF, brouillon, email, commit, push, déploiement ou publication n'a été produit par cette reprise.

Condition de reprise P0-E : redéployer explicitement `build-case-puzzle` avec le correctif fail-closed déjà poussé, puis rejouer le même scénario sandbox avec `produce-pad-classification-candidates`, désormais actif. Aucun contournement par écriture directe de faits PAD n'est autorisé.

Tentative de reprise Git/runtime du 24 août 2026 : **PARTIAL / STOP AUTH**.

- les changements Auth Lovable `5b973677` / `23a433bd` ont été neutralisés chirurgicalement par `fbe21700`, sans autre modification Auth ;
- le module pur `pad-scope-blocker.ts` a été déplacé sans changement de doctrine vers `_shared`, avec uniquement ses imports et tests concernés, puis commité sous `c54f507d` ; les deux commits ont été poussés sur `work` ;
- CI complète verte : configuration des 91 Edge Functions, typecheck, 107 tests frontend, baseline Deno inchangée, 476 tests Deno avec 6 ignorés, baseline lint inchangée et build production ;
- Lovable voit le commit et le nouvel import `../_shared/pad-scope-blocker.ts`, mais le runtime indique encore `build-case-puzzle` « Last updated 22 juin 2026 » ;
- le panneau Cloud Lovable permet uniquement de consulter code et journaux de cette fonction, sans commande native de redéploiement ; le seul chemin disponible dans cette session est l'agent Lovable, déjà observé comme réinjectant automatiquement le changement Auth explicitement interdit ;
- aucun nouveau message agent Lovable n'a donc été envoyé, aucun déploiement n'a été tenté, et aucune migration, donnée, recette sandbox, fonction supplémentaire, configuration, Auth, email ou publication n'a été modifié.

Condition de déblocage : disposer d'une action Lovable native de redéploiement ciblé, ou d'un GO CTO élargi autorisant explicitement l'agent Lovable et la neutralisation chirurgicale de tout nouveau commit Auth automatique avant reprise de la recette sandbox. Le scénario ne doit pas être rejoué tant que `build-case-puzzle` corrigé n'est pas prouvé en ligne.

Verdict intermédiaire : le garde-fou P0-B est maintenant prouvé directement dans le runtime authentifié et empêche bien tout mauvais devis. Le défaut d'extraction observé est corrigé et testé localement. Le blocage ne vient pas d'une grille PAD absente : le barème officiel PAD 2006 est déjà intégré. Il vient de l'absence, sur ce dossier, des faits `cargo.pad_category` et `cargo.pad_rate_fcfa_per_ton`. La description sandbox générique « pièces mécaniques » ne doit pas être classée automatiquement ; la doctrine documentée la considère ambiguë. La reprise de recette doit utiliser une désignation officielle non ambiguë ou une validation opérateur via le workflow de candidats existant.

Clôture du lot lecteur PAD et recette sandbox R3 du 24 août 2026 : **PASS ciblé / P0-E reste PARTIAL**.

- `build-case-puzzle` et `run-pricing` ont été déployées de manière ciblée sur l'aperçu privé ; aucune publication publique, migration, autre fonction ou email n'a été exécuté.
- Le scénario `SANDBOX-P0E-20260824-R3` a utilisé `1 conteneur 20' DV`, 10 000 kg, `PIÈCES DÉTACHÉES DE MACHINES ET APPAREILS`, DAP, Le Havre → Dakar → Mbour et le package `DAP_PROJECT_IMPORT`.
- L'analyse initiale a correctement créé le gap bloquant `pricing.pad_category`. Le workflow d'alias validé a produit un candidat unique `T02`, source officielle `REDEVANCES_PORTUAIRES_2006.pdf, Section 2.3.1, Page 15`.
- La boîte native de confirmation du navigateur de test n'a pas pu être pilotée de façon fiable. La transition `suggested → accepted` a donc été rejouée sous le rôle `authenticated`, l'identité du propriétaire du dossier et les RLS réelles, avec gardes strictes sur dossier/candidat/source/T02 et clé d'idempotence ; la propagation a ensuite utilisé la RPC officielle `propagate_classification_candidate_to_fact`.
- Les facts runtime exacts ont été vérifiés : `cargo.pad_category = T02` dans `value_text` avec métadonnées MAP-7B dans `value_json`, et `cargo.pad_rate_fcfa_per_ton = 9 678` dans `value_number`/`value_text` avec métadonnées MAP-8B dans `value_json`.
- Le rejeu de `build-case-puzzle` a résolu le gap PAD, conservé uniquement `contacts.client_email` comme gap non bloquant et produit `READY_TO_PRICE`, 80 % de complétude, sans erreur.
- Un premier pricing sandbox a révélé un second défaut du même lecteur : `buildPricingInputs` lisait encore l'objet `value_json` avant les scalaires, terminait `success` mais omettait la ligne PAD. Ce run de test n'a produit ni version, PDF, brouillon, email ou diffusion.
- Le correctif chirurgical `419ba486` fait consommer aux entrées du moteur les mêmes valeurs métier que le garde PAD, sans modifier la lecture JSON des autres facts. CI complète : 91 configurations Edge PASS, typecheck PASS, 107 tests frontend PASS, baseline Deno inchangée à 65 erreurs/7 groupes, 493 tests Deno PASS et 6 ignorés, lint 756 erreurs/27 warnings sans aggravation, build production PASS.
- Après redéploiement de la seule fonction `run-pricing`, le run 2 a produit exactement une ligne officielle `PAD_DROIT_PASSAGE` de `96 780 FCFA` (`10 t × 9 678`), sans double comptage. Le total HT est passé de `390 200` à `486 980 FCFA` et le TTC de `417 200` à `513 980 FCFA`, soit un delta exact de `96 780` sans TVA additionnelle.
- Le transport officiel 20P vers Mbour est resté `165 200 FCFA`, classé `DEBOURS_TIERS`, base fournisseur TTC, sans TVA SODATRA et avec commission locale égale à zéro.
- Lovable a réinjecté deux fois son changement Auth automatique limité à `client.ts` et `previewAuthStorage.ts`. Les merges ont été neutralisés immédiatement par les reverts autorisés `87803eea` puis `4f4135ac`; l'arbre final après chaque revert est identique au code applicatif attendu.
- Nettoyage transactionnel final vérifié : zéro résidu pour le dossier R3 dans toutes les tables publiques portant `case_id`, et zéro sur le document, le candidat, les facts propagés, les runs de pricing et `storage.objects`.

Audit tarifaire et correction locale du 25 août 2026 : **PASS LOCAL / RUNTIME NON MODIFIÉ**.

- La recherche approfondie sur les sources publiques officielles confirme la séparation opérateur : terminal à conteneurs LoLo exploité par DP World ; terminal RoRo/ConRo exploité par Dakar Terminal, qui traite aussi les conteneurs transportés par ces navires. Le droit de passage PAD reste une redevance distincte de la manutention terminal.
- Aucun barème officiel public actuel ne justifie un poste générique supplémentaire `PORT_DAKAR_HANDLING = 15 000 FCFA/tonne`. Ce marqueur historique ne doit donc produire aucune ligne tarifaire en plus du DTHC et de `PAD_DROIT_PASSAGE`.
- Le DTHC reste inchangé et distinct : son montant doit provenir de la compagnie ou du terminal avec une source éligible. Aucun montant Dakar Terminal n'est inféré pour le RoRo/ConRo ; il reste à confirmer tant qu'une source officielle ou une pro forma représentative n'est pas obtenue.
- Limite bloquante vérifiée puis **levée localement le 25 août 2026** (mini-lot terminal ci-dessous) : le modèle canonique ne possédait aucun fait structuré permettant de distinguer sûrement le mode d'opération navire/terminal LoLo, RoRo ou ConRo. `routing.transport_mode` ne distingue que le maritime de l'air/de la route et `transport.vessel` ne contient qu'un nom éventuel. Ne jamais déduire l'opérateur du seul nom du transporteur.
- La dérive `DDP_PROJECT_IMPORT` a été corrigée localement : le package existe désormais dans la source partagée backend avec une composition identique à `DAP_PROJECT_IMPORT` et à la constante frontend. Le garde PAD redevient fail-closed sur ce package.
- `run-pricing` exclut désormais les marqueurs PAD de tous les appels à `price-service-lines`. La liste non filtrée reste utilisée par `PAD_CATEGORY_REQUIRED`, puis le droit de passage officiel est ajouté une seule fois par `enrichment_pad`. DTHC n'est ni retiré ni modifié.
- Le PAD multi-lot n'ayant pas encore de faits ni de calcul par lot, tout lot entrant dans le périmètre PAD est maintenant bloqué localement : `PAD_CATEGORY_REQUIRED` si les faits manquent, puis `PAD_MULTI_LOT_UNSUPPORTED` si les faits globaux sont présents. Il ne peut plus réussir sans ligne PAD officielle par lot.
- Aucun commit, push, déploiement, migration, donnée, Auth/RLS, email, PDF ou runtime Lovable n'a été modifié dans ce lot.

#### Mini-lot terminal — garde LoLo/RoRo/ConRo (25 août 2026) : **PASS LOCAL / RUNTIME NON MODIFIÉ**

Le prérequis « fait/gap explicite + garde fail-closed » posé ci-dessus est livré localement, sans migration, sans DDL/RLS et sans mécanisme de source tarifaire.

- **Fait canonique** `routing.terminal_operation_mode`, valeurs strictes `LOLO` / `RORO` / `CONRO`. Aucune migration : la clé passe par le RPC générique `supersede_fact` et la catégorie `routing` existante. Saisie/correction par le chemin sécurisé existant (`set-case-fact`, allowlist étendue) et via l'UI CaseView (liste de choix explicite, jamais de saisie libre suggérée). L'API canonicalise la casse/les espaces et refuse toute écriture ambiguë combinant texte avec `value_number` ou `value_json`. En multi-lot, l'UI signale ce fait global comme ambigu puisque le moteur exige une déclaration propre à chaque lot.
- **Normalisation stricte** : `trim` + majuscules uniquement. `RoRo` → `RORO`, mais `RO-RO`, `ROULIER`, `LO/LO`, un nombre, un booléen ou un objet JSON restent INVALIDES, donc bloquants. Aucun synonyme n'est deviné : deviner reviendrait à choisir l'opérateur terminal à la place de l'humain. L'opérateur n'est jamais déduit du transporteur.
- **Décision pure partagée** dans `supabase/functions/_shared/terminal-operation-mode.ts`, directement testable, sans I/O ni tarif. `PORT_DAKAR_HANDLING` reste hors de ce périmètre : c'est le marqueur PAD, traité par `pad-scope-blocker.ts`, inchangé.
- **`run-pricing` mono-lot** : hors périmètre DTHC, strictement aucun changement ; DTHC au périmètre sans mode valide → blocage stable `TERMINAL_OPERATION_MODE_REQUIRED` avant tout chiffrage ; `LOLO` → le chemin DTHC existant reprend la main, montant et source inchangés (DP World) ; `RORO`/`CONRO` → blocage stable `DAKAR_TERMINAL_RATE_REQUIRED` tant qu'aucune source tarifaire canonique Dakar Terminal n'est prouvée. Aucun montant n'est inventé, aucun mécanisme de tarif n'est créé dans ce lot : fail-closed seulement.
- **`run-pricing` multi-lot** : mêmes codes de blocage, mais le mode est lu sur les faits DÉCLARÉS PAR LE LOT uniquement. Le mode global n'est jamais prêté à un lot — sinon un dossier mixte (lot conteneur LoLo + lot roulant) laisserait le mode global `LOLO` autoriser silencieusement le chemin DP World pour le lot roulant.
- **`build-case-puzzle`** : gap bloquant `routing.terminal_operation_mode` (catégorie `routing`, opérateur, non exposé au client) dès qu'un périmètre contenant DTHC n'a pas de mode valide. Placé après le final sync et avant le calcul de `blockingGapsCount`, protégé de la fermeture orpheline, exclu du sync « présence du fait = gap résolu » (une valeur invalide ne doit pas refermer le gap), idempotent, et fail-closed en cas d'échec de lecture/écriture (`TERMINAL_MODE_GUARD_ERROR` → jamais `READY_TO_PRICE`). Un RoRo/ConRo correctement déclaré n'ouvre PAS ce gap : le fait est juste, c'est le barème qui manque.
- **Sûreté de périmètre** : le garde ne s'arme que sur la clé `DTHC`. Aucun package aérien ni export du catalogue ne la porte (`EXPORT_SENEGAL` porte `THC_EXPORT`, distinct) — épinglé par test. L'air, l'export et tout périmètre hors DTHC sont strictement inchangés.
- Preuves locales indépendantes : 91 configurations Edge Functions PASS, typecheck frontend PASS, 107 tests frontend PASS, **583 tests Deno hermétiques PASS et 6 ignorés** (dont 59 nouveaux tests terminal), baseline Deno inchangée à 65 diagnostics/7 groupes, lint inchangé à 756 erreurs/27 warnings, build production PASS. `git diff --check` PASS. Aucun `deno.lock` généré. Les 15 smokes live sont volontairement hors de la gate locale : ils requièrent des clés/runtime externes et n'ont pas été utilisés pour conclure ce PASS.

Condition de reprise P0-E historique, satisfaite par la clôture ci-dessous : le prérequis « fait/gap + garde fail-closed + tests » était satisfait localement. Restait alors requis, sous GO CTO Git/runtime distinct, le déploiement coordonné de `run-pricing`, `build-case-puzzle` et `set-case-fact`, puis une recette sandbox mono-lot. Le résultat attendu était une ligne PAD officielle unique, un DTHC sourcé auprès du bon opérateur, aucune ligne `PORT_DAKAR_HANDLING` et aucun montant Dakar Terminal inventé. Les scénarios PAD multi-lots restent explicitement bloqués, et tout trafic RoRo/ConRo reste bloqué tant qu'un barème officiel ou une pro forma Dakar Terminal validée n'est pas obtenu.

#### Clôture P0-E LoLo du 26 août 2026 : **PASS CIBLÉ / NETTOYAGE PASS**

- État statique et runtime avant recette : `work`, `origin/work` et Lovable alignés sur `0407766f3fdb0cb061511ac32b0483528df81f3a` ; Lovable `ready`, privé et non publié.
- Dossier sandbox non sensible `SANDBOX-P0E-FINAL-20260826`, créé depuis un CSV temporaire de 435 octets avec une adresse `example.invalid`. Parcours réel : intake documentaire, extraction, gaps, validation opérateur du mode terminal `LOLO`, candidat PAD officiel `T02`, propagation canonique, reconstruction à 100 % sans gap, ajustement du périmètre de services, pricing, version, PDF et brouillon standard.
- Le candidat unique `T02` provenait de l'alias validé et de `REDEVANCES_PORTUAIRES_2006.pdf, Section 2.3.1, Page 15`. La boîte native de confirmation restant non pilotable de façon fiable, l'acceptation a suivi le fallback déjà audité : rôle `authenticated`, identité exacte du propriétaire, RLS réelles, cardinalité/source/catégorie strictement gardées, clé d'idempotence, puis RPC canonique `propagate_classification_candidate_to_fact`. Aucun fait PAD n'a été écrit directement.
- `service.overrides` a retiré exactement `TRUCKING`, `EMPTY_RETURN` et `CUSTOMS_DAKAR`. Le marqueur générique `PORT_DAKAR_HANDLING` n'a produit aucune ligne tarifaire ; DTHC est resté dans le périmètre LoLo.
- Pricing Run `#1` réussi avec 8 lignes : DTHC DP World officiel `155 000 XOF` depuis `DPW_TARIFS_2025_0001.pdf`, PAD T02 officiel `96 780 XOF`, frais SODATRA `35 000 + 25 000 + 15 000 XOF`, magasinage informatif nul, surestaries et droits/taxes conservés avec montant `NULL / À confirmer`. Total lignes et sous-total avant TVA SODATRA `326 780 XOF`, TVA SODATRA `13 500 XOF`, total ferme à payer hors réserves `340 280 XOF`. Aucun transport local, retour vide, dédouanement Dakar ou montant générique de manutention n'a réapparu.
- Version immuable v1 créée depuis ce run, qualification provisoire et politique de total ferme excluant les postes réservés. Un PDF brouillon unique de 3 179 octets a été enregistré avec le SHA-256 `357aa436b6e5eca807f7cdbd215ec2d50aedc37aaac9984c6373aa87ca2083d5` ; son rendu visuel reprenait les montants, sources, réserves, route et mentions non contractuelles attendus.
- Brouillon email standard créé avec le destinataire sandbox, un sujet et un corps non vides, `ai_generated = false`, statut `draft` et `sent_at = NULL`. Le bouton « Marquer comme envoyé » n'a pas été utilisé ; aucun email n'a été envoyé.
- Auth/RLS : les neuf tables critiques du parcours contrôlées ont RLS active et leurs policies présentes. Sous `anon`, le dossier, ses faits, runs, versions et brouillon étaient tous invisibles. Sous l'identité propriétaire authentifiée, dossier, PDF et brouillon étaient lisibles. Sous une autre identité authentifiée, la lecture d'équipe du dossier était autorisée par doctrine, mais `has_case_write_access = false` et le PDF/brouillon privés restaient invisibles.
- Inventaire Auth observé : cinq comptes actifs, dont trois confirmés ; un compte `sodatra.sn` porte `pad_admin`, trois comptes sont sur le domaine sandbox `test.local`, et un compte confirmé hors domaine SODATRA n'a pas de rôle applicatif. Comme les policies `*_select_team` donnent la lecture métier à tout compte `authenticated`, l'identité et la nécessité des comptes confirmés hors domaine doivent être validées avant toute production générale. Aucun compte ni rôle n'a été modifié pendant cette recette.
- Nettoyage final strict : brouillon, document PDF, version et lignes, run, faits, gaps, candidat, jobs, timeline, document source et dossier supprimés ; zéro ligne résiduelle dans toutes les tables publiques portant `case_id` contrôlées et zéro objet sous les deux préfixes sandbox dans `storage.objects`. Le fichier CSV temporaire hors dépôt a également été supprimé.
- Deux anomalies UI non bloquantes sont conservées au backlog : le toast de création affiche parfois `vundefined` alors que la version persistée est correctement v1 ; l'ouverture du PDF a créé deux onglets navigateur alors qu'un seul document existait en base et dans le stockage. Aucun défaut tarifaire, doublon de donnée ou réapparition de service retiré n'a été observé.

Verdict de fin de P0 : **PASS technique et GO pour P1-A local / GO pilote privé limité au LoLo et aux tarifs explicitement éligibles / NO-GO production générale**. Le NO-GO général protège la gouvernance Auth non encore arbitrée, les familles tarifaires restant `to_confirm` ou historiques, le RoRo/ConRo sans source Dakar Terminal et les scénarios multi-lots PAD encore volontairement bloqués. P1-A peut commencer localement sans activer ces périmètres ni modifier le runtime de production.

Parcours minimum :

1. création ou import d'une demande ;
2. extraction et consolidation des faits ;
3. affichage et résolution des gaps ;
4. résolution des prérequis PAD/package ;
5. exécution pricing et reprise après échec ;
6. création et sélection d'une version de devis ;
7. rendu imprimable/PDF ;
8. création d'un brouillon email ;
9. création et revue d'un brouillon non envoyé ; tout test d'envoi réel exige un GO runtime distinct et une adresse de test explicitement autorisée ;
10. vérification de l'audit trail et de l'absence de doublons après réexécution.

Conditions : compte de test autorisé, dossier sandbox clairement identifié, données non sensibles, plan de nettoyage validé et GO CTO runtime explicite.

Critère de sortie : preuves horodatées du parcours complet, absence de régression sécurité/données et décision CTO distincte de publication.

## 6. P1 — fonctions métier incomplètes après P0

### PACK P1-A — scénarios et hypothèses opérateur

État au 29 août 2026 : **P1-A1 à P1-A5 PASS Git + Lovable runtime avec nettoyage intégral**.

#### P1-A1 — ledger d'hypothèses durci : **PASS / NETTOYAGE PASS**

- Commit applicatif atomique `e9ff9ce8a87e6e1995f0cf2f25b06bfd8ed8a08b`, puis régénération automatique bénigne des types Supabase `d1633447` et merge Lovable `b89d363fde65d2de482870dcf6a9700ddad7a894` ; Git local, `origin/work` et Lovable alignés.
- Migration `20260828120000_harden_quote_scenario_assumptions_p1a.sql` appliquée et enregistrée sur Lovable. Elle ajoute les valeurs typées, la chaîne de supersession, les contraintes inter-dossiers, le registre append-only d'idempotence, les privilèges minimaux et la RPC atomique `manage_scenario_assumption`.
- Edge Function `manage-scenario-assumption` déployée seule depuis le SHA canonique. Probes non mutantes : `OPTIONS` à 200 et appel sans autorisation à 401. Preview privée reconstruite ; aucun autre runtime, Auth, tarif, pricing, email ou publication touché.
- UI opérateur passée d'un panneau en lecture seule à des mutations explicites : création, révision, confirmation client et réfutation. Aucune promotion en fact dans ce lot et aucun pricing.
- Preuves locales : typecheck PASS ; 128 tests frontend PASS ; 694 tests Deno PASS et 6 ignorés ; baseline Deno inchangée à 65 diagnostics/7 groupes ; lint baseline inchangée à 756 erreurs/27 warnings ; build production PASS ; preuve PostgreSQL 17.6 réelle PASS.
- Recette authentifiée sandbox : `create → revise → confirm_client` visible dans l'UI, lien de supersession réciproque valide, puis `refute` sur une seconde hypothèse. Trois états terminaux observés : une ligne `superseded`, une `client_confirmed`, une `refuted`.
- Idempotence runtime : le rejeu de la même clé et du même fingerprint retourne le même `assumption_id` avec `idempotent_replay = true`, une seule ligne de mutation et un seul événement ; le même identifiant avec un fingerprint différent est refusé par `IDEMPOTENCY_CONFLICT`.
- Protections runtime : mutation inter-dossiers refusée par `FORBIDDEN_CROSS_CASE` ; promotion vers `quote_facts` refusée par `PROMOTION_NOT_ALLOWED` ; zéro `quote_fact` créé ; identités obligatoires présentes ; aucune policy d'écriture directe ; `authenticated` n'a ni INSERT/UPDATE/DELETE ni EXECUTE sur la RPC ; `service_role` n'a pas de mutation directe sur la table et dispose uniquement de l'EXECUTE RPC ; RLS active sur le ledger et le registre.
- Nettoyage final strict : les deux dossiers sandbox, les trois hypothèses, les cinq mutations et les cinq événements ont été supprimés par cascade gardée ; zéro ligne résiduelle pour leurs identifiants.

#### P1-A2 — objet scénario versionné : **PASS GIT + LOVABLE RUNTIME / NETTOYAGE PASS**

- Nouvelle migration locale `20260828200000_create_quote_scenarios_p1a2.sql` : tables `quote_scenarios`, `quote_scenario_links`, `quote_scenario_selections` et registre append-only `quote_scenario_mutations` ; périmètre immuable et hashé, chaîne de révision/supersession, au plus une sélection ouverte par dossier, RLS et privilèges minimaux.
- Schéma de périmètre fermé v1 vérifié aux trois niveaux frontend, Edge et PostgreSQL : vocabulaire borné, 1 à 12 lots, références métier anonymes, aucune clé monétaire, aucun UUID métier, aucun décimal, aucune clé inconnue. Les points ouverts sont dérivés par la base et ne peuvent pas être forgés par le client ou l'Edge Function.
- Nouvelle Edge Function locale `manage-quote-scenario`, seule voie d'écriture : Auth obligatoire, contrôle du dossier sous JWT/RLS avant élévation service-role, validation stricte, fingerprint serveur, RPC atomique service-role-only. Opérations P1-A2 exclusivement : `create`, `revise`, `select`.
- Nouveau panneau opérateur : saisie structurée des périmètres air, maritime, route et multimodal ; LoLo/RoRo/ConRo purement descriptifs ; création, révision immuable, sélection séparée, comparaison lisible par `unit_ref`, hypothèses/réserves liées et points ouverts persistés. Aucune écriture directe Supabase, aucun dump JSON libre, aucun bouton de pricing, promotion, finalisation, devis, PDF ou email.
- Idempotence UI renforcée pendant la contre-revue : une relance après réponse réseau perdue réutilise la même clé tant que l'opération, la cible et le contenu logique n'ont pas changé ; une modification produit une nouvelle identité de mutation.
- Six profils anonymisés représentatifs verrouillés par tests : FCL LoLo, aérien, réexport, transit multimodal/multi-destination, dangereux et cross-trade. Aucun email, nom client, pièce jointe ou donnée réelle n'est conservé dans les fixtures.
- Preuves locales avant et après réconciliation Git/Lovable : reset complet des 208 migrations PASS ; 93 configurations Edge PASS ; typecheck frontend PASS ; **183 tests frontend PASS**, dont 55 P1-A2 ; baseline Deno inchangée à 65 diagnostics/7 groupes ; **733 tests Deno PASS et 6 ignorés**, dont 39 P1-A2 ; lint baseline inchangée à 756 erreurs/27 warnings ; build production PASS avec l'avertissement de taille de bundle préexistant.
- Probes PostgreSQL 17.6 réelles : création/rejeu idempotent, révision sur une nouvelle ligne, supersession réciproque, libération de la sélection sans sélection automatique du successeur, nouvelle sélection, refus inter-dossiers et refus de réviser une version remplacée. Deux appels réellement concurrents avec la même clé ont produit exactement un scénario, une mutation et un événement. Toutes les fixtures ont été annulées ou supprimées ; compteurs résiduels à zéro.
- Publication Git : commit atomique `856db09929abe0d4f1c5f5297fae3da17d3fddf9` poussé sur `work` après CI et contre-revue Claude Code Opus xhigh PASS.
- Migration Lovable : version exacte `20260828200000` appliquée en transaction depuis le fichier Git de **100 014 octets**, SHA-256 `44446cbf2b14b2d7f432aa4c9a170e91031a3bb8dc2b683d5f064f8b50c26842`, puis enregistrée avec son SQL complet dans `supabase_migrations.schema_migrations`. Présence vérifiée des quatre tables, des validateurs, de la RPC, de la RLS et des privilèges minimaux.
- Déploiement Lovable limité à `manage-quote-scenario` : `OPTIONS` retourne 200 et `GET` non authentifié retourne 401. Le projet reste privé et non publié. La régénération de types post-migration `7aef67d3`/`a590c21c` restaure les tables P1-A2 et ajoute les signatures des validateurs, sans autre fichier applicatif.
- Recette authentifiée Chrome : création d'une révision 1 LoLo ; révision 2 sur une nouvelle ligne avec supersession immuable ; sélection séparée ; comparaison identique ; révision 3 ajoutant l'alternative de destination `dest-b` ; comparaison affichant précisément `Destination · Alternatives` ; libération automatique de l'ancienne sélection par `superseded_by_revision` ; sélection séparée de la révision 3. À chaque étape, l'UI affiche explicitement `Aucun prix calculé`.
- Idempotence runtime : rejeu du `select` avec la même clé et le même fingerprint retournant `idempotent_replay=true` sans nouvelle mutation ; même clé avec un fingerprint différent rejetée par `IDEMPOTENCY_CONFLICT`. Registre final avant nettoyage : 1 `create`, 2 `revise`, 2 `select`, chaque opération avec une clé distincte.
- Isolation runtime : insertion de sélection reliant le deuxième dossier sandbox au scénario du premier rejetée par `FORBIDDEN_CROSS_CASE`. RLS active sur les quatre tables ; `authenticated` dispose de SELECT mais d'aucun INSERT/UPDATE/DELETE et n'a pas EXECUTE sur la RPC ; `service_role` possède l'EXECUTE RPC.
- Invariants métier : trois scénarios chaînés 1→2→3 ; les révisions 1 et 2 sont `superseded`, la révision 3 reste `draft` ; changement de hash uniquement lors du changement réel de périmètre. Zéro `quote_fact`, zéro `pricing_run` et zéro `quotation_version` pour la recette.
- Nettoyage final strict : suppression exacte des deux dossiers sandbox et cascade vérifiée sur toutes les tables publiques portant `case_id` ou `quote_case_id`. **Zéro résidu dans 27 tables contrôlées**. Aucun email, tarif, Auth, déploiement supplémentaire ou publication publique.

#### P1-A3 — promotion explicite hypothèse → fait : **PASS GIT + LOVABLE RUNTIME / NETTOYAGE PASS**

- Migration locale `20260829120000_promote_scenario_assumption_p1a3.sql` : registre `quote_fact_promotions` deny-all et append-only hors cascade de rétention, allowlist fermée, RPC atomique service-role-only, RLS, privilèges minimaux, idempotence forte, contrôle inter-dossiers et journalisation transactionnelle.
- La promotion est strictement unitaire, humaine et attestée. L'hypothèse doit être `active` ou `client_confirmed`, déclarer exactement son `assumed_fact_key`, et viser cette même clé. Aucune promotion automatique, de masse ou réversible n'existe.
- Toute clé monétaire ou tarifaire, tout JSON à montant imbriqué, `service.mode`, `service.package`, `service.overrides`, HS et PAD sont exclus. Les valeurs restantes sont bornées par type, longueur, précision et vocabulaire canonique.
- Une hypothèse liée à plusieurs scénarios vivants est bloquée par `SCENARIO_CONTEXT_AMBIGUOUS` : ni l'UI ni la RPC ne choisissent arbitrairement un contexte. Un scénario unique est attesté par son identifiant et son `scope_hash` exact.
- L'Edge Function locale `promote-scenario-assumption` exige Auth, prouve l'accès au dossier sous JWT/RLS avant toute élévation service-role, calcule le fingerprint côté serveur et n'appelle qu'une RPC atomique. L'UI relit le fait courant et le contexte de scénario avant d'autoriser l'attestation ; une relance du même geste logique réutilise sa clé d'idempotence.
- Le fait est écrit par `supersede_fact` avec `source_type='manual_input'` et `confidence=1.0`, ce qui conserve la protection existante contre l'écrasement par `build-case-puzzle`. La provenance complète réside dans le registre de promotion, la timeline et `source_excerpt` — pas dans `quote_facts.value_json`, car plusieurs lecteurs métier donnent priorité à `value_json` et y placer des métadonnées altérerait la valeur métier/pricing.
- Aucune écriture n'est faite dans `quote_gaps`, `client_gap_requests`, scénarios, pricing, versions, tarifs, PDF ou emails. Un gap éventuellement devenu résolu ne sera constaté qu'au prochain `build-case-puzzle` explicite ; aucun composant FROZEN n'a été modifié.
- Contre-revue locale : 94 configurations Edge PASS ; double typecheck PASS ; **211 tests frontend PASS**, dont 28 P1-A3 ; baseline Deno inchangée à 65 diagnostics/7 groupes ; **753 tests Deno PASS et 6 ignorés**, dont 20 P1-A3 ; lint baseline inchangée à 756 erreurs/27 warnings ; build production PASS avec les avertissements de bundle préexistants.
- PostgreSQL local : premier reset ayant correctement détecté une syntaxe `CASE` fautive, correction chirurgicale, puis **reset intégral des 209 migrations PASS**. Assertions transactionnelles PASS pour promotion nominale, rejeu, conflit d'idempotence, refus inter-dossiers, refus monétaire, absence de clé cible, registre immuable, RLS/privilèges, absence de pricing/version et cascade de nettoyage sans résidu. Garde multi-scénarios testée séparément : zéro fait et zéro promotion lors du refus. Deux appels réellement concurrents avec la même clé ont produit exactement une promotion, un fait et un événement ; l'un a créé et l'autre a rejoué, puis la fixture a été nettoyée sans résidu.
- Publication Git : commit applicatif atomique `7c131870a6882c06faddce19e3a8017353f82eff` poussé sur `work`. La régénération automatique post-migration `d28be610` ajoute exclusivement les 139 lignes de types attendues dans `src/integrations/supabase/types.ts` ; le merge Lovable `f37d3b66491e9f5b78f91c2d66934fdc20977331` ne contient aucun autre changement. Double typecheck, 211 tests frontend, lint baseline et build restent PASS après cet alignement.
- Migration Lovable : version exacte `20260829120000` appliquée en transaction depuis le fichier Git de **58 600 octets**, SHA-256 `809e17b9a2d84ec98a2d9c916c14acf39d26aff8073d685bce6fa755555a48a2`, puis enregistrée avec son SQL complet dans `supabase_migrations.schema_migrations`. Présence de la table, des validateurs et de la RPC vérifiée ; RLS active, aucune policy, aucune mutation directe ni EXECUTE RPC pour `authenticated`, EXECUTE réservé à `service_role`.
- Déploiement Lovable limité à `promote-scenario-assumption` depuis un contenu byte-identique au commit applicatif. `OPTIONS` retourne 200 et un appel sans autorisation retourne 401 `Missing authorization header`. Preview privée reconstruite ; projet non publié ; aucune autre fonction, Auth, migration, famille tarifaire ou donnée métier touchée.
- Recette authentifiée Chrome : hypothèse numérique `cargo.weight_kg = 12 345,5`, sans scénario vivant ni fait courant ; dialogue affichant la cible et la valeur exactes ; base `operator_expertise` choisie et attestation cochée ; succès UI `Hypothèse promue en fait du dossier`. Résultat : statut `promoted_to_fact`, un unique fait courant `cargo.weight_kg` à `12345.5`, `source_type='manual_input'`, `confidence=1`, un registre de promotion attesté et un événement de timeline avec `priced=false` et `gap_written=false`.
- Idempotence et fail-closed runtime : rejeu avec la même clé et le même fingerprint retournant `idempotent_replay=true` avec les mêmes identifiants et sans nouvelle ligne ; tentative sur la clé monétaire `cargo.value` refusée par `MONETARY_KEY_NOT_PROMOTABLE` avant toute écriture. Compteurs après ces contrôles : 1 fait, 1 promotion, 1 événement, 0 pricing run, 0 version de devis et 0 gap.
- Nettoyage final strict : suppression exacte du fil et du dossier sandbox, puis cascade vérifiée. Zéro résidu pour leurs identifiants dans `quote_cases`, hypothèses, faits, promotions, timeline, scénarios, liens, pricing runs, versions, gaps et demandes client. Aucun pricing, PDF ou email n'a été déclenché.
- État d'autorité avant P1-A4 : branche locale `work`, `origin/work` et Lovable alignés sur `62be6aa510e5f4eec9d1b6fe4364e8eccfeea2ac`, worktree propre, projet privé et non publié.

#### P1-A4 — pricing isolé par scénario : **PASS GIT + LOVABLE RUNTIME / NETTOYAGE PASS**

- Nouveau ledger local `quote_scenario_pricing_runs` avec registre append-only `quote_scenario_pricing_mutations`, RLS de lecture partagée conforme au contrat d'espace opérateur authentifié, RPC atomique service-role-only, idempotence forte, verrou concurrent par scénario et supersession linéaire des runs.
- Nouvelle Edge Function locale `run-scenario-pricing` : Auth obligatoire, preuve d'accès au scénario sous JWT/RLS avant élévation service-role, requête fermée et attestation de `scope_hash`. Elle superpose uniquement les hypothèses liées encore vivantes au snapshot complet des faits courants et ne persiste directement que le résultat isolé.
- Le moteur canonique `quotation-engine` est seulement interrogé lorsque les préconditions sont complètes. `price-service-lines` n'est jamais appelé ; les services sans montant deviennent des réserves `TO_CONFIRM`. Les retraits explicites de `service.overrides` sont conservés et aucune ligne retirée ne peut réapparaître dans le snapshot de scénario.
- Qualification volontairement bornée à `provisional`, `partial` ou `blocked` : P1-A4 ne produit jamais de résultat `firm`, de version de devis, de PDF ou d'email. Les totaux ferme/indicatif et leur provenance restent séparés ; toute ligne dépendant d'une hypothèse est exclue du total ferme.
- Limite fail-closed : le périmètre P1-A2 utilise des références de lots anonymisées sans correspondance déterministe vers `quote_request_lines`. Tout scénario multi-lot ou mapping ambigu est donc bloqué au lieu d'inventer une répartition.
- UI locale limitée au scénario vivant sélectionné : action explicite « Estimer isolément », statut, qualification, double total, réserves, blocages et nombre d'hypothèses affichés. Aucun accès direct en écriture à Supabase.
- Aucun composant FROZEN n'a été modifié : `quotation-engine`, `run-pricing`, `build-case-puzzle` et `set-case-fact` restent byte-inchangés dans ce lot.
- Preuves locales finales : 95 configurations Edge PASS ; typecheck frontend PASS ; **216 tests frontend PASS** ; baseline Deno inchangée à 65 diagnostics/7 groupes ; **765 tests Deno PASS, 0 échec et 6 ignorés** ; lint baseline inchangée à 756 erreurs/27 warnings ; build production PASS avec les avertissements de bundle préexistants.
- PostgreSQL local : reset intégral des **210 migrations PASS**. Assertions transactionnelles PASS pour idempotence, conflit de clé, supersession, immutabilité, RLS/privilèges, absence de contamination et cascade de nettoyage. Deux appels réellement concurrents ont produit les runs 1 et 2 avec exactement un run vivant.
- Recette Edge locale authentifiée fail-closed : résultat `blocked` avec six bloqueurs ; un unique run de scénario créé ; zéro `quote_fact`, zéro `pricing_run` canonique et statut du dossier inchangé. Le dossier, l'utilisateur et l'événement de test ont été intégralement nettoyés.
- Publication Git : commit applicatif atomique `36b1be20f5ac0d809c79d09a9444662e96938dde` poussé sur `work`. La régénération automatique post-migration `193ef757` ajoute exclusivement les types P1-A4 attendus dans `src/integrations/supabase/types.ts` ; le merge Lovable `859d9fe9c30a3253af0ed14d6801b0392afeae50` ne contient aucun autre changement. Typecheck, 216 tests frontend, lint baseline et build restent PASS après cet alignement.
- Migration Lovable : version exacte `20260829200000` appliquée en transaction depuis le fichier Git de **26 790 octets**, SHA-256 `2351731d652e7e83be3eae2fb7dc0c589fab6d81e22acf7fe35a5fbefd2a6960`, puis enregistrée avec son SQL complet dans `supabase_migrations.schema_migrations`. Le stockage initial avait reçu un CRLF terminal supplémentaire de deux octets ; l'écart a été détecté puis retiré sous gardes strictes de version, cardinalité, longueur et suffixe. Le SQL live est finalement byte-identique au fichier Git. Tables, RPC, RLS et privilèges vérifiés : lecture des runs pour `authenticated`, aucune écriture directe, mutation ledger et RPC réservées au `service_role`.
- Déploiement Lovable limité à `run-scenario-pricing` ; fonction byte-identique au commit applicatif. `OPTIONS` retourne 200 et un appel sans autorisation retourne 401 `Missing authorization header`. Frontend privé reconstruit, projet non publié ; aucune autre fonction, Auth, migration, famille tarifaire ou donnée métier modifiée.
- Recette authentifiée mono-lot : fixture aérienne fictive `AIR_IMPORT_DAP`, sans hypothèse, un lot et dix faits courants. L'action explicite « Estimer isolément » a produit un run `success/partial`, 145 000 F CFA HT et 171 100 F CFA TTC, avec huit lignes. `AIR_HANDLING` et `TRUCKING` restent `TO_CONFIRM` via deux réserves `RATE_PENDING_CONFIRMATION` ; aucun montant absent n'est transformé en zéro ni présenté comme ferme.
- Recette authentifiée multi-lot : même périmètre avec deux `quote_request_lines`. Le run est `blocked`, sans montant ni ligne tarifaire, avec l'unique bloqueur `SCENARIO_MULTI_LOT_UNSUPPORTED`. `engine_request` et `engine_response` sont nuls : `quotation-engine` n'a pas été appelé.
- Isolation runtime renouvelée : pour les deux dossiers, empreinte des dix faits inchangée, statut `READY_TO_PRICE` inchangé, zéro `pricing_run` canonique, zéro gap et zéro `quotation_version`. La télémétrie `learned_knowledge` est restée à zéro usage et sa date maximale inchangée ; aucune version, PDF, brouillon ou email n'a été généré.
- Nettoyage final strict : les deux fils et dossiers fictifs, leurs faits, lignes de demande, scénarios, sélections, mutations et runs isolés ont été supprimés. Le FK live met `quote_cases.thread_id` à `NULL` lors de la suppression du fil ; la suppression gardée des deux dossiers fixes a donc été exécutée séparément. Contrôle dynamique de **29 tables** portant `case_id` ou `quote_case_id` : zéro résidu ; zéro fil, email ou scénario restant.
- État d'autorité à la clôture runtime : branche locale `work`, `origin/work` et Lovable alignés sur `859d9fe9c30a3253af0ed14d6801b0392afeae50` avant le commit documentaire final ; worktree applicatif propre, preview privée et projet non publié.

#### P1-A5 — versions/PDF/brouillons de scénario : **PASS GIT + LOVABLE RUNTIME / NETTOYAGE PASS**

- Migration `20260829230000_create_scenario_outputs_p1a5.sql` : extension additive de `quotation_versions` avec provenance canonique/scénario mutuellement exclusive, registre d'idempotence interne deny-all, RPC de création atomique service-role-only et RPC de réattestation de fraîcheur. Une sortie scénario reste immuable, `draft`, non sélectionnable et non ferme.
- Les numéros commerciaux canoniques restent positifs et ignorent les sorties scénario. Les sorties de travail utilisent un espace technique négatif distinct : aucune concurrence ne peut consommer ou collisionner un numéro de devis canonique.
- Nouvelle Edge Function `generate-scenario-quotation-version` : Auth obligatoire, contrôle d'accès JWT/RLS avant élévation, scénario vivant sélectionné et `scope_hash` exact, dernier run réussi obligatoire, fingerprint serveur et idempotence forte. Toute évolution des faits, hypothèses, sélection ou scénario rend la sortie obsolète et bloque aussi son rejeu.
- PDF et brouillon non envoyé relisent la provenance et réattestent la fraîcheur avant chaque usage. Ils affichent la référence et le titre du scénario, les hypothèses, exclusions, réserves, total ferme et total indicatif, avec une mention forte de document de travail non contractuel. L'enrichissement IA du brouillon scénario est refusé afin de préserver un contenu déterministe.
- `send-quotation` refuse explicitement toute version dont `source_kind` n'est pas `canonical`. `select_quotation_version` et les triggers SQL bloquent également sélection, mutation ou promotion d'une sortie scénario. L'UI propose création, PDF et brouillon non envoyé, mais aucune action d'envoi.
- Les listes de versions canoniques filtrent les sorties scénario. Aucun changement d'état du dossier, aucun écrit dans `quote_facts`, `pricing_runs` ou les tarifs, et aucun email réel. Les composants FROZEN `quotation-engine`, `run-pricing`, `build-case-puzzle` et `set-case-fact` sont intacts.
- Preuves locales finales : **96 configurations Edge PASS** ; typecheck frontend PASS ; **218 tests frontend PASS** ; baseline Deno inchangée à 65 diagnostics/7 groupes ; **771 tests Deno PASS, 0 échec et 6 ignorés** ; lint baseline inchangée à 756 erreurs/27 warnings ; build production PASS avec l'avertissement de taille de bundle préexistant.
- PostgreSQL local : reset intégral incluant la migration P1-A5 PASS. Assertions transactionnelles PASS pour forme de sortie, doubles totaux, lignes `TO_CONFIRM`, non-sélection, état dossier inchangé, absence de pricing/faits canoniques, idempotence, fraîcheur stricte, RLS/privilèges et nettoyage. Deux appels réellement concurrents ont produit exactement une version, une mutation et un événement ; résultats `false/true`, numéro scénario `-1`, prochain numéro canonique `1`, puis zéro résidu.
- Publication Git : commit applicatif atomique `32d3206a6877ede52f343858c11801b464db4669` poussé sur `work`. La régénération automatique Lovable `56af13b5`, intégrée par le merge `78f14f924d2fe2f57fc5b79f3903b2d36f9d495f`, est limitée à `src/integrations/supabase/types.ts`. Après alignement : typecheck PASS, 218 tests frontend PASS, 771 tests Deno PASS et 6 ignorés, baselines lint inchangées et build PASS.
- Migration Lovable : version exacte `20260829230000` appliquée depuis le fichier Git de **33 639 octets**, SHA-256 `e0d87b22491e3fcc28f96879dffad880f60282c8464f00d9ccc493ec760848e7`, puis vérifiée byte-identique dans `supabase_migrations.schema_migrations`. Les neuf versions canoniques préexistantes respectent la nouvelle forme ; RLS, contraintes et privilèges service-role-only sont vérifiés.
- Déploiement Lovable limité à `generate-scenario-quotation-version`, `export-quotation-version-pdf`, `create-quotation-email-draft` et `send-quotation`, plus reconstruction du frontend privé. Les quatre probes `OPTIONS` retournent 200 et les quatre appels non authentifiés 401. Aucun autre runtime, Auth, tarif, migration, email ou publication publique n'a été touché.
- Recette authentifiée partielle : le scénario sélectionné expose une hypothèse, une réserve, deux exclusions, 100 000/118 000 F CFA de total ferme HT/TTC et 150 000/177 000 F CFA de total indicatif HT/TTC. La version technique `-1` est restée `draft`, `source_kind='scenario'`, non sélectionnée et sans `pricing_run_id` canonique. Le rejeu a retourné la même version avec `idempotent_replay=true` ; la RPC canonique de sélection l'a refusée.
- Recette documentaire : PDF d'une page vérifié visuellement avec bandeau « estimation de scénario partielle — non ferme », hypothèse, réserve, exclusions, doubles totaux et mentions non contractuelles. Un unique brouillon déterministe vers une adresse `.invalid` a été créé puis récupéré idempotemment ; `status='draft'`, `sent_at=NULL`, aucun email réel envoyé.
- Recette bloquée : un run `blocked` a affiché `Calcul bloqué`, `Non chiffrée` et `SANDBOX_REQUIRED_DATA_MISSING`. La création de sortie a été refusée par `SCENARIO_RUN_NOT_OUTPUTTABLE` ; aucune version, aucun PDF et aucun brouillon n'ont été créés pour ce cas.
- Nettoyage final strict : suppression confirmée de l'unique PDF sandbox via l'interface Storage, puis transaction gardée supprimant exactement le brouillon, le document, les deux dossiers et leurs fils. Contrôle post-nettoyage : zéro résidu pour les identifiants sandbox dans Storage, dossiers, fils, hypothèses, scénarios, sélections, runs, sorties, lignes, documents et brouillons ; les **9 versions canoniques** préexistantes sont intactes et aucune version scénario ne reste.

#### Extension scénarios cargo v2 — 14 septembre 2026 — PARTIAL intégration, correctifs de contre-revue PASS local, Cloud NOT_RUN

- GO utilisateur explicite : contrat scénario versionné, migration locale, exception ciblée `quotation-engine`, tests ; puis correctif ciblé AIR/validation avec tests. Pas de tarifs, commit/push ni déploiement autorisés dans ce lot.
- Base `work` local/GitHub `0e2768ad71f2d55e199af177705e0550cd857dec`, HEAD inchangé ; ancienne note de clôture locale préservée.
- Contrat v2 : danger tri-état, SOC/COC, ONU/classe, poids total/par unité/inconnu, justification opérateur par groupe. Toute donnée de groupe v2 est une hypothèse de simulation, jamais une déclaration client automatique.
- UI corrigée : « Nouveau scénario » conserve le contrat général v1 (dont AIR) ; « Nouveau maritime par groupes » crée un v2. Révisions conservées, passage explicite v1→v2 proposé uniquement en maritime (ancien faux → inconnu) ; changement de mode v2 averti, jamais de rétroconversion ni d'effacement des hypothèses.
- `run-scenario-pricing` consomme les groupes v2 dans des inputs transitoires ; un seul appel moteur, frais communs non dupliqués, poids par groupe, contradictions bloquées, DG inconnu/règles magasinage réservés ; tous les montants v2 exclus du total ferme.
- Diff : `QuoteScenariosPanel.tsx`, `quoteScenarios.ts`, `manage-quote-scenario/domain.ts`, `run-scenario-pricing/{domain,index}.ts`, `quotation-engine/index.ts` ; nouveaux `_shared/scenario-cargo.ts`, tests Deno/Vitest, migration `20260914120000`, assertions SQL transactionnelles ; cette roadmap.
- Tests après correctif : 375 Vitest PASS, dont 3 nouveaux tests du formulaire ; 144 Deno ciblés PASS, dont 2 nouveaux cas AIR/validation stricte ; suite Deno 1316 PASS / 1 FAIL Intake ligne 193 / 6 ignorés. Fichiers Intake/test identiques à `origin/work` : PASS_WITH_BASELINE, pas de correction hors GO.
- `npm run ci` exécuté, arrêté sur ce seul échec Intake ; configuration 94 fonctions et typecheck app/node PASS. Gate Deno 49/5 et lint 737/16 inchangés ; build exécuté séparément PASS ; `git diff --check` PASS.
- Première reprise Docker : migration appliquée puis rejouée sur PostgreSQL 17.10 isolé (`network=none`, aucun port, données en mémoire, sources en lecture seule) avec les validateurs/droits P1-A2 historiques ; aucun accès Cloud.
- SQL PASS : ancien CHECK effectif après migration (OID conservé), ACL/propriétaire/corps des autres validateurs inchangés, snapshot/hash SHA-256/points ouverts v1 conservés, inconnu non converti en faux, champs manquants/contradictoires/interdits rejetés, rejeu et assertions transactionnelles réussis.
- Correctif révélé par le test négatif : retrait des droits EXECUTE superflus du nouvel auxiliaire pour authenticated/service_role ; restriction explicite propre à v2, sans modification des ACL des validateurs v1 ni des rôles/policies Auth/RLS. Ne pas présenter les permissions v1/v2 comme identiques. Le test échouait avant ce correctif et passe après ; 142 Deno ciblés rejoués PASS.
- Limites : calcul v2 maritime conteneurisé ; destinations par groupe et multi-`quote_request_lines` sans mapping restent bloqués, ainsi que les gardes valeur/PAD existants. Recalcul conteneurisé v1 exige une révision v2 ; historiques inchangés. Proposition automatique depuis emails/photos hors de ce lot.
- Aucun fait client, tarif, Auth/politique RLS, pricing canonique, email ou runtime modifié. Réserves par groupe conservées par le lecteur de sorties existant, sans génération de document réel.
- Contre-revue initiale FAIL : création AIR forcée v2 et `weight_basis=["per_unit"]` accepté par Edge/rejeté par SQL. Corrigés sous GO distinct : accès général v1 rétabli sans assouplir les gardes moteur ; base du poids exige une chaîne de l'enum, sans coercition. Tests UI/type JSON vérifiés en échec avant patch, puis PASS ; aucun changement supplémentaire de composant FROZEN.
- Intégration locale PostgreSQL 17.6 : schémas techniques Auth/Storage initialisés, migrations du dépôt jusqu'au 20260910140000 puis migration v2 ; RPC réels création/sélection/pricing/sortie/rejeu, hash périmé, isolation inter-dossiers, lectures autorisées/écritures directes refusées PASS. Résultat tarifaire synthétique, aucun appel moteur Edge réel ; réserves/doubles totaux conservés et absence de faits/pricing canonique/email vérifiée.
- Reconstruction complète FAIL sur le garde-fou `20260910180000_dthc4_f1_relevage_official_rate.sql:233` (2 lignes RELEVAGE hors DPW/TRANSIT), fichier identique à `origin/work` : obstacle baseline distinct du lot, pas de correction tarifaire ni validation intégrale revendiquée. Edge/Lovable/recette métier NOT_RUN.
- SQL de la revue précédente PASS, fixtures annulées (0 utilisateur/0 dossier), conteneur supprimé ; SQL non rejoué au correctif, migration inchangée. Diff du correctif : panneau, `_shared/scenario-cargo.ts` et son test, nouveau `case/__tests__/QuoteScenariosPanel.test.tsx`, roadmap ; HEAD `0e2768ad` inchangé. Suite : lever l'obstacle de reconstruction SQL séparément avant GO Git/Cloud ; aucun commit/push/déploiement. Rollback local : annuler ces seuls changements en préservant le lot v2 antérieur ; aucun état Cloud à restaurer.

#### Réconciliation locale du fournisseur RELEVAGE — 14 septembre 2026 — PASS ciblé / reconstruction PARTIAL

- GO explicite : migration corrective locale + tests, sans application Cloud, commit/push ni déploiement ; `work` local/GitHub `0e2768ad71f2d55e199af177705e0550cd857dec`, HEAD inchangé, lot scénario antérieur préservé.
- Diff exact du sous-lot : nouveaux `supabase/migrations/20260910170000_reconcile_relevage_provider.sql`, `supabase/tests/reconcile_relevage_provider.sql` ; cette roadmap uniquement. Aucun composant FROZEN ni migration historique modifié.
- Migration rédigée le 14/09, ordonnée avant F1 : exige les deux lignes seed RELEVAGE/TRANSIT 20/40 et leur identité/provenance/montants/unités exacts ; `DP_WORLD` → `DPW` uniquement, avec `updated_at` via trigger existant. Aucun montant, niveau de preuve, taux, rôle, policy ou fait client modifié par ce correctif.
- Verrou de table, garde cardinalité/doublons/collision, empreintes JSON complètes hors provider/horodatage des deux cibles, intégrité complète des autres lignes. Absence de candidat legacy = no-op sans UPDATE, y compris après F1b ; application Cloud et traitement de sa version antérieure au ledger nécessitent un GO/préflight distinct.
- PostgreSQL 17.6 isolé, réseau désactivé, aucun port, sources montées read-only, données éphémères : test reproduit le refus F1 initial puis PASS normalisation/rejeu, 15 refus atomiques sur variantes invalides, table vide no-op, lignes hors cible inchangées. F1/F1b historiques enchaînés PASS ; état final 36 560 / 73 120 / 82 260, rejeu du correctif après F1b sans aucune mutation.
- Rejeu applicatif depuis une base neuve après initialisation technique Auth/Storage (19 migrations Storage) : 229 migrations du dépôt réussies, dont le correctif et F1 ; arrêt sur `20260911090000_dthc4_d1_retire_non_canonical_thc_rows.sql` (5 lignes canoniques THC actives au lieu de 11). Les cinq présentes sont IMPORT ; EXPORT/TRANSIT et les cinq cibles legacy à retirer sont absentes. Fichier D1 identique à `origin/work`, aucun contournement ni insertion tarifaire.
- Reconstruction complète FAIL sur cette autre dette baseline ; migration scénario v2 et recette Lovable NOT_RUN dans ce rejeu. `git diff --check` PASS ; CI applicative non rejouée pour ce sous-lot SQL (résultats du correctif AIR ci-dessus conservés).
- Fixtures SQL annulées (0 table publique dans la base de tests), conteneur éphémère supprimé après contrôle d'identité ; aucun état utilisateur/Cloud à restaurer. Rollback local : retirer seulement ces deux nouveaux fichiers et cette note, sans toucher au lot scénario antérieur.
- Suite : diagnostic/réconciliation distincte de la grille historique attendue par D1 avant publication ; ne pas abaisser son garde-fou ni inventer les lignes manquantes. Aucun GO Cloud/Git acquis.

#### Réconciliation locale des lignes THC historiques — 14 septembre 2026 — PASS local / Cloud NOT_RUN

- GO utilisateur : réconciliation locale et tests, sans écriture Cloud, modification des montants, commit/push ni déploiement ; demande de contre-revue dans le chat Claude « Audit application et direction produit ».
- Base `work` local/GitHub `0e2768ad71f2d55e199af177705e0550cd857dec`, HEAD inchangé ; lots scénario v2 et RELEVAGE antérieurs préservés.
- Diff exact du sous-lot : nouveaux `supabase/migrations/20260911080000_reconcile_dpw_thc_replay_rows.sql`, `supabase/tests/reconcile_dpw_thc_replay_rows.sql` ; cette note uniquement. Aucune migration historique ni composant FROZEN modifié.
- Diagnostic préalable read-only : Cloud contient 11 THC canoniques actives et 13 historiques inactives ; le rejeu Git ne créait que 5 IMPORT. Six canoniques EXPORT/TRANSIT et cinq cibles historiques de D1 manquaient ; valeurs rapprochées des migrations D1/provenance et des lignes Cloud, sans nouvelle décision de barème.
- Migration rédigée le 14/09, ordonnée avant D1 : insère seulement les cibles absentes avec leurs attributs exacts ; cinq historiques insérées inactives. Aucun UPDATE/DELETE ; verrou, refus des doublons/écarts, contrôle post-insertion et empreinte complète des lignes existantes. Rejeu exact = no-op.
- PostgreSQL 17.6 isolé sans réseau ni ports, sources read-only et données éphémères : échec D1 initial reproduit, 11 insertions exactes, 13 cas négatifs atomiques (dont altération par trigger), rejeu avant/après provenance PASS. Tests RELEVAGE antérieurs rejoués : 15 cas négatifs et chaîne F1/F1b PASS.
- Reconstruction neuve après initialisation technique Auth/Storage (19 migrations Storage) : **234/234 migrations du dépôt PASS**, incluant les deux réconciliations, F1/D1/F1b/provenance et scénario v2 ; les blocages historiques décrits ci-dessus sont levés localement.
- Sur cette base complète : assertions SQL v2 et RPC réels création/sélection/persistance pricing/sortie/rejeu/isolation/droits PASS, résultat tarifaire synthétique, aucun moteur Edge réel. Rejeu THC final = 0 insertion ; 0 utilisateur/0 dossier après rollback des fixtures.
- CI applicative NOT_RUN pour ce sous-lot SQL ; résultats et dette Intake du lot AIR ci-dessus inchangés. `git diff --check` PASS. Aucun rôle/policy Auth/RLS ni fait client/runtime Cloud modifié ; les migrations historiques du dépôt sont rejouées uniquement en local.
- Risque publication : le ledger Cloud consulté ne comporte aucune version >= `20260910000000`, alors que certains effets sont présents ; cela ne prouve pas leur absence d'exécution. Réconciliation du ledger/application Cloud nécessite préflight et GO distincts ; aucun repair/blind push autorisé.
- Conteneur de test supprimé après vérification d'identité ; seules bases synthétiques éphémères effacées. Rollback : retirer les deux nouveaux fichiers et cette note, sans toucher aux lots précédents ; aucune restauration Cloud.
- Suite : contre-revue Claude du bilan (non encore envoyé/approuvé à cette clôture), puis préflight publication séparé ; recette Edge/Lovable et métier NOT_RUN. Un avis sur bilan seul ne vaut pas revue du diff local non publié.

#### Contre-revue Claude et preuve THC état Cloud — 14 septembre 2026 — PASS test local / publication NO-GO

- GO : fournir les diffs à Claude et compléter le test local état Cloud ; aucun commit/push ni écriture Cloud. Base `work` `0e2768ad71f2d55e199af177705e0550cd857dec` inchangée, alignement distant revérifié après interruption réseau.
- Claude, chat « Audit application et direction produit » : cohérence de la base publiée approuvée ; NO-GO local conditionné à la lecture des diffs, au préflight ledger sans rejeu aveugle et à la preuve de no-op sur l'état THC Cloud.
- Diff de ce sous-lot : extension de `supabase/tests/reconcile_dpw_thc_replay_rows.sql` et cette note uniquement ; migrations et code v2 inchangés, travaux antérieurs préservés.
- Nouveau SELECT Cloud : 24 THC DPW, 11 actives/13 inactives ; les 14 attributs métier sont reproduits exactement en fixture, UUID/horodatages synthétiques. Aucun dossier, secret ni identifiant Cloud exporté ; ce n'est pas un clone complet de la base.
- PostgreSQL 17.6 isolé (aucun réseau/port, sources read-only) : deux exécutions de la réconciliation puis D1/provenance PASS, zéro INSERT/UPDATE/DELETE tenté prouvé par trigger de refus ; empreinte JSON de toutes les colonnes et 24 lignes inchangée. Les 13 tests négatifs antérieurs repassent.
- Fixtures annulées puis conteneur supprimé ; aucune donnée utilisateur effacée. `git diff --check` PASS ; CI et reconstruction 234 migrations non rejouées ici (preuves précédentes conservées), recette Edge/Lovable v2 NOT_RUN.
- Vérifications read-only de contre-revue : ledger Cloud 198 entrées, dernière version 20260902120000 ; 16 versions Git août–septembre absentes. F1 ne doit pas être rejouée après F1b ; seuls les effets prouvés pourront justifier un marquage sous GO distinct. Aucun marquage effectué.
- Test Intake : échec de recherche littérale LF sur source CRLF Windows confirmé, recherche réussie après normalisation en mémoire seulement ; aucun fichier normalisé/modifié ni CI verte locale revendiquée.
- Dossier de revue préparé hors dépôt : diffs suivis contre HEAD, contenu intégral des nouveaux fichiers, manifestes SHA-256 ; aucune publication Git. Transmission/avis code à confirmer dans le chat, aucune approbation de publication déduite.
- Rollback : retirer uniquement l'extension du test et cette note ; aucune restauration Cloud. Suite : verdict de code Claude puis préflight ledger séparé ; jamais de replay global de migrations Cloud.

#### Correctifs après contre-revue Claude — 14 septembre 2026 — PASS ciblé / publication NO-GO

- GO utilisateur : corrections ciblées/tests locaux et préparation de nouvelle contre-revue ; aucun commit/push, SQL/ledger Cloud, tarif ou déploiement. Base `work` locale/GitHub `0e2768ad71f2d55e199af177705e0550cd857dec`, HEAD inchangé ; lot précédent présent et préservé.
- Claude a reçu les 17 fichiers complets/diffs : GO code des deux réconciliations, avis conditionnel sur v2. Son attribution des 9 échecs Deno 2.6.10 au nouveau test scénario est inexacte : la preuve §3.24 concerne le preflight IMO publié. Diagnostic 2.6.10 non rejoué ici, aucun sanitizer désactivé.
- Recalcul à conteneurs v1 toujours soumis à révision explicite v2 ; anciens résultats/faits intacts. Codes DG maritime/aérien distingués, messages opérateur et aide de révision explicites ; aucune invitation à convertir AIR en v2 maritime. Pas de nouvelle prise en charge DG aérien.
- SOC/COC reste une hypothèse requise et tracée : réserve persistée et avertissement UI « sans ajustement tarifaire SOC/COC » ; aucune exonération/majoration ajoutée. Fallback de lot v2 malformé corrigé : danger inconnu et champs v2 conservés. Mention inexacte d'alignement ACL v1/v2 corrigée ci-dessus, SQL inchangé.
- Diff de ce sous-lot (11 fichiers) : `QuoteScenariosPanel.tsx` et son test ; `quoteScenarios.ts`, `scenarioCargoV2.test.ts`, `scenarioPricing.ts` et son test ; `run-scenario-pricing/domain.ts`, nouveau `handler_test.ts` ; `_shared/scenario-cargo.ts` et son test ; cette roadmap. Aucun nouveau patch du moteur FROZEN, d'Auth/RLS ou de migration.
- Tests reproduits en échec avant correction : fallback frontend, distinction DG AIR/maritime et réserve SOC/COC ; PASS après. Test réel du handler : 16 cas PASS via transport HTTP mémoire fermé, aucun socket/JWT réel/Cloud, RPC et réponse moteur simulées (pas une nouvelle preuve de concurrence SQL ni de tarif réel).
- Handler vérifié : accès JWT puis visibilité sous utilisateur avant service-role ; groupes et hypothèse liée vers un seul appel moteur par invocation ; résultat isolé, faits originaux conservés, total ferme v2 nul, frais commun non dupliqué, réserves persistées ; refus, hash périmé, lecture/moteur/RPC en échec, identité/fingerprint de rejeu.
- 378 Vitest PASS ; Deno final 1334 PASS / 1 FAIL Intake :193 / 6 ignorés. Source Intake et son test identiques à `origin/work`, fragilité LF/CRLF déjà diagnostiquée : PASS_WITH_BASELINE, pas de CI verte revendiquée. Gate types Deno 49/5 et lint 737/16 inchangés, typecheck frontend/config 94 PASS, build PASS, lint ciblé et diff-check PASS.
- `npm run ci` exécuté : arrêté sur Intake ; lint/build exécutés séparément. Un TS2502 introduit dans le nouveau test a été corrigé, baseline non relevée. Après ajout du seizième cas, suite Deno et gate de types rejouées ; SQL/234 migrations et recette Lovable NOT_RUN ce tour, six fichiers SQL byte-inchangés.
- Suite : transmettre le dossier de code actualisé pour contre-revue indépendante, puis préflight ledger sous GO distinct ; ne pas rejouer F1 après F1b. Aucun avis de publication acquis. Rollback : annuler seulement ce sous-lot local, conserver les 17 fichiers antérieurs ; aucune restauration Cloud.

#### D1 AIR et préparation préflight ledger — 14 septembre 2026 — PASS local / PARTIAL publication

- GO utilisateur : D1/tests et préparation read-only du plan pour contre-revue Claude ; aucun commit/push, marquage ledger, application SQL ou déploiement. `work`, HEAD local/GitHub `0e2768ad71f2d55e199af177705e0550cd857dec` inchangé (GitHub confirmé via connecteur, DNS Git direct indisponible).
- D1 : AIR v1 avec `cargo.containers` reçoit `SCENARIO_CONTAINERS_UNSCOPED_AIR`, message sans remède maritime ; blocage conservé, aucune conversion de mode/suppression de faits ni appel moteur. Maritime inchangé.
- Diff propre à ce sous-lot : `run-scenario-pricing/domain.ts`, `src/lib/scenarioPricing.ts` et son test, `run-scenario-pricing/handler_test.ts`, cette note. Les quinze autres fichiers du lot de vingt restent SHA-256 inchangés, dont moteur et six SQL.
- Rouge puis vert : assertion du message et deux tests du vrai handler avec/sans DG, transport mémoire fermé. 378 Vitest PASS ; 46 Deno ciblés PASS (18 handler + 28 cargo) ; types frontend, ESLint ciblé et diff-check PASS ; types Deno 49/5 inchangés PASS_WITH_BASELINE. CI complète/SQL/recette Lovable NOT_RUN ce sous-lot.
- Préflight SELECT uniquement : ledger 198 entrées ; 234 fichiers locaux, 30 versions identiques. Empreinte SQL normalisée LF/fin de texte : 200 fichiers correspondent à 195 entrées Cloud, dont 172 sous identifiant différent ; ce n'est pas une preuve byte-identique ni d'effet actuel. Ne pas rouvrir automatiquement la réconciliation historique clôturée §3.1.
- Les 16 versions publiées récentes absentes du ledger ne sont pas autorisées au marquage : statuts ciblés, reprise honoraires, 25 règles IMO, 11 THC actives/provenance et 3 relevages transit finaux vérifiés partiellement ; définitions/ACL/RLS et rapprochements métier exhaustifs restent à compléter. F1 remplacée par F1b, jamais à rejouer.
- C8 explicite : `20260825170000` doit précéder `20260911080000` ; version et empreinte SQL normalisée du prérequis concordent avec le ledger. Le runner « seulement trois nouvelles » n'est pas démontré par la comparaison brute des versions : exiger liste exacte/méthode Lovable bornée, aucun rejeu global.
- Plan détaillé et preuves préparés hors dépôt pour Claude ; contre-revue du plan en attente de transmission/avis. Aucun GO publication déduit du GO CODE précédent. Backup/PITR et restauration non vérifiés ; GO Cloud précis requis après clôture des contrôles.
- Rollback : retirer uniquement D1/tests et cette note, préserver le lot antérieur ; aucune restauration DB/Auth/RLS/runtime nécessaire. Suite : contre-revue du plan, puis contrôles manquants avant toute nouvelle demande d'écriture Cloud.

#### Préparation locale D/E/G après avis Claude — 14 septembre 2026 — PASS local / publication PARTIAL

- GO utilisateur : manifeste historique, trois préflights, rollback et tests locaux ; aucun SQL Cloud (même SELECT), commit/push, déploiement, tarif ou modification de doctrine permanente. `work`, HEAD local/GitHub `0e2768ad71f2d55e199af177705e0550cd857dec` inchangé ; accès Git direct indisponible, connecteur GitHub concordant.
- Dossier hors dépôt `preparation-locale` : manifeste des 16 historiques et 3 nouvelles (version/name/statements exacts UTF-8/SHA-256), preuve historique par lignes de HEAD séparée des effets actuels, préflights SELECT, rollback gardé, générateur/fixtures/tests et consignes de revue. Aucune décision de marquage autorisée.
- Point B non levé : `20260822140700` est documentée comme reconstruction LOCALE d'une quarantaine Cloud observée, pas exécution Cloud du fichier ; ne pas inventer cette preuve. Quinze autres livraisons/exécutions documentées, dont IMO par noms de lots ; identifiants d'appels Lovable non fournis, effets exhaustifs encore PARTIAL/NOT_RUN.
- Préflights : absence legacy RELEVAGE ; 11 THC uniques/attributs exacts + 24 lignes + C8/empreinte SQL ; v1/catalogue complet/CHECK/auxiliaire absent. Conditions no-op à reprendre sous verrou lors d'une éventuelle application ; aucun runner global Cloud ni reprise de l'ancienne réconciliation.
- Rollback v2 local : accusé de revue/OID attendu, verrou ACCESS EXCLUSIVE, zéro scénario v2, corps attendus ; restauration v1/commentaire et DROP auxiliaire RESTRICT, jamais CASCADE ni suppression ledger. Snapshot Cloud réel obligatoire avant une future application ; le modèle local ne le remplace pas.
- PostgreSQL 17.10 jetable, réseau none, aucun port, sources read-only : trois préflights positifs + six refus ; deux passes no-op avec trigger anti-écriture/empreinte ; assertions v2 ; cinq refus atomiques du rollback puis restauration exacte OID/ACL/propriétaire/corps/commentaire des 11 validateurs et insertion v1 PASS. Table scénario minimale avec vrai CHECK, pas recette RPC/RLS complète.
- Tests existants rejoués : RELEVAGE 15 refus/chaîne F1-F1b/no-op PASS ; THC 13 refus/chaîne D1-provenance/fixture 24 lignes sans tentative d'écriture PASS. Contrôle manifeste/UTF-8 sans BOM/génération reproductible PASS. CI frontend/Deno/build, reconstruction 234 migrations, concurrence multi-connexion et recette Lovable NOT_RUN ce lot.
- Vigilance transaction : v2 possède son BEGIN/COMMIT ; future inscription ledger des trois nouvelles seulement après succès et avant commit dans la même enveloppe validée. Un INSERT après son COMMIT ne serait pas atomique. Aucun SQL de marquage opérationnel produit tant que les preuves restent partielles.
- Seule cette note change dans le dépôt ; 19 autres fichiers du lot conservés. Rollback du sous-lot : retirer ses artefacts locaux et cette note, sans restauration Cloud. Suite : contre-revue du dossier D/E/G, arbitrage de la preuve de quarantaine, puis contrôles frais et GO d'écriture distinct.

#### Gardes D/E/G, contrôles Cloud et option B préparée — 14 septembre 2026 — PASS local / publication PARTIAL

- GO utilisateur : correctifs/tests locaux, contrôles Cloud READ ONLY et préparation option B ; aucune écriture Cloud, commit/push, publication ni doctrine permanente. `work`, HEAD `0e2768ad71f2d55e199af177705e0550cd857dec` inchangé, GitHub confirmé via connecteur.
- Hors dépôt : scan des appelants résiduels `pg_proc.prosrc` dans préflight v2/rollback, OID attendu seul exclu, RESTRICT conservé ; rouge reproduit puis vert. Limite : références assemblées dynamiquement non garanties par cette recherche textuelle.
- PostgreSQL 17.10 isolé : trois préflights, six refus données/prérequis, double no-op, assertions scénario v2 ; six refus rollback et restauration exacte des validateurs PASS. Aucun correctif applicatif/migration du dépôt dans ce sous-lot ; 19 fichiers antérieurs préservés.
- SELECT Lovable frais : trois préflights ok, appelants résiduels absents ; ledger 198 métadonnées ; EMPTY_RETURN 5/5 rejetés, PORT_DAKAR_HANDLING 2/2 ; 4 tables RLS, 17 policies, 5 triggers activés, 7 fonctions et code réservé IMO présents.
- Comparaison corps : cinq identiques après normalisation CRLF/trim ; un diff commentaires/lignes blanches, un diff accents du message d'erreur uniquement. Ni identité byte à byte des sept corps ni preuve d'exécution intégrale des migrations revendiquée.
- E0 : deux étapes observées xid 27469, même transaction et read_only=on via paramètre transaction-local ; pas une preuve Cloud d'annulation d'écriture sur erreur.
- Option B `20260822140700` : 25 cibles exactes/inactives, 35 demurrage dont 26 actives, version absente ; aucun trigger de statement/règle tarifaire ni trigger utilisateur/règle ledger. L'exécution HISTORIQUE reste non prouvée.
- Brouillon externe : accusé, verrous/empreintes, état cible strict sous verrou, SQL original UTF-8, comparaison no-op puis INSERT ledger nu exact avant COMMIT ; préparation uniquement, aucune application Cloud.
- Tests option B sur fixture synthétique : zéro UPDATE de ligne, 198→199 entrées locales dont texte source exact ; dix refus et atomicité PASS. Générateurs déterministes/contrôle Q3 PASS ; CI, 234 migrations, concurrence multi-connexion et recette Lovable NOT_RUN ce sous-lot.
- Suite : contre-revue Claude du dossier actualisé, sauvegarde fraîche ledger COMPLET/catalogue v1 puis éventuel GO Cloud borné. Verrous bloquants/timeout à valider ; garde E0 ne remplace pas cette revue. Aucun runner global Cloud ni rejeu F1/IMO-rules.
- Seule cette note change dans le dépôt. Rollback : retirer ses artefacts/note seulement, préserver le lot antérieur ; aucune restauration DB/Auth/RLS/runtime nécessaire.

#### Clôture ciblée Claude : E0-ter et variante option B — 14 septembre 2026 — PASS local / publication PARTIAL

- GO existant poursuivi : préparation/correctifs/tests locaux et contrôles Cloud READ ONLY ; avis Claude conditionnel, jamais assimilé à une autorisation d'écriture. `work`, HEAD `0e2768ad71f2d55e199af177705e0550cd857dec` local/GitHub alignés par ls-remote, inchangés.
- E0-ter PASS : requête 93 193 octets, littéral 92 914 octets, accents/commentaires et 5 CRLF ; MD5 local/Cloud `4918f0af893260c3be1ffd7bcbc9d068`, read_only=on. Fidélité de cet appel SELECT démontrée, pas preuve de tout DDL ni de l'origine des divergences historiques.
- Option B externe : ledger ACCESS EXCLUSIVE, trois tables tarifaires SHARE ROW EXCLUSIVE ; dix refus, zéro UPDATE ligne/inscription SQL exacte et assertions pg_locks PASS en PostgreSQL 17.10 isolé. Génération déterministe PASS ; concurrence multi-connexion NOT_RUN, non bloquante selon Claude.
- Ordre borné : option B avant toute autre inscription D/E (pin 198), puis E après recontrôle des prérequis ; base E avant trois Edge. Tout changement préalable ledger impose de nouveaux pins approuvés. Date UTC/accusé/zéro ligne à tracer dans CTO_GO_QUEUE seulement lors de l'exécution réelle.
- Ledger complet exporté hors dépôt : 198 entrées/10 tranches, 1 270 542 octets SQL ; version/name/cardinalité/taille/MD5 vérifiés, métadonnées identiques avant/après. Catalogue v1 frais sauvegardé, préflight ok. Export non atomique par tranches, pas snapshot complet DB/PITR ; restauration non vérifiée.
- Manifeste : H2-d2 `20260909170000` et IMO storage `20260910140000` exclus du marquage pour corps divergents. Pas de preuve d'exécution exacte Git ; convergence éventuelle sous GO distinct, ensemble dans l'ordre et même transaction, jamais H2-d2 seul.
- Liste D séparée : 10 candidates no-op sous gardes/tests/GO, 2 DDL policies/triggers, 2 jamais rejouables (F1/IMO-RULES-1), 2 divergentes. Toutes NOT_AUTHORIZED ; aucun rejeu général proposé.
- Restent : capacité de restauration/risque accepté, revue limitée aux modifications de verrou/séquence et enveloppes E, puis GO utilisateur précis. Préparation et exports ne sont pas une publication ; CI/recette Lovable NOT_RUN ce tour.
- Dans le dépôt, seule cette note change ; 19 fichiers applicatifs et consignes de gouvernance préservés. Aucun commit/push, DB/Auth/RLS/tarif/fait/runtime modifié. Rollback du sous-lot : retirer seulement ses artefacts/note ; aucune restauration Cloud.

#### Écarts textuels H2-d2 / IMO storage acceptés — 15 septembre 2026 — PASS décision / publication PARTIAL

- GO utilisateur : conserver les deux fonctions Cloud telles quelles, abandonner leur convergence purement textuelle et poursuivre le lot scénarios sans bloquer sur ces écarts. Décision close, ne pas redemander cet arbitrage sans preuve nouvelle.
- Portée exacte : commentaires/lignes blanches de `fee_line_code_is_reserved(text)` et accents du message d'erreur de `fee_lines_reject_reserved_code()`, comparés le 14 septembre. Aucune autre différence acceptée ; modification automatique ou inévitable par Lovable non démontrée.
- Versions `20260909170000` et `20260910140000` exclues du marquage historique avec le texte Git ; aucun rejeu/convergence requis pour le lot actuel, aucun changement de source Git pour fabriquer une concordance. L'écart reste documenté.
- Les pins, contrôles de logique/tarifs/Auth/RLS et rollback des nouvelles fonctions restent obligatoires. Ce GO n'autorise aucun commit/push, marquage ledger, SQL Cloud, déploiement ou envoi client.
- Préflight : `work`, HEAD local/GitHub `0e2768ad71f2d55e199af177705e0550cd857dec` inchangé, lot local attendu présent. Arbitrages métier anciens de la file non élargis par cette décision.
- Diff : cette note et annotations de décision des annexes externes ; code/migrations et consignes antérieures préservés. Génération du manifeste et diff-check contrôlés ; tests applicatifs/recette/Cloud NOT_RUN ce tour, aucune modification DB/Auth/RLS/runtime.
- Suite : terminer les prérequis réels de livraison (restauration/risque accepté et enveloppes finales), puis GO de publication borné. Rollback de cette décision documentaire : retirer uniquement cette note/annotations ; aucune restauration Cloud nécessaire.

#### Enveloppes finales et restauration — 15 septembre 2026 — PASS local / publication PARTIAL

- GO utilisateur : préparation locale de livraison et contrôles de restauration en lecture seule ; aucun GO de commit/push, SQL Cloud ou déploiement déduit.
- `work`, HEAD local/GitHub/Lovable `0e2768ad71f2d55e199af177705e0550cd857dec` inchangé ; 19 fichiers applicatifs et consignes précédentes préservés. Diff du tour : cette note et annexes externes uniquement.
- Annexes `preparation-locale/execution-E{1,2,3}-DRAFT.sql` générées : B puis E1/E2/E3, pins ledger, préflight sous locks, no-op tarifaire, SQL + INSERT ledger atomiques et contrôles après exécution ; aucun runner global ni marquage D historique.
- E3 préserve OID/ACL/owner/config/contraintes et lignes scénarios ; SQL original conservé dans `statements`, retrait des seuls BEGIN/COMMIT externes pour exécution englobée. Rollback v1 conditionné à zéro ligne v2 et retour Edge coordonné, ledger conservé.
- Tests frais PostgreSQL isolé : 22 refus attendus E + 3 succès + retour v1 PASS ; suites antérieures de préparation/option B PASS après correction des chemins de montage du harnais jetable ; génération des six annexes vérifiée.
- Cloud SELECT 15/09 09:18 UTC : 198 entrées exactes, E1/E2 no-op prêts, catalogue v1 exact ; préflight B frais conforme. Texte E3 113902 octets, MD5 local/Cloud `c65ba55dbc8b91d80d9f574cfae6c3f8` par SELECT littéral, aucune preuve DDL inférée.
- Restauration complète/PITR non établis ; bouton Export project data vérifié dans Lovable, non activé. L'export crée une copie Cloud avec lien email ; son téléchargement, intégrité et restauration locale restent NOT_RUN, hors code Edge/Storage/secrets selon documentation officielle.
- Preuves hors dépôt : `C:/Users/DELL/AppData/Local/Temp/dcq-claude-review-20260914-cloud24/preparation-locale/CLOTURE-LIVRAISON-20260915.txt`, manifeste E et résultats. Tests sur fixtures ciblées, pas un rejeu Cloud intégral ; CI applicative/recette Lovable NOT_RUN ce tour.
- Suite : GO ciblé pour export puis validation locale, contre-revue de clôture limitée aux enveloppes/retour arrière, puis GO de publication nommé. Écarts textuels acceptés inchangés et non bloquants. Aucun impact DB/Auth/RLS/tarifs/faits/runtime ; retrait des seules nouvelles annexes/note pour annuler cette préparation.

#### Export et essai de restauration — 15 septembre 2026 — PASS local / livraison PARTIAL

- GO utilisateur : export Lovable, téléchargement et essai local uniquement, sans migration Cloud/publication. Compétence computer-use utilisée pour l'export autorisé ; aucun message envoyé à Claude ni au client.
- Export Cloud privé `database_export_15_09_26/dakotation-pro_260915.backup`, créé le 15/09 à 09:27:54 UTC, téléchargé dans `C:/Users/DELL/Downloads/dakotation-pro_260915.backup` : 23784269 octets, SHA256 `083d722e534132f47e6bd3bfab9e2f5aa82ae6165bb7f21ee3db61a802d07603`. Archive sensible, hors Git, ne pas joindre aux contre-revues.
- Archive custom zstd, 2310 entrées, pg_dump 18.6 depuis PostgreSQL 17.6. Restauration complète `pg_restore --exit-on-error --single-transaction`, sans suppression des propriétaires/ACL, terminée code 0 sur `supabase/postgres:17.6.1.136`, sans réseau/ports et données tmpfs.
- Prérequis locaux après deux refus atomiques : utiliser `supabase_admin`, créer uniquement les rôles NOLOGIN manquants `supabase_realtime_admin`, `sandbox_exec`, `sandbox_exec_snjewofqxfsdmaszapux`. Aucun rôle/identifiant Cloud modifié ; les attributs globaux et accès réels ne sont pas reproduits par ces rôles locaux.
- Comparaison locale/Cloud fraîche : 15 champs concordants dont 132 tables publiques/2 vues, 130 tables RLS, 228 politiques (empreinte identique), 198 entrées ledger (empreinte identique), 219 tarifs portuaires (empreinte identique), 73 dossiers/1409 faits/171 runs/9 versions/0 scénario, 20 fonctions scénario (corps/ACL/owner/config/security_definer).
- L'écart initial d'affichage des politiques provenait de `search_path` local incluant auth : aucune modification des politiques ; comparaison identique après alignement de la session sur public,extensions.
- Preuves : annexes externes `preparation-locale/export-restore-verify.sql` et `export-restore-results-20260915.json`. Tous les objets de l'archive restaurés, comparaison ciblée uniquement ; comportement applicatif, authentification réelle, restauration Cloud/PITR et fichiers Storage/code Edge non démontrés.
- Préflight : `work`, HEAD local/Lovable `0e2768ad71f2d55e199af177705e0550cd857dec` inchangé, lot local présent ; accès GitHub direct indisponible ce tour, dernier alignement confirmé antérieurement. Code applicatif/migrations/consignes inchangés ; seule cette note et deux annexes de contrôle ajoutées.
- Impact Cloud autorisé : création de l'export privé et notification annoncée par Lovable ; aucun SQL métier, tarif, fait, Auth/RLS, commit/push ou déploiement modifié. CI/recette applicative et B/E NOT_RUN ce tour. Conteneur de restauration supprimé après contrôles ; archive privée conservée.
- Suite : retour local désormais prouvé ; contre-revue de clôture limitée aux nouvelles enveloppes et à cette preuve, puis GO de livraison regroupé et nommé. Aucun nouveau chantier de sauvegarde générale ni réouverture des écarts textuels acceptés. Restauration Cloud effective non autorisée/non testée.

#### B1 — contrôle ACL E3 et répétition locale — 15 septembre 2026 — PASS local / revue PARTIAL

- GO utilisateur : correctif du contrôle E3, tests reproduisant Lovable et rejeu B→E1→E2→E3 sur restauration privée ; aucune écriture Cloud, commit/push ou publication.
- `work`, HEAD local/GitHub `0e2768ad71f2d55e199af177705e0550cd857dec` inchangé. Hors dépôt : générateur E, enveloppe E3, tests et manifeste actualisés ; B/E1/E2, rollback et sources métier inchangés.
- Garde E3 : propriétaire identique au helper v1 épinglé ; PUBLIC/anon/authenticated/service_role interdits ; autres entrées ACL limitées aux mêmes bénéficiaire, accordeur, privilège et délégation déjà présents sur v1. Aucun GRANT ajouté à la migration.
- Fixture PostgreSQL 17.6 : 29 refus attendus avec atomicité, trois succès E et retour v1 PASS, dont sept nouvelles protections ACL. Génération reproductible PASS.
- Archive privée restaurée intégralement en local isolé, puis B/E1/E2 PASS : ledger 198→199→200→201 ; ancien E3 refusé sur E_HELPER_ACL_POSTCHECK, annulation vérifiée ; E3 corrigé PASS →202 ; rollback v1 PASS, historique conservé.
- Empreintes des 163 tables public/auth/storage (66 499 lignes) inchangées après chaque étape et retour ; catalogue v1 rétabli, droits helper v2 limités à postgres et au rôle sandbox déjà présent sur v1.
- Adaptations LOCALES explicites : database OWNER postgres pour pg_database_owner ; OID objets/rôles et ordre catalogue/CHECK issus de la restauration, égalité sémantique préalable. Aucun pin Cloud rafraîchi automatiquement. Harnais corrigé après refus sur ordre des CHECK, interpolation JS et propriétaire DB local.
- E3 SHA256 `ae83d07083f604111b636e1ebdbcdcc29b70a2f73da16cd2e1aeabdbe1450565` ; ancien test de transport Cloud ne couvre pas ces nouveaux octets. Convention CRLF source B conservée, chaîne ledger inchangée.
- Preuves externes : `preparation-locale/b1-rehearsal-results.json`, `rehearse-b1.mjs` et dossier de contre-revue B1. Conteneur temporaire supprimé, sauvegarde privée conservée ; aucune donnée client jointe à la revue.
- Suite : contre-revue limitée à B1 et aux preuves affectées, puis GO de livraison regroupé nommé. CI applicative, recette Lovable, publication et avis Claude sur ce correctif NOT_RUN. Rollback local : reprendre les annexes précédentes ; aucun retour Cloud requis.

#### GO livraison privée — 15 septembre 2026, 10:21 UTC — BLOCKED avant écriture

- Contre-revue Claude reçue : B1 LEVÉ, pas de correction supplémentaire ; transport E3 frais et préflights restent requis avant écriture.
- GO utilisateur explicite : quatre enveloppes SQL B→E1→E2→E3, commit/push work, Edge quotation-engine (FROZEN)→run-scenario-pricing→manage-quote-scenario, vérification des sources, recette privée sans envoi et entrée CTO ; arrêt au premier échec. Aucun scénario v2 pendant la fenêtre de synchronisation.
- Arrêt au préflight : connexion directe github.com:443 impossible pour git ls-remote (21 secondes). HEAD local `0e2768ad71f2d55e199af177705e0550cd857dec` inchangé ; alignement GitHub frais UNKNOWN, pas de divergence démontrée.
- Lovable get_project/get_database_status READ ONLY : même SHA, privé/non publié, prêt, base activée. Aucun query_database, accusé, migration, commit/push ou déploiement effectué ; tests/transport/préflights DB/recette NOT_RUN ce tour.
- Diff du tour : cette note et l'entrée CTO_GO_QUEUE uniquement ; lot antérieur préservé. Aucun impact DB/Auth/RLS/tarifs/faits/runtime ; aucun rollback Cloud requis.
- Reprise : rétablir l'accès GitHub puis contrôles frais sous le GO déjà donné, sans nouvelle boucle de contre-revue à périmètre inchangé. Retour SQL toujours limité à zéro ligne v2, historique conservé ; après données v2, correction en avant.

#### Livraison scénarios — 15 septembre 2026, 10:29 UTC — SQL PASS / Edge et recette NOT_RUN

- GO de livraison repris après rétablissement GitHub : HEAD local/GitHub/Lovable `0e2768ad71f2d55e199af177705e0550cd857dec`, 19 fichiers applicatifs identiques à la contre-revue ; B1 LEVÉ par Claude.
- Contrôles locaux : 94 configurations, typecheck frontend, 378 tests frontend et build PASS ; types Deno 49, lint 737/16 inchangés. Deno 2.9.5 fourni via cache npm/DENO_BIN local après absence initiale du PATH, aucune modification du dépôt pour ce problème d'environnement.
- Tests Deno : 1336 PASS, 1 FAIL, 6 ignorés. Seul échec SIFB Intake ligne 193 (recherche LF dans checkout CRLF), reproduit sur checkout baseline origin/work, fichiers inchangés : PASS_WITH_BASELINE, pas CI intégralement verte. Aucun correctif hors lot ni test ignoré ajouté.
- Transport E3 SELECT frais : 114746 octets, MD5 `493f6b48383f722e13072f82794ae70d`, identique au local. Deux préflights frais PASS à 10:28 UTC, ledger 198 et catalogue épinglé conformes.
- B→E1→E2→E3 réellement exécutées séparément via query_database, chacune atomique, avec accusés `REVIEWED_OPTION_B_EXECUTION_NOT_HISTORICAL_PROOF` puis `REVIEWED_SCENARIO_E_20260915`. Vérifications de persistance ledger 199→200→201→202 entre 10:28 et 10:29 UTC.
- Sources ledger MD5 : B b2f2029470209f3e5625101974f6e73b ; E1 ff415c5d2c6de69d0e9ee44c7236e8c1 ; E2 c4913825b152b0aff3f4b4d3ed9f2298 ; E3 deed0b385ed07c9253c076745e5f0b75. Aucun marquage historique D ni runner global.
- Zéro changement de données tarifaires vérifié par gardes no-op et empreintes ; 1409 faits inchangés (MD5 9b93a7acc7d70de1852df770db4dbb41), port_tariffs baeaca4d2f8771030736bb0a15c4148b. Aucun scénario v2 ; scope OID 197950 conservé, helper v2 OID 199196, ACL postgres+sandbox uniquement.
- Preuves détaillées externes : preparation-locale/delivery-cloud-results-20260915.json. Sauvegarde privée exclue du dépôt et des revues. Trois migrations locales de réconciliation/scénario comprises dans le commit du lot, source métier inchangée depuis revue.
- Suite autorisée : commit/push work, quotation-engine→run-scenario-pricing→manage-quote-scenario avec contrôles à chaque étape, recette privée sans envoi. Pas de création v2 pendant la fenêtre frontend/Edge.
- Retour : Edge coordonné puis rollback SQL seulement à zéro ligne v2 ; ledger conservé et nouveau numéro pour relivraison. Aucun rollback exécuté dans le Cloud.

#### Livraison scénarios — 15 septembre 2026, 10:39 UTC — PARTIAL, contrôle runtime incomplet

- Commit applicatif `450913bd40994d59ac5864243d2e5227f2b55d7a` poussé sur work ; 22 fichiers, +2103/-53. SQL B/E1/E2/E3 PASS ci-dessus, ne pas rejouer.
- Lovable a généré quatre lignes de types pour le helper v2 ; diff intégral contrôlé, aucun changement sous supabase/. Fast-forward local vers `1f5bc6a3c4fce3ed3b9c9a18405732ecf8c2cd7f`, sans annuler ces ajouts bénins.
- quotation-engine seule déployée : succès rapporté Lovable, sources Git Edge/shared identiques au commit 450913bd ; OPTIONS 200, POST sans authentification 401, interface Cloud Active.
- Bundle réellement déployé/version/empreinte non exposés par connecteur ou vue Cloud : NOT_VERIFIED. Ne pas présenter l'identité des sources Git comme une lecture du runtime.
- Arrêt avant run-scenario-pricing et manage-quote-scenario ; sonde métier authentifiée et recette NOT_RUN. Aucun scénario v2 à créer pendant cette fenêtre frontend/Edge.
- SELECT final 10:39:16 UTC : ledger 202, aucun scénario (v2 compris), 1409 faits. Première requête finale refusée sur nom de colonne scope, corrigée en scope_snapshot ; aucune écriture pendant ces contrôles.
- Tests conservés : PASS_WITH_BASELINE (échec SIFB CRLF reproduit sur baseline), pas de CI intégralement verte ; aucun correctif hors lot, Auth/RLS, tarif, fait, envoi ou publication publique.
- Suite : preuve runtime ou arbitrage explicite d'une preuve de remplacement (identité Git + déploiement confirmé + sondes authentifiées), puis deux Edge et recette sous le GO borné. Aucun rollback effectué ; SQL réversible seulement à zéro v2, ledger conservé.
- Entrée CTO_GO_QUEUE actualisée pour commit dédié ; cette note de roadmap reste locale jusqu'au prochain commit autorisé contenant du code, pas de commit docs-only supplémentaire.

#### Livraison scénarios — 15 septembre 2026, 10:46 UTC — PARTIAL, bundling Edge 2 FAIL

- GO utilisateur reçu sur preuve de remplacement sources Git + confirmation déploiement + sondes authentifiées ; bundle non relisible documenté, plus bloquant à lui seul. Préflight local/GitHub/Lovable `7708526` aligné ; projet privé/non publié, seule roadmap sale attendue.
- Sonde authentifiée moteur générique conforme : 1×20GP SOC, STANDARD, 10000 kg, DAP Dakar, valeur fictive 1000000 XOF ; HTTP200 success true, THC 155000 + transport 82600 = 237600 XOF indicatifs, postes non documentés TO_CONFIRM. Première sonde count au lieu de quantity exclue des preuves de calcul.
- Déploiement run-scenario-pricing refusé par bundler : Module not found ../manage-quote-scenario/domain.ts, import confirmé domain.ts:2. Deployed: none ; manage-quote-scenario non tentée, recette scénarios NOT_RUN. quotation-engine du tour précédent inchangée.
- Cause : tests sur dépôt complet, dépendance inter-fonctions absente du bundle isolé. Préparer sous GO un partage du validateur pur via _shared et un test de résolution dans le périmètre réel de chacun des trois bundles, sans changer les règles métier ni le moteur FROZEN.
- SELECT avant/après sondes 10:45:35→10:46:32 : ledger 202, scénarios/runs scénario 0, faits 1409, runs canoniques 171, versions 9 ; empreintes complètes facts et port_tariffs identiques (méthode to_jsonb documentée dans queue). Aucun fait client, tarif, Auth/RLS, SQL métier, envoi ou publication modifié.
- Queue actualisée pour commit dédié ; aucune correction applicative, aucun rollback. Ne créer aucun scénario v2 pendant cette fenêtre incomplète ; retour SQL seulement à zéro v2 et ledger conservé. Cette note reste locale jusqu'à commit applicatif autorisé.

#### Correctif assemblage scénarios — 15 septembre 2026 — PASS livré, recette métier PARTIAL

- GO utilisateur explicite : correctif ciblé, tests et reprise livraison privée ; aucune nouvelle migration ni modification tarifaire. Base work/local/GitHub `3170e98`, note de roadmap antérieure conservée.
- Domaine pur déplacé dans `_shared/quote-scenario-domain.ts`, ancienne façade export-star conservée, import run-scenario-pricing vers _shared. Comparaison automatisée ancien/nouveau identique après seule substitution du chemin d'import et normalisation EOL ; aucun changement de règle, Auth/RLS, moteur quotation-engine ou SQL.
- Nouveau `check:scenario-bundles`, intégré à npm run ci et GitHub Actions : copies isolées fonction+_shared, résolution Deno info 39/36/33 modules PASS, contrôle négatif de l'ancien import sibling refusé. Ce test vérifie la fermeture des dépendances, pas le compilateur Lovable ni le bundle effectivement déployé.
- Harnais Windows corrigé pendant développement : chemins d'entrée file:// et exigence d'un module ESM ; le contrôle négatif avait révélé le faux positif initial à un seul module. Aucun faux PASS conservé.
- 97 tests Deno ciblés PASS ; suite générale 378 frontend PASS, 1336 Deno PASS/1 FAIL/6 ignorés (SIFB CRLF identique baseline) ; types frontend/config/build PASS, dette Deno 49 et lint 737/16 inchangée. PASS_WITH_BASELINE, pas CI locale intégralement verte.
- Contre-revue Claude Code locale en lecture seule, session 4a747887-405b-4133-8ca2-b8e93ae4520b : GO technique avec deux réserves vérifiables levées localement (aucun export default, seuls imports résiduels dans tests). Première réponse CLI sans outils inexploitable écartée ; aucun résultat inventé repris. Aucun accès données client/backup, aucun droit d'écriture accordé.
- Livré sur work : `b3499cf22cdbac6fb3ec98fef97c3381c179c5a3`, 7 fichiers +1717/-1587. CI GitHub 34962663800 entièrement SUCCESS, nouveau gate inclus ; la réserve CRLF locale demeure distincte. run-scenario-pricing puis manage-quote-scenario déployées seules depuis ce SHA, identité supabase/ avant/après, OPTIONS 200 et sans auth 401 ; quotation-engine déjà déployée, non redéployée. Bundles runtime non relus, preuve de remplacement acceptée.
- Recette authentifiée générique du moteur PASS : groupes dangereux/reefer/danger inconnu séparés, THC 465000/1023000/à confirmer, total indicatif 1735800 XOF, honoraires 0, aucune persistance canonique. Sonde run-scenario-pricing vide : 400 VALIDATION_FAILED attendu.
- GoTrans créé/sélectionné via UI : scénario v2 `60081f2a-6ac9-4487-97fa-aa2739d94d05`, 39×20HQ SOC/13×20HQ SOC/3×40HQ COC ; bases opérateur explicites, UN3536→classe9 sourcé uniquement pour armoires, danger des autres groupes inconnu. Run `d2317567-4eb9-4cb8-8c89-aca932b06a86` HTTP200/status blocked : TERMINAL_OPERATION_MODE_REQUIRED, PAD_CATEGORY_REQUIRED, CARGO_VALUE_REQUIRED_FOR_SCENARIO_ENGINE ; moteur non appelé, aucun montant. Pas de recette positive GoTrans revendiquée.
- Réserve UI vérifiée : justification de 203 caractères acceptée par contrôle cargo frontend (plafond500), refusée par garde structurelle Edge (200), corrélation 25192814-4688-4759-a220-e7b5282033e8. Diagnostic local reproduit ; seul texte de recette raccourci, création suivante HTTP200. Harmonisation UI à prévoir, aucune garde serveur/SQL modifiée.
- Intégrité SELECT 11:20:58→11:32:33 UTC : scénarios/runs isolés 0→1/0→1 ; ledger202, faits1409 (MD5 393ff8e6bcdf748f3b61b329a2441d9e), port_tariffs MD5 235a655bf711e7ad8fc6c917f6419fee, pricing canonique171/versions9 inchangés. Aucun tarif/fait/Auth/RLS/migration/envoi/publication modifié ; projet observé workspace_edit, is_published=false, réglage publish_visibility=public non modifié.
- Retour v1 SQL désormais interdit en l'état : une ligne v2 existe, ledger conservé. Aucun rollback ni nettoyage effectué. Revert du correctif réintroduirait l'import inter-fonctions défaillant : ne pas le proposer comme redéploiement sain. Suite produit : estimation partielle isolée malgré données manquantes, sous lot/GO approprié, sans inventer catégorie PAD ou valeur client. Note de clôture locale non commitée ; queue dédiée publiée.

#### THC conteneur indépendante opérateur — 15 septembre 2026 — PASS livré, recette GoTrans PARTIAL

- GO utilisateur : calculer la manutention avec le barème validé indépendamment de l’opérateur ; annexes incertaines non chiffrées, jamais assimilées à zéro. Lot local, pas de GO publication déduit.
- Préflights début/fin : work local/GitHub `24b108eb29e23ee38add84db94708b72e8aba165` alignés ; note antérieure locale préservée. Aucun commit/push.
- Diff applicatif : run-scenario-pricing/{domain,index,handler_test}.ts + src/lib/scenarioPricing{,.test}.ts ; raccordement limité aux scénarios v2 MARITIME/CONTAINER Dakar IMPORT/TRANSIT avec DTHC demandée, sans branche spécifique GoTrans.
- THC : montant et référence tarifaire conservés, catégorie neutre DTHC ; opérateur/mode non inventés. Mode absent/RORO/CONRO ne bloque plus ce poste ; contradictions et fait terminal invalide bloquent toujours.
- Annexes terminal/magasinage : hors mode LOLO connu, amount/prix nul + TO_CONFIRM, exclus des totaux ; deux réserves persistées avant empreinte et libellés français. LOLO explicite conserve la baseline ; estimation reste provisoire, sans montant ferme revendiqué.
- Hors périmètre, garde terminal identique à HEAD ; moteurs quotation-engine/run-pricing et garde partagée inchangés. PAD/valeur restent bloquants : aucune recette positive GoTrans ni chiffrage partiel malgré ces blocages revendiqués.
- Tests exécutés : 94 Deno ciblés PASS (28 handlers dont replay éligible, absences/RORO/CONRO, contradictions, PAD/valeur, AIR/hors Dakar), 379 frontend PASS ; bundles isolés, types frontend, build, diff-check PASS ; dette Deno49 et lint737/16 inchangée, PASS_WITH_BASELINE. Suite Deno générale, CI distante et recette Lovable NOT_RUN ce lot.
- Contre-revue Claude Code locale Read-only : GO technique ; B1 régression alléguée retirée après comparaison baseline fournie par exécutant (extrait git show vérifié), non corrigée hors lot. Tests non rejoués par relecteur ; réserves LOLO/provisoire assumées, format JSON réserves SQL vérifié localement sans migration.
- Aucun changement DB/Auth/RLS, tarif, fait client, moteur gelé, runtime ou envoi. Retour arrière : retrait ciblé de ce diff local, sans toucher à la note antérieure ; aucune restauration Cloud. Suite : GO distinct commit/push work + frontend preview privée/run-scenario-pricing + recette contrôlée, sans SQL ni redéploiement quotation-engine.
- Livraison sous GO utilisateur reçu ensuite : work `24b108e`→`8b830eef01b4b0ddf0fd6d0f6bd898907f7b8802`, 6 fichiers +202/-22, push et CI GitHub34966509916 SUCCESS (toutes gates). Identité Git d’auteur Codex reprise des commits précédents pour cette seule commande, sans configuration globale ; première tentative sans identité n’avait créé aucun commit. Accès Git initial intermittent rétabli avant écriture.
- Lovable synchronisé sur ce SHA, privé workspace_edit/is_published=false. Seule run-scenario-pricing déployée, message umsg_01m2jf7we6eay962hyv60fcs74 ; succès outil, OPTIONS200/POST sans auth401 rapportés. HEAD/sources Git identiques avant/après, bundle runtime non relisible (preuve de remplacement acceptée). Deux TS2345 historiques run-pricing rapportées sans correction, aucun autre déploiement/migration.
- Recette UI authentifiée 12:05 UTC : scénario existant relancé sans modifier son périmètre, run2 `bc7dfecd-6af8-4e5e-9ffc-2cc6c828da8f`. Blocage terminal disparu ; deux réserves lisibles affichées et persistées. PAD_CATEGORY_REQUIRED/CARGO_VALUE_REQUIRED_FOR_SCENARIO_ENGINE seuls bloquants, moteur non appelé, totaux null ; recette de montant positif runtime NOT_RUN, pas de succès de chiffrage GoTrans revendiqué.
- Intégrité SELECT 12:02:10→12:05:55 : ledger202/scénarios1/faits1409/pricing canonique171/versions9 inchangés ; facts MD5 393ff8e6bcdf748f3b61b329a2441d9e et port_tariffs MD5 235a655bf711e7ad8fc6c917f6419fee identiques ; seul run scénario1→2. Première requête SELECT avec nom quote_pricing_runs erroné refusée sans écriture, reprise pricing_runs vérifiée au code. Aucun envoi. Rollback applicatif possible par revert8b830ee + redéploiement run-scenario-pricing (réintroduit garde terminal), aucun retour SQL ; note de clôture locale non commitée. Suite : préconditions PAD/valeur et estimation partielle sous lot ciblé.

#### Estimation principale par groupes — 15 septembre 2026 — PARTIAL local, non publié

- GO utilisateur : lot générique estimation par groupes et exception ciblée quotation-engine (nécessaire pour exclure le remplacement de valeur par 1 FCFA), tests et contre-revue, sans barème/fait client/migration/publication. Codex seul exécutant ; pas de nouveau GO demandé pour les raccordements compris dans ce lot.
- Préflights : work local/GitHub `8b830eef01b4b0ddf0fd6d0f6bd898907f7b8802` alignés et inchangés ; note précédente préservée. Aucun commit/push.
- Diff : quotation-engine/index, run-scenario-pricing/index et handler_test, _shared/scenario-cargo_test, CaseView, QuoteScenariosPanel et son test, PricingLaunchPanel et son test, scenarioPricing et son test ; aucune nouvelle dépendance ni fichier SQL.
- Mode opt-in DAP_SERVICES_ONLY : scénario v2 maritime validé, DAP explicite, aucun package DDP. Pas de CAF, droits/taxes douaniers ou total DDP ; absence de valeur préservée. Hors opt-in, parcours historique inchangé (y compris fallback historique du moteur, non généralisé comme corrigé).
- PAD non résolu devient une réserve dans ce mode uniquement, jamais un tarif inventé ; poste null/TO_CONFIRM exclu du sous-total. Réserves dans l'empreinte ; réponse d'un ancien moteur sans accusé du mode refusée, sans montant retenu. Gardes scénario/IMO/terminal/partenaire inchangées.
- Bouton principal « Estimer avec le scénario sélectionné » raccordé à la mutation isolée existante, anti-double-clic, aucune création/sélection au montage ; garde intention conservée. Calcul depuis faits validés distinct et toujours soumis à ses préchecks. Changement de dossier remonte le panneau avec identité neuve.
- Tests après ajustements : 80 Deno ciblés PASS (dont couture réelle faits→DTO→moteur, valeur/HS connus, transit et ancien moteur refusé) ; 386 frontend/21 fichiers, types frontend, configuration94 fonctions, bundles isolés39/36/33 modules et contrôle négatif, build et diff-check PASS. Types Deno49 et lint737/16 inchangés : PASS_WITH_BASELINE.
- npm run ci rejoué après ajustements : arrêt sur suite Deno1358 PASS/1 FAIL/6 ignorés, échec historique SIFB CRLF. Test et Intake identiques à origin/work ; motif LF absent sur CRLF et présent après normalisation en mémoire vérifiée, sans modification. Gates lint/build relancées séparément et PASS_WITH_BASELINE/PASS. Aucun test live.
- Contre-revue Claude Code Read-only du diff : GO technique, aucun bloquant prouvé, neuf réserves. Ajustements regroupés R2/R3/R5 (contexte, PAD ciblé, diagnostic), R6/R7 (sous-total, absence de socle ferme explicite, identifiant avant verrou et état calcul partagé) ; tests R1/R4/R9 ajoutés. Auto-revue/tests après ajustements, pas de nouvelle contre-revue générale ; relecteur NOT_RUN. Première invocation non démarrée (limite Windows), reprise via stdin réussie, aucun droit d'écriture.
- R1 explicité : le mode exclut les droits pour toute estimation v2 DAP/non-DDP, même valeur/HS connus ; c'est un périmètre de prestations, pas une exonération ou un défaut de données. R8 : conditions historiques de visibilité/statut du panneau conservées ; hors de ce panneau, voie scénario séparée inchangée. Propositions et automatisation ci-dessous restent à terminer avant clôture/publication du lot global.
- Suite locale traitée dans le complément ci-dessous : propositions PAD contextuelles et propositions de scénarios. Risque historique transport spécial55t non résolu ; aucun chiffrage positif GoTrans revendiqué.
- DB/Auth/RLS, faits client, barèmes, migrations, autres modules FROZEN et runtime inchangés ; recette Lovable et publication NOT_RUN. Retour arrière local : retrait ciblé de ce diff en préservant note antérieure, aucune restauration Cloud. Publication ultérieure à autoriser distinctement, quotation-engine avant run-scenario-pricing pour l'accusé du nouveau mode.

#### Complément propositions contextuelles — 15 septembre 2026 — PASS_WITH_BASELINE local, publication NOT_RUN

- GO existant confirmé par l'utilisateur : terminer les propositions PAD/scénarios génériques, tests et contre-revue, sans publication, migration, faits client ni barèmes. Codex seul exécutant ; Claude Code Read-only pour la revue.
- Préflights : work/HEAD/GitHub `8b830eef01b4b0ddf0fd6d0f6bd898907f7b8802` alignés au départ et à la clôture ; panne réseau GitHub intermédiaire résolue. Lot local antérieur présent et préservé. Aucun commit/push.
- Diff du complément : recommend-pad-category/{index,scenario-domain,scenario-proposal,scenario-proposal_test}.ts ; ScenarioProposalPanel et test ; scenarioProposal et test ; QuoteScenariosPanel et test ; texte PricingLaunchPanel ; roadmap. Lot cumulé : 20 fichiers, dont 7 nouveaux, aucune dépendance ni SQL ajouté.
- Nouvelle route authentifiée read-only sur recommend-pad-category : client anon + Authorization appelant pour chaque SELECT, accès dossier vérifié avant les e-mails, collection complète exigée. API historique conservée, dont ses lectures service_role ; aucune extension de droits/RLS.
- Proposition depuis listes numérotées en texte lisible de l'expéditeur client exact : groupes, SOC/COC, poids unitaire ou borne haute explicitée, ONU/classe strictement sur la ligne. Sources/corrections/équipements/IMO ambigus refusés ; ni photos ni MIME opaque interprétés, ni identité client déduite.
- Hypothèse import maritime Dakar explicitement affichée ; périmètres déclarés incompatibles ou non textuels refusés. Un appel IA groupé, extraits seuls avec adresses e-mail masquées et transfert annoncé ; contexte commun ne prouve pas une catégorie commune. Alias validés obligatoires, tarif de référence issu d'une source applicable unique, jamais du modèle.
- Sans sélection, bouton principal ouvre la proposition ; reprise explicite après relecture de l'empreinte dossier/fil/client/périmètre/e-mails. Brouillon v2 validé avec quantité justifiée et empreinte/source dans scenario_basis ; aucune création, sélection, promotion ou cotation automatique. Candidats PAD affichés seulement, non appliqués au calcul.
- Rejeu final : 393 tests frontend/23 fichiers PASS ; Deno global1396 PASS/1 FAIL/6 ignorés, dont 38 nouveaux tests propositions PASS. Unique FAIL historique SIFB CRLF : test et Intake identiques à origin/work, motif absent en CRLF et présent après normalisation en mémoire. npm run ci reste non vert pour ce seul test, sans le masquer.
- Types frontend, config94 fonctions, bundles isolés39/36/33 et contrôle négatif, build et diff-check PASS ; Deno49 erreurs/5 buckets et lint737 erreurs/16 avertissements inchangés : PASS_WITH_BASELINE. Graphe recommend-pad-category vérifié sans import hors dossier/_shared. Aucun test live, SQL ni recette Lovable exécutés.
- Claude : GO technique local, zéro blocage, huit réserves ; tests NOT_RUN par le relecteur. Corrections/tests regroupés R1/R3/R4/R5/R6/R7 : justification quantité, article français un, profils existants, motif HTTP, périmètre typé, information transfert IA ; vérification locale après ajustements, sans nouvelle revue générale.
- Réserves conservées R2/R8 : empreinte et UUID source influencent le scope_hash et les réserves de sorties internes (à filtrer/revoir avant toute future sortie client) ; annuler le formulaire nécessite une nouvelle proposition IA. 402/429/erreurs IA restent un diagnostic PAD indisponible, jamais un montant inventé. Source non exploitable : scénario manuel disponible.
- DB/Auth/RLS/barèmes/faits/runtime inchangés. Recette positive GoTrans et compatibilité réelle des corps e-mail du dossier NOT_RUN ; aucun succès métier live revendiqué. Retour arrière : retrait ciblé du complément local, en préservant le lot antérieur et les notes ; aucune restauration Cloud.
- Suite : GO distinct de publication regroupée du lot (commit/push work, preview privée, quotation-engine puis run-scenario-pricing, recommend-pad-category, recette contrôlée sans envoi). Les refus de compatibilité restent actifs pendant la fenêtre preview/Edge ; aucune nouvelle migration.

#### Livraison estimation/propositions — 15 septembre 2026 — PASS livraison privée, recette métier PARTIAL

- GO utilisateur « oui si c'est une amélioration » : commit/push work, preview privée, quotation-engine puis run-scenario-pricing puis recommend-pad-category, recette sans migration ni envoi. Aucun nouveau périmètre applicatif ouvert.
- Git 8b830eef→7b7b56e086cdc0e35f4f3f199fc22dde24b32ef1 ; 20 fichiers +1092/-55, dont 7 nouveaux. Push réussi, GitHub et Lovable alignés, worktree applicatif propre. Premier commit refusé faute d'identité locale, repris avec l'identité Codex <noreply@openai.com> vérifiée dans l'historique, paramètres limités à la commande ; aucune config globale modifiée.
- Prépublication rejouée : 393 frontend/23 fichiers PASS, Deno1396 PASS/1 FAIL SIFB CRLF historique/6 ignorés ; types Deno49 et lint737/16 inchangés, types frontend/build/config94/bundles isolés PASS. CI GitHub 34977483065 SUCCESS (34977481506 annulée, pas un échec de tests).
- Sources Git des trois entrées Edge + deux modules de proposition relues dans Lovable et comparées exactement aux blobs locaux : identiques ; arbre supabase 0537c0b67e29517041241f2e29d5c347360ffaca avant/après chaque étape, aucun code modifié par Lovable.
- Déploiements confirmés successivement : quotation-engine umsg_01m2jna46wedvb4eedsa03b8h8 ; run-scenario-pricing umsg_01m2jnftj9f40t2w1a8f2qze0f ; recommend-pad-category umsg_01m2jnjegme33szxq090fysgzd. Sondes Codex propres pour chacune : OPTIONS200, POST{} sans Authorization401. Preuve de remplacement acceptée ; empreinte bundle runtime non accessible, NOT_VERIFIED.
- Projet workspace_edit, is_published=false, ready ; nouvelle interface visible. Dette Deno du journal Lovable hors modules modifiés rapportée sans correction, build Vite réussi ; pas de généralisation du seul compteur local49 aux diagnostics d'un autre périmètre.
- Recette authentifiée UI GoTrans : bouton principal → run3 75f5f538-09f9-4bf7-b801-585c9e8e7ca7 à 13:56:55 UTC, status success/qualification partial, zéro blocker. Accusé moteur DAP_SERVICES_ONLY, caf null, duties_excluded true et totals_scope PRICED_SERVICES_ONLY réellement persistés.
- Sous-total indicatif HT/TTC 9067500 XOF = seule THC des 39 armoires (39×232500). Aucun montant ferme démontré affiché ; pas un devis complet. THC des 13 transformateurs/3 conteneurs pièces null (danger inconnu) ; transport N'Dioum null/DESTINATION_UNKNOWN ; PAD, retour vide, douane, agence, magasinage et surestaries restent non chiffrés, jamais assimilés à gratuits.
- Proposition e-mail authentifiée : refus lisible CLIENT_SOURCE_UNVERIFIED, sans nouveau scénario/fait. Fil GoTrans client_email non renseigné (3 e-mails), malgré contacts.client_email visible dans les faits ; aucune correction de données entreprise. Recherche métadonnées d'un autre dossier répondant aux préconditions initiales du parseur : aucun résultat ; première requête enum mal castée refusée, reprise SELECT ::text réussie, aucune écriture.
- Recette positive de propositions PAD/groupes sur données Cloud existantes NOT_RUN ; les 38 tests synthétiques correspondants passent localement. Limites sources/texte/identité déjà annoncées conservées, pas de fixture Cloud créée ni de donnée client inventée.
- Intégrité 13:46:34/13:47:56→13:57:42 UTC : ledger202, faits1409/MD5 393ff8e6bcdf748f3b61b329a2441d9e, port_tariffs235a655bf711e7ad8fc6c917f6419fee, carrier4702b8f737ec040591dabd4ce5f2b196, transport466371db155f9900125d30115589f44c inchangés ; scénarios1, pricing canonique171, versions9, brouillons45 inchangés ; runs isolés2→3 uniquement.
- Aucun Auth/RLS, barème, fait client, migration, publication publique, PDF ou envoi modifié/créé. Le risque transport spécial55t demeure différé ; le sous-total ne constitue pas une validation transport.
- Rollback possible par revert ciblé du commit et redéploiement coordonné des trois Edge, en conservant les données historiques ; aucun rollback exécuté, aucune restauration SQL nécessaire. Une ligne scénario v2 existe : retour SQL v1 toujours interdit.
- Suite utile : raccorder la provenance client et la lecture des e-mails existants pour rendre les propositions exploitables, puis compléter les seuls postes encore non chiffrés. Aucun correctif supplémentaire ni nouvelle boucle de revue entrepris. Note de clôture locale non commitée (pas de commit docs-only).

#### Estimation cohérente / PAD scénario v3 — 15 septembre 2026 — PARTIAL local, runtime NOT_RUN

- GO utilisateur : parcours cohérent, extension contrat scénario/migration locale/run-scenario-pricing, tests et contre-revue ; aucun barème/fait client, Cloud, commit, push ou déploiement autorisé dans ce lot.
- Préflight : `work`, HEAD/GitHub `7b7b56e086cdc0e35f4f3f199fc22dde24b32ef1` inchangé ; note précédente de 17 lignes préservée. Diff applicatif : 28 fichiers +770/-44, dont 10 nouveaux, plus cette clôture documentaire.
- Sources : repli sur contacts.client_email existant, scalaires contradictoires refusés, métadonnées distinguées ; texte MIME complet UTF-8/base64/QP, pièces jointes/HTML/ambiguïtés refusés ; fingerprint et vérification fraîche conservés, aucun fait écrit.
- Contrat v3 : choix PAD par unit_ref, catégorie/null et justification, aucun montant ; v1/v2 conservés. Sans choix PAD, proposition v2 ; avec choix, import maritime v3, calcul DAP isolé, autre périmètre refusé explicitement sans ignorer les choix.
- PAD : source catalogue courante unique et poids par groupe ; honoraires AGENCY/CUSTOMS_DAKAR via résolveur H2 inchangé, une seule fois, sans CAF fictive. Données/tarifs inconnus ou catalogues incomplets restent réservés, jamais gratuits ; TVA existante selon la ligne.
- UI : choix PAD explicite, résultat détaillé du scénario sélectionné près du bouton principal, ancien résultat marqué pendant échec/relance ; devis canonique séparé et historique conservé. Pas de nouvelle assimilation IMO/non-DG ni transport exceptionnel inventé.
- SQL `20260915150000` : helper v2 conservé, wrapper v3, OID/ACL/propriétés d'exécution d'entrée préservés ; clone nettoyé et ACL bornées, empreinte corps gardée au replay. Aucun changement de table/policy ni réécriture de ligne.
- PostgreSQL17 synthétique sans réseau/port : upgrade/replay, CHECK préexistant, snapshots/hash/open points v2 et OID/ACL/propriétés PASS ; 11 invalides v3 refusés, catégorie inconnue admise, tests SQL v2 PASS. Refus atomiques PUBLIC/anon/authenticated/service_role et empreinte helper altérée PASS ; appels sandbox autorisés, privilèges existants préservés.
- Tests : frontend401 PASS, typecheck/config94/bundles39-43-34+contrôle négatif/build PASS ; Deno1410 PASS, 1 FAIL SIFB CRLF et6 ignorés. Fichiers de ce FAIL inchangés vs origin/work, recherche LF échoue en CRLF et réussit après normalisation en mémoire : PASS_WITH_BASELINE, pas de CI brute verte revendiquée.
- Typage Deno49 erreurs/5 buckets et lint737 erreurs/16 warnings sans aggravation. Après corrections finales catalogue/devise, ciblés87 Deno puis45 serveur PASS, typage Deno baseline PASS ; aucun test live exécuté.
- Contre-revue Claude Code Read/Glob/Grep uniquement : B1 terminal v3 et B2 bascule v3 sans choix identifiés, corrigés et LEVÉS à la revue ciblée ; aucun test exécuté par le relecteur. N3 catalogues/N4 métadonnées corrigés ; ergonomie v3 et invalidation après changement de faits restent non bloquantes différées.
- Correction N2 post-relecture : schéma Git/types vérifiés sans colonne port_tariffs.currency, contrat PAD existant FCFA/t conservé et requête de colonne inexistante interdite par tests ; devise étrangère honoraires réservée. Ces dernières adaptations sont testées par l'exécutant, sans troisième revue générale.
- Aucune modification quotation-engine/run-pricing/price-service-lines, Auth/RLS, barèmes, faits ou runtime ; aucune sauvegarde client transmise à Claude. Validation migration dans le schéma complet, ACL réelles fraîches et recette Lovable NOT_RUN : aucune livraison déclarée prête sur les seules fixtures.
- Suite sous GO local : terminer validation d'intégration SQL/retour arrière borné ; préflight catalogue/ACL en lecture seule avant demande de GO publication regroupé. Ne pas révoquer de droit réel pour contourner un préflight ; ne pas rouvrir la méthode de revue.
- Retour arrière : retrait ciblé du diff local en préservant la note antérieure ; bases synthétiques conservées dans le conteneur local arrêté `dcq-pad-v3-local-20260915`, aucune restauration Cloud requise ou exécutée.

#### PAD v3 — schéma complet et retour arrière — 15 septembre 2026 — PASS local / publication NOT_RUN

- GO local confirmé : validation d'intégration et retour arrière seulement ; `work`, HEAD/GitHub `7b7b56e086cdc0e35f4f3f199fc22dde24b32ef1` inchangé, lot applicatif antérieur préservé.
- Diff de ce tour : ajustement de `20260915150000_scenario_pad_v3.sql`, ajout du rollback homonyme, de `supabase/tests/scenario_pad_v3_full.sql` et de `scripts/scenario-pad-v3-integration.mjs`, plus cette note.
- Archive privée du 15/09 09:27 restaurée intégralement dans PostgreSQL17, réseau/ports absents, données en tmpfs ; archive originale SHA256 `083d722e534132f47e6bd3bfab9e2f5aa82ae6165bb7f21ee3db61a802d07603` intacte et non transmise au relecteur.
- ACL réelle restaurée : entrée v2 autorisant service_role conservée sans modification ; copie vers le nouveau helper exclut PUBLIC/anon/authenticated/service_role au lieu de refuser le droit préexistant. Aucun droit utilisateur, RLS ou barème modifié.
- Préparation locale B→E1→E2→E3, ledger198→202, avec seules substitutions OID/catalogue local après égalité sémantique ; artefacts Cloud antérieurs inchangés. Un essai E3 a refusé avant v3, cause non établie ; arrêt respecté, non reproduit sur restauration fraîche, aucune garde forcée.
- Répétition finale PASS : migration/replay, ledger203, vrais RPC create/replay/select/revise/record, refus fingerprint et montant injecté, conservation du scope original et du snapshot de pricing après révision.
- Permissions PASS : helper inaccessible à PUBLIC/anon/authenticated/service_role, écritures directes scénario/pricing interdites ; fixture autonome BEGIN/ROLLBACK. Aucun appel HTTP ni calcul Edge réel dans cette recette SQL.
- Rollback PASS : accusé et deux empreintes requis, refus atomique sans accusé/sur empreinte altérée/avec historique v3 ; verrous et recherche JSON récursive (racine comprise), restauration v2 exacte à zéro v3, helper retiré et ledger203 conservé.
- Empreinte des 163 tables / 66 499 lignes inchangée après migration, tests et rollback : `ec89975687e59b7a0b9cfce2e2199a5f`. Catalogue fonctions scénario, OID/ACL/propriétés et protections RLS/table identiques après retour arrière.
- Contre-revue Claude Code en lecture seule : aucun bloquant migration/rollback ; renforcements de fixture et assertions permissions/catalogue intégrés puis répétition complète PASS. Empreintes dérivées du test uniquement, pas des pins Cloud approuvés.
- Contrôles exécutés : intégration complète, JSONPath racine/imbriqué, node --check, git diff --check et config94 PASS ; lint737 erreurs/16 warnings baseline inchangé. Suite applicative complète non relancée ce tour ; résultats du lot précédent ci-dessus, test:deno:live NOT_RUN.
- Publication/recette Lovable NOT_RUN ; aucun commit/push/Cloud/déploiement/envoi. Prochaine étape : préflight catalogue/ACL/ledger Cloud frais en lecture seule et GO de publication distinct ; l'archive ne prouve pas l'état Cloud actuel.
- Retour arrière SQL possible uniquement à zéro historique v3, sans effacement du ledger ; toute relivraison après rollback exige un nouveau numéro. Aucun scénario v3 pendant la fenêtre de livraison. Copie locale de restauration arrêtée après validation ; archive originale conservée.

#### PAD v3 — préflight Cloud — 15 septembre 2026, 16:06 UTC — PASS borné / publication NOT_RUN

- GO utilisateur limité aux contrôles Cloud en lecture seule et présentation du GO de livraison distinct. Queue historique examinée : aucun nouveau GO tarif/runtime déduit des anciennes entrées PENDING.
- Local/GitHub/Lovable alignés `work@7b7b56e086cdc0e35f4f3f199fc22dde24b32ef1` ; lot local présent et préservé. Projet `workspace_edit`, ready, `is_published=false` ; base activée, exécuteur SQL postgres.
- SELECT Cloud : ledger202, dernière version20260914120000 ; version20260915150000 et helper `quote_scenario_scope_v2_violation(jsonb)` absents. Aucun historique v3 dans toutes les colonnes JSONB des tables quote_scenario* et quotation_versions ; 1 scénario, 4 runs isolés, 9 versions existantes.
- 23 corps de fonctions scénario/RPC correspondent aux migrations Git attendues après seule normalisation CRLF→LF. Entrée v2 OID197950, postgres, invoker/immutable/parallel safe, proconfig null ; SHA256 pg_get_functiondef `8aa48bf1f46f6fe8b819efe73592e425fe748898d64860dfa2c2319357dc5e73`.
- ACL entrée : postgres/service_role/sandbox_exec_snjewofqxfsdmaszapux, EXECUTE par postgres sans délégation ; helper cargo v2 : postgres+sandbox uniquement. ACL par défaut public identique au cas restauré testé. RPC mutation/pricing SECURITY DEFINER avec search_path public,pg_temp ; aucun droit direct INSERT/UPDATE/DELETE pour anon/authenticated/service_role sur scénario/run/mutation vérifiés ; RLS active sur toutes les tables inspectées.
- Faits1409 MD5 `393ff8e6bcdf748f3b61b329a2441d9e`, port_tariffs219 MD5 `235a655bf711e7ad8fc6c917f6419fee`, identiques aux preuves antérieures avec la même formule. Aucun contenu client extrait ; vérification JSONPath racine PASS.
- SHA256 fichiers locaux : migration `902bc6296bd6ccaa7927178fa6d5874cec99166633611d68155b441591aff366`, rollback `de369b583c8bc2d7431bdeba9e3ca3446c0b31d89d7a6842ef3ddf542fa785a1`. Contrôles frais à répéter avant écriture ; ces observations ne sont pas une preuve de déploiement Edge.
- Diff de ce tour limité à cette note ; code/tests/migration inchangés, tests applicatifs NOT_RUN ce tour. Aucune écriture Cloud, aucun commit/push/déploiement/envoi ; aucun rollback exécuté.
- GO distinct proposé : préflights frais et contrôle transport ; migration20260915150000 + enregistrement ledger atomiques via Lovable Cloud (202→203), commit/push work/preview privée, déploiements manage-quote-scenario → run-scenario-pricing → recommend-pad-category avec sources/sondes vérifiées, recette contrôlée générique puis GoTrans. Arrêt au premier échec/dérive ; aucun scénario v3 pendant la fenêtre, aucun tarif/fait client modifié ni envoi. Rollback v2 seulement à zéro historique v3, ledger conservé ; après rollback, nouvelle version de migration obligatoire.

#### PAD v3 — livraison privée — 15 septembre 2026, 16:35 UTC — livraison PASS / recette PARTIAL

- GO utilisateur explicite : migration/enregistrement, commit/push work/preview privée, manage-quote-scenario → run-scenario-pricing → recommend-pad-category, vérifications et recette ; aucun envoi/fait/barème. Préflight Git/Lovable aligné `7b7b56e`, périmètre local préservé.
- Transport SELECT : 6199 octets, SHA256 `902bc6296bd6ccaa7927178fa6d5874cec99166633611d68155b441591aff366`, MD5 `ee68364fa607c9946582404a8b22c3d3`, identiques au fichier relu/testé. Préflight frais des 23 fonctions/ACL/OID/ledger/zéro v3 PASS.
- Migration20260915150000 appliquée via query_database à 16:16:19 UTC, accusé `REVIEWED_PAD_V3_DELIVERY_20260915` ; garde catalogue/ledger reprise dans la transaction, timeouts3s/30s, enregistrement source atomique ; ledger202→203. B/E1/E2/E3 antérieurs non rejoués.
- Postcheck indépendant16:16:40 : source ledger SHA256 exacte, OID entrée197950 et ACL/propriétés conservés ; seul wrapper modifié + helper ajouté. Faits1409 MD5 `393ff8e6bcdf748f3b61b329a2441d9e`, port_tariffs MD5 `235a655bf711e7ad8fc6c917f6419fee` inchangés ; zéro historique v3.
- Pins de définitions pour rollback éventuel : wrapper `15fd28047c922d15d62de9871338ab0d4dc8736a8b3c1c8554e36089a65ee9da`, helper `f3d50bbfda2c5b42c84ec2a59fa47b3584e191e85bbaed77d854ffd74937f2f0` ; helper OID199242, ACL postgres+sandbox uniquement. Aucun rollback exécuté.
- Contrôle bundles interrompu ENOENT (deno absent PATH), puis PASS avec Deno2.9.5 déjà installé et DENO_BIN explicite :39/43/34 et contrôle négatif ; config94, typecheck frontend, 401 tests/24 fichiers, build et diff-check PASS. Suite Deno complète et test:deno:live NOT_RUN ce tour ; preuves locales antérieures conservées.
- Commit applicatif `1d04d7c6` (32 fichiers,+1052/-44), push work ; Lovable ajoute seulement 4 lignes de types générés (`7d742e0`) puis commit vide : HEAD local/GitHub/preview `c9f37b7c`. Arbre supabase inchangé `14ca18b9b60ebd629b6c2213849f01fced8c1428`, différences générées relues et fast-forward accepté.
- Déploiements réels confirmés dans l'ordre manage-quote-scenario → run-scenario-pricing → recommend-pad-category ; sources avant/après identiques et sondes indépendantes OPTIONS200/POST sans auth401. Troisième étape reprise après résumé sans preuve, appel réel confirmé par `umsg_01m2jyajzhecg8y0n1cytkp96y` ; bundle runtime non accessible, preuve de remplacement seulement.
- Recette UI générique : titre vide refusé, formulaire aérien accessible sans conversion maritime ; annulation sans création. Calcul générique positif NOT_RUN. Interface résultat sélectionné / ancien devis distinct vérifiée.
- Recette GoTrans FAIL à la proposition : identité client retrouvée, puis CARGO_LIST_REQUIRED. E-mail initial stocké en segments base64 séparés par marqueur MIME, sans en-têtes Content-Type/Transfer-Encoding : proposalPlainBody le renvoie comme texte brut ; aucune ligne numérotée détectée. Décodage diagnostique du premier segment retrouve exactement les 3 lignes client ; aucune source modifiée, aucun groupe saisi manuellement pour contourner le défaut.
- Arrêt avant création/calcul v3 et sans correctif runtime supplémentaire. Contrôle16:33 UTC : ledger203, zéro historique v3,1 scénario,9 versions, faits1409/tarifs219 ;5 runs v2 contre4 initialement, le run supplémentaire était déjà visible avant notre recette. Pas de nouvelle écriture de fait/barème/Auth/RLS ni envoi ; preview workspace_edit, is_published=false.
- Suite bornée : adapter/tester la lecture du format historique réellement stocké, sans nouvel objet DB ni modification du message source ; reprendre ensuite le parcours complet. Rollback SQL non exécuté, seulement à zéro historique v3 avec pins ci-dessus, ledger conservé et nouveau numéro obligatoire après retour arrière. Note de clôture locale non commitée (pas de commit docs-only).

#### Lecture historique des e-mails — 15 septembre 2026, 17:16 UTC — livraison PASS / recette fonctionnelle PASS, couverture métier PARTIAL

- GO utilisateur sur correctif ciblé de lecture historique, tests et reprise de recette ; préflight local/GitHub aligné `work@c9f37b7c`, note de clôture précédente conservée. Aucun GO de migration, fait/barème ou changement FROZEN déduit.
- Périmètre applicatif : `recommend-pad-category/scenario-source.ts` et ses deux tests `scenario-source_test.ts` / `scenario-proposal_test.ts` ; cette roadmap. Aucun importeur IMAP, handler d'accès, moteur ou frontend modifié.
- Lecteur des deux alternatives base64 privées de leurs en-têtes : décodage strict/canonique UTF-8 et comparaison intégrale texte/HTML, sans rendu ni réseau. Texte original complet retourné ; formats ambigus, variantes contradictoires, marqueurs de troncature/HTML incomplet, binaire, scripts/commentaires et alt d'image non vide refusés. Pixels non interprétés, restriction TEXT_ONLY déjà explicite dans l'UI ; aucune prétention d'inventaire exhaustif des pièces. Normalisation de présentation pour comparaison seulement, aucun texte source réécrit.
- Reproduction initiale : 18 nouveaux tests échouent sur l'ancien lecteur. Après corrections regroupées,68 Deno ciblés PASS ;18 tests UI ciblés puis401 frontend PASS ; typecheck/config94/build/bundles39-43-34 et contrôle négatif PASS. Une erreur lint introduite a été corrigée sans relever la baseline.
- Rejeu Deno complet final1436 PASS/1 FAIL SIFB CRLF/6 ignorés : assertion LF échoue, normalisation mémoire CRLF réussit ; Intake/test identiques à origin/work. Types Deno49/5 buckets, lint737/16 inchangés : PASS_WITH_BASELINE. test:deno:live NOT_RUN.
- Relecture locale du corps réel30489 caractères, reconstruction en mémoire byte-identique : proposed, groupes39×20HQ/13×20HQ/3×40HQ, poids55000/18000/15000kg ; IMO9 seulement premier groupe, autres dangers inconnus. Aucun contenu/contact client ajouté aux fixtures ou transmis à Claude.
- Contrôle Cloud SELECT16:46 UTC : ledger203 ; empreintes md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)) faits `393ff8e6bcdf748f3b61b329a2441d9e` et tarifs `235a655bf711e7ad8fc6c917f6419fee`, identiques aux preuves antérieures.
- Contre-revue indépendante Claude Code Read/Glob/Grep uniquement : B2 (Bonjour + séparateur) corrigé/testé, N1 (copie HTML répétée) remplacé par regex sticky/test6000 balises ; B1 images sans alt requalifié NON BLOQUANT après lecture du contrat UI TEXT_ONLY, sans forcer un blocage des signatures/photos. Revue ciblée finale GO technique, aucun blocage ; tests du relecteur NOT_RUN. Tentative Write de plan refusée par restriction d'outils, aucun fichier du relecteur écrit.
- Réserves non bloquantes : HTML volontairement strict, coupe historique parfaitement alignée indétectable, jeton initial isolé ressemblant au base64 pouvant être refusé ; aucune classification automatique des pixels. Aucun nouveau ticket/chantier ouvert.
- Aucun commit/push/déploiement/écriture Cloud ce tour ; GO de publication distinct demandé pour commit/push work + recommend-pad-category seule puis recette, réponse attendue. Recette authentifiée avec correctif NOT_RUN. Retour arrière local : retrait des trois diffs applicatifs seulement, note précédente conservée ; aucun rollback SQL nécessaire.
- Clôture : HEAD local `c9f37b7c` inchangé ; accès GitHub443 échoue lors des deux derniers ls-remote, après alignement vérifié en début et pendant le tour. Aucun écart Git prouvé ; préflight distant frais obligatoire à la reprise avant commit/push/déploiement.
- Reprise publication, GO utilisateur explicite reçu : commit/push work, recommend-pad-category seule et recette, sans migration/envoi. Préflight frais local/GitHub/Lovable aligné `c9f37b7c`, accès rétabli, preview privée ;68 tests ciblés et diff-check rejoués PASS avant commit. Résultat de déploiement/recette à consigner après exécution.
- Livraison : `c9f37b7c`→`4d2dc59b` sur work,4 fichiers,+206/-8 ; arbre supabase `90a58be7f081a8e052ae82ae465765ace63a0cae`, GitHub/Lovable alignés. Appel réel deploy_edge_functions recommend-pad-category seule confirmé dans `umsg_01m2k0t3pse9a9s08qhzgzbjjd`, succès et sources identiques avant/après ; sondes indépendantes200/401 PASS. Bundle runtime NOT_VERIFIED ; deux TS2345 historiques run-pricing rapportées sans correction, frontend200. Aucun autre Edge/publication publique.
- Recette authentifiée17:14–17:15 PASS : proposition depuis l'e-mail historique→contrôle empreinte→brouillon→création/sélection v3 `ed060b67-2d61-48fc-87d6-fe074f991296`→bouton principal→exécution1 enregistrée17:15:36. Groupes39/13/3 et IMO9 premier lot seulement ; PAD T02 retenu comme hypothèse sur transformateurs/pièces, aucune catégorie choisie pour armoires. Sous-total HT9617500/TTC9716500 : THC9067500 + honoraires350000 + agence200000, sans CAF ni droits/taxes douaniers. Aucun test générique positif Cloud supplémentaire ni devis confirmé/envoi.
- Couverture métier PARTIAL : suggestion armoires→mobilier de bureau inadéquate au contexte UN3536, non retenue ; sources PAD uniques applicables non vérifiées pour T02, THC lots2/3 réservée pour danger inconnu, transport N'Dioum/annexes/surestaries/retour vide non chiffrés. Aucun contournement ni correctif supplémentaire. Suite utile : diagnostic ciblé des suggestions contextuelles et de la sélection des sources PAD, pas nouvel audit général.
- Postcheck SELECT17:16 : ledger203, faits1409/tarifs219 et deux empreintes ci-dessus inchangés ; scénarios1→2, runs5→6, versions9 inchangées. Aucune migration/Auth/RLS/fait/barème/envoi ; note de clôture locale non commitée. Rollback correctif par revert applicatif+redéploiement recommend seule ; rollback SQL v3 désormais indisponible sous la garde zéro historique v3, aucune suppression/retour SQL exécuté. Incident Git443 transitoire après sondes, contrôle distant suivant aligné4d2dc59b.

#### PAD contextuel et unité catalogue — 15 septembre 2026 — PASS local / publication et recette NOT_RUN

- GO publication utilisateur reçu : commit/push work, recommend-pad-category puis run-scenario-pricing en privé, recette contrôlée ; sans migration/envoi. Préflight frais 17:43 UTC : Git/Lovable alignés 4d2dc59b ; ledger203, faits1409 et tarifs219 aux empreintes inchangées. 116 tests ciblés rejoués PASS (Deno du cache npm explicite après absence du PATH), diff-check PASS.
- GO utilisateur explicite : correction compréhension PAD + lecture tarif, exception ciblée run-scenario-pricing, tests/contre-revue ; aucun tarif/fait/migration/publication. Préflight work local/GitHub aligné `4d2dc59b`, note de clôture précédente préservée ; HEAD inchangé.
- Périmètre : 7 fichiers applicatifs,+123/-26 (nouveau `_shared/scenario-pad-tariff.ts` inclus) : domaine/orchestration/test recommend-pad-category, lecteur/test PAD et fixture handler run-scenario-pricing ; cette roadmap. quotation-engine, run-pricing, Auth/RLS, importer et contrats SQL inchangés.
- Prédicat PAD commun : PER_TONNE stocké reconnu, synonymes historiques conservés ; aucun montant converti/modifié, montant numérique positif seulement comme avant. Identifiant non vide, source/niveau/dates/devise implicite XOF/import/conteneur et unicité toujours exigés ; source brute préservée. Zéro tarif reste non retenu, aucune doctrine d'exonération introduite.
- Contexte de désignation ONU initialement borné à UN3536, source titre public IMO IMDG2024 `https://imo-epublications.org/content/books/9789280117974.UNNo3536` vérifiée par recherche officielle (ouverture directe timeout). Désignation/source transmises et montrées dans la proposition, sans correspondance ONU-PAD ni propagation du danger/nature entre lots ; autres ONU sans désignation inventée.
- Filtre lexical de compatibilité mobilier/équipement électrique et consigne IA contextuelle : batterie/UN3536 prioritaire, simple storage cabinets insuffisant pour mobilier, vrais chairs/desks/ameublement préservés ; tests génériques indépendants du client. Aucun choix PAD/fait/scénario enregistré automatiquement.
- Preuve rouge : 5 tests échouent sur ancien code avec fixture PER_TONNE ;75 ciblés finaux PASS et41 handler PASS avec fixture catalogue réelle. Frontend401/24 PASS ; config94, bundles39/44/34+contrôle négatif, typecheck/build/diff-check et eslint ciblé PASS.
- Deno complet1439 PASS/1 FAIL SIFB CRLF/6 ignorés ; fichiers Intake/test byte-identiques à origin/work, assertion LF fausse sur CRLF et vraie après normalisation mémoire. TypesDeno49/5 buckets et lint737/16 inchangés : PASS_WITH_BASELINE, pas CI entièrement verte. Dernier ajustement lexical couvert par75 ciblés rejoués ; test:deno:live NOT_RUN.
- Contre-revue Claude Code Read/Glob/Grep sans MCP : GO, aucun blocage. Réserves ameublement/chairs traitées puis revue limitée aux ajustements et fixture handler : GO de clôture. Tests du relecteur NOT_RUN ; aucun fichier écrit par lui. Sessions18c0a970 puisdc5f3fb4 terminées.
- Limites : lexique de compatibilité non exhaustif, pas classification métier universelle ; choix opérateur conservé, justification scénario plafonnée à200 caractères par contrat existant. Autres lecteurs PAD et prestations non chiffrées hors lot ; aucun tarif nouveau, aucune source absente inventée.
- Aucun commit/push/Cloud/DB/Auth/RLS/runtime/envoi ce tour. Rollback local : retrait des seuls7 diffs applicatifs du lot, note précédente préservée ; pas de rollback SQL. Suite : GO distinct commit/push work + recommend-pad-category puis run-scenario-pricing en privé et recette contrôlée, sans migration/envoi.

#### Livraison PAD contextuel et unité catalogue — 15 septembre 2026 — PASS borné / cotation complète PARTIAL

- GO publication utilisateur exécuté : douania/dakar-cargo-quotes, work `4d2dc59b → d1250f82` ; 8 fichiers,+142/-27, dont 7 applicatifs,+123/-26. GitHub/Lovable alignés, tree supabase `7d3135256a377a495011390108d298af3628f932`, worktree propre avant note de clôture locale.
- 116 tests ciblés frais PASS ; autres preuves et dette PASS_WITH_BASELINE détaillées au lot précédent. Tests génériques locaux ; recette Cloud générique supplémentaire et test:deno:live NOT_RUN.
- Deux appels réels Lovable deploy_edge_functions successifs : recommend-pad-category puis run-scenario-pricing, retours « Successfully deployed edge functions ». Sources Git identiques avant/après chaque appel ; sondes indépendantes OPTIONS200/POST sans auth401 pour chacune. Bundle runtime non accessible, aucun hash de bundle prétendu.
- Recette authentifiée : proposition fraîche UN3536 → contexte batteries sourcé, candidat T02, plus de mobilier sur les armoires ; tarifs de référence visibles 9678 FCFA/t. Pièces : candidats T02/T13, donc choix humain toujours nécessaire, aucune propagation automatique de classe IMO.
- Bouton principal du scénario v3 existant : exécution2 enregistrée 17:49:13 UTC ; PAD lots2/3 =2264652/435510 XOF (avant null), sous-total indicatif HT12317662/TTC12416662 (avant HT9617500/TTC9716500). Source PAD et réserves conservées ; lot1 reste sans choix enregistré. Proposition nouvelle non appliquée, aucun nouveau scénario.
- Contrôle 17:49:47 UTC : ledger203, faits1409/md5 `393ff8e6bcdf748f3b61b329a2441d9e`, tarifs219/md5 `235a655bf711e7ad8fc6c917f6419fee` inchangés ; scénarios2, versions9 inchangés ; seules exécutions scénario6→7. Aucun fait/barème/Auth/RLS/migration/envoi/publication publique ; preview privée ready.
- Limites : cotation encore partielle (PAD armoires à choisir, danger lots2/3 inconnu, transport hors barème et frais annexes non chiffrés). Deux TS2345 historiques run-pricing signalées par Lovable sans modification ; aucun nouveau blocage du lot.
- Rollback code possible par revert ciblé d1250f82 et redéploiement des deux fonctions, sans rollback SQL ni effacement du calcul audité. Note de clôture locale non commitée ; suite utile : choix PAD explicite des armoires puis couverture des prestations restantes, hors de cette livraison.

#### Cockpit estimation lisible — 15 septembre 2026 — PASS local / publication et recette Cloud NOT_RUN

- GO utilisateur : résultat principal, postes à compléter, devis confirmé distinct, détails repliés et messages lisibles ; UI/tests uniquement, aucun moteur/fait/barème/migration/publication. Préflight local/GitHub work aligné d1250f82 ; note de clôture PAD précédente conservée. HEAD inchangé.
- Périmètre : CaseView, PricingLaunchPanel, ScenarioEstimateResult, présentation pure scenarioPricing, leurs tests (dont nouveau cockpit-layout) ; cette roadmap. Aucun fichier sous supabase ni contrat/guard serveur modifié.
- Estimation déplacée en tête ; montant/date/état courant, bouton actualiser et accès explicite groupes/PAD. Gap dossier libellé et rangé avant devis confirmé, jamais fermé ni converti en fait. Diagnostics, coordination, scénarios alternatifs et sources accessibles en sections repliées, panneaux maintenus montés.
- Postes non chiffrés regroupés par prestation, impact sur sous-total explicite ; action revue PAD/groupes ou accès au détail exact, sans choix appliqué. Codes connus traduits, codes de support préservés dans les détails ; lignes et sources brutes conservées.
- Devis confirmé et son erreur IMO isolés dans une étape repliable ; refus métier attendu traduit en avertissement, erreurs techniques toujours signalées. Confirmation, intent, préchecks, concurrence et callbacks de calcul inchangés. Statuts verrouillés gardent seulement l’inspection du résultat en tête, aucun nouveau droit de calcul.
- Impression : sections ouvertes temporairement avant impression puis restaurées, sans effet de bord métier. Header responsive ; garde caseId conservée pour le résultat sélectionné.
- Tests frontend416/25 fichiers PASS, dont10 de composition CaseView avec I/O/panneaux périphériques simulés : gap PAD, sélection/absence de scénario, navigation sans écriture, statuts terminaux/en cours et impression. Dernier ajustement de dépendance du double de test couvert par10 tests rejoués PASS.
- Typecheck et build PASS ; lint737 erreurs/16 avertissements inchangé = PASS_WITH_BASELINE (nouvel avertissement du test corrigé sans relever baseline) ; diff-check PASS. CI complète/typesDeno/testsDeno/live NOT_RUN ce lot, serveur inchangé.
- Vérification visuelle Chrome locale des composants réels avec données fictives et coque statique : lisibilité/détails repliés vérifiés, aucun accès Cloud ; ne vaut pas recette complète Lovable. Onglet et serveur temporaires arrêtés. Auto-revue UI/tests proportionnée ; pas de nouvelle contre-revue moteur.
- Aucun commit/push/déploiement/SQL/envoi ; rollback local par retrait des seuls diffs UI/tests du lot, note PAD préservée. Suite : GO distinct commit/push work + preview privée et recette authentifiée, sans redéploiement Edge ni migration. Prestations encore non chiffrées hors lot.
- GO de livraison utilisateur reçu le 15/09 : commit, push work, preview privée et recette authentifiée uniquement, sans migration/redéploiement Edge/envoi ; 416 tests et typecheck rejoués PASS avant commit. Résultat de livraison à consigner après vérification.

#### Livraison cockpit estimation — 15 septembre 2026 — PASS preview et recette authentifiée

- GO utilisateur : commit/push work, mise à jour preview privée et recette, sans migration/Edge/envoi. Exécutant Codex, auto-revue UI proportionnée ; aucun nouveau périmètre moteur.
- Repo douania/dakar-cargo-quotes, work d1250f82 → 58752e3168629d36e25179ac7b89a9eaa8a57400 ; GitHub/Lovable alignés. Commit8 fichiers +460/-174 (7 UI/tests + roadmap, clôture PAD précédente conservée). Tree supabase inchangé7d3135256a377a495011390108d298af3628f932.
- 416 tests frontend/25 fichiers et typecheck rejoués PASS avant commit ; build rejoué PASS après push. Lint du lot737/16 = PASS_WITH_BASELINE, diff-check PASS ; CI complète/Deno/live NOT_RUN, aucun serveur modifié.
- Chrome Lovable : mise à jour de l’aperçu puis recette authentifiée sur preview active ; estimation principale, montants/date et6 familles à compléter lisibles ; ouverture groupes/PAD sans mutation, lien transport ouvre les14 lignes/sources, devis confirmé séparé et repliable, sans lancement canonique.
- Relance unique : GoTrans scénario sélectionné ed060b67, exécution3 →4 le15/09 à18:24:53 UTC ; HT12317662/TTC12416662 XOF inchangés, nouveau résultat affiché sans refus IMO global. Sous-total toujours partiel, faits/catégories non confirmés non promus.
- Contrôle18:23→18:26 UTC : facts1409/md5 393ff8e6bcdf748f3b61b329a2441d9e et tarifs219/md5 235a655bf711e7ad8fc6c917f6419fee inchangés ; ledger203, scénarios2 et versions9 stables ; seules exécutions scénario8→9.
- Aperçu privé direct id-preview rechargé : nouveau cockpit et bouton Actualiser visibles également ; is_published=false. Lovable confirme ensuite (umsg_01m2k54p2tejj9k1kgb10d8m61, réponse completed) build Vite22,51s/code0, HEAD/tree/worktree inchangés, aucune édition/Edge ; cause de l’ancienne alerte non prouvée (journal absent), non assimilée à un blocage actuel.
- Aucun SQL d’écriture, migration, fait/tarif/Auth/RLS, déploiement Edge ni envoi. Retour arrière par revert ciblé58752e3 et resynchronisation preview ; exécution auditable conservée. Prestations non chiffrées hors lot. Note de clôture locale non commitée.

#### Réconciliation PAD / actions / brouillons — 16 septembre 2026 — PASS_WITH_BASELINE local, publication NOT_RUN

- GO utilisateur : exception ciblée gaps dans build-case-puzzle/run-pricing FROZEN, synchronisation actions/brouillons et restitution, tests/contre-revue ; aucun changement calcul/barème/fait, migration ou publication.
- Exécutant unique Codex ; contre-revue indépendante lecture seule : deux constats UI corrigés (source de brouillon hors fenêtre, suivi sent/answered mixte), clôture PASS et 23 tests dédiés rejoués indépendamment.
- Repo douania/dakar-cargo-quotes, work/HEAD 58752e3168629d36e25179ac7b89a9eaa8a57400 inchangé ; distant aligné au préflight, dernier ls-remote indisponible (connexion GitHub). Aucun commit/push ; note de livraison cockpit préexistante conservée.
- PAD devient une revue opérateur interne : messages producteurs/UI alignés, retrait de la whitelist client, navigation vers groupes/sources ; gap confirmé maintenu ouvert tant que ses critères canoniques manquent. Aucune catégorie supposée n'est promue.
- Synchronisation : réduction des historiques append-only avant déduplication, clôture des anciennes actions client, annulation des seuls brouillons non envoyés PAD/mixtes ; historique et suivis légitimes sent/answered conservés. Génération/cache/marquage envoyé refusent les anciens brouillons PAD ; les vrais gaps client restent demandables.
- UI : sources exactes chargées par identifiant et case_id, sans dépendance à la fenêtre historique ; source inconnue d'un brouillon non envoyé refusée. Compteurs/bannière/plan/actions distinguent revue PAD et attente client. Idempotence séquentielle testée, aucune nouvelle garantie de concurrence transactionnelle revendiquée.
- Diff fonctionnel : cinq handlers Edge (build-case-puzzle, run-pricing, sync-gap-client-actions, generate-reply-draft, mark-client-gap-request-sent), politique client + helper pur, cinq fichiers UI + re-export, quatre fichiers de tests ; roadmap uniquement en documentation. Quotation-engine et moteurs scénario inchangés.
- Validation : Vitest 439/28 PASS dont 23 nouveaux ; Deno complet 1439 PASS/1 FAIL SIFB Intake:193/6 ignorés. Intake/test inchangés vs origin/work ; assertion LF fausse sur CRLF, vraie après normalisation en mémoire : échec baseline, pas CI brute verte.
- Types frontend/build/config94/bundles isolés/diff-check PASS ; gate types Deno49/5 et lint737/16 inchangés = PASS_WITH_BASELINE. Recette Lovable et test:deno:live NOT_RUN.
- Aucun impact Cloud actuel, SQL/migration/Auth/RLS/faits/barèmes/envoi ; seules les transitions de coordination décrites sont prévues au déploiement. Rollback local : retrait des seuls diffs de ce lot en préservant la note antérieure ; historique runtime futur conservé, sans restauration de brouillons obsolètes.
- GO de livraison utilisateur reçu le 16/09 : commit/push work + preview privée + cinq déploiements Edge coordonnés + recette sans envoi/migration, arrêt au premier échec. Préflight Git/GitHub/Lovable aligné 58752e3, types frontend et 23 tests ciblés rejoués PASS. Avant livraison 09:32:14 UTC : ledger203, faits1409/md5 393ff8e6bcdf748f3b61b329a2441d9e, tarifs219/md5 235a655bf711e7ad8fc6c917f6419fee. Résultat runtime à consigner après recette ; contrôles PAD confirmé et prestations non chiffrées non supprimés.

#### Livraison réconciliation PAD — 16 septembre 2026 — PASS livraison privée et recette ciblée

- GO utilisateur livraison complète confirmé ; work 58752e3 → 38b49d8834d828473e0a961b5f4e544f5df0bd36, 18 fichiers +505/-129, tree supabase ed3338627f4c647f17d40231a078f5943b82dfda. Push réussi et Lovable aligné, privé/is_published=false. Premier commit refusé faute d'identité, repris avec identité Codex déjà utilisée, limitée à la commande ; configuration globale inchangée.
- Avant push : typecheck et 23 tests ciblés rejoués PASS. CI GitHub35080062468/job104741644463 SUCCESS pour ce SHA (config/typecheck/Vitest/Deno/lint/build), distincte de la réserve CRLF locale. Contre-revue du lot déjà close ; aucune correction additionnelle.
- Déploiements effectifs séquentiels : mark-client-gap-request-sent puis generate-reply-draft, sync-gap-client-actions, build-case-puzzle et run-pricing ; succès outils, sources/HEAD/tree identiques avant/après et worktree propre rapportés par Lovable. Messages umsg_01m2ms0k4zejt8aw4aj37zqkrz et umsg_01m2ms6gatfx8s91mtbb8g67bx. Chaque OPTIONS200/POST vide sans auth401 ; bundle runtime NOT_VERIFIED, preuve de remplacement admise conservée.
- Recette authentifiée Chrome : cinq routes refusent le corps vide avec400, sans lancement métier. sync-gap-client-actions sur GoTrans deux fois200/no_client_resolvable_gaps ; aucune action/demande client créée, pas de brouillon ni envoi. Cas mixtes/anciens brouillons/source absente/suivis sent-answered couverts localement, pas de fixtures client Cloud ajoutées.
- UI privée : estimation enregistrée toujours visible, revue PAD interne cohérente dans gap/bannière/action/plan, description connue présentée ; ancien appel générique au client absent de ces emplacements. Navigation sources/candidats ouvre la section attendue. Aucune catégorie promue, aucune analyse ou calcul canonique relancé ; contrôle PAD du devis confirmé toujours ouvert.
- Intégrité09:32:14→09:39:43UTC : faits1409/md5 393ff8e6bcdf748f3b61b329a2441d9e, tarifs219/md5 235a655bf711e7ad8fc6c917f6419fee, ledger203 inchangés ; actions/demandes client GoTrans0→0. Aucun SQL d'écriture, migration, fait/barème/Auth/RLS, publication publique ou envoi.
- Limites : alerte de typage Deno historique encore signalée par Lovable, sans correctif hors lot ; cotation toujours partielle, validation PAD ferme et prestations non chiffrées restantes. Le présent lot corrige l'orientation/synchronisation, pas les calculs ni la complétude tarifaire.
- Retour arrière possible par revert ciblé38b49d8 + resynchronisation preview et redéploiement coordonné des cinq Edge ; pas de rollback exécuté, historique de coordination à conserver. Note de clôture locale non commitée, aucun commit docs-only ajouté.

#### Complétude estimation PAD / THC / SOC-COC — 16 septembre 2026 — PASS_WITH_BASELINE local, publication NOT_RUN

- GO utilisateur : raccordement PAD, distinction base/suppléments et SOC/COC ; exception ciblée quotation-engine/run-scenario-pricing, tests et contre-revue regroupés, sans barèmes/faits/migration/publication. Exécutant unique Codex ; note de clôture précédente conservée.
- Préflight et clôture : douania/dakar-cargo-quotes, work local/GitHub alignés 38b49d8834d828473e0a961b5f4e544f5df0bd36 ; HEAD inchangé, aucun commit/push. Entrées historiques queue déjà arbitrées/supersédées ou différées, aucun nouveau mandat déduit.
- PAD : propositions sourcées réutilisables dans une révision du scénario sélectionné ; choix opérateur explicite, empreinte/source et caractéristiques du groupe rapprochées, autres choix/route/liens conservés. Aucun prix mémorisé dans le contrat, aucune hypothèse promue en fait ; nouvelle sauvegarde explicite requise. Changement de sélection abandonne la réponse asynchrone antérieure.
- THC scénario DAP seulement : base ordinaire sourcée sous hypothèse STANDARD si DRY sans famille explicite et danger non positif ; équipement reefer/spécial conserve sa famille. Danger inconnu garde une ligne supplément IMO null distincte ; DG connu et parcours canonique inchangés. Absence/ambiguïté de tarif laisse le poste non chiffré ; aucun barème en dur ajouté.
- SOC/COC : surestaries armateur examinées par groupe COC, sans contamination par types SOC ; montants toujours à confirmer selon armateur/durée. Retour vide par lot : SOC exclut la restitution armateur, pas un repositionnement client ; règle métier existante COC/import Sénégal appliquée seulement avec direction IMPORT et pays SN explicites, jamais pays absent/transit présumés.
- Restitution : exclusions nommées « Exclu sous hypothèse », notes des bases et conditions visibles ; réserves détaillées conservées dans le run pour les sorties documentaires existantes. Aucune migration/projection SQL/PDF modifiée ; rendu PDF réel NOT_RUN, lecteur de projection testé.
- Diff : 15 fichiers applicatifs/tests (2 nouveaux ownership-pricing.ts/_test), cette roadmap ; moteur, orchestration, helper pur, raccordement/rendu UI et tests. Auth/RLS, run-pricing, price-service-lines, faits et catalogues inchangés.
- Tests : 443 Vitest/28 fichiers PASS ; 80 Deno ciblés PASS ; suite Deno complète 1445 PASS/1 FAIL SIFB Intake:193/6 ignorés. Intake et test identiques à origin/work ; assertion LF fausse sur CRLF, vraie après normalisation mémoire : dette baseline, pas suite brute verte.
- Types frontend/build/config94/bundles39-45-34 et contrôle négatif/diff-check PASS ; types Deno49/5 et lint737/16 inchangés. Dernier ajustement STANDARD non-DG couvert par80 ciblés et gate types rejoués ; test:deno:live NOT_RUN.
- Contre-revue indépendante lecture seule PASS : précondition IMPORT manquante corrigée/testée, restitution exclusion et projection des réserves corrigées, cas source/groupe et isolement canonique revus ; relecteur80 Deno et20 Vitest, puis9 parent UI et35 Deno affectés rejoués PASS. Pas de nouvel audit général.
- Limites : estimation toujours non ferme ; N’Dioum sans tarif actif trouvé et transport lourd restent réservés, aucun pays/tarif/solution 55t inventé. Choix PAD ferme toujours distinct ; aucune recette Lovable ni modification runtime dans ce lot.
- Retour arrière local : retrait ciblé des seuls diffs du lot, note antérieure préservée ; aucun retour DB. Suite : GO distinct commit/push work + preview privée + quotation-engine puis run-scenario-pricing, recette générique et GoTrans sans migration/envoi ; pas de redéploiement recommend-pad-category nécessaire.
- GO de livraison reçu le 16/09 : commit/push work, preview privée, quotation-engine puis run-scenario-pricing et recette, sans migration/envoi ; arrêt au premier échec. Préflight Git/Lovable aligné38b49d88, preview privée ; avant livraison10:13:04UTC ledger203, faits1409/md5 393ff8e6bcdf748f3b61b329a2441d9e, tarifs219/md5 235a655bf711e7ad8fc6c917f6419fee, scénarios2/runs9. Résultat de livraison à consigner après exécution.

#### Livraison complétude PAD / THC / SOC-COC — 16 septembre 2026 — PASS livraison et recette GoTrans ; couverture runtime générique PARTIAL

- GO utilisateur de publication exécuté : douania/dakar-cargo-quotes, work 38b49d8834d828473e0a961b5f4e544f5df0bd36 → 4577dd8696b200f6c8a71b1090b7ea449f809b0f, push origin/work vérifié ; 16 fichiers, +357/-29. Arbre supabase 0af9a931f0e79c68819dde1313de565db350eae2.
- CI GitHub run35083847479 SUCCESS sur ce SHA ; avant commit29 tests frontend ciblés,80 Deno ciblés et typecheck PASS. Dettes locales baseline documentées au lot précédent inchangées ; test:deno:live NOT_RUN.
- Lovable message umsg_01m2mvbebwen5r9mfrzc7smtqm : quotation-engine puis run-scenario-pricing réellement déployées avec succès ; sources propres identiques après chacun, sondes indépendantes OPTIONS200/POST sans auth401 ; aucune autre Edge. Empreinte bundle runtime NOT_VERIFIED, preuve de remplacement autorisée conservée.
- Preview privée ready/workspace_edit/is_published=false et SHA4577dd8 vérifiés à clôture ; aucune migration, modification Auth/RLS, publication publique ou envoi client.
- Recette Chrome authentifiée : relance scénario existant ed060b67, run ebc9e667 séq5 SUCCESS, HT15 262 662 / TTC15 361 662 XOF ; base THC transformateurs2 015 000 et pièces930 000 ajoutée, suppléments IMO null séparés.
- Propositions PAD fraîches : T02 armoires sourcé alias matériel électrique et tarif838d60d1 ; choix explicite, vérification empreinte, révision UI baabd809-16dc-4129-a556-18c5bce771d4 rév2 créée et sélectionnée. Comparaison SQL : seul pad_choices change, uniquement lot-1 ; groupes/route et autres choix inchangés, rév1 conservée/remplacée.
- Bouton principal : run9c169c94-4df6-42bb-9563-4a1b848c694d séq1 SUCCESS/partial, 10:22:42UTC ; HT36 021 972 / TTC36 120 972 XOF, PAD lot-1 ajouté20 759 310, lot-2 2 264 652 et lot-3 435 510 conservés. Résultat actualisé et disparition du poste PAD à compléter vérifiés dans UI.
- UI : surestaries seulement lot COC3 ; trois retours vides rendus « Exclu sous hypothèse », conditions SOC/repositionnement et COC/import SN explicites ; honoraires350 000 et agence200 000 une seule fois. Estimation non ferme ; aucune hypothèse promue en fait.
- Postcontrôle10:24:19UTC : ledger203 inchangé, faits1409/md5 393ff8e6bcdf748f3b61b329a2441d9e et tarifs219/md5 235a655bf711e7ad8fc6c917f6419fee identiques à10:13:04 ; seuls scénarios2→3 et runs9→11 attendus.
- Limites : cas génériques couverts localement, recette Cloud synthétique séparée NOT_RUN (contexte/session navigateur non exploitable sans contournement) ; aucun appel synthétique authentifié exécuté. Rendu PDF réel NOT_RUN. Transport N’Dioum, annexes terminal/magasinage, surestaries COC et suppléments IMO éventuels restent non chiffrés, jamais gratuits.
- Suite : compléter la couverture des prestations avec sources transport/conditions disponibles ; ne pas présenter ce sous-total comme cotation complète. Rollback possible par revert ciblé4577dd8 + preview et deux redéploiements ; conserver historique des scénarios/runs. Note de clôture locale seule non commitée, aucun commit docs-only.

#### Estimation kilométrique TC ordinaires hors barème — 16 septembre 2026 — PASS_WITH_BASELINE local ; publication NOT_RUN

- GO utilisateur : formule pour TC normaux / destinations absentes, exception ciblée calcul gelé et raccordement des données/tests/contre-revue ; sans faits/barèmes/Cloud/publication. Exécutant Codex, contre-revue indépendante lecture seule ciblée.
- Préflight/clôture : douania/dakar-cargo-quotes, work local/GitHub 4577dd8696b200f6c8a71b1090b7ea449f809b0f inchangé. Note précédente de livraison conservée ; aucune nouvelle entrée queue à arbitrer hors décisions historiques déjà traitées/différées.
- Périmètre : scénario DAP maritime import Sénégal via Dakar seulement. Tarif exact prioritaire ; destination répertoriée, tarif ambigu/expiré/inactif, catalogue incomplet ou ancre Pout modifiée interdisent la substitution. Aucun fallback canonique ni changement price-service-lines/run-pricing.
- Calcul indicatif 20P 57000+1000×km / 40P 69000+2000×km HT, distance >58km ; frais HT 0/1000 et TVA fournisseur18% issus de la grille approuvée, débours TTC sans nouvelle TVA SODATRA. Règle tarifaire 22t existante conservée, jamais utilisée comme preuve d'admissibilité physique.
- Données : hypothèse JSON existante routing.local_transport_estimate, formulaire guidé puis liaison explicite au scénario. Distance/itinéraire/source/date, lots rapprochés par référence/type/quantité/poids, charge marchandise admissible TC ET véhicule sourcée, attestation ordinaire décochée par défaut. Aucun pays ni distance ni capacité inventé ; pays peut être hypothèse liée.
- Exclusions : danger positif/inconnu, température dirigée, équipement spécial, poids inconnu/supérieur à capacité, qualification absente ou lot modifié. La normalité opérationnelle reste attestée par l'opérateur, pas détectée depuis une photo ni déduite du seul poids ; pas de nouvelle limite légale universelle. Dossier GoTrans/CargoTrans non modifié, 55t non qualifiés par ce lot.
- Traçabilité : source CALCULATED/firm_eligible=false, décomposition et réserves persistées, identité/fingerprint des hypothèses conservée ; sous-total indicatif uniquement. Retour vide/attente/prestations spéciales non présumés inclus. Contrat SQL de scénario inchangé, hypothèse non promouvable en fait par la whitelist existante.
- Diff applicatif : 12 fichiers (+502/-10), dont 4 nouveaux helper/test/formulaire/test ; quotation-engine, orchestration/domaine/test HTTP, UI hypothèses/messages et commentaire résolveur exact. Cette note et la clôture antérieure sont les seuls diffs documentaires.
- Tests finaux : 446 Vitest/29 fichiers PASS ; 114 Deno ciblés PASS dont27 nouveaux helper/moteur et44 orchestration ; suite Deno1473 PASS/1 FAIL/6 ignorés. Échec SIFB Intake:193 identique origin/work après normalisation CRLF/LF, assertion brute false/normalisée true ; CI brute reste en échec baseline, pas annoncée verte.
- Types frontend, build, configurations94, bundles40/48/34+contrôle négatif, diff-check PASS ; types Deno49/5 et lint737/16 sans aggravation. Deno retrouvé en cache puis gates rejoués ; avertissement React Refresh nouveau corrigé. test:deno:live et recette Lovable/PDF réelle NOT_RUN.
- Contre-revue PASS : 27 Deno rejoués personnellement par le relecteur ; rendu groups:[null] corrigé avec alerte sans mutation, testé UI ; qualification explicite, routes et non-fermeté revues. Test HTTP supplémentaire prouve liaison→DTO→réserve persistée/rejeu sans écriture canonique (transport réseau simulé localement).
- Aucun commit/push, migration, écriture Cloud, modification Auth/RLS/tarif/fait ou envoi. Retour arrière local : retirer uniquement les diffs du lot en préservant la note antérieure ; aucune restauration DB. Activation requiert GO distinct commit/push work, preview privée, quotation-engine puis run-scenario-pricing, recette contrôlée sans envoi/migration.

#### Proposition distance TomTom — 16 septembre 2026 — PARTIAL ; local PASS_WITH_BASELINE, activation NOT_RUN

- GO utilisateur : terminer le raccordement automatique sous GO local, départ prévu sortie DP World Dakar ; secret TOMTOM_API_KEY déclaré enregistré par utilisateur, valeur jamais consultée. Aucun GO de publication déduit.
- Préflight : douania/dakar-cargo-quotes work local/GitHub 4577dd8696b200f6c8a71b1090b7ea449f809b0f inchangé, lot kilométrique précédent présent et préservé ; queue historique inchangée, aucun nouveau mandat déduit des entrées anciennes.
- Périmètre supplémentaire : Edge propose-road-distance (index/domaine/2 tests), config, UI RoadDistanceProposal/test, formulaire transport/test et passage caseId dans panneau hypothèses ; aucun nouveau changement du moteur de calcul.
- Flux : clic opérateur → auth existante + accès dossier sous RLS utilisateur → destination saisie ou unique fait courant routing.destination_city → géocodage SN → choix si ambigu/approximatif → distance indicative truck/fastest sans trafic/ferry → brouillon d'hypothèse uniquement, sans enregistrement automatique ni qualification des lots.
- Sécurité/provenance : clé serveur, hôte TomTom fixé, timeout10s, redirections refusées, erreurs fournisseur neutralisées ; aucun email complet ni marchandise transmis ; empreinte du choix lie libellé/coordonnées/précision ; changement dossier/brouillon invalide résultat tardif ; retouche manuelle distance/destination efface provenance/date.
- Origine exacte NOT_VERIFIED : page officielle DP World contact consultée sans coordonnées de sortie routière. TOMTOM_DAKAR_ORIGIN doit contenir lat/lon/source/verified_on vérifiés, aucune valeur par défaut ; contrôle géographique Dakar seulement, pas une preuve de portail. Configuration manquante → refus explicite avec secours manuel.
- APIs documentées : docs.tomtom.com/geocoding-api/documentation/tomtom-maps/v1/geocode (Geocoding v2), routing-api/documentation/tomtom-maps/v1/calculate-route ; confiance matchConfidence, pays trajet SEN requis, itinéraire transfrontalier/non vérifiable refusé. Distance ne valide ni gabarit ni capacité/autorisation du véhicule.
- Tests : 452 Vitest/30 fichiers PASS ; nouveaux21 Deno PASS avec vérification types ; suite Deno1494 PASS/1 FAIL/6 ignorés. Unique échec Intake SIFB:193 CRLF baseline, deux fichiers inchangés vs origin/work ; pas CI verte.
- Types frontend, config95, build, bundles40/48/34+contrôle négatif PASS ; lint737/16 et typesDeno49/5 sans aggravation. Recette fournisseur réelle, secret/origine Cloud, test:deno:live et Lovable NOT_RUN.
- Contre-revue indépendante PASS après corrections ciblées provenance et libellé départ ; relecteur a personnellement rejoué21 Deno+9 UI PASS. Pas de nouvelle boucle de revue générale.
- Réserves : origine à vérifier/configurer avant activation ; pas de cache ni quota applicatif global, appels répétés consomment le quota fournisseur. Ni clé, ni coordonnées fictives de test destinées à la configuration Cloud.
- Aucun commit/push/migration/déploiement/envoi, faits/barèmes/Auth/RLS inchangés. Retour arrière local limité aux diffs TomTom, préserver lot km. Suite : obtenir point routier sourcé puis GO de publication regroupé incluant nouvelle Edge et recette réelle ; application actuelle inchangée.

#### Départ portuaire approximatif accepté — 16 septembre 2026 — PASS local ; runtime NOT_RUN

- Décision utilisateur explicite : prendre un point logiquement probable au port de Dakar ; remplace l'exigence précédente de validation du portail exact avant activation, sans qualifier l'écart réel de négligeable faute de mesure.
- Repère DEFAULT_PORT_ORIGIN : lat14.687222/lon-17.426944, ligne DPWSN consultée sur https://www.geopostcodes.com/container-terminals-code-list/ le16/09/2026. Convention d'estimation, ni sortie vérifiée ni kilomètre zéro officiel ; date = consultation source, pas constat terrain.
- Ajustement borné : domaine/index et2 tests Edge + libellé RoadDistanceProposal. Défaut seulement si TOMTOM_DAKAR_ORIGIN absent ; surcharge explicite invalide refusée, surcharge valide sourcée conservée. Aucune nouvelle configuration Cloud nécessaire pour le départ par défaut.
- Provenance conserve coordonnées/source et mention approximative ; tarifs exacts prioritaires et exclusions TC spéciaux inchangés. La routabilité effective reste à contrôler par TomTom lors de la recette, pas prouvée par le registre du terminal.
- work4577dd8696b200f6c8a71b1090b7ea449f809b0f local/GitHub alignés, HEAD inchangé ; lot antérieur préservé. 22Deno+9UI ciblés, typecheck frontend et diff-check PASS. Suites complètes non rejouées ce sous-lot ; résultats précédents restent historiques.
- Contre-revue indépendante ciblée PASS,22Deno rejoués personnellement ; aucun nouveau blocage local. Aucun secret consulté, commit/push/déploiement/migration/écritureCloud/envoi ; faits/barèmes/Auth/RLS inchangés.
- Retour arrière : retirer uniquement ce défaut et ses libellés/tests, rétablissant l'exigence de configuration explicite. Suite : GO de publication regroupé du lot km+TomTom puis recette réelle privée, sans migration ni envoi client.

#### Livraison privée km + TomTom — 16 septembre 2026 — PARTIAL ; recette authentifiée NOT_RUN

- GO utilisateur regroupé : commit/push work, preview privée, quotation-engine → run-scenario-pricing → propose-road-distance, puis recette ; aucune migration ni envoi client.
- Git work4577dd8→567b936c2f471a4691f0b5610fa7e3ba9a667c8d poussé ;20 fichiers,+879/-10 ; tree supabase be5aaea236fac1db3d0287df42de71cee59718f3. Coupure réseau transitoire résolue à la reprise ; identité ponctuelle Codex identique aux commits précédents.
- Vérifications fraîches :49Deno ciblés avec typecheck+9UI PASS,95config et bundles40/48/34+contrôle négatif PASS, diff-check PASS. Suites globales : résultats historiques PASS_WITH_BASELINE ci-dessus, non rejouées intégralement pendant livraison.
- Lovable message umsg_01m2n2w0fgf1xtn7x8sth225tr : succès des3déploiements dans l'ordre ; SHA/tree/propreté vérifiés après chacun ; OPTIONS200/POST sans auth401 chacun. Empreinte bundle runtime NOT_VERIFIED ; preuve = sources+outil déploiement+sondes.
- get_project confirme567b936, ready,is_published=false ; preview HTTP200 rapporté par Lovable. Aucune édition automatique ni correction de dette Deno par Lovable.
- Recette navigateur via computer-use : preview /login, connexion utilisateur requise ; aucun appel TomTom réel ni chiffrage authentifié ce tour. Routabilité du départ approximatif et validité de la clé restent NOT_RUN, pas PASS.
- Aucun changement DB/Auth/RLS, fait client, barème, secret, migration ou envoi. Note de clôture locale non commitée (pas de commit docs-only).
- Retour arrière : revert ciblé567b936 puis preview/redéploiement coordonné ; nouvelle fonction à ne plus appeler après retour. Suite sous même GO : connexion utilisateur puis recette distance et estimation ordinaire, sans qualifier les55t comme TC ordinaires.

#### Recette authentifiée TomTom — 16 septembre 2026 — PARTIAL ; proposition distance FAIL

- work567b936 local/GitHub alignés, seule note roadmap locale préexistante ; aucun nouveau commit/push/déploiement.
- Chrome connecté : après rechargement, nouveau formulaire et avertissement départ approximatif visibles. Proposition N'Dioum → « Service cartographique indisponible. La saisie manuelle reste possible. » ; distance/source/date non remplies, brouillon annulé,0 hypothèse affichée. Estimation GoTrans existante inchangée, aucun calcul55t ordinaire effectué.
- Diagnostic Lovable lecture seule umsg_01m2n3qrqwez6taqdqjhrd9bpb : nom TOMTOM_API_KEY présent, TOMTOM_DAKAR_ORIGIN absent (défaut prévu) ; journaux boot/shutdown seuls ; sonde géocodage via secret disponible dans sandbox HTTP401 Unauthorized, aucune valeur secrète affichée.
- Refus authentification fournisseur prouvé dans sandbox ; identité secret sandbox/runtime Edge NOT_VERIFIED, cause précise de la clé refusée inconnue. Ne pas attribuer l'échec au point de départ ni annoncer une recette positive.
- Aucun fait/barème/DB/Auth/RLS modifié, aucune hypothèse/scénario enregistré, aucun envoi. Tests locaux précédents restent PASS_WITH_BASELINE ; recette calcul km positif runtime et routabilité réelle restent NOT_RUN.
- Suite : vérifier/corriger l'identifiant TomTom enregistré et ses droits sans partager la clé dans le chat, puis reprendre même recette. Pas de nouveau correctif code déduit du seul401. Note locale non commitée.

#### Recette TC ordinaire hors barème — 16 septembre 2026 — FAIL ciblé ; TomTom PASS

- GO utilisateur : création dossier fictif/scénarios puis reprise authentifiée ; work567b936 local/GitHub alignés, note roadmap préexistante seule. Aucun code, commit/push, migration ou déploiement ce tour.
- Dossier TEST-KM-20260916 `450cb321-8da6-4323-a579-187800d09e45`, sans email ; 5 hypothèses actives, scénario révisé3 `abbf33ca-2a8e-49b8-9e65-f665165dbe85` sélectionné, package DAP et SOC synthétiques. Aucun fait réel GoTrans modifié, aucune promotion ni envoi.
- TomTom a proposé480,9km avec source/date conservées ; capacité20t fictive et poids10t explicitement réservés au test. Les hypothèses nouvellement créées deviennent liables après rechargement : cache `quote-scenario-linkable-assumptions` non invalidé par le panneau de création.
- Run initial rev2 bloqué par ownership/package manquants dans le fixture ; compléments UI autorisés, puis run `a9e386a6-2f10-4cd0-b19f-f92afef8ef85` success technique mais transport non chiffré. Sous-total155000XOF = THC uniquement, aucune preuve de PASS km.
- Cause vérifiée via engine_request et garde `_shared/local-transport-estimate.ts:84-86` : scénario `equipment_code=20gp`, hypothèse `20GP`, comparaison stricte ; les autres critères de cette garde concordent. Le parcours normal révèle une incompatibilité de casse non couverte par la preuve locale antérieure.
- STOP recette positive ; cas négatifs et priorité tarif exact runtime NOT_RUN. Correction moteur FROZEN non effectuée ; demander exception ciblée normalisation + test de bout en bout, regrouper avec invalidation cache UI. Publication distincte.
- Artefacts TEST conservés pour reproduction ; reprise sans recréer le dossier. Aucun montant forcé. Note locale non commitée ; Auth/RLS/barèmes inchangés.

#### Correctif casse équipement + cache hypothèses — 16 septembre 2026 — PASS local et contre-revue ; GO livraison reçu

- GO local explicite reçu, exception pricing ciblée ; work567b936 inchangé. Périmètre : `_shared/local-transport-estimate.ts`, son test Deno, `QuoteScenarioAssumptionsPanel.tsx`, nouveau test UI associé ; roadmap préexistante préservée.
- Comparaison équipement insensible à la casse seulement, sans fusion20GP/20HC ni20/40 ni équipements spéciaux ; aucune mutation des entrées. Après création/révision/confirmation/réfutation, invalidation des deux caches du dossier concerné, sans calcul automatique.
- Preuve rouge/vert : 2 nouveaux tests Deno et4UI échouent sur code antérieur puis passent après patch. Moteur réel local + catalogue simulé :20gp/20GP,1TC10t,480,9km→634722XOF TTC fournisseur ; ce n'est pas une preuve runtime.
- Tests exécutés :29Deno ciblés avec typecheck PASS (priorité tarif exact, refus55t/DG/frigo/capacité et changements équipement compris),17UI ciblés PASS, suite456Vitest PASS, typecheck frontend PASS, build PASS (avertissements dépendances/taille), diff-check PASS. CI globale/Deno globale/lint non rejoués : NOT_RUN.
- Auto-revue diff effectuée ; contre-revue indépendante requise avant publication encore NOT_RUN. Aucun commit/push/déploiement/migration/écriture Cloud, aucun impact Auth/RLS/faits/barèmes ; runtime conserve le défaut jusqu'à livraison autorisée.
- Retour arrière local : retirer seulement ces4diffs applicatifs/tests et cette note, préserver autres notes. Suite : contre-revue ciblée puis GO de publication distinct et reprise du même dossier TEST, sans envoi.
- Contre-revue indépendante Codex `review_case_equipment_fix` sous GO utilisateur : GO technique ciblé, aucun bloquant ;29Deno et4UI rejoués PASS. Réserve non bloquante : test cache mocké, actualisation navigateur à prouver en recette privée. Aucun avis attribué à Claude.
- Contrôles supplémentaires : bundles isolés40/48/34 + contrôle négatif PASS, configuration95 PASS, lint737/16 et typesDeno49/5 PASS_WITH_BASELINE. Git toujours567b936 ; aucun changement Cloud. Publication proposée :4fichiers applicatifs/tests + roadmap, preview privée, quotation-engine puis run-scenario-pricing ; sans migration, tarif, fait client ni envoi ; arrêt au premier échec et reprise dossier TEST existant.
- GO livraison utilisateur reçu : commit/push work, preview privée, quotation-engine puis run-scenario-pricing, recette TEST ; sans migration ni envoi, arrêt au premier échec. Préflight Git/GitHub/Lovable alignés567b936, preview non publiée ; résultat runtime à consigner après exécution.

#### Livraison et recette ciblée casse/cache — 16 septembre 2026 — PASS privé

- GO regroupé exécuté : work567b936→89ee9a0040b74c41cc983fd2a93d35dae181db5e poussé,5fichiers +110/-4 ; tree supabase93599e520a4d918e232aae471f2c21e6914cfa52. Préflight Git/GitHub/Lovable alignés, aucune divergence.
- Lovable `umsg_01m2n8r2vrf0ftea4m10s3e94v` : quotation-engine puis run-scenario-pricing déployées avec succès ; sources/tree/propreté identiques après chaque étape, OPTIONS200/POST vide401, preview200 privée. Bundle runtime NOT_VERIFIED ; aucune correction de dette TS2345 ni autre fonction/migration.
- Recette Chrome authentifiée : scénario TEST rev3 inchangé, run2 `d3c9386f-e1df-42e0-b2e4-7eace9278c76` success ; transport634722XOF (HT537900+TVA fournisseur96822), aucune TVA SODATRA ajoutée, sourceCALCULATED/non ferme. THC155000 ; sous-total affiché789722XOF, autres postes explicitement non chiffrés.
- Cache UI PASS : hypothèse synthétique « TEST CACHE — contrôle sans incidence tarifaire — NE PAS ENVOYER » créée sans clé tarifaire, immédiatement disponible dans les liens du scénario sans reload. Révision temporaire annulée sans sauvegarde/lien ; témoin conservé uniquement dans dossierTEST.
- Aucun changement GoTrans/faits client/barèmes/Auth/RLS, aucun email, PDF ou devis ferme ; seul dossier fictif écrit pour recette. Cas négatifs et priorité tarif exact prouvés localement, non rejoués en runtime ce tour : NOT_RUN.
- Retour arrière possible par revert ciblé89ee9a0 et preview/redéploiement coordonné. Note clôture locale non commitée ; lot ciblé terminé, ne pas assimiler ce PASS à une cotation complète ou à une validation du transport55t.

#### Séjour terminal / surestaries COC — 16 septembre 2026 — PARTIAL fonctionnel, PASS_WITH_BASELINE local

- GO local utilisateur : exception quotation-engine/run-scenario-pricing, hypothèses/tests/contre-revue ; aucun barème/fait/migration/Cloud/publication. Préflight work local/GitHub89ee9a0040b74c41cc983fd2a93d35dae181db5e aligné, HEAD local inchangé ; recontrôle distant final indisponible (connexion443), état distant final UNKNOWN. Clôture précédente préservée, queue historique non rouverte.
- Nouveau contrat d’hypothèse JSON pricing.container_stay_estimate, via ledger existant sans SQL : formulaire guidé, référence/type/quantité/propriété rapprochés au scénario ; durées magasinage et armateur distinctes, null jamais recyclé, source/date requises, aucun jour/armateur par défaut. Hypothèse liée uniquement, non promouvable en fait.
- Surestaries : import Dakar/SN DAP et moteur non-transit, lots COC non-DG/non-température seulement, couple armateur/équipement exact existant et tarif actif daté ; paliers approuvés continus/complets, chaînes NUMERIC SQL prises en charge, montants XOF/FCFA seulement et non fermes. Pas de fallback legacy chiffré ; absence/ambiguïté/durée manquante/devises étrangères restent réservées. Garde finale Bamako contradictoire refusée,63tests ciblés rejoués PASS.
- Magasinage : lignes distinctes par lot ; zéro conditionnel uniquement DPW sec import local, sortie supposée dans10jours et franchise unique active en catalogue concordant avec FAQ DPW consultée16/09. SOC ne supprime pas le magasinage ; RoRo/ConRo effectif interdit cette franchise.
- Source https://dpw-prod-cd-1.dpworld.com/senegal/faqs confirme franchise10j sec local/2j frigo/21j Mali, seuls10j utilisés dans ce périmètre. Lecture visuelle PDF public/data/tarifs/DPW_TARIFS_2025_0001.pdf : une page THC, aucun magasinage ; ce fichier ne prouve pas les6000/12000 XOF/j inscrits en base. Taux/unité EVP non activés, aucune correction tarifaire implicite.
- Maersk Sénégal import consulté : https://www.maersk.com/fr-fr/local-information/imea/senegal/import distingue surestaries et détention ; pas de cumul automatique ni de taux nouveau intégré. Détention après sortie, TVA fournisseur éventuelle, frais annexes et magasinage excédentaire demeurent non chiffrés/explicitement réservés.
- Notes/paliers humanisés et réserves conservées dans résultat isolé pour sorties existantes ; statut non ferme, hypothèses/faits et ancien parcours canonique séparés. Contrat SQL/RLS/Auth et catalogues inchangés.
- Tests :18nouveaux Deno domaine/moteur et45handler PASS ;111ciblés avant ajout HTTP,63ciblés après. SuiteDeno1516PASS/1FAIL SIFB Intake193/6ignorés : mêmes fichiers qu’origin/work, assertion brutefalse/normaliséeCRLF→LFtrue, dette baseline. Pas de CI brute verte.
- Frontend458tests PASS puis21ciblés PASS incluant nouveau raccourci(1test ajouté) ; typecheck frontend/build/config95/bundles41-49-34+contrôle négatif/diff-check PASS. TypesDeno49/5 et lint737/16 sans aggravation. test:deno:live/recette Lovable/PDF-email réel NOT_RUN.
- Contre-revue indépendante Codex review_container_stay : deux blocages corrigés (mode effectif hérité, durées distinctes),18Deno+2UI puis98Deno helper/handler/moteur rejoués par relecteur PASS ; réserves et test historique multi-lignes revus, aucun nouveau blocage. Aucun avis attribué à Claude.
- Périmètre13fichiers applicatifs/tests + roadmap ; nouveaux helper/test et formulaire/test, deux moteurs et tests, raccordement hypothèses/libellés UI. Aucun commit/push/déploiement/envoi ; runtime reste inchangé.
- Suite : justifier les tarifs magasinage excédentaire/annexes et unités/conditions sur pièces avant activation de ces montants ; ce lot local ne rend pas la cotation complète. Publication du sous-périmètre validé nécessite GO distinct preview+quotation-engine+run-scenario-pricing et recette.
- Retour arrière local : retirer uniquement ce lot, préserver note précédente ; aucun retour DB nécessaire.

#### Magasinage P1 ×1,111 — 16 septembre 2026 — PARTIAL local, non publié

- GO utilisateur : coefficient1,111 sur premières tranches, deux codes observés et autres à prouver ; poursuite du lot local précédent uniquement. HEAD work89ee9a0 inchangé ; GitHub aligné au préflight, dernier contrôle distant indisponible (connexion443), état distant final UNKNOWN.
- Snapshot historique grille Dakar Terminal09/12/2014 p.34 ; P1×1,111 arrondi au franc, P2/P3 inchangés. Aucun catalogue existant ni fait client modifié, aucune hausse réglementaire revendiquée.
- 412 :177→197 observé DPW facture3300753 du23/02/2026 p.99/105 (même facture) ;419 :1768→1964 observé TOM p.12/110. Transfert entre opérateurs explicitement hypothétique ; autres codes estimés à corroborer.
- Choix explicite du code410–419 dans hypothèse de séjour ; calcul par tonne exacte et paliers15/15/reste après franchise10j vérifiée en catalogue. Poids unitaire multiplié par quantité, poids total non remultiplié ; résultat non ferme, provenance et ventilation conservées.
- Périmètre DPW sec non-DG import Dakar DAP inchangé ; opérateur/température/danger inconnus restent réservés. Codes420/421 exclus du calcul à la tonne ; TOM non activé. Pas de calcul automatique sur les armoires IMO.
- Extension : deux fichiers helper/test storage-rate-estimate ; raccordements helper séjour, formulaire/test, moteur, filtre scénario et tests existants. Total lot15fichiers applicatifs/tests + roadmap.
- Tests23Deno helper/moteur +45handler PASS ;2UI ciblés PASS ; typecheck frontend/build/bundles42-50-34 et contrôle négatif PASS ; typesDeno49erreurs/5catégories identiques baseline. Suite frontend générale449PASS/10FAIL dont délais dépassés ; rejeu séquentiel confirme6FAIL sur17 dans FinalRequestStatePanel puis interrompu, bilan global séquentiel incomplet. Cause non déterminée, aucune équivalence baseline revendiquée pour ces échecs.
- Contre-revue indépendante review_storage_uplift PASS,23Deno rejoués ; aucun avis attribué à Claude. Deno.lock non suivi créé par le relecteur supprimé (artefact régénérable), cache node_modules initialisé sans changement de dépendances suivies.
- Aucun commit/push/migration/déploiement/envoi ; DB/Auth/RLS/runtime inchangés. Recette Lovable NOT_RUN. Publication suspendue jusqu'à clarification des tests, puis GO distinct ; rollback local par retrait ciblé du lot uniquement.

#### Livraison séjour/P1 — 16 septembre 2026 — GO privé utilisateur, contrôles prépublication

- GO utilisateur « publier dans lovable avec la remarque à corroborer » : commit/push work, preview privée, quotation-engine puis run-scenario-pricing ; aucune migration, publication publique ou envoi client.
- Blocage frontend levé sans patch applicatif : dépendances locales Deno hors package-lock (Radix2.3.7 vs2.2.5, user-event14.6.7 vs14.6.1, Vitest3.2.7 vs3.2.4). npm ci restaure les versions verrouillées ;459/459tests PASS, typecheck/build PASS. Les anciens échecs ne sont pas une régression démontrée du lot.
- Préflight Git/GitHub/Lovable89ee9a0 aligné, projet workspace_edit/is_published=false. Réserve P1 non officielle et montants non fermes conservés. Dépendances suivies inchangées ; Auth/RLS/catalogues/faits inchangés.
- Livraison69f1658ad9bd2e1f74c1d6a32b311a5926176fae poussée sur work (16fichiers,+596/-15). Lovable umsg_01m2npp6mcfaxvakq9y7bb83q0 confirme build24,98s/preview200, puis quotation-engine et run-scenario-pricing successifs «Successfully deployed» ; OPTIONS200/POST sans auth401 chacun, HEAD/tree supabase36b3ef590caf33f4ad532c49e39b21a7431d1b87 inchangés. Bundle runtime non exposé/NOT_VERIFIED.
- Contrôle Chrome authentifié : formulaire séjour présent, mention P1×1,111/412-419observés/autres à corroborer/P2-P3historiques visible. Formulaire annulé, aucune hypothèse enregistrée, aucun pricing lancé ni fait modifié. Recette de calcul complète NOT_RUN ; livraison privée PASS, recette PARTIAL.
- Retour arrière par revert ciblé69f1658 et redéploiement coordonné des deux fonctions, sans rollback SQL. Note de résultat finale locale non commitée (pas de commit docs-only).

#### Recette séjour/P1 — 17 septembre 2026 — calcul PASS, restitution PARTIAL

- GO utilisateur sur recette avec hypothèse de séjour ; work69f1658 inchangé et Lovable sur ce SHA. GitHub inaccessible (connexion443), aucun commit/push/déploiement ce tour ; note précédente préservée.
- Chrome authentifié : dossier synthétique TEST-KM-20260916 (450cb321-8da6-4323-a579-187800d09e45), ajout hypothèse pricing.container_stay_estimate 12j DPW/code414, lot SOC20GP10t ; révision4 sélectionnée (19e1fa6c-22a6-4eae-81a3-88f821bca09c), six hypothèses liées. Aucune promotion en faits ni action GoTrans.
- Run isolé8bae0b9a-e029-489f-92ef-d6ec81b210ed terminé08:55:27UTC, status success/qualification partial, confirmé UI et SELECT Lovable : P1 355×1,111 arrondi394, franchise10j, 2j×10t×394=7880FCFA. THC155000 et transport634722 inchangés ; sous-total indicatif797602XOF, aucun montant ferme éligible.
- Source STORAGE_P1_OPERATOR_1111_20260916 et réserve « à corroborer sur facture » visibles/persistées ; P2/P3 historiques signalés, hors frais annexes. Hypothèse et run TEST conservés pour audit ; aucun envoi, changement de barème, migration ou modification Auth/RLS.
- Défaut de restitution constaté : résumé générique annonce encore magasinage non chiffré, alors que sa ligne7880 est calculée. Aucun correctif hors GO ; prochaine action proposée : adapter ce libellé au résultat effectif. Surestaries COC et autres paliers runtime NOT_RUN ce tour.

#### Résumé magasinage — 17 septembre 2026 — PASS local, non publié

- GO utilisateur sur contradiction du résumé ; préflight local/GitHub work69f1658 aligné, notes locales précédentes préservées. HEAD inchangé.
- Correctif strictement présentation : src/lib/scenarioPricing.ts remplace le libellé fixe « magasinage non chiffré » par un renvoi aux montants/réserves par lot ; seuls les postes non chiffrés sont annoncés exclus, absence de gratuité et caractère non ferme conservés. Helper partagé par cockpit et panneau scénarios, codes persistés inchangés.
- Diff du lot : une chaîne applicative, test helper et quatre cas UI (calculé7880, absent, mixte, zéro calculé), plus cette note. Tests vérifient réserve à corroborer, postes manquants et absence de mutation du résultat.
- Tests ciblés31PASS ; suite frontend463/463PASS ; typecheck/build et diff-check PASS. Build avec avertissements non bloquants. Auto-revue proportionnée au seul libellé ; aucun calcul/composant FROZEN modifié.
- Aucun commit/push, déploiement, migration, recalcul, envoi ou changement DB/Auth/RLS/barèmes/faits. Recette du nouveau libellé Lovable NOT_RUN ; GO de publication distinct requis (frontend uniquement). Retour arrière : rétablir l'ancien libellé et ses tests, sans restauration de données.

#### Livraison résumé magasinage — 17 septembre 2026 — PASS privé

- GO utilisateur commit/push work/preview privée/recette, sans migration ni Edge. Préflight local/GitHub/Lovable69f1658 aligné ; commit0cc375b81ca2d66300623acb3f5798eba5237baa poussé et confirmé distant (4fichiers,+58/-4, notes de clôture précédentes incluses). Aucun changement sous supabase/.
- Lovable umsg_01m2qaafjbedhrqbf37tdmh2j7/main : réponse terminée, HEAD attendu avant/après, worktree propre, build19,7s et preview200 ; aucun fichier/Edge/DB modifié. Deux diagnostics Deno TS2345 historiques signalés sans correction, hors lot.
- Chrome authentifié dossier TEST450cb321 : nouveau résumé visible après rechargement, magasinage7880FCFA et réserve « à corroborer sur facture » conservés, sous-total797602FCFA et exécution08:55:27 inchangés ; aucun recalcul ni mutation métier.
- Tests locaux du lot463PASS/types/build PASS au tour précédent, pas de rejeu ce tour (sources inchangées). Aucun envoi/publication publique/migration/Edge/Auth/RLS/barème/fait modifié. Retour arrière : revert ciblé0cc375b et reconstruction frontend seulement. Note finale locale non commitée.

#### Proposition désignation magasinage par lot — 17 septembre 2026 — PASS local, non publié

- GO utilisateur serveur/interface/tests/contre-revue, sans migration/Auth/RLS/barème/fait/publication. Préflight work local/GitHub0cc375b aligné ; note de livraison précédente préservée, HEAD inchangé.
- Nouveau service propose-storage-designation : requireUser et SELECT sous JWT appelant/RLS existante, sans service_role ; lot rapproché au scénario sélectionné (référence/équipement/quantité/propriété), description scenario_basis et contexte des autres lots. Aucun nouvel extracteur e-mail ; source explicitement hypothétique.
- Alias validé exact puis désignation normalisée exacte ; sinon IA limitée aux IDs catalogue. Codes/libellés/unités/provenance repris du référentiel, pas des champs inventés par IA. Catalogue incomplet/inaccessible refusé. Aucun choix automatique, tarif ou montant calculé ; plusieurs correspondances conservées.
- UI séjour : proposition sur demande, libellé/code/unité/source documentaire/justification visibles, adoption explicite après relecture fraîche scénario/hash/description/candidat. Seuls410–419 tonne_per_day adoptables, autres signalés ; choix DPW sous hypothèse, validité tarifaire distincte/à corroborer. Métadonnées existantes conservent justification par lot ; modification manuelle du séjour invalide ces preuves.
- Contrat de calcul séjour/moteurs FROZEN inchangés. Configuration nouvelle fonction selon standard existant verify_jwt=false+requireUser ; aucune règle Auth/RLS modifiée. Persistance via API hypothèses existante uniquement après enregistrement opérateur.
- Contre-revue indépendante review_storage_proposal : risque callback ancien écrasant saisie corrigé par invalidation de la seule proposition sur empreinte complète du brouillon ; focus conservé. B1 levé,7tests UI rejoués par relecteur ; source documentaire ajoutée. Limite non bloquante : texte descriptif long passe davantage par IA qu'alias exact.
- Tests finaux :471frontend PASS,7Deno ciblés PASS, types frontend et deno check nouvelle Edge PASS, configuration96fonctions/build/diff-check PASS. Suite Deno générale/CI complète et recette Lovable/IA réelle NOT_RUN. Un premier hook de test retournait le mock et expirait, corrigé avec bloc sans retour ; Deno retrouvé dans cache npm, dépendances inchangées.
- Périmètre11fichiers applicatifs/config/tests + roadmap ; aucun commit/push/déploiement/écriture Cloud/envoi. Retour arrière local ciblé du lot ; publication future frontend+nouvelle Edge uniquement, sans migration. Validation fonctionnelle sur données réelles nécessaire avant revendication de couverture métier.

#### Renforcement contextuel désignation magasinage — 17 septembre 2026 — PASS local, recette réelle NOT_RUN

- GO utilisateur ciblé : contexte des lots avant correspondance, test GoTrans et contre-exemple mobilier ; sans publication. work0cc375b local/GitHub alignés, lot local antérieur préservé.
- propose-storage-designation transmet les champs structurés propres à chaque lot (ONU, poids/base, équipement, propriété, quantité, danger et description) ; tout alias exact passe désormais par validation IA. Panne IA : aucun alias non contrôlé renvoyé.
- Filtre conservateur propre au lot cible : indices électriques/UN3536 excluent mobilier et armoires génériques, pas les armoires électriques ; ni poids seul ni lot voisin ne définissent cette exclusion. Aucun code dérivé de la seule classe IMO, candidats limités au catalogue.
- UI informe de la transmission systématique du contexte hypothétique ; e-mails originaux/photos non relus. La compréhension exhaustive des sources n'est pas revendiquée. Choix manuel conservé ; filtre lexical peut sur-exclure en cas de négation.
- Tests :11Deno ciblés et6UI PASS, deno check Edge/tests et typecheck frontend PASS, diff-check PASS. Contre-revue indépendante ciblée favorable ; notice UI corrigée. IA réelle/Lovable et CI complète NOT_RUN ce tour.
- Diff complémentaire :4fichiers du nouveau service, notice StorageDesignationProposal.tsx et roadmap. Moteurs/barèmes/faits/Auth/RLS/DB inchangés, aucun commit/push/Cloud. Retour arrière local limité à ce complément ; GO publication distinct toujours requis.

#### Livraison proposition magasinage — 17 septembre 2026 — PARTIAL

- GO utilisateur commit/push/preview/nouvelle Edge/recette, sans migration ni envoi. work0cc375b→d8e563ddf126a13d5241523ffef99f01066b99c9 ;12fichiers+406/-2. Push initial réseau FAIL, nouvelle tentative PASS ; identité ponctuelle Codex identique aux commits antérieurs, aucun réglage global.
- GitHub/Lovable alignés ; build local et471frontend PASS,11Deno ciblés PASS, configuration96fonctions PASS. CI complète NOT_RUN. Lovable message umsg_01m2qcdj7cee3tg5s0dfpfzndw confirme rebuild et déploiement unique propose-storage-designation ; OPTIONS200/POST sans auth401, arbre supabase8dcabf7b936ee0a863951271a4adf7ae6d23438c inchangé. Bundle runtime NOT_VERIFIED.
- Recette authentifiée Chrome TEST450cb321 : bouton présent, réponse IA avec désignation419 générique et source2014 ; proposition non retenue car description synthétique non spécifique. Aucun code/hypothèse enregistré, montant antérieur inchangé, brouillon annulé.
- GoTrans5e9cd222 : essai lot-1/20hq/39/SOC refusé. Diagnostic SELECT : scénario sélectionné baabd809 est schema_version3, actif/import/maritime ; garde nouvelle Edge n'accepte que2. Autre limite : scenario_basis contient références email/hash mais pas les libellés marchandises. Reconnaissance GoTrans non validée.
- Arrêt recette au refus ; brouillon GoTrans annulé, UI confirme aucune hypothèse enregistrée. Aucun fait/barème/Auth/RLS/migration/pricing/envoi modifié. Suite : compatibilité scénario3 et rattachement des descriptions sources, puis tests et nouvelle recette ciblée ; ne pas présenter le lot comme achevé métier.
- Retour arrière : revert ciblé d8e563d et rebuild preview ; fonction nouvelle inutilisée par ancien frontend, retrait éventuel sous GO distinct. Note de clôture locale non commitée, pas de commit documentaire seul.

#### Correctif proposition magasinage v3 et sources — 17 septembre 2026 — PASS local, non publié

- GO utilisateur correction v3/descriptions/tests/reprise recette ; base work d8e563d alignée GitHub, note de livraison précédente préservée. Aucun commit ni publication ce tour.
- Nouvelle Edge accepte versions2/3, refuse versions futures ; lit sous JWT appelant le fil du dossier, l'identité client et les emails complets bornés. Réutilise parser source historique et extracteur de groupes par partage mécanique dans _shared ; façades recommend-pad-category inchangées fonctionnellement, sans import inter-Edge.
- Rapprochement strict de tous les lots : référence/quantité/équipement/propriété/poids/base/ONU/classe/danger et bon email, ou extrait identique si aucune référence. Source inaccessible, révisée, ambiguë ou discordante : refus avant IA, pas de remplacement silencieux.
- IA reçoit seulement extraits marchandises masqués et caractéristiques par lot, pas emails entiers/photos. Empreinte source comparée à l'adoption et conservée dans preuve ; aucun fait ni code automatiquement enregistré.
- Tests86Deno ciblés PASS dont70de non-régression parser/proposition existants ; UI ciblée7PASS ; types frontend/deno Edge+tests et build PASS. Contre-revue indépendante : deux points provenance/identité descriptive corrigés et levés. CI complète et recette Cloud nouveau code NOT_RUN.
- Périmètre10fichiers applicatifs/tests (dont4partage/façades) + roadmap. Aucun moteur gelé/barème/fait/Auth/RLS/migration modifié. Déploiement futur nouvelle version propose-storage-designation et preview uniquement ; rollback revert ciblé + redéploiement. Reconnaissance GoTrans runtime toujours non validée tant que ce correctif n'est pas livré.

#### Livraison correctif magasinage v3/sources — 17 septembre 2026 — livraison PASS / recette PARTIAL

- GO utilisateur commit/push/preview/redéploiement propose-storage-designation seule/recette sans envoi. work d8e563d→a1823b0619a61843ed8896cda0243101dd8479b6, 11 fichiers +438/-323 ; GitHub aligné, worktree propre avant cette note.
- 86 tests Deno ciblés rejoués PASS sur code livré ; contrôles frontend/types/build et contre-revue du lot précédent conservés, CI complète NOT_RUN ce tour.
- Lovable : même HEAD et arbre supabase4c59e5907efbf53f42c3c9053dc2331a1c485294 avant/après, build Vite30,4s PASS, déploiement unique réussi ; OPTIONS200/POST sans auth401 rapportés. Empreinte du bundle runtime non exposée ; dette Deno hors lot signalée, non corrigée.
- Recette Chrome authentifiée GoTrans : version3 acceptée, extraits source exacts retrouvés pour lot-1 (39 storage cabinets/55t/UN3536) et lot-2 (13 transformers/18t), provenance email affichée ; plus de refus v3 ni description technique seule.
- Lot-1 propose BATTERIES D'ACCUMULATEURS417, pas du mobilier ; affiche aussi APPAREILS ELECTRIQUES421 sauf colis lourds malgré55t. Lot-2 propose414 mais remonte tranches1,5–3t et3–5t avant la bonne désignation plus de5t malgré18t. Filtrage des exclusions/poids métier insuffisant : recette fonctionnelle PARTIAL, codes non validés.
- Aucune adoption ni sauvegarde ni relance pricing : formulaire annulé, aucune hypothèse enregistrée confirmé UI ; montant affiché initial36 021 972HT/36 120 972TTC non recalculé. Lot-3/adoption complète NOT_RUN. Aucun fait/barème/DB/Auth/RLS/migration/envoi modifié.
- Suite : correctif borné de filtrage déterministe des contraintes poids/exclusions et classement des candidats, tests génériques avant nouvelle recette. Retour arrière revert ciblé + rebuild preview et redéploiement de propose-storage-designation seule ; aucune restauration DB. Note de clôture locale non commitée, aucun commit docs-only.

#### Filtrage contraintes désignations magasinage — 17 septembre 2026 — PASS local, non publié

- GO utilisateur correctif local poids/exclusions après recette PARTIAL ; base work a1823b0 alignée GitHub, note précédente préservée. Queue historique examinée : provenance/cumul déjà documentés, autres arbitrages hors lot restent sans nouveau GO d'écriture.
- Six fichiers service/tests propose-storage-designation + roadmap uniquement. Filtre déterministe catalogue avant alias/IA, IDs contrôlés sur ce même catalogue après IA ; aucun calcul, montant, barème ou moteur FROZEN modifié.
- Bornes kg lisibles (notation milliers 1,500/3,001), bas strict pour « plus de », haut inclus ; tranches contradictoires/composées/inconnues retirées. Exclusions « sauf/hors/exclu/except/colis lourd » non prouvables retirées sans inventer de seuil. Notice de filtrage via warning existant.
- Poids de pièce admis seulement après rapprochement source, quantité one_unit_per_container, extrait exact kg/t par unit et égalité au poids scénario. Pas de division du total, ni assimilation /container ou borne de fourchette à un colis ; syntaxes non reconnues exclues prudemment.
- Tests :94Deno ciblés PASS (24service+70source/proposition),7UI PASS, typecheck frontend et deno check Edge/trois tests PASS, diff-check PASS. Premier check élargi a révélé type de retour source imprécis, annoté puis check vert. CI complète/build/recette Cloud NOT_RUN ce tour.
- Contre-revue indépendante lecture seule : deux blocages (contraintes antérieures ignorées, poids conteneur assimilé au colis) corrigés puis levés ; relecteur24tests PASS, GO technique local. Couverture non universelle de la syntaxe documentaire explicitement conservée.
- Aucun commit/push/déploiement, DB/Auth/RLS/fait/client/envoi inchangés ; runtime reste a1823b0. Retour arrière : retirer ce diff ciblé sans supprimer les notes antérieures. Suite : GO publication distinct commit/push/preview privée/propose-storage-designation seule, puis recette GoTrans sans adoption ni recalcul implicite.

#### Livraison filtre magasinage — 17 septembre 2026 — PASS borné / classification toujours proposée

- GO utilisateur commit/push/preview privée/propose-storage-designation seule/recette. work a1823b0→504915cb45c583ac96d0a65e88c1eab7a71e45f9,7fichiers+132/-7 ; premier push réseau FAIL, retry PASS ;94Deno rejoués PASS, autres contrôles/revue du lot précédent conservés.
- Lovable message umsg_01m2qz2b1gf32bnm4v6618am6x : HEAD distant identique, worktree propre, arbre supabase6bb664faf69a6f8655d446f9a172ba2e07f2eae8 inchangé avant/après ; build23s/preview200, déploiement unique réussi, OPTIONS200/POST sans auth401. Bundle runtime non exposé, preuve limitée aux sources/déploiement/sondes. Projet non publié ; dette Deno historique non corrigée.
- Recette Chrome GoTrans lot-2 : extrait18t/unit retrouvé ; TRANSFORMATEURS plus de5 000kg/code414 premier, tranches1,5–3t/3–5t absentes ; alternative matériel électrique421 générique affichée non applicable automatiquement.
- Lot-1 : extrait55t/unit/UN3536 retrouvé ; batteries/accumulateurs417 proposés, ni mobilier ni catégorie « sauf colis lourds ». Alternative OMCI419 également affichée : choix métier non validé, ne pas assimiler classe dangereuse et code magasinage confirmé ; justification IA reste à examiner.
- Lot-3 : extrait10–15t/container retrouvé ; ACCESSOIRES(pièces détachées)419 proposé, pas de tranche poids pièce ni transfert ONU du lot-1. Notice de filtrage visible sur les trois essais. Critère borné poids/exclusions satisfait ; aucun verdict de classification tarifaire définitive.
- Formulaire annulé, UI aucune hypothèse enregistrée ; aucune adoption/sauvegarde/recalcul/envoi. Montants existants36 021 972HT/36 120 972TTC non recalculés. Aucune DB/migration/Auth/RLS/barème/fait modifié. CI complète/adoption de bout en bout NOT_RUN.
- Rollback : revert ciblé504915c, rebuild preview et redéploiement propose-storage-designation seule, sans restauration DB. Note locale non commitée. Suite métier : arbitrage sourcé des alternatives et hypothèses de séjour avant chiffrage, pas validation automatique de419 pour IMO.

#### Confirmations PAD par groupe — 17 septembre 2026 — PARTIAL local, non livré

- GO utilisateur : lot local cohérent persistance/serveur/UI, exceptions run-pricing et build-case-puzzle, tests et contre-revue ; publication distincte. work local/origin 504915cb45c583ac96d0a65e88c1eab7a71e45f9 inchangé ; note de livraison précédente préservée.
- Nouveau registre append-only, migration/rollback 20260917120000 préparés ; confirmation explicite catégorie/source/poids par groupe, acteur JWT, contrôle d'accès avant service, CAS contexte/tête et idempotence. Accès navigateur au registre/RPC interdit ; politiques existantes non modifiées.
- Devis confirmé consomme les lignes PAD par groupe ; sélection/poids/source/tarif périmés refusés, aucune catégorie globale propagée. Finalisation SQL vérifie le contexte et les décisions sous verrou commun ; ce verrou ne sérialise pas tous les writers de faits/sources.
- Gap PAD et demandes non envoyées réconciliés via contrôle frais ; retrait explicite PAD respecté jusque dans le bloc aval de création du gap. Faits et barèmes jamais modifiés par ce lot.
- Interface : marchandises/confirmations courantes distinctes des variantes/historique repliés ; lien du gap ouvre la décision attendue ; rafraîchissement invalide les confirmations ; dossiers verrouillés en lecture seule.
- Tests finaux ciblés : 22 Deno stricts et 20 UI PASS ; typecheck frontend, build, configuration97fonctions, bundles et diff-check PASS. 113 tests Deno de non-régression PASS ; cas historique décision PAD globale/deux lignes rejoué PASS (ambiguïté conservée).
- CI complète non verte : 1561 Deno PASS/1FAIL CRLF historique/6ignorés lors du passage ; fichier et test en échec identiques à origin/work. Lint738erreurs/16avertissements contre baseline configurée737/16 ; comparaison réelle origin/work738, aucune nouvelle erreur. PASS_WITH_BASELINE, pas PASS CI.
- SQL local : schéma seul d'archive privée restauré sans données/propriétaires/ACL, migrations v2/v3 puis nouveau registre ; restauration comporte une erreur realtime.list_changes hors lot. Fixture transactionnelle PASS poids/acteur/replay/CAS/dérive/gap/finalisation/révocation/verrouillage/ACL, rollback des fixtures effectué. Ce n'est pas une preuve d'identité Cloud ni de concurrence simultanée.
- Contre-revue indépendante lecture seule : retrait PAD/réouverture du gap et invalidation UI corrigés, observations levées ; aucun autre blocage identifié dans la revue bornée. SQL non rejoué par le relecteur.
- Limites : allocation canonique ambiguë et poids absents restent bloquants ; confirmation PAD ne résout ni IMO ni terminal. Décision maritime PAD globale active avec plusieurs lignes reste refusée, sans révocation silencieuse.
- Runtime/Cloud/Auth/faits/barèmes inchangés ; aucun commit/push/déploiement/envoi. Retour SQL préparé limité au registre vide avec accusé explicite ; registre renseigné exige correction en avant. Préflight schéma/ACL Cloud frais, qualification complète de la migration et recette authentifiée NOT_RUN ; nécessaires avant livraison autorisée séparément.

- Préflight Cloud SELECT du 17 septembre 16:31UTC : ledger203, version20260917120000/registre/quatre RPC absents ; 190colonnes et contraintes des tables ciblées identiques à la répétition locale. Helpers d'accès présents : lecture authentifiée, écriture créateur/assigné ; aucune permission existante modifiée.
- Permissions par défaut postgres/public Cloud relevées (anon/authenticated/service/sandbox) puis reproduites localement en transaction : réinstallation migration et fixture PASS, refus d'accès table/quatreRPC pour les deux sandbox/anon/authenticated PASS, ROLLBACK local complet. Trigger client_gap_requests et empreinte de fonction identiques. Préflight borné favorable ; recette Cloud toujours NOT_RUN, livraison exige GO distinct et recontrôle frais.

#### Livraison PAD par groupe — 17 septembre 2026 — livraison PASS borné, recette PARTIAL

- GO utilisateur migration/commit/push/preview/3Edge/recette, arrêt premier échec. Accès GitHub rétabli ; identité ponctuelle Codex <noreply@openai.com> explicitement autorisée après refus initial du commit, configuration globale inchangée.
- SQL via query_database 16:39UTC : 20260917120000 appliquée et ledger203→204 atomiquement ; source15362octets SHA2565fafe4d212d9d4f8e84e157e0a9c8cf71c139446b179fb1ef8c922480cfafba8 transportée/relevée identique ; registre0, RLS active, quatreRPC postgres/service_role seulement, table service SELECT/INSERT seulement.
- Git work504915c→533467af01270b9678bb4b17d5d7f04d019d27ae poussé :19fichiers+1087/-25. Lovable types générés seuls+97lignes, examinés puis fast-forward local vers ed5a8a83f4750b97f2d597a7d84aa715dc39b938 ; arbre supabase56af1818a6d6484c3ec19607362f16016266a258 identique.
- Lovable umsg_01m2r3vq7be4r9m8fyn7e19s4f : manage-pad-group-confirmation→run-pricing→build-case-puzzle déployées avec succès annoncé, contrôle arbre après chacune ; OPTIONS200/POSTsansauth401 ; build16,8s/preview200, aucune migration rejouée ni publication publique. Bundle runtime non exposé : preuve sources/déploiement/sondes, pas empreinte du bundle.
- Chrome authentifié TEST450cb321 : nouveau panneau visible, actualisation fonctionne ; scénario sélectionnév2 => parcours historique conservé. Confirmation+pricing positif du nouveau parcours NOT_RUN : fixture v3 avec allocation canonique complète nécessaire, sans utiliser un dossier réel pour l'inventer.
- Chrome GoTrans : trois groupes affichés séparément, propositions T02 distinctes des décisions attendues ; lien du gap ouvre/focalise le premier groupe et son formulaire, bouton désactivé sans sources/attestation. Historique replié. Aucun formulaire soumis, aucun pricing recalculé.
- Contrôle poids GoTrans :2145000+234000+45000=2424000kg du scénario, contre2361000kg du fait courant ; message explicite de désaccord conservé. Pas de validation métier ni correction de fait implicite ; autres exigences IMO/terminal inchangées.
- Intégrité16:46UTC : registre0, ledger204, quote_facts MD5 52f9d333c52925d86e6634fe368e22cf et port_tariffs235a655bf711e7ad8fc6c917f6419fee identiques à l'avant migration ; aucun envoi. Retour SQL possible uniquement registrevide avec accusé, ledger conservé ; aucune restauration effectuée.
- Suite : préparer fixture synthétique compatible et terminer confirmation→calcul→fermeture gap ; examiner séparément la source du total GoTrans avant tout changement de fait. Livraison technique ne vaut pas recette métier complète. Note de clôture locale non commitée.

#### Recette PAD et source poids — 17 septembre 2026 — PARTIAL

- GO utilisateur : adapter TEST450cb321 puis examiner poids GoTrans en lecture seule. HEAD work ed5a8a83 inchangé ; aucun code, commit, push, déploiement ou migration.
- TEST : révision5 v3 créée/sélectionnée via Chrome authentifié, anciennes versions conservées. Allocation1x20GP SOC/10000kg et neuf autres entrées fictives renseignées par supersede_fact, provenance TEST explicite ; aucune donnée GoTrans changée.
- Gap pricing.pad_category initialisé ouvert via RPC existante pour la fixture. Confirmation UI authentifiée754653e2-aecf-4207-9143-673a22f058cb T02/10000kg persistée ; gap resolved et panneau « Classification PAD exploitable » vérifiés. Aucun fait global cargo.pad_category créé.
- Tarif applicable lu : T02 import CONTENEUR PAD9678XOF/t, attendu96780XOF pour10t ; calcul canonique NOT_RUN (zéro pricing_runs TEST), ne pas présenter ce montant attendu comme calcul exécuté.
- Analyse UI TEST refusée : job failed « No emails or documents found for this case ». Aucun statut forcé. Fichier synthétique hors dépôt C:/Users/DELL/.codex/TEST_PAD_20260917.txt préparé pour compléter la source ; upload Chrome refusé « Not allowed », zéro document enregistré. Reprise après accès fichiers extension ou upload manuel ; nouvelle confirmation si contexte périmé.
- GoTrans : e-mail afe8910c-e09f-4f59-be05-3e4c6917bca9 décodé confirme39x55t +13x18t +3x10–15t =2409–2424t. Fait courant2361000kg ai_extraction incompatible avec sa propre source ;2424000kg scénario est borne haute, pas total client exact. Aucun fait corrigé.
- Intégrité finale : registre1 (TEST seulement), barèmes MD5 235a655bf711e7ad8fc6c917f6419fee inchangés, poids GoTrans2361000kg inchangé, aucun envoi. Rollback SQL registre-vide désormais interdit ; décision à préserver. Note locale non commitée.

#### Assistance aux confirmations PAD — 17 septembre 2026 — PASS local borné, non livré

- GO utilisateur : préremplir les justifications disponibles, exposer extrait/calcul et blocages ; aucune correction automatique du poids GoTrans ni confirmation implicite. work ed5a8a83 local/origin alignés, notes précédentes préservées.
- Périmètre : PadGroupConfirmationsPanel et test ; manage-pad-group-confirmation/index, nouveau helper evidence et test. Proposition PAD modifiable explicitement qualifiée ; attestation jamais précochée, changement catégorie efface justification/attestation.
- Assistance source en lecture seule sous droits appelant : fil complet borné, identité client, rapprochement quantité/équipement/propriété/poids/référence ; empreinte SHA256 identique à l'enveloppe de proposition, contexte frais recontrôlé. Échec/ambiguïté => aucun extrait prérempli, saisie sourcée manuelle conservée.
- Extrait client et formule lisibles ; référence technique repliée. Fourchette => poids exact non confirmé et champ source du poids laissé vide. Conflit affiche poids dossier/total scénario ; groupe sans poids => total indéterminé, jamais zéro implicite.
- Tests exécutés :19Deno avec vérification types PASS,6UI PASS,typecheck frontend PASS,build PASS,diff-check PASS. Contre-revue indépendante : empreinte source et total incomplet corrigés puis levés ;3tests provenance rejoués PASS. CI complète et recette Lovable NOT_RUN.
- Aucun changement DB/Auth/RLS/barème/fait/moteur/runtime, aucun commit/push/envoi. GoTrans2361000kg n'est pas corrigé par ce lot ; fourchette2409–2424t demeure à rapprocher explicitement avant devis confirmé.
- Livraison distincte à autoriser : commit/push work, preview privée et manage-pad-group-confirmation seule, recette sans confirmation réelle ni envoi. Rollback applicatif par revert ciblé/rebuild/redéploiement, registre conservé ; aucune migration.

#### Livraison assistance PAD — 17 septembre 2026 — PASS borné

- GO publication utilisateur : commit/push work, preview privée, manage-pad-group-confirmation seule et recette sans confirmation réelle ni envoi.
- Git ed5a8a83 → 59dcc4d40663221ef4064cf8c05593308430c253, origine alignée ; six fichiers +191/-9. Arbre supabase fdebbef95190c74c77f3d627f2bdc728ffcfaf56 inchangé après déploiement selon Lovable.
- Lovable : déploiement unique réussi, OPTIONS200 / POST sans auth401, build Vite20,2s et previewHTTP200. Bundle runtime non exposé : NOT_VERIFIED ; aucune correction automatique de dette Deno.
- Tests rejoués :6UI +19Deno stricts PASS, check:function-config97 PASS, check:scenario-bundles PASS (PATH Deno local rétabli), diff-check PASS ; CI complète NOT_RUN.
- Recette Chrome authentifiée GoTrans en lecture seule : extraits des trois lignes client visibles ; sources et calculs2145000/234000kg préremplis ; lot3 fourchette10–15t explicite, source poids exact vide ; attestations décochées et motifs de désactivation affichés.
- Conflit2424000kg scénario /2361000kg dossier visible. Aucun fait corrigé, aucune confirmation soumise, aucun recalcul ni envoi. Le calcul complet du TEST demeure NOT_RUN, distinct de cette recette UI.
- Intégrité avant/après : registre1 ; faits MD5 8cc3268243897737ca5e5126378e5658 et tarifs MD5 235a655bf711e7ad8fc6c917f6419fee identiques. Aucune migration/Auth/RLS.
- Suite : rapprocher le poids extrait GoTrans avec sa source et traiter la fourchette sans confirmation arbitraire. Rollback applicatif par revert ciblé/rebuild/redéploiement unique ; préserver registre. Note de clôture locale non commitée.

#### Base de poids révisable — 17 septembre 2026 — PASS local borné, non livré

- GO utilisateur local registre/calcul run-pricing/sorties/UI, migration préparée localement/tests/contre-revue ; sans écriture Cloud/publication/barème/fait GoTrans. work59dcc4d local/origin alignés après retry réseau ; note de livraison précédente conservée.
- Contrat PAD distingue confirmed/provisional ; réserve obligatoire en provisoire, choix humain et attestation explicites, aucune promotion en fait. Migration20260917180000 ajoute deux colonnes et remplace writer en préservant CAS/acteur/idempotence/ACL ; défaut confirmé compatible ancien registre.
- Calcul PAD conserve montants et traçabilité ; base unitaire affichée uniquement si per_unit déclaré, produit quantité/poids contrôlé. Qualification jamais ferme avec poids provisoire ; snapshot conserve source et réserve dans les lignes immuables.
- PDF et brouillon portent base unitaire/total/réserve sans troncature au nombre de motifs ; mail déterministe pour ce parcours (pas de réécriture IA). Rendu PDF synthétique3×15t inspecté en PNG, lisible ; aucun document client créé.
- Tests finaux :42Deno stricts +7UI PASS ; typecheck frontend/build PASS, checks config97/bundles PASS, diff-check PASS. Trois sorties Deno check PASS ; run-pricing check conserve2TS2345 historiques aux guards communication/partenaire (aucun correctif hors lot). CI complète NOT_RUN.
- SQL Docker isolé réseau none, base pad_confirmation_test : migration et fixture provisoire/replay/réserve/changement vers exact/historique PASS ; fixture legacy CAS/poids/ACL/finalisation PASS. Rollback sans provisoire puis réapplication PASS ; rollback avec historique provisoire refusé explicitement, fixtures annulées.
- Contre-revue indépendante : affichage unitaire ajouté, risque total ferme/perte réserve dans mail corrigé puis LEVÉ ; tests17Deno et mail rejoués par relecteur. SQL et PDF vérifiés par exécutant uniquement.
- Limites : poids contradictoires/allocation/IMO/autres contrôles restent bloquants ; GoTrans2361000kg non corrigé. Ce lot ne crée pas de procédure de réouverture des dossiers envoyés et ne prouve pas une révision complète post-envoi ; historique des décisions et versions existantes préservé.
- Aucun commit/push/Cloud/envoi. Rollback local préparé interdit dès historique provisoire ; correction en avant ensuite. Avant livraison : préflight Cloud schéma/ACL/ledger en lecture seule et GO distinct migration/commit/push/preview/Edge coordonnés/recette ; aucune décision pendant fenêtre de versions mixtes.

#### Préflight poids révisable — 17 septembre 2026 — PASS lecture seule

- GO limité aux contrôles Cloud et préparation livraison. Local/origin/Lovable59dcc4d alignés, projet prêt privé/non publié ; lot local attendu présent, note précédente conservée. Aucun code modifié/test relancé ce tour.
- Ledger204, migration20260917180000 absente, colonnes weight_basis/weight_reservation et contrainte nouvelles absentes.16colonnes/17contraintes existantes conformes au schéma local testé ; writer Cloud corps identique à migration20260917120000 (normalisation CRLF seulement).
- Trois helpers non modifiés identiques Cloud/local par md5(pg_get_functiondef) ; propriétaire postgres, SECURITY DEFINER/search_path fixé, EXECUTE postgres/service_role uniquement. Registre RLS actif, SELECT/INSERT service_role uniquement hors propriétaire.
- Registre3 désormais : TEST1 + GoTrans lot2/lot1 enregistrés à17:42UTC, à préserver. Empreinte décisions62d4e86e13a137695e7206886ad4026c ; après ajout colonnes comparer projection retirant les deux nouveaux champs. Aucun changement de décision exécuté par Codex.
- Faits8cc3268243897737ca5e5126378e5658 et tarifs235a655bf711e7ad8fc6c917f6419fee inchangés ; poidsGoTrans2361000kg inchangé. Migration locale SHA256 f42e48742469b3ca83cf0db1566c86f73893da4c811807e70585be118387ad57.
- Livraison proposée sous GO distinct : préflight frais, migration+ledger204→205, commit/push/preview privée, sorties generate-quotation-version/export-quotation-version-pdf/create-quotation-email-draft puis run-pricing puis manage-pad-group-confirmation ; contrôle sources/sondes et recette TEST synthétique, GoTrans lecture seule.
- Pendant fenêtre aucune confirmation/recalcul/version/brouillon utilisateur. Aucun envoi ; aucune correction du poidsGoTrans. Rollback SQL uniquement sans historique provisional, sinon correction en avant/préservation décisions ; pas de retrait automatique des validations existantes. Note locale non commitée.

#### Livraison poids révisable — 17 septembre 2026 — PARTIAL, arrêt avant push

- GO utilisateur livraison regroupée avec arrêt au premier échec. Préflight frais local/origin/Lovable59dcc4d, schéma/ACL et trois décisions identiques.
- Migration20260917180000 appliquée avec enregistrement atomique ledger204→205 ; garde writer/ledger/décisions avant écriture et projection des anciennes décisions après ajout colonnes. Accusé PAD_WEIGHT_BASIS_APPLIED.
- Contrôle après écriture : RLS/ACL/propriétaires inchangés, trois décisions conservées confirmed ; empreintes décisions62d4e86e13a137695e7206886ad4026c, faits8cc3268243897737ca5e5126378e5658, tarifs235a655bf711e7ad8fc6c917f6419fee inchangées. Writer MD5 pg_get_functiondef0101cece8985a0a0fb53c38e93a9baec.
- Commit local5a52309 :17fichiers +461/-18. git diff --cached --check a signalé trois lignes vides EOF dans migration/rollback/fixture ; commande PowerShell non conditionnée a malheureusement poursuivi le commit malgré cet échec. Arrêt avant push, aucune modification corrective ni amend automatique.
- Push/preview/cinq déploiements/recette NOT_RUN. Runtime Edge et UI restent anciens ; migration additive compatible, aucune décision provisoire créée. Tests applicatifs non relancés ce tour, preuves locales précédentes conservées.
- Suite : traiter explicitement ce défaut de contrôle de format avant reprise ; ne pas changer la source déjà enregistrée au ledger sans documenter sa différence purement textuelle. Aucun tarif/fait/confirmation GoTrans modifié, aucun envoi. Retour SQL toujours soumis à absence d'historique provisional. Cette note de clôture reste locale non commitée.

#### Reprise livraison poids révisable — 17 septembre 2026

- GO utilisateur correction EOF et reprise livraison/recette. Écart Git expliqué : commit local5a52309 non poussé, origin/Lovable59dcc4d ; ledger205 confirmé, trois décisions et empreintes faits/tarifs inchangées, aucun provisional.
- Correctif strict : une ligne vide EOF supprimée dans migration, rollback et fixture ; aucune instruction SQL changée. Source historique exécutée conservée au ledger sans réécriture ; différence textuelle finale documentée, aucune migration rejouée.
- diff-check PASS après correction ; commandes de reprise conditionnées aux codes de sortie. Tests métier précédents restent la preuve du code inchangé ; recette runtime à poursuivre après cinq déploiements coordonnés, sans envoi ni correction GoTrans.

#### Livraison poids révisable — clôture 17 septembre 2026 — PASS livraison / PARTIAL recette

- Correction EOF f477e91 poussée avec lot5a52309 ; diff-check global59dcc4d→f477e91 PASS.20tests Deno ciblés relancés PASS (PAD, base poids, PDF, brouillon). Tests SQL/7UI/build locaux du lot précédents non relancés.
- Lovable umsg_01m2r9xt0fe53v7tzxn3g34rg7 terminé : build21,1s, preview200 ; cinq Edge déployées dans l'ordre generate-quotation-version, export-quotation-version-pdf, create-quotation-email-draft, run-pricing, manage-pad-group-confirmation. Chaque succès rapporté, OPTIONS200/POSTsansauth401 ; source supabase abfeb743dc8b57919a3bd0257bd53e324ddf58b3 identique. Bundle runtime non exposé, preuve de remplacement conservée.
- Écart automatique expliqué/vérifié :11d6862 puis14be739 ajoutent uniquement6lignes de types pour les deux colonnes ; fast-forward local14be739 aligné origin. Aucun code métier modifié par Lovable, aucune migration rejouée/publication publique/envoi.
- Recette authentifiée TEST450cb321 : UI base révisable/réserve/attestation puis enregistrement réussi ; décisionv2 provisional10000kg et réserve exacte vérifiées SQL, décisionv1 conservée. Restitution « poids provisoire retenu avec réserve » observée.
- Calcul/version/PDF/brouillon runtime NOT_RUN : document synthétique TEST_PAD_20260917.txt non chargé ; sélecteur Chrome timeout puis session navigateur réinitialisée/onglet de recette disparu. Aucun contournement de contrôle de source. Document TEST reste à ajouter avant reprise du parcours complet.
- Contrôle final lecture seule : ledger205, faits8cc3268243897737ca5e5126378e5658 et tarifs235a655bf711e7ad8fc6c917f6419fee inchangés. Deux confirmations GoTrans conservées ; aucune correction poids ni décision lot3.
- Historique provisional désormais présent sur TEST : rollback SQL destructif interdit ; préserver décisions et privilégier correction en avant. Aucun nettoyage effectué. Note de clôture locale non commitée.

#### Recette poids révisable — 18 septembre 2026 — PARTIAL

- Base work14be739 alignée GitHub ; aucun code, commit, push, migration ou déploiement ce tour. Note locale précédente préservée.
- Document utilisateur TEST_PAD_20260917.txt présent/extrait (797 caractères), case450cb321 ; après analyse, confirmation TESTv3 provisional10000kg enregistrée, v1/v2 conservées. Source synthétique et réserve explicites ; aucune action GoTrans.
- Analyse puis calcul canonique Run1 réussis :884380XOF avant TVA SODATRA,983380XOF à payer,9lignes dont2à confirmer. Qualification provisoire et réserve10t visibles ; versionv1 immuable7cdd6e12-46da-4504-bfda-d091a1fc518e créée avec même réserve.
- PDF généré et registre vérifié (3862octets) ; ouverture UI sans document visible dans le navigateur utilisé : contenu/rendu PDF NOT_VERIFIED, ne pas assimiler génération à recette visuelle PASS.
- Brouillon runtime créé : sujet provisoire, base10t/réserve complète vérifiées UI et SQL ; statusdraft,0destinataire,sent_atNULL. Aucun envoi ni marquage envoyé.
- Défauts observés hors correctif : action de revue PAD persistante malgré confirmation exploitable ; postes Surestaries et Droits&Taxes encore TO_CONFIRM pour fixture SOC/DAP. Montant de test, pas validation générale de couverture métier. Après rechargement, panneau brouillon accessible ; bouton PDF revient à PDF Draft.
- Suite : vérifier le PDF effectif et diagnostiquer ces restitutions sans étendre silencieusement le lot. Tests automatisés non relancés ; recette authentifiée ci-dessus uniquement. Historique provisoire à préserver, rollback SQL destructif toujours interdit.

#### Actualisation des actions PAD — 18 septembre 2026 — PASS local, non livré

- GO utilisateur : traiter l’action PAD persistante après confirmation. work14be739 local/GitHub alignés, notes locales antérieures préservées ; queue sans nouvelle entrée PENDING réelle.
- Diagnostic SELECT TEST450cb321 : deux gaps PAD historiques resolved, aucun PAD open ; actions UI mises en cache indépendamment et non invalidées par handleRefresh. Rappel PAD du pipeline affiché inconditionnellement.
- Correctif limité à CaseView, façade frontend padGapReview et PadGapActions.test : rafraîchir ready-actions-panel/next-action-banner/cockpit-state du seul dossier ; rappel de revue uniquement si gap PAD actuellement open. Aucun masquage fondé sur une simple proposition, aucune clôture de gap côté client.
- Tests :15UI PASS (dont résolution/réouverture sans rechargement et isolation inter-dossiers), typecheck PASS, build PASS avec avertissements ; auto-revue ciblée effectuée. Premier test trop large sur badge « Interne » corrigé pour cibler l’action PAD, les autres actions internes restant légitimes.
- Aucun changement moteur/barème/fait/registre/DB/Auth/RLS/Edge ; aucune écriture Cloud, commit, push ni envoi. CI complète et recette Lovable du correctif NOT_RUN.
- Suite : GO distinct commit/push work/preview privée/recette ; sans migration ni redéploiement Edge. Rollback applicatif ciblé, aucune donnée à restaurer.

#### Livraison actualisation PAD — 18 septembre 2026 — PASS borné

- GO utilisateur commit/push work/preview privée/vérification, sans migration ni Edge.14be739→de1f543c2972641d2c3fd92ee61194124143cd1a,4fichiers +68/-4 incluant notes antérieures. Premier push refusé réseau, rejeu réussi ; origine alignée.
- Lovable umsg_01m2t0qf81f8t8jwww8dspkpzh : réponse completed, build Vite ~29s/previewHTTP200, HEAD avant/après de1f543 et arbre supabase abfeb743 inchangés. Diagnostics Deno signalés sans correction, aucune CI complète revendiquée.
- Recette navigateur authentifiée TEST450cb321 après rechargement : action PAD obsolète absente en coordination, rappel inconditionnel absent du pipeline ; version provisoire/réserve10t/brouillon toujours présents, marquage envoyé désactivé sans destinataire. Aucune confirmation/révocation/recalcul/envoi réalisé pour cette livraison.
-15tests UI relancés PASS : fermeture/réouverture dynamique et isolation dossier couvertes localement ; cycle dynamique de mutation Cloud NOT_RUN. Typecheck/build locaux du tour précédent PASS ; contrôle runtime présent limité au dossier TEST.
- Aucun changement DB/Auth/RLS/faits/barèmes/Edge/publication publique. Retour arrière par revert applicatif ciblé et reconstruction preview ; historique conservé. Note de clôture locale non commitée.

#### Rapprochement du poids extrait / base commerciale — 18 septembre 2026 — PARTIAL local

- GO utilisateur exception run-pricing/build-case-puzzle, confirmations/UI/tests/contre-revue, puis migration locale explicitement autorisée ; aucun GO de publication. work de1f543 local/origin alignés, note de clôture précédente préservée.
- Migration20260918120000 : registre append-only service-only, décision retain/revoke, source/justification/réserve, acteur JWT, CAS contexte+têtes et idempotence. Le hash PAD original reste inchangé : pas de réécriture des confirmations ni faits ; seuls totaux ai_extraction contradictoires éligibles.
- Lecture commune et contrôles pricing/puzzle consomment une réconciliation fraîche ; total commercial en tonnes transmis aux entrées moteur, ancien fait conservé. Un changement de contexte/tête/provenance refuse la réutilisation. Les autres blocages IMO/services demeurent indépendants.
- UI : rapprochement explicite séparé des catégories, réserve obligatoire/attestation décochée, révocation ; question de poids distincte dans gap/actions/bannière après synchronisation. Transport CAS limité aux IDs triés, têtes complètes conservées serveur.
- Réserve globale distincte des réserves par groupe, copiée aux lignes immuables et lue par qualification/version/PDF/brouillon sans troncature ; pas de poids exact inventé. Future livraison coordonnée inclut aussi les trois consommateurs de sorties du helper partagé.
- Tests ciblés :36Deno stricts et18UI PASS ; typecheck frontend/build PASS, config97/bundles PASS. Check Deno composants :2TS2345 run-pricing reproduits sur archive origin/work, PASS_WITH_BASELINE ; aucune correction de cette dette. CI complète NOT_RUN.
- SQL PostgreSQL local réseau none, base synthétique pad_weight_reconciliation_test : migration, CAS/idempotence, registre/faits conservés, refus provenance, réouverture gap autorisée et fermeture/finalisation refusées après dérive, ACL héritées retirées PASS. Harnais avec finaliseurs simulés, pas une preuve d’intégration schéma complet.
- Rollback à registre vide puis réapplication PASS ; rollback avec historique refusé PAD_WEIGHT_HISTORY_EXISTS, transactions de test annulées. Aucun historique Cloud concerné. Schéma complet/restauration, concurrence réellement chevauchante et recette applicative NOT_RUN.
- Contre-revue indépendante lecture seule : replay Edge après réponse perdue et garde de provenance atomique corrigés ; réouverture du gap après dérive corrigée ; relectures ciblées et transport IDs conformes. Tests exécutés par Codex, non rejoués par relecteur.
- État :22fichiers locaux (interface/tests, gestion PAD/pricing, helper réserves, migration/rollback/harnas et roadmap), aucun commit/push/Cloud/envoi/barème/fait GoTrans. Pas encore disponible dans Lovable.
- Suite sous GO local existant : intégration SQL sur schéma complet, concurrence et parcours calcul→sorties avant proposition de livraison ; ne pas demander un nouveau GO de réalisation inchangé. Rollback SQL interdit dès première décision persistante, privilégier correction en avant.

#### Rapprochement des poids — intégration locale — 18 septembre 2026 — PASS borné

- GO local inchangé ; work@de1f543 conservé, aucune publication ni lecture/écriture Cloud ce tour.
- Restauration privée du 15/09 dans PostgreSQL isolé réseau none, sans port exposé ; E3 et trois migrations préalables puis 20260918120000 appliquées. Adaptations locales propriétaire DB et pins OID/catalogue E3 après égalité sémantique ; aucune preuve d’identité avec le Cloud frais ni simulation du ledger des migrations récentes.
- Vraies RPC sur schéma restauré complété : scénario, confirmation, rapprochement, replay, fermeture/réouverture gap, finalisation et refus après dérive de provenance PASS ; fait extrait et confirmation conservés. Montant de finalisation SQL synthétique.
- Fixtures pad_group_confirmations, pad_weight_basis et nouvelle pad_weight_reconciliation_full PASS, transactions annulées ; fixtures de concurrence/documents persistées uniquement dans la base locale privée.
- Deux sessions réellement chevauchantes : révocation sous verrou puis assertion d’ancienne tête bloquée et refusée PAD_WEIGHT_HEAD_CHANGED PASS ; ce n’est pas une concurrence HTTP complète.
- Parcours local PAD réel → qualification → PDF/brouillon PASS : 36 t retenues, fait extrait 35 t intact, 348408 XOF ; réserve globale présente, devis provisoire et total indicatif. PDF synthétique hors Git contrôlé visuellement : lisible, sans débordement.
- Limites : entrées et snapshot assemblés par le harnais ; orchestration HTTP run-pricing, persistance de version, authentification et recette Lovable NOT_RUN. CI complète non relancée ; tests ciblés de la section précédente conservés, code applicatif inchangé ce tour.
- Rollback sur ce schéma avec historique refusé PAD_WEIGHT_HISTORY_EXISTS comme attendu, aucun objet supprimé ; retour arrière vide déjà vérifié au lot précédent.
- Contre-revue indépendante des trois nouveaux harnais : aucun bloquant, limites ci-dessus confirmées ; tests non rejoués par le relecteur. Deno check du harnais documents et git diff --check PASS.
- Diff de ce tour : deux scripts locaux, un test SQL complet et cette clôture ; lot total 25 fichiers locaux. Aucun barème/fait GoTrans/secret ajouté, aucun commit/push/déploiement/envoi.
- Suite : préflight Cloud frais en lecture seule, puis GO de livraison distinct et recette authentifiée. Migration et sources restent uniquement locales ; préserver toute décision enregistrée lors d’un retour arrière.

#### Rapprochement des poids — GO livraison reçu, préflight bloqué — 18 septembre 2026

- GO utilisateur reçu : migration20260918120000 + enregistrement, commit/push work/preview, six Edge (version/PDF/brouillon puis run-pricing/build-case-puzzle/manage-pad-group-confirmation), recette TEST et GoTrans lecture seule, arrêt au premier échec, aucun envoi.
- Préflight local work@de1f543, lot attendu présent ; git ls-remote origin refs/heads/work FAIL : connexion github.com:443 impossible après 21145 ms. État distant frais UNKNOWN ; contrôle précédent aligné, non substituable à un contrôle frais.
- Arrêt avant toute écriture : migration/commit/push/déploiement/recette NOT_RUN ; aucun appel Cloud ce tour, aucun fait/barème/Auth/RLS modifié. Seule cette note locale ajoutée ; aucun rollback requis.
- Reprise sous ce même GO après rétablissement et contrôle GitHub, puis recontrôle Cloud ; pas de nouvelle demande d’autorisation si périmètre inchangé.

#### Rapprochement des poids — livraison partielle — 18 septembre 2026

- Reprise sous GO existant : GitHub rétabli, local/GitHub/Lovable de1f543 identiques ; projet prêt, non publié. Préflight Cloud 17:32:51 UTC : ledger205, cible absente, trois empreintes RPC prérequises inchangées.
- Migration20260918120000 appliquée via Lovable query_database avec enregistrement dans la même transaction ; accusé PAD_WEIGHT_MIGRATION_APPLIED. Contrôle persistant : ledger206, registre vide, RLS active ; table SELECT service_role seulement, quatre RPC service_role et helper assert propriétaire seulement.
- Arrêt au contrôle d’identité Git : git var GIT_AUTHOR_IDENT FAIL (identité non configurée). Aucun commit/push/Edge/preview/recette ; work@de1f543 inchangé, code local préservé. Aucune décision commerciale ni donnée GoTrans modifiée.
- Suite : définir l’identité uniquement pour ce commit, puis reprendre les actions nommées sous le même GO, sans rejouer la migration. Retour SQL possible seulement à registre vide, jamais effacer le ledger ; aucune restauration exécutée.

#### Rapprochement des poids — livraison privée — 18 septembre 2026 — PARTIAL

- Identité Codex <noreply@openai.com> autorisée uniquement pour ce commit via options Git ; aucune configuration globale modifiée. work de1f543→e0ce9367f2711da9b887420048a0e7cfcccbc335 poussé, 25 fichiers +731/-22, diff-check PASS.
- Migration non rejouée : contrôle frais version20260918120000 présente une fois, registre vide ; ledger206 précédemment vérifié. Aucun fait GoTrans/barème/confirmation/envoi modifié.
- Lovable message umsg_01m2tsmfcnfqf81fxnm4g9gxwh : six déploiements séquentiels annoncés Successfully deployed (generate-quotation-version, export-quotation-version-pdf, create-quotation-email-draft, run-pricing, build-case-puzzle, manage-pad-group-confirmation), sondes OPTIONS200/POST sans auth401 pour chacun ; arbre supabase4b1ade67ff2df97f803fa590bb51628276281eb8 identique à Git approuvé, worktree propre rapporté après chacun.
- Build preview21,10s PASS rapporté, HTTP200 ; projet prêt/non publié confirmé via connecteur. Bundle runtime non exposé : preuve limitée aux sources + résultat déploiement + sondes, pas une preuve métier.
- Lovable fac78461bfef0312174fe753a413d7a103e2a837 : diff connecteur depuis e0ce936 vérifié, uniquement94 lignes ajoutées à src/integrations/supabase/types.ts pour nouvelle table/RPC ; aucun écart métier. Le HEAD intermédiaire14ab6f8 et sa suppression temporaire des types sont rapportés par Lovable, non adoptés localement.
- Contrôle GitHub final local échoue à nouveau (connexion443,21176ms) après push réussi ; arrêt recette conformément au GO, déploiement déjà envoyé terminé et bilan récupéré. Alignement GitHub final UNKNOWN, HEAD local e0ce936 inchangé.
- Dossier TEST accessible en session authentifiée, aucun calcul/version/brouillon de cette recette lancé : NOT_RUN. Code/UI GoTrans final non recetté ; aucune validation commerciale réelle.
- Suite sous même GO : accès GitHub frais, rapprochement du seul diff généré, puis recette TEST calcul→version→PDF→brouillon et GoTrans lecture seule. Ne pas rejouer SQL ni déployer à nouveau sans nécessité ; retour SQL uniquement registre vide, ledger préservé. Note locale non commitée.

#### Rapprochement des poids — recette authentifiée — 18 septembre 2026 — PARTIAL

- Alignement frais PASS : GitHub/Lovable fac78461bfef0312174fe753a413d7a103e2a837 ; fetch et diff Git depuis e0ce936 confirment uniquement94 lignes de types générés. Fast-forward local effectué, note locale préservée ; aucune migration rejouée ni nouveau déploiement.
- TEST450cb321 : calcul authentifié Run#2 réussi,9 lignes,884380XOF avant TVA SODATRA,99000XOF TVA,983380XOF total provisoire ; réserve groupe10t conservée. Versionv2 créée depuis Run#2 et persistante après rechargement.
- Export PDFv2 généré et ouvert dans un nouvel onglet ; contenu/présentation du nouveau PDF NOT_VERIFIED ce tour.
- FAIL actualisation : après créationv2, carte versions sélectionnev2 mais panneau préparation restev1 avec ancien brouillon ; après rechargement, panneau passev2 sans brouillon. Cause observée côté code : onVersionCreated actualise versionRefreshToken seulement, tandis que le panneau consomme send-quotation-data séparément.
- Arrêt avant écriture de brouillon conformément au GO ; aucun envoi, aucune décision/fait GoTrans modifié. Test réel du rapprochement de poids contradictoires et suite brouillon NOT_RUN ; TEST actuel contrôle seulement la non-régression du poids provisoire, sans conflit global.
- Suite : correctif ciblé de synchronisation création version→panneau brouillon avec test, puis reprise recette ; aucun changement de calcul/barème nécessaire identifié. Note locale non commitée, HEADfac78461 inchangé ; artefacts TEST conservés pour traçabilité.

#### Création de version → brouillon — correctif local — 18 septembre 2026 — PASS local

- GO utilisateur : actualisation ciblée avec tests, sans calcul/tarifs ni publication. Préflight work@fac78461 aligné GitHub au second essai (premier accès443 indisponible) ; notes locales antérieures préservées.
- PricingResultPanel utilise le verrou de sélection déjà consommé par SendQuotationPanel ; invalidation send-quotation-data limitée au dossier et attendue après création, y compris réponse perdue/erreur. Aucun changement des snapshots ou de la logique métier.
- QuotationSelectionSync : trois régressions ajoutées (succès, réponse perdue après écriture simulée, échec relecture), actions brouillon verrouillées pendant création/relecture, ancien texte écarté après succès, échec fermé conservé. Suite ciblée20/20 et frontend488/488 PASS ; typecheck/build/diff-check PASS. Avertissements DOM imbriqué/build présents, sans correction hors lot.
- Auto-revue du diff ciblé effectuée : deux fichiers code/test + présente clôture ; aucune DB/Auth/RLS/Edge, aucun fait/barème ou artefact Cloud modifié. CI complète/Deno et recette Lovable du correctif NOT_RUN, non pertinents au contrôle serveur inchangé / publication non autorisée.
- HEAD inchangé ; aucun commit/push. Retour local : retirer uniquement ces deux diff et cette clôture en préservant les notes précédentes. Suite : GO publication frontend distinct, puis recette TEST ; preuve complète du rapprochement de poids toujours restante.

#### Création de version → brouillon — livraison et recette — 18 septembre 2026 — PASS ciblé

- GO publication utilisateur + identité Codex/noreply@openai.com limitée au commit ; aucune configuration globale modifiée. work fac78461→2dec09071e9f83a076e97ef2d96c0dad1de17ccc,3 fichiers,+87/-5 incluant clôtures antérieures ; push et alignement final GitHub/Lovable PASS.
- Lovable umsg_01m2tv7haxfk4tkag89swcfq4p : build32,7s/HTTP200 rapportés, HEAD et arbre supabase inchangés, aucune édition ; projet ready/is_published=false confirmé. Aucun SQL/migration/déploiement Edge/publication publique.
- Recette UI authentifiée TEST450cb321 : Run#3 réussi9 lignes,884380XOF sous-total+99000TVA=983380total provisoire ; versionv3 depuis Run#3. Pendant création panneau verrouillé, puis v3 cohérente carte/préparation sans rechargement : défaut corrigé.
- PDFv3 généré, visualisation des deux pages : base10t révisable, titre provisoire, totaux et DRAFT présents, aucun chevauchement visible ; pagination2pages perfectible non bloquante. Brouillonv3 généré sans IA, réserve10t et montants conservés ; persistance vérifiée après rechargement, destinataire vide, marquage envoyé désactivé ; aucun envoi.
- Observation non bloquante : avertissement absence PDF restait affiché après export jusqu'à génération du brouillon ; alors PDF détecté. Ne remet pas en cause synchronisation version/brouillon vérifiée, aucun correctif supplémentaire.
- Tests locaux du lot précédent488/488/typecheck/build PASS non rejoués, sources inchangées. GoTrans/faits/barèmes/Auth/RLS inchangés par nos actions ; artefacts TEST conservés. Aucun test de conflit global dans cette recette : rapprochement des poids contradictoires reste à vérifier séparément.
- Retour arrière : revert ciblé2dec090 et reconstruction frontend, sans toucher aux artefacts TEST ni migrations. Note de clôture locale non commitée ; suite utile : terminer la recette spécifique du rapprochement des poids sous son périmètre autorisé.

#### Suite canonique P1-A

- **P1-A2 — objet scénario** : PASS Git + Lovable runtime et nettoyage ; périmètre immuable, révisions, supersession, sélection et comparaison ; aucun pricing.
- **P1-A3 — promotion explicite** : PASS Git + Lovable runtime et nettoyage ; flux unitaire, attesté, idempotent et non monétaire vérifié.
- **P1-A4 — pricing isolé par scénario** : PASS Git + Lovable runtime et nettoyage ; aucun composant FROZEN modifié, aucun écrit dans `quote_facts` ni le pricing canonique, double total et provenance, mono-lot monétaire et multi-lot fail-closed recettés.
- **P1-A5 — versions/PDF/email** : PASS Git + Lovable runtime et nettoyage ; sorties de travail non fermes, hypothèses/exclusions/réserves et doubles totaux visibles, sélection et envoi interdits.

Périmètre restant : **P1-A est clos. Le prochain lot canonique est P1-B — intégration humaine des propositions de frais maritimes.**

Tests obligatoires : RLS, rôles, idempotence, concurrence, provenance, supersession, absence d'écriture automatique dans `quote_facts`, isolation entre scénarios.

### PACK P1-B — intégration humaine des propositions de frais maritimes

État initial de l'audit : moteur et UI `proposal_only`, `amount = null`, suggestions jamais comptées. État courant : voir le verdict daté en fin de cette section ; les trois fonctions P1-B sont déployées, mais la recette métier reste incomplète et le runtime n'est pas validé.

À développer :

- action explicite de confirmation, rejet ou ajustement par l'opérateur ;
- justification et source de la décision ;
- création d'une ligne tarifaire ou TO_CONFIRM seulement après confirmation ;
- versionnement et audit trail ;
- recalcul déterministe sans double comptage ;
- révocation ou remplacement contrôlé d'une décision ;
- présentation client distinguant montant ferme, provisoire et exclu.

Tests obligatoires : aucune suggestion comptée avant confirmation, double clic idempotent, permissions, devise, arrondis, commission sur débours, relecture d'une version historique.

#### État local P1-B au 29 août 2026

- **P1-B0 — lecteur maritime durci : PASS local.** L'endpoint exige désormais une authentification et une preuve d'accès au dossier sous le JWT appelant avant toute lecture minimale sous `service_role`. `AIR_IMPORT`, route et multimodal restent hors périmètre maritime ; FCL, LCL et breakbulk maritimes sont explicitement reconnus.
- **P1-B1 — décision humaine sans effet pricing : PASS local.** Le registre `maritime_fee_decisions` est append-only, versionné, idempotent et protégé contre les collisions et les propositions obsolètes. Les actions explicites `confirm`, `adjust`, `reject` et `revoke` conservent la source, la justification, l'acteur et le snapshot signé de la proposition.
- Le panneau opérateur permet ces quatre actions mais affiche toujours **Non inclus dans le total**. Les suggestions incomplètes ne peuvent pas être confirmées ou ajustées ; un rejet reste possible. Aucun chemin vers `quote_facts`, `pricing_runs`, `quote_service_pricing`, versions, PDF ou email n'a été ajouté.
- Preuves locales : deux resets complets verts ; lecture et mutations Edge authentifiées ; accès lecture partagé et écriture refusée à un membre non propriétaire ; rejeu idempotent ; concurrence identique sans doublon ; proposition obsolète refusée ; historique 3 versions ; nettoyage sandbox intégral. Gates finales : 221 tests frontend, 787 tests Deno avec 6 ignorés, typechecks frontend/Deno sans aggravation, lint baseline et build verts.
- Aucun commit, push, déploiement, migration Lovable ou changement de donnée live n'a été effectué pour ce lot.
- **P1-B2 reste à concevoir et implémenter séparément** : consommation explicite des décisions dans le pricing, déduplication avec les lignes PAD et transporteur déjà structurelles, états ferme/provisoire/exclu et relecture documentaire historique. Ce lot touche le pricing FROZEN et nécessite un GO CTO dédié après validation du modèle de non-double-comptage.

#### P1-B2 — intégration locale et doctrine débours TTC, 30 août 2026

**Statut : contrôles locaux PASS ; publication et recette Lovable non réalisées.** Le GO local P1-B2 autorise la consommation mono-lot dans `run-pricing`. La décision métier suivante remplace toute proposition antérieure d'ajouter automatiquement 18 % : les frais fournisseurs sont des **débours repris à l'identique de la facture, TVA fournisseur incluse**. Le montant de chaque frais est copié une seule fois, sans marge implicite, sans extraction/ré-addition de TVA et sans TVA SODATRA additionnelle. Ce contrat de cotation ne constitue pas une validation comptable ou fiscale du fournisseur.

- Une formule de commission reste indicative : elle ne prouve pas le montant TTC facturé. Une confirmation de commission exige désormais l'attestation explicite que la suggestion égale le TTC du frais sur la pièce ; sinon, l'opérateur saisit ce TTC par ajustement, avec source et justification. La saisie d'ajustement est vide initialement. Ne jamais recopier le total d'une facture regroupant plusieurs frais sur chaque ligne.
- Le serveur inscrit l'attestation dans le JSON existant `proposal_snapshot` : montant TTC, référence opérateur, action et version du contrat. Le client ne peut fournir un snapshot. L'empreinte de proposition reste celle des faits et de la suggestion ; l'empreinte de requête lie l'attestation à l'idempotence. Aucun changement SQL n'est nécessaire pour ce contrat.
- Le pricing refuse une commission dont l'attestation est absente, ancienne, d'une version inconnue ou incohérente avec le montant/la source. Les anciennes décisions ne sont ni réécrites ni présumées TTC : une nouvelle décision est nécessaire. Les lignes et leur provenance figée conservent la référence de la pièce et la base `supplier_invoice_ttc`.
- Le PAD demeure souverain : confirmation exacte et fraîche = attestation sans modification ; ajustement, rejet, différence même fractionnaire ou ligne non ferme = blocage ; révocation = maintien de la ligne canonique. La doctrine TTC n'autorise pas à substituer une facture divergente au PAD ni à modifier DTHC/les autres tarifs.
- Audit Lovable précédent en SELECT uniquement : correspondances de base/taux identifiées pour CMA CGM (COMM, 2,8 % PAD), Grimaldi (COMM, 2,8 % PAD) et Hapag-Lloyd (COLL, 3,5 % fret maritime). Le champ `vat_rate = 18` ne provoque **aucun calcul supplémentaire**. ONE (base non définie) et MSC (conflit avec HTF forfaitaire) restent hors correspondance autorisée ; aucune famille tarifaire n'est activée.
- `service.overrides.remove` utilise le marqueur PAD réel `PORT_DAKAR_HANDLING` et élimine les lignes correspondantes déjà présentes, pas seulement les nouveaux ajouts. Quatre clés canoniques maritimes sont reconnues pour retrait uniquement ; elles ne deviennent pas des services générables. La règle existante `add` prioritaire pour une même clé de package reste inchangée. Aucun lien implicite n'est inventé entre retrait du PAD et suppression d'une commission distincte.
- Une transformation de commission structurelle ferme déjà comprise dans les totaux moteur bloque : on ne laisse pas un montant caché après suppression/mise à zéro d'une ligne. Décisions actives multi-lots, correspondances interdites, erreur de lecture du registre, cache de schéma absent ou historique tronqué bloquent également. Le lecteur vérifie le décompte exact avant de choisir les versions courantes.
- Rectification du diagnostic antérieur : le lecteur maritime transmettait déjà `cargo.freight_cost` et `cargo.freight_currency`. Aucun patch de ce lecteur n'a été ajouté pour Hapag ; USD sans taux explicite demeure bloqué.
- Preuves locales : 57 tests backend ciblés ; 224 tests frontend ; 824 tests Deno, 0 échec, 6 ignorés ; configuration des 97 fonctions ; typecheck frontend ; baseline Deno inchangée (65 diagnostics dans 7 groupes) ; lint inchangé (756 erreurs historiques, 27 avertissements) ; build et `git diff --check`. Exemple testé : débours TTC 3 304 + honoraires 10 000 + TVA SODATRA sur honoraires 1 800 = total 15 104, sans double comptage. Les sept scripts CI ont été exécutés via `pnpm` car le lanceur `ci` appelle un `npm` absent de cet environnement ; aucune baseline n'a été relevée.
- Claude Code Opus xhigh a audité et proposé le module d'attestation ; sa session a été arrêtée après refus de permission d'application non interactive. Codex a appliqué/complété le patch et exécuté les contrôles, sans contourner les permissions et sans deux IA écrivaines simultanées.
- Git : branche `work`, HEAD et référence GitHub vérifiés `6d577da49e099857775fe2f21d8f700367516b11`. Les lots P1-B0/B1/B2 restent locaux et non commités. Aucun commit, push, migration live, changement Auth/RLS, tarif, email ou déploiement. La migration P1-B1 existante n'a pas été modifiée pendant cette clarification.

**Reprise :** une recette locale ne vaut pas preuve runtime. Avant toute publication, vérifier de nouveau Git/Lovable, le lot complet B0/B1/B2, les dépendances de bundle Edge et l'ordre de déploiement registre/backend/frontend ; exiger un GO Git+runtime distinct. La recette devra contrôler montant facture TTC, retrait/rejet/révocation, version/PDF/brouillon historique et cas multi-lots bloqué, sans email réel, puis nettoyer le sandbox. Ne pas considérer l'ensemble P1-B clos ni élargir au pricing scénario sur la seule base de ce PASS local.

#### P1-B — quatre correctifs de reprise, 30 août 2026

**Verdict : PASS local du lot correctif ; P1-B non publié, recette Lovable encore requise.** Le GO utilisateur autorise un seul lot local avec Claude Code, tests et contre-revue, sans publication. Il ne vaut ni GO Git+runtime ni clôture de P1-B.

Faits vérifiés :

- Base inchangée : `work`, `HEAD`, référence GitHub distante et SHA Lovable = `6d577da49e099857775fe2f21d8f700367516b11`. Lovable reste privé et non publié.
- SELECT Lovable préalable : table `maritime_fee_decisions` absente, version `20260829234500` absente du ledger et deux RPC maritimes absentes. La migration locale non publiée peut donc être corrigée sans réécrire une version live. Revalider cette précondition avant publication.
- Révocation d'un rejet : transition SQL désormais permise, avec les mêmes verrous, version attendue, snapshot hérité et montant décidé nul. Une révocation déjà courante ne peut pas être révoquée à nouveau avec une nouvelle clé.
- Décisions orphelines : visibles avec ou sans propositions actuelles, identité du transporteur d'origine, source, montant, version et obsolescence. Seule la révocation est proposée ; aucune nouvelle proposition financière ni réaffectation au nouveau transporteur. Un changement de dossier invalide l'état et les requêtes tardives de l'ancien dossier.
- Reprise idempotente : une clé existante du même dossier atteint l'arbitrage SQL avant la vérification de version courante. Un rejeu identique ne crée pas d'événement ; un payload différent reste en conflit ; une nouvelle clé conserve les gardes de version. Le refus Auth/accès dossier précède toujours l'accès privilégié.
- Historique incomplet : `manage-maritime-fee-decision` exige un tableau et un décompte exact égal à sa longueur, sinon lecture et mutation échouent sans écrire. Aucun contournement par pagination partielle.
- Aucun changement de doctrine PAD, de tarifs, d'attestation TTC, d'Auth/RLS ou de code pricing dans ce correctif. Les changements B0/B1/B2 préexistants hors périmètre sont conservés byte-identiques.

Livraison locale :

- Claude Code Sonnet 5, effort high, a rédigé le patch principal des trois fichiers applicatifs en lecture seule ; Codex l'a appliqué, corrigé l'oubli d'affichage des orphelins en présence d'autres propositions, complété l'isolation par dossier, écrit les régressions et effectué la contre-revue. Aucun contournement des permissions, aucune écriture concurrente.
- Fichiers applicatifs : `MaritimeFeeProposalsPanel.tsx`, `manage-maritime-fee-decision/index.ts`, migration `20260829234500_create_maritime_fee_decisions_p1b1.sql`. Tests : panneau existant, nouveau `manage-maritime-fee-decision/index.test.ts` et nouveau `supabase/tests/maritime_fee_decisions_recovery.sql`. Seul ce document est mis à jour en plus.
- **234 tests frontend** (dont 20 du panneau), **837 tests Deno réussis, 0 échec, 6 ignorés** (dont 13 nouvelles régressions du handler, réseau interdit). Les cinq fichiers live exclus par le script canonique n'ont pas été exécutés.
- Sept gates locaux réussis : configuration 97 fonctions, typecheck frontend, tests frontend, non-aggravation types Deno (65 diagnostics/7 groupes), tests Deno, lint baseline (756 erreurs/27 avertissements historiques inchangés), build. `git diff --check` réussi. Les baselines ne signifient pas zéro dette ; bundle principal 3 586 kB environ.
- PostgreSQL portable 17.11 sur loopback et port 54379, base exclusivement synthétique : échec `reject -> revoke` reproduit avant patch puis réussite après patch ; rejeu, conflit, version obsolète, immutabilité et refus anon/authenticated vérifiés. Deux connexions simultanées renvoient le même ID, une création et un rejeu, un seul événement de révocation. Faits canoniques sentinelles inchangés.
- Fixtures SQL annulées ou supprimées par leurs identifiants exacts : zéro utilisateur, dossier, fait et décision de test restant ; serveur PostgreSQL temporaire arrêté. Aucun reset intégral de toutes les migrations n'a été refait : le test SQL utilise des contrats parents minimaux, pas une réplique exhaustive du runtime.
- Preuves et logs hors repo : `outputs/p1b-correctifs-20260830/` dans le miroir local du projet ChatGPT ; sauvegarde des fichiers source sous `C:\Users\LENOVO\Backups\DakarCargoQuotes\`. Une sauvegarde sur C: ne remplace pas une copie hors machine.
- Aucun commit, push, migration Lovable, déploiement, email ou changement de donnée live. Les tests Windows/Node 24 locaux ne remplacent pas une CI distante propre ni la recette Lovable.

**Reprise obligatoire :** conserver le lot local ; obtenir un GO Git+runtime distinct avant publication coordonnée B0/B1/B2. Recontrôler Git/Lovable et l'absence de migration live, inspecter le lot complet et ses bundles Edge, prévoir rollback et recette sandbox (TTC exact, PAD conservé, retrait/rejet/révocation, reprise réseau, changement de transporteur, multi-lots bloqué, versions/PDF/brouillon sans envoi), puis nettoyage. P1-C vient après cette validation, pas avant.

#### P1-B — publication Git et STOP du déploiement, 30 août 2026

**Verdict : PARTIAL — Git et migration livrés, déploiement incomplet, aucune validation sandbox.** Le GO Git+runtime a été reçu après le PASS local ci-dessus.

Faits vérifiés :

- Les 19 fichiers ont été comparés au manifeste de sauvegarde avant staging. Seule correction mécanique de préparation : retrait d'une ligne vide en fin de `manage-maritime-fee-decision/index.test.ts` ; les 13 tests du handler ont été rejoués avec succès, réseau interdit, puis le diff indexé contrôlé.
- Commit atomique applicatif `148f1bc505f9d33b2e914252468d8a09209f0b36`, poussé sur `work`. [CI GitHub 33321011812](https://github.com/douania/dakar-cargo-quotes/actions/runs/33321011812) intégralement verte : configuration des fonctions, typecheck frontend, tests frontend, baseline Deno, tests Deno, lint baseline et build.
- Migration `20260829234500_create_maritime_fee_decisions_p1b1.sql` appliquée via Lovable dans une transaction gardée contre les collisions, puis inscrite au ledger avec le contenu Git exact. Une seule entrée, une seule chaîne SQL ; MD5 `47b0543b665b1bea8e523e6731f33a9f`, SHA-256 du fichier `df96fcd304165ce42c6d73fbecd839946663e7aca637f3a386d0a187e79f489b`. **Ne pas réappliquer ni réécrire cette migration live.**
- Contrôles post-migration : registre vide ; RLS active ; trigger d'interdiction UPDATE actif ; aucun SELECT/INSERT direct pour authenticated, aucun SELECT pour anon ; accès service_role attendu.
- Rapport de déploiement Lovable : `maritime-fee-proposals` déployée ; `manage-maritime-fee-decision` refusée avec `Module not found .../supabase/functions/maritime-fee-proposals/index.ts` à son import ligne 23 ; `run-pricing` non tentée, arrêt séquentiel. Aucun autre Edge déployé. Ces résultats ne constituent pas une recette fonctionnelle.
- Le graphe local `deno info` se résout, mais ne reproduit pas l'empaquetage Lovable : `import.meta.main` empêche seulement le démarrage du handler importé, pas l'échec de résolution d'un fichier sibling absent du bundle.
- Régénération Lovable `e4ca5742`, puis `9d63697ba362b136ecd0f9e714e0d43143b99bbb` : diff exact limité à **118 lignes de types** pour la nouvelle table et les deux RPC dans `src/integrations/supabase/types.ts`. Aucun changement Auth, backend, configuration ou tarif. Comportement bénin inspecté et accepté sans revert ; alignement local fast-forward.
- [CI GitHub 33321153373](https://github.com/douania/dakar-cargo-quotes/actions/runs/33321153373) également intégralement verte sur ce SHA intégrant les types générés. Ces tests ne prouvent pas la compatibilité avec le bundler Lovable.
- Contrôle final des données : 64 dossiers, 162 runs, 9 versions, 45 brouillons et 5 utilisateurs, identiques au départ ; zéro décision maritime. Les empreintes complètes des six tables contrôlées (pricing_rate_cards, local_transport_rates, carrier_billing_templates, border_clearing_rates, destination_terminal_rates, demurrage_rates) sont inchangées.
- Le formulaire de demande synthétique a été préparé mais **jamais soumis**, puis vidé. Aucun dossier sandbox, PDF, brouillon ou email créé ; aucun objet à supprimer. Le projet reste privé et non publié.
- Preuves de transaction, préconditions, contrôles et rapport de déploiement conservées hors dépôt dans `outputs/p1b-publication-20260830/` du miroir local du projet ChatGPT.

**Correctif minimal proposé, non exécuté :** extraire uniquement le mapping pur `FactRow`, `resolveOperationTypeFromRequestType`, `mapFactsToMaritimeInput` et ses helpers vers un module `_shared`, modifier les imports des trois fonctions et des tests concernés sans changer la logique, puis vérifier l'absence d'import cross-fonction dans leurs dépendances locales. Pas de refactor global, aucun changement tarifaire, PAD, TVA, Auth ou migration.

**Reprise sous GO distinct :** Claude Code pour ce lot de compatibilité bundler, Codex en contre-revue, test de résolution dans un périmètre isolé limité à la fonction et `_shared` (pas seulement `deno info` dans le dépôt complet), CI complète, commit/push atomique, déploiement coordonné des trois consommateurs concernés puis recette sandbox complète initialement prévue et nettoyage. Conserver le ledger et ses traces ; aucun rollback destructif spéculatif. P1-C reste suspendu jusqu'au PASS runtime P1-B.

#### P1-B — bundling corrigé, déploiement complet et recette interrompue, 30 août 2026

**Verdict : PASS du correctif et des déploiements ; PARTIAL de la recette P1-B.** Cette entrée remplace le STOP de bundling précédent, sans effacer sa trace. Le GO reçu autorise le lot ciblé Claude Code, contre-revue, CI, commit/push, déploiement des trois fonctions et reprise sandbox.

- Commit `a85bfd5c482eaacde3e6ff2fb148cf0028de4c40`, branche `work` : cinq fichiers seulement. Extraction des six déclarations pures de mapping vers `_shared/maritime-fee-proposals/fact-mapping.ts`, imports ajustés dans les trois fonctions et le test du lecteur. Les déclarations sont identiques mot pour mot ; handlers/tests identiques hors imports. Aucun changement métier, tarif, PAD, TVA, Auth/RLS ou migration.
- Claude Code Sonnet 5 high fournit le patch principal en lecture seule ; Codex l'applique et le contre-vérifie. Aucune permission contournée, aucune écriture concurrente. Coût Claude rapporté : 0,6111921 USD.
- Régression d'empaquetage reproduite dans des dossiers isolés ne contenant que chaque fonction et `_shared` : deux fonctions échouaient avant patch ; les trois graphes passent après patch (28/31/37 modules). Vérification d'un entrypoint `file:///` réellement analysé, aucune dépendance locale hors périmètre. Ce contrôle est distinct du graphe du dépôt complet.
- 32 tests ciblés réussis ; sept gates locaux réussis : 97 fonctions, typecheck frontend, 234 tests frontend, baseline Deno inchangée (65 diagnostics/7 groupes), 837 tests Deno réussis et 6 ignorés, lint baseline inchangée (756 erreurs/27 avertissements), build. [CI GitHub 33322260159](https://github.com/douania/dakar-cargo-quotes/actions/runs/33322260159) intégralement verte sur le SHA applicatif.
- Lovable rapporte le déploiement réussi de `maritime-fee-proposals`, `manage-maritime-fee-decision` et `run-pricing`, dans cet ordre, depuis le même SHA. OPTIONS : 200 ; POST sans Authorization : 401 sur les trois. Aucun autre Edge, migration, Auth, tarif ou publication touché. Projet privé, ready, non publié. Coût Lovable rapporté : 1,8 crédit.
- Recette authentifiée : dossier fictif `f242fc94-6044-4df1-b1ad-1a27ad7aacc7` / `SANDBOX-P1B-20260830`, propriétaire de session existant ; aucun nouveau compte. Un premier job sans source échoue explicitement avec « No emails or documents found for this case ». Ajout par l'UI d'une source texte synthétique, extraction de 18 faits puis confirmation opérateur LoLo (19 faits). Aucun tarif injecté directement.
- L'alias validé de « PIECES DETACHEES DE MACHINES ET APPAREILS » produit le candidat T02 `ee6c3dbe-bafb-4e6f-aac4-0a79eab41086`. Au dernier SELECT, ce candidat reste `suggested` : la boîte native « Accepter ce candidat » bloque les commandes du navigateur, y compris la confirmation et une tentative de récupération. Ne pas déclarer l'acceptation ou la propagation réussie. Intervention manuelle requise dans Chrome, puis relire l'état avant toute nouvelle action.
- Dernier contrôle sandbox : dossier `NEED_INFO`, 1 document, 0 décision maritime, 0 pricing run, 0 version. Aucun email réel ni publication. Les empreintes complètes des six tables tarifaires contrôlées sont inchangées. Aucun résultat tarifaire P1-B n'est encore prouvé en runtime.
- **Nettoyage restant obligatoire** : document `27103c70-09f6-4849-8328-1b25e6594725`, bucket `case-documents`, objet `f242fc94-6044-4df1-b1ad-1a27ad7aacc7/27103c70-09f6-4849-8328-1b25e6594725-SANDBOX-P1B-source.txt`, puis dossier et dépendances synthétiques exactes. Ne pas supprimer un objet préexistant. Conserver les IDs de tout nouvel objet avant la suite. Ne pas annoncer un nettoyage déjà effectué.
- Preuves locales hors repo : `outputs/p1b-bundler-20260830/` du miroir du projet ChatGPT, notamment `VERIFICATION.md`, logs CI locale, graphes isolés et `SANDBOX_IDS.md`.

**Reprise :** le GO ciblé reste reçu ; aucun nouveau GO technique n'est requis pour terminer la même recette après déblocage du navigateur. Relever l'état Git/Lovable et le statut du candidat, reprendre validation/propagation PAD par le parcours opérateur normal, exclusions de services, propositions/attestation TTC, rejet/révocation/idempotence, pricing anti-double-comptage, multi-lots bloqué, version/PDF/brouillon non envoyé, puis nettoyage intégral. STOP sur défaut réel ou résultat tarifaire inattendu ; ne pas élargir le patch pour faire passer la recette. P1-C reste suspendu jusqu'au PASS runtime P1-B.

#### P1-B — recette TTC/PAD et STOP du parcours versionné, 30 août 2026

**Verdict : PARTIAL ; défaut frontend reproductible avant clôture P1-B.** Cette entrée remplace le blocage de confirmation Chrome précédent. Le GO de recette reste limité : pas de nouveau correctif applicatif pour forcer son succès.

- Base vérifiée : local `work`, GitHub et Lovable `5904aa4d98771a85b1551c5f5a1bad37963439bc`, worktree propre avant mise à jour de ce document ; [CI 33323343098](https://github.com/douania/dakar-cargo-quotes/actions/runs/33323343098) réussie. Aucun code applicatif, migration, déploiement, Auth/RLS ou tarif modifié pendant cette reprise. Projet toujours privé/non publié.
- Le candidat T02 a été accepté par l'utilisateur puis propagé via l'UI : 9 678 FCFA/t, tonnage synthétique 10 t. Reprise d'analyse, 22 faits courants, 100 %, zéro gap bloquant. Exclusions TRUCKING/EMPTY_RETURN/CUSTOMS_DAKAR et LoLo confirmés via le parcours opérateur.
- **Limite de fixture explicite :** l'intake avait réduit le 20DV présent dans la source à `20'`. Le DTHC refuse correctement une taille seule non qualifiée. Les deux seuls faits `cargo.container_type`/`cargo.containers` ont été normalisés en 20DV via transaction sandbox gardée et RPC `supersede_fact`, avec historique et source de préparation explicite. Aucun tarif injecté. Cette recette ne prouve pas un intake intégral ni une édition UI du JSON conteneurs.
- Témoin sans décision (run2) : total à payer 388 880 XOF. Après PAD exact confirmé et commission CMA ajustée/attestée au TTC synthétique de 3 304 XOF (run3) : total 392 184 XOF, delta exact 3 304 ; TVA SODATRA inchangée à 13 500 sur 75 000 d'honoraires. Une seule ligne PAD 96 780, une seule DTHC 155 000, une seule commission 3 304. Cinq autres postes restent `TO_CONFIRM` ; aucun devis global ferme ni tarif activé.
- Sans attestation TTC, sauvegarde de commission désactivée ; après attestation, décision enregistrée sous JWT opérateur. Le serveur conserve `amount_basis=supplier_invoice_ttc`, montant 3 304, `vat_added_by_sodatra=false`, source et justification fictives. Aucune facture client réelle utilisée.
- Rejet PAD v2 : run4 `blocked`, message explicite imposant révocation ou correction catégorie/tonnage. Révocation v3 du rejet enregistrée avec chaîne `supersedes_id` intacte. La transition SQL corrective `reject -> revoke` est donc prouvée live ; le recalcul après révocation ne l'est pas encore.
- Version v1 `b4c13470-22f3-4609-9a8c-ebc4d8d58aa8`, run3, 16 lignes, qualification `provisional`. MD5 du snapshot `05b58cef352e4c988cc4ef17e5d860cb`, identique après rejet et révocation. Provenance TTC conservée dans `raw_lines`.
- PDF généré par l'UI et contrôlé visuellement sur deux pages : PAD/commission/totaux identiques ; postes inconnus « À confirmer », DEVIS PROVISOIRE, DRAFT, non contractuel. Document `0bc12e5f-15ee-4d44-a39b-af858e26487b`, SHA-256 `a509d505f83988d9a4534dfe7d770078d2eec9ef787c346a09928c43e41928d3`. Gabarit existant avec certains libellés abrégés ; aucun patch PDF. Aucun brouillon email créé ni envoyé.
- **Défaut vérifié après rafraîchissement :** dossier `QUOTED_VERSIONED`, décisions maritimes encore possibles mais aucun bouton de recalcul/analyse. `CaseView.tsx:2038` exclut ce statut de `showPricingPanel` et `:2050` de `isRerun`, alors que `run-pricing/index.ts:1368` l'autorise. Le dernier run réussi et l'action « Créer version de devis v2 » restent visibles ; le panneau de récupération du dernier run bloqué est lui-même masqué. Aucun statut DB forcé pour contourner le défaut. L'utilisation d'une ancienne version comme nouvelle sortie après décision reste un risque à tester, pas une fuite déclarée prouvée.
- Recettes runtime restantes : recalcul post-révocation, retrait maritime canonique, orphelin après changement de transporteur, multi-lots bloqué, rejeu/concurrence, brouillon historique. Les preuves locales existantes ne les remplacent pas. Pas de nouvelle CI locale exécutée sans modification du code.
- Empreintes complètes des six tables tarifaires identiques avant/après recette : 35 pricing_rate_cards, 141 local_transport_rates, 59 carrier_billing_templates, 6 border_clearing_rates, 10 destination_terminal_rates, 35 demurrage_rates. Migration P1-B1 inchangée ; ne pas la réappliquer.
- **Nettoyage BLOQUÉ, aucune suppression effectuée** : exactement le dossier synthétique déjà identifié, 4 runs, 4 décisions, 1 version/16 lignes, document source et PDF, 24 faits, 2 gaps, 4 jobs, 46 événements et 1 candidat associés. Aucun brouillon ni nouvel utilisateur. Les deux objets Storage existent encore. Lovable n'a pas de session opérateur injectée ; sa commande normale de session pour l'opérateur existant exige une approbation humaine indisponible dans ce contexte. Aucun contournement, aucune suppression SQL de storage.objects, aucune création de compte. Les lignes métier sont conservées pour éviter de rendre les fichiers orphelins. Terminer via une session normalement approuvée ou l'interface Storage avec confirmation humaine, puis supprimer les dépendances DB exactes et vérifier retour aux baselines : 64 dossiers, 162 runs, 9 versions, 45 brouillons, 5 utilisateurs, zéro décision maritime.
- Deux demandes de nettoyage bornées à Lovable n'ont changé aucun fichier ni donnée (rapports de l'agent, Git inchangé, SELECT final : 65 dossiers, 166 runs, 10 versions, 45 brouillons, 5 utilisateurs, 4 décisions et les 2 objets Storage attendus) ; coûts rapportés 3,4 puis 1,1 crédits. Ne pas répéter le minting refusé ni élargir les permissions pour éviter ce blocage.
- Preuves détaillées hors repo : `outputs/p1b-bundler-20260830/RUNTIME_REPRISE_20260830.md` et `SANDBOX_IDS.md` dans le miroir local du projet ; aucun secret conservé.

**Correctif candidat sous nouveau GO :** lot frontend chirurgical de reprise explicite d'un dossier versionné **non envoyé**, affichage du dernier blocage et tests après version/PDF/rejet/révocation. Préserver les versions historiques, ne pas déclencher automatiquement le pricing, ne pas élargir les états envoyés/finalisés, vérifier les gardes de nouvelle version/brouillon. Claude Code pour patch/tests, Codex en contre-revue ; CI et GO de synchronisation adaptés au périmètre confirmé. Aucune justification établie pour modifier tarifs, Auth/RLS ou migration. P1-C reste suspendu jusqu'au PASS runtime P1-B et nettoyage complet.

#### P1-B — correctif frontend de reprise validé localement, 30 août 2026

**Verdict : PASS local du lot frontend ; PARTIAL runtime P1-B maintenu.** GO utilisateur reçu pour correction ciblée avec Claude Code, contre-revue, tests, commit/push `work`, synchronisation privée puis reprise de la recette et nettoyage. Base propre locale/GitHub/Lovable vérifiée : `7f6e3cbe247b8299193d50da96a24338e2588561`.

- Claude Code Sonnet 5 high a fourni la proposition read-only (coût rapporté 1,861156 USD, aucun refus ni contournement de permission) ; Codex applique et contre-vérifie, sans modification concurrente.
- Trois fichiers applicatifs seulement : `CaseView.tsx`, son helper pur existant et `PricingLaunchPanel.tsx`. QUOTED_VERSIONED devient un rerun manuel ; SENT/ACCEPTED/REJECTED/ARCHIVED/PRICING_RUNNING restent verrouillés même avec le flag DDP provisoire. Intention, préchecks, confirmation et écritures backend restent inchangés.
- Invalidation exacte de la query du dernier run dans le `finally` de chaque tentative, y compris erreur et retour anticipé. Aucun appel automatique ajouté, aucune version/PDF/fact réécrite par ce patch. Deux fichiers de tests ajoutent 37 régressions : statuts, guards, clic/confirmation/annulation, success -> blocked -> success, erreurs et isolation inter-dossiers.
- Sept gates locaux verts : 97 fonctions configurées, typecheck, 271 tests frontend, baseline Deno 65 diagnostics/7 groupes inchangée, 837 tests Deno réussis/6 ignorés, lint baseline 756 erreurs/27 avertissements inchangée, build. Le bundle volumineux demeure une dette P2, non aggravation fonctionnelle revendiquée uniquement sur les tests exécutés.
- Contrôle de périmètre : aucun backend, migration, Auth/RLS, tarif, doctrine PAD/DTHC/TVA, dépendance ou config modifié. Les gardes versions/brouillons sont inspectées en lecture seule : le filtre du dernier run réussi ne prouve pas à lui seul la fraîcheur commerciale ; ne pas confondre une version historique idempotente avec une nouvelle offre à jour.
- SELECT avant publication : même sandbox QUOTED_VERSIONED, 4 runs/4 décisions/1 version ; MD5 historique inchangé `05b58cef352e4c988cc4ef17e5d860cb`. Aucun nouvel objet runtime créé pendant le patch. Storage est accessible via la session plateforme déjà connectée ; aucune suppression encore effectuée.
- Preuves hors dépôt : `outputs/p1b-frontend-recovery-20260830/` du miroir projet ChatGPT (proposition Claude, contre-revue, logs des sept gates). Les IDs et inventaires précédents restent ceux à nettoyer.

**Suite autorisée :** commit/push atomique, vérifier CI GitHub et alignement Lovable sans déploiement Edge ni publication publique, reprendre le recalcul après révocation et les contrôles P1-B restants. Nettoyage exact Storage puis DB via parcours approuvé, contrôle des baselines et empreintes tarifaires. STOP sur divergence, défaut réel ou montant inattendu. P1-C reste suspendu ; ne pas déclarer P1-B clos avant ces preuves.

#### P1-B — frontend livré, recette de reprise positive, autorisation précise restante

- Commit `91474c4f48f5af834ad0279ab929b444ebb52e18` sur `work`, [CI GitHub 33326711410](https://github.com/douania/dakar-cargo-quotes/actions/runs/33326711410) entièrement verte. Lovable aligné sur ce SHA, privé/non publié. Après rechargement, l'UI expose le bouton de relance en statut Versionné et l'alerte run4. Aucun redéploiement Edge ni autre runtime applicatif.
- Run5 `e348744a-1b4a-41ab-a4b3-bde913358e8d` : success392184 après révocation PAD, commission TTC3304, TVA SODATRA13500, PAD conservé. Alerte du run4 disparue sans rechargement. Run6 `7da280d7-2b1c-4a45-8491-f2a970496558` : success388880 après retrait explicite de CMA_CGM_COMM, état `excluded_by_scope_override`, delta exact3304 sans taxe ajoutée.
- Run7 `4a5a2c43-0ec8-4ef8-a0b6-b1e4d1e1d03f` : blocked sans total ; chacun des deux lots reçoit `PAD_MULTI_LOT_UNSUPPORTED` et `MARITIME_FEE_DECISION_MULTI_LOT_UNSUPPORTED`. Run8 `482f02da-ccdf-49db-8af9-c6c47592608b` : blocked sans total, `MARITIME_FEE_DECISION_INCOHERENT` après changement fictif CMA -> ONE. Alertes run7/8 immédiatement affichées.
- Préparations distinctes du parcours UI : supersessions gardées des seuls faits sandbox `service.overrides` puis `carrier.name`, fonction live vérifiée ; deux lignes de fixture multi-lot ajoutées puis supprimées par IDs exacts après contrôle. Aucun statut forcé, tarif injecté ou fait client modifié. Overrides initiaux restaurés ; transporteur fictif courant ONE ; zéro ligne de lot restante. Les lancements de pricing et la lecture des propositions passent par l'UI authentifiée.
- L'UI montre l'ancienne décision CMA orpheline avec montant/source/justification et seule action Révoquer, séparée de la proposition ONE. **La sauvegarde de révocation est refusée par le contrôle de sécurité du navigateur avant exécution**, qui demande une autorisation spécifique malgré le GO général de recette. Ce n'est pas une erreur SQL/Edge prouvée. Toujours quatre décisions ; aucune révocation CMA enregistrée. Ne pas contourner par SQL, CLI ou autre agent. Autorisation précise demandée pour la décision `9229fc74-e9a6-4d4f-86b3-ae6afdcf2409` et le nettoyage du seul sandbox.
- Version v1 toujours draft/run3, MD5 `05b58cef352e4c988cc4ef17e5d860cb` inchangé. Aucun nouveau devis/PDF/brouillon/email. Empreintes complètes des six familles tarifaires identiques ; migration P1-B1 MD5 `47b0543b665b1bea8e523e6731f33a9f` inchangé.
- **Inventaire à conserver avant nettoyage** : même dossier `f242fc94-6044-4df1-b1ad-1a27ad7aacc7`, 8runs, 4décisions, 1version/16lignes, 27faits, 2gaps, 4jobs, 53événements, 1candidat et 1document source. Les deux objets Storage source/PDF listés précédemment sont toujours présents. Compteurs globaux65/170/10/45/5/4 contre baseline cible64/162/9/45/5/0. Les deux lignes multi-lot créées pour cette recette seules ont été supprimées, fixtures reproductibles.
- Preuves et IDs complets : `outputs/p1b-frontend-recovery-20260830/RUNTIME.md` hors repo. Restent à prouver en runtime : révocation orpheline/recalcul, rejeu/concurrence ledger, brouillon non envoyé et nettoyage. Aucun PASS global P1-B ni reprise P1-C avant résolution.

#### P1-B — révocation CMA et nettoyage intégral prouvés, 30 août 2026

**Verdict : PASS du périmètre révocation/nettoyage ; PARTIAL du pack P1-B maintenu.** L'autorisation explicite de l'utilisateur lève le blocage précédent pour le seul dossier SANDBOX-P1B-20260830. Aucun contournement de permission, aucun minting de session. Git local/GitHub/Lovable alignés sur `4107658ff9fe1e47d7f3351b86499f0d6ae4d312` avant cette mise à jour documentaire ; code applicatif `91474c4f` inchangé, CI précédente `33327315732` réussie.

- Révocation enregistrée par l'UI : `0e17859a-5e26-44d6-8e7b-e226c5393ee0`, CMA revoke v2, supersedes `9229fc74-e9a6-4d4f-86b3-ae6afdcf2409`, montant nul. La décision orpheline n'est plus active.
- Run9 `4f896204-7129-48a8-9f10-a9fabb6cfbbc` confirmé via UI : success508880, TVA SODATRA13500, PAD canonique conservé, aucune commission CMA réintroduite. Le delta de120000 avec le témoin CMA388880 est expliqué par les frais transporteur ONE168600 contre CMA48600, vérifiés dans les lignes calculées et les modèles live inchangés ; aucune nouvelle validation documentaire ni promotion tarifaire.
- Version v1/run3 : snapshot MD5 `05b58cef352e4c988cc4ef17e5d860cb` inchangé jusqu'à suppression. Aucun nouveau devis/PDF/brouillon/email.
- Deux objets Storage exacts supprimés via la console plateforme existante et vérifiés absents : source743octets sous `case-documents/f242fc94-6044-4df1-b1ad-1a27ad7aacc7/`, PDF4519octets `quotation-attachments/QC-f242fc94-6044-4df1-b1ad-1a27ad7aacc7/v1/draft-1788110274782.pdf`. Aucun DELETE SQL de `storage.objects`, aucun bucket supprimé.
- Transaction DB gardée par ID/owner/statut/contact fictif, cardinalités, absence de références inter-dossiers et empreintes hors sandbox avant/après : 123 lignes supprimées (dossier1, document source1, jobs4, événements55, candidat1, décisions5, runs9, version1, faits27, gaps2, lignes version16, enregistrement PDF1). Contrôles post-transaction : zéro résidu dans les31tables portant case_id, dossier/version/PDF/Storage absents.
- Baselines retrouvées :64dossiers/162runs/9versions/45brouillons/5users/0décision ; 35 empreintes des données hors sandbox strictement identiques. Six catalogues tarifaires et migration20260829234500 (MD5 `47b0543b665b1bea8e523e6731f33a9f`) inchangés. Aucun dossier client, Auth/RLS, tarif ou email réel modifié.
- Preuves conservées hors repo : `outputs/p1b-frontend-recovery-20260830/CLEANUP.md`, `cleanup-authorized.sql`, `cleanup-proof.json`. Suppressions runtime non annulables depuis l'interface ; fixtures synthétiques conservées, sans revendiquer de sauvegarde binaire restaurable du PDF.
- Lovable retourne completed/ready, privé/non publié, SHA conforme. Des cartes historiques de l'éditeur indiquent encore « Échec de la génération / L'aperçu n'est pas à jour » ; la reprise UI est prouvée, mais ces notifications n'ont pas fait l'objet d'un correctif ou déploiement supplémentaire.

**Reprise :** terminer uniquement les preuves runtime de rejeu/concurrence du ledger et du brouillon historique non envoyé, sur une nouvelle fixture minimale autorisée avec nettoyage. Ne pas réutiliser les identifiants supprimés ni déclarer P1-B clos sur les seuls tests locaux. P1-C non commencé.

#### P1-B — recette duo complémentaire, brouillon historique et STOP sélection, 30 août 2026

**Verdict : PASS des contrôles listés et du nettoyage ; PARTIAL / STOP P1-B global.** GO CTO DUO CONTINU reçu pour recette et documentation, sans patch applicatif. Claude Code Sonnet effort high a effectué deux analyses Read/Grep/Glob, sans écriture ni accès runtime ; Codex a exécuté la recette et arbitré. Git local `work`, GitHub et Lovable alignés sur `78b08603fb87b89cd256fc4ab5910c08bf076b44`, code applicatif `91474c4f` inchangé.

- Nouvelle fixture `SANDBOX-P1B-DUO-20260830`, dossier `11e5828f-6c6a-4dad-a2f3-9621a94648b4`, contact `p1b-duo@example.invalid`. Création par intake UI ; aucun nouveau compte, thread, document ou objet Storage. Compléments et deux runs/snapshots canonical synthétiques préparés par SQL gardé, avec statut de fixture `QUOTED_VERSIONED` : **ceci ne constitue pas une nouvelle preuve de calcul tarifaire, de génération de version ou de transition FSM**.
- Rejet CMA sans montant via l'UI ; rejeu RPC même clé/fingerprint : même ID, sans doublon. Assertions live : `IDEMPOTENCY_CONFLICT`/23505 et `STALE_DECISION`/40001 refusés sans mutation. Les essais RPC lancés en parallèle retournent des PID différents mais des intervalles non chevauchants : **concurrence transactionnelle simultanée non prouvée**. Des réponses longues annulées499 ont imposé un contrôle DB avant reprise ; des paramètres de fixture incorrects ont été refusés22023, sans patch applicatif.
- Deux onglets du même compte, tous deux préparés sur v5, puis soumissions demandées simultanément : une seule révocation v6 `09325b88-eef5-4f80-b3dd-13ccd6020988`, aucun doublon/v7. L'autre vue finit en « Décision non enregistrée / Edge Function returned a non-2xx status code » ; annuler/recharger restitue v6. Latence prolongée observée, origine et statut HTTP exact non capturés ; ne pas inventer une preuve HTTP409 ni deux utilisateurs distincts.
- Brouillon historique réel via `create-quotation-email-draft` : `fec6d2f2-50a1-4edc-986e-8b9f5fdc2a64`, lié à v1 `bb583965-34ba-4e0a-822c-cc9739625c61`, status draft/sent_at NULL/IA désactivée. Malgré Run2/V2, il reprend uniquement route/réserve v1 et les repères fictifs 13 304 avant TVA SODATRA, 1 800 de TVA, 15 104 à payer, caractère provisoire et réserve TO_CONFIRM. Aucun faux PDF joint. Rejeu depuis l'autre vue : même brouillon, aucun doublon. Après sélection v2 (repère total 28 000), corps v1 MD5 `128222858683470dc858b6f55e748c0f` inchangé.
- **Défaut reproduit :** `QuotationVersionCard` affiche v2 sélectionnée et la DB confirme `is_selected=true` sur v2, mais `SendQuotationPanel` conserve v1/15 104/ancien brouillon et le bouton de marquage actif. Rechargement complet : v2/28 000, sans brouillon, bouton désactivé. Cause statique : `handleSelectVersion` ne rafraîchit que le state local de `usePricingResultData`, pas la query `['send-quotation-data', caseId]` de `useSendQuotation`.
- Protection conservée : `send-quotation` recharge et vérifie `is_selected` avant mutation et contrôle la correspondance draft/version. **Preuve statique, pas un test d'envoi runtime** ; aucun marquage ni email tenté. Claude juge la garde suffisante pour éviter un blocage global ; arbitrage Codex : le mandat impose STOP sur défaut réel, et une UI commerciale contradictoire ne permet pas de clore P1-B. Aucun élargissement Auth/backend/pricing nécessaire pour le correctif proposé.
- Nettoyage transactionnel gardé par ID/owner/horodatage/contact, cardinalités, révocation courante et 35 empreintes avant/après : **28 lignes supprimées** (dossier1, faits9, événements7, décisions6, runs2, versions2, brouillon1), aucun fichier créé/supprimé. Zéro résidu dans les 31 tables case_id ; baselines64/162/9/45/5/0 et 35 empreintes hors sandbox identiques. Six catalogues tarifaires inchangés ; migration20260829234500 MD5 `47b0543b665b1bea8e523e6731f33a9f` inchangée. Suppression runtime non annulable dans l'UI ; seules les fixtures synthétiques et leurs lignes archivées sont conservées hors repo.
- Preuves hors repo : `outputs/p1b-duo-final-20260830/RESULTAT.md`, `proof-before-cleanup.json`, `fixture-archive.json`, `cleanup.sql`, `cleanup-proof.json` et analyses Claude. Comparaison Git/Lovable des quatre fichiers principaux concernés PASS ; projet privé/non publié, SHA inchangé. Aucune CI applicative relancée en l'absence de changement de code ; les résultats antérieurs 271 frontend/837 Deno (6 ignorés) restent des preuves historiques.

**Reprise indispensable :** GO local ciblé pour synchroniser sélection et panneau de brouillon, empêcher une action sur l'ancien cache pendant le rafraîchissement et préserver les brouillons historiques. Tests : sélection v1→v2 sans reload, v2 avec/sans brouillon, retour v1, chargement/échec, éditions non sauvegardées, aucune mutation/envoi involontaire. Claude pour le patch, Codex en contre-revue ; aucun refactor, changement de tarif/Auth/backend/migration. Synchronisation privée et nouvelle recette sous autorisation adaptée, puis compléter la preuve de concurrence live avec chevauchement observable sans forger de session ni contourner une permission. P1-C reste non commencé jusqu'au PASS P1-B.

#### P1-B — correctif de synchronisation version/brouillon, 30 août 2026

**Verdict : PASS local ; recette runtime P1-B encore à terminer.** GO utilisateur reçu pour correctif frontend ciblé, tests, contre-revue, commit/push `work`, synchronisation privée et reprise sandbox. Base Git local/GitHub/Lovable vérifiée `78b08603fb87b89cd256fc4ab5910c08bf076b44`, projet privé/non publié. Claude Code Sonnet high a fourni le candidat principal ; Codex a corrigé les lacunes de revue ; une relecture finale Claude en Read/Grep/Glob uniquement conclut PASS (session `9a33b439-2d47-49bd-b390-7518368f385b`). Une seule IA écrit à la fois.

- Périmètre : `QuotationVersionCard.tsx`, `SendQuotationPanel.tsx`, `useSendQuotation.ts` et nouveau `QuotationSelectionSync.test.tsx`. Sélection : invalidation des deux lectures par dossier, y compris query inactive ; attente des deux rafraîchissements même si la réponse RPC est ambiguë ; erreurs Supabase critiques propagées ; liste des cartes masquée sur erreur ; gardes au clic et fermeture de confirmation sur changement de version. Brouillons et snapshots historiques non modifiés implicitement.
- Tests locaux : **17 régressions ciblées, 288 tests frontend, 837 tests Deno PASS / 6 ignorés** ; typecheck app/node PASS ; 97 fonctions configurées ; baseline Deno **65 erreurs / 7 groupes inchangés**, lint **756 erreurs / 27 avertissements inchangés** ; build PASS (avertissement préexistant de gros bundle, environ 3,59 Mo non compressé). Aucune baseline relevée.
- Aucun backend, Auth/RLS, tarif, migration, email réel ou publication publique modifié. Les mises à jour explicites de brouillon restent filtrées par leur ID/version ; pas de verrou distribué ajouté. La relecture ne remplace pas la recette live.
- Preuves locales hors repo : `outputs/p1b-selection-sync-20260830/` dans le miroir ChatGPT. Les sept commandes de CI ont été exécutées avec les binaires Node/Deno portables, équivalentes aux scripts `package.json`, sans `test:deno:live`.

**Suite autorisée :** commit/push atomique du lot, vérifier CI GitHub et synchronisation privée ; nouvelle fixture fictive pour sélection v1/v2 avec/sans brouillon, édition non sauvegardée, brouillons jamais envoyés, rejeu/concurrence avec chevauchement réellement observable, puis nettoyage gardé et contrôle des 35 empreintes métier et six catalogues. P1-C read-only uniquement après PASS P1-B complet ; STOP sur défaut réel, divergence ou permission bloquante.

#### P1-B — clôture de la recette duo et nettoyage, nuit du 30 au 31 août 2026

**Verdict : PASS P1-B dans le périmètre privé validé ; NO-GO production générale inchangé.** Le GO correctif frontend a été exécuté : commit/push atomique `f54951f081e426bf204c7c87f84385e890f4fdc1`, CI GitHub [33337511099](https://github.com/douania/dakar-cargo-quotes/actions/runs/33337511099) PASS. Local/GitHub/Lovable alignés ; les trois fichiers applicatifs modifiés ont été comparés avec le source Lovable au même SHA. Aucun déploiement Edge, changement Auth, migration, tarif ou publication publique.

- Nouvelle fixture `SANDBOX-P1B-SELECTION-20260830`, ID `5e21d3c4-aaca-4715-b731-2feb8201731f`, contact `p1b-selection@example.invalid`, utilisateur existant autorisé. Deux runs et snapshots canoniques **préparés synthétiquement**, repères v1 15 104 et v2 28 000 : ce montage n'est pas une nouvelle preuve de calcul, génération de version ou transition FSM. Les recettes précédentes documentées conservent ces preuves.
- UI authentifiée : v1 vers v2 sans reload, cartes et panneau concordants ; v2 sans brouillon n'affiche pas l'ancien ; retour v1 retrouve son brouillon inchangé ; une édition v1 non sauvegardée ne fuit pas vers v2. Deux brouillons créés par le parcours normal, chacun sur sa version, route, réserves et total propres ; mode IA désactivé, `status=draft`, `sent_at=NULL`. Aucun clic de marquage/envoi, aucun email, aucun PDF/document/objet Storage créé.
- Rejet CMA v1 sans montant par UI. Concurrence sur la RPC existante : deux connexions PostgreSQL distinctes, transactions réellement chevauchantes et clé/payload identiques, verrou transactionnel gardé 8 secondes sur le seul sandbox. Le second appel attend 2,542 secondes ; un seul revoke v2 `52c28b06-f9de-4620-bf72-bb13c7cbc1b0`, renvoyé à l'identique avec `idempotent_replay=true`. **Preuve de concurrence DB/RPC, pas de deux requêtes HTTP Edge simultanées ni de deux utilisateurs.** Les connecteurs ont retourné 499 ; les événements persistés prouvent le résultat, contrôlé avant toute suite, sans retry aveugle.
- Même clé avec fingerprint différent : `IDEMPOTENCY_CONFLICT`/23505 ; nouvelle clé avec version attendue périmée : `STALE_DECISION`/40001. Aucun changement du ledger après ces deux refus. La vue opérateur confirme la révocation v2 sans montant.
- Snapshots v1/v2 et corps des deux brouillons inchangés jusqu'au nettoyage, fidélité historique vérifiée par empreintes. Archive synthétique des 23 lignes conservée hors repo avant suppression. Aucune donnée client extraite pour cette archive.
- Nettoyage transactionnel gardé par ID, propriétaire, date, contact fictif, dernière révocation et empreintes ciblées/hors sandbox : suppression de 1 dossier, 9 faits, 2 runs, 2 versions, 2 brouillons, 5 événements et 2 décisions. **PASS_CLEANUP_BASELINE_RESTORED** : 64 dossiers/162 runs/9 versions/45 brouillons/5 users/0 décision ; 35 empreintes identiques à la baseline dans la transaction avant commit, sinon rollback. Aucun objet Storage à supprimer. Ces suppressions runtime ne sont pas annulables dans l'UI ; les lignes synthétiques sont archivées hors repo.
- Six catalogues complets inchangés : 35 cartes, 141 tarifs locaux, 59 modèles transporteur, 6 frontières, 10 terminaux destination, 35 demurrage. Migration `20260829234500` MD5 `47b0543b665b1bea8e523e6731f33a9f` et corps de la RPC MD5 `e6aaca7c615deb6c18365b5bff6110e7` inchangés ; pas de réapplication de migration. Aucun compte Auth créé/modifié ; cette recette n'est pas une nouvelle matrice exhaustive de tests RLS.
- Preuves hors repo : `outputs/p1b-selection-sync-20260830/RESULTAT.md`, `proof-before-cleanup.json`, `cleanup.sql`, `cleanup-proof.json`, logs CI et relectures Claude. Tests locaux du lot : 17 ciblés / 288 frontend / 837 Deno PASS, 6 ignorés ; baselines types/lint inchangées.

**Suite :** P1-B clos. Le GO DUO autorise maintenant seulement l'audit P1-C en lecture seule et sa documentation ; aucune implémentation automatique de l'état commercial consolidé ni modification d'un composant FROZEN avant validation du modèle et GO adapté.

### PACK P1-C — `final_request_state`

Objectif : construire un état commercial consolidé représentant la dernière demande réellement applicable.

À concevoir avant implémentation :

- modèle des sources : emails, chaînes citées, pièces jointes, anciens devis, réponses client et échanges internes ;
- règles de priorité temporelle et commerciale ;
- détection des contradictions ;
- distinction fait courant, ancien fait, hypothèse et instruction annulée ;
- provenance et justification de chaque valeur consolidée ;
- validation humaine des conflits critiques ;
- projection stable vers le puzzle et le pricing sans réécrire silencieusement l'historique.

Garde initiale : aucun patch avant validation CTO du modèle, des invariants et des cas de conflit GWC ou équivalents. Le GO local du 31 août valide uniquement le contrat borné P1-C1 décrit ci-dessous ; il n'autorise ni persistance, ni projection, ni changement runtime.

#### Audit initial P1-C terminé — lecture seule, 31 août 2026

**Verdict : audit terminé ; conception à valider, aucune implémentation ni recette runtime P1-C.** Claude Code Sonnet high a analysé import/intention/chargement du thread en Read/Grep/Glob uniquement (session `1347752c-fb4f-4db5-a8c4-6a5b1e42c747`) ; Codex a contre-vérifié les constats, complété `build-case-puzzle`/gate pricing et consulté uniquement les métadonnées Lovable. Aucun email réel lu, aucune mutation après le nettoyage P1-B. Git/GitHub/Lovable applicatifs `f54951f081e426bf204c7c87f84385e890f4fdc1`.

Faits établis :

- Aucun objet dédié `final_request_state` retrouvé dans code/migrations ou schéma public consulté. Les faits ont déjà provenance/validation/supersession et les runs un snapshot ; ces mécanismes ne forment pas encore une révision commerciale consolidée.
- Trois horloges coexistent : `CaseView.tsx:547` choisit l'email à analyser par `received_at`, le thread/puzzle trie par `sent_at`, et `run-pricing/index.ts:1326` retient l'intention par date de création de l'événement. Une analyse tardive d'un ancien email peut donc reprendre la priorité. `import-thread/index.ts:85` remplace en outre une date invalide par maintenant. Risque statique établi, pas de mauvais devis runtime démontré.
- `analyze-thread-event/index.ts:103,164` classe un corps brut, sans auteur/date ni séparation des citations ; le résultat est un événement JSONB, pas une révision avec amendements par champ/lot. `apply-thread-intent-v1` crée des tâches, pas une consolidation.
- `build-case-puzzle/index.ts:5251` agrège les entrants non-SODATRA et les pièces jointes ; `8340` attribue à tous les faits IA le même dernier email entrant. Ce filtre n'établit ni le rôle client de chaque auteur ni la source exacte de chaque valeur. Les gardes monétaires client/partenaire, faits manuels, documents historiques, citations multi-quote et supersession existent néanmoins et doivent être préservées.
- L'idempotence des événements d'intention reste SELECT puis INSERT ; la timeline live n'a pas d'unicité métier ni de trigger utilisateur. C'est un risque concurrent statique, **distinct du ledger maritime P1-B validé**. Pas de test de course runtime P1-C effectué.
- Contre-revue : les états actuels `ACCEPTED`/`REJECTED` existent, contrairement à l'énumération historique partielle citée par Claude ; ne pas imposer une nouvelle FSM sans conception. Une analyse manuelle par email existe aussi dans l'administration : le problème est l'absence de consolidation, pas l'impossibilité absolue d'analyser un email intermédiaire. Refus de devis et annulation de demande ne sont pas équivalents.

Modèle recommandé, **à approuver avant patch** : projection commerciale versionnée distincte de `quote_facts` et des scénarios, sources/rôles/périmètre identifiés, assertions typées et citations par valeur, amendements ciblés, historique immuable, révision attendue et conflits humains. Dernier email ne signifie jamais à lui seul dernière demande applicable.

Invariants proposés : une instruction explicite ne modifie que les champs/lots concernés ; silence, citation, accusé de réception ou tarif partenaire ne remplacent pas la demande ; contradiction avec un fait opérateur validé = revue humaine, sans écrasement ; annulation/refus/retrait/hypothèse distincts ; acceptation liée à une version identifiable ; provenance/date/lot ambigus = à confirmer ; révisions/rejeux atomiques ; aucun tarif, hypothèse ou devis historique promu automatiquement. Doctrine PAD/DTHC/débours TTC/service.overrides inchangée.

Tests à créer : amendement puis simple remerciement, import/analyse hors ordre, date manquante ou égale, partenaire/interne plus récent, ancien texte cité/PDF, annulation/reprise vs refus d'offre, retrait d'un seul lot/service, conflit opérateur/client, rejeu/concurrence/révision périmée, scénario non promu, versions et brouillons historiques immuables. Réutiliser les six profils anonymisés P1-A ; la fixture GWC actuelle est une régression ciblée, pas encore une chaîne complète P1-C.

**Ordre recommandé : P1-C1 contrat + résolveur pur/fixtures sans DB ni pricing ; P1-C2 révisions persistées et revue humaine ; P1-C3 projection contrôlée vers puzzle/pricing/snapshots.** Aucun composant FROZEN modifié sans GO dédié. Rapport détaillé et limites de preuve hors repo : `outputs/p1b-selection-sync-20260830/AUDIT_P1C.md`. Le GO DUO est terminé ; le prochain patch exige validation du modèle et autorisation locale adaptée, sans reprendre les recettes P1-B déjà nettoyées.

#### P1-C1 — contrat borné et résolveur pur, PASS local, 31 août 2026

**Autorisation et verdict :** GO utilisateur reçu sur « valider le modèle P1-C1, puis développer son résolveur et ses tests, sans toucher initialement au pricing ni au runtime ». **PASS local P1-C1 ; P1-C global reste incomplet et NO-GO production générale maintenu.** L'audit initial ci-dessus demeure une preuve historique ; sa garde de validation est satisfaite pour ce seul lot. Aucun commit, push, PR, lecture d'email réel, fixture live, migration, déploiement ou publication.

Livrables locaux :

- `supabase/functions/_shared/final-request-state.ts` : fonction pure `resolveFinalRequestState(unknown)`, sans import ni I/O, horloge courante, aléa ou mutation de l'entrée. Aucun handler, composant FROZEN ou consommateur existant modifié. Le seul import du module est son fichier de tests.
- `supabase/functions/_tests/final_request_state.test.ts` : 93 tests locaux, dont six profils synthétiques représentatifs (FCL LoLo, aérien, réexport, transit/multi-destinations, marchandises dangereuses, cross-trade), amendements et collisions adversariales. Aucune donnée client ni dépendance à la boîte email.
- Cette roadmap : diff antérieur de clôture P1-B/audit P1-C préservé ; seules les nouvelles preuves et conditions de reprise sont ajoutées.

Contrat validé et frontières :

- Enveloppe fermée d'un dossier, lots et versions identifiés, sources classées et assertions typées avec extrait exact présent dans la source. Vocabulaire initial de 17 champs non monétaires, bornes de taille, refus des clés/types inconnus et des références inter-dossiers ou manquantes. Toute extension du vocabulaire doit être revue.
- Seule une instruction client explicite, attestée, courante et datée fait autorité. Les notes opérateur, réponses partenaires, citations, documents historiques et hypothèses restent du contexte. Les dates d'import/analyse n'existent pas dans le contrat ; une date absente, invalide ou sans fuseau ne devient jamais « maintenant ».
- Résolution champ par champ et lot par lot, jamais remplacement global par le dernier email ni propagation implicite dossier vers lots. Même instant avec valeurs contradictoires, rôle/date ambigus ou conflit avec fait protégé : `needs_review`, sans présenter le champ ambigu comme résolu et sans écraser le fait validé. Le conflit protégé antérieur reste visible même si un email suivant rejoint sa valeur.
- Annulation/reprise explicite de demande et acceptation/refus d'une version de devis sont séparés. Un remerciement, un amendement ou une acceptation ne rouvre pas une demande annulée. Un retrait devient une trace explicite, pas un effacement de l'historique. Provenance et extrait sont conservés dans les valeurs retenues et le journal des assertions.
- Sorties discriminées : `invalid_input`, `needs_review`, `consistent`, `cancelled`, `no_request`. **`consistent` signifie seulement absence de conflit détecté dans le sous-ensemble fourni : ni demande complète, ni validation humaine, ni autorisation de devis/pricing.** Les services descriptifs ne modifient pas `service.overrides`. Les clés descriptives ne sont pas encore un mapping vers les faits canoniques.
- L'adaptateur de confiance reste à construire : le résolveur ne prouve pas l'identité réelle de l'auteur, l'Auth, la segmentation citation/corps courant ni la justesse sémantique d'une assertion. `roleVerified` est une précondition fournie par cet adaptateur, jamais une preuve acceptée directement d'un navigateur. L'extrait exact est une preuve lexicale, pas une validation de sens.
- `schemaVersion: 1` versionne uniquement le format. Déterminisme/rejeu en mémoire et détection des collisions ne prouvent ni persistance, ni révisions métier, ni verrou/CAS, ni concurrence DB. Ces garanties et la résolution humaine des conflits relèvent de P1-C2. La projection vers puzzle/pricing/snapshots relève de P1-C3.

Exécution et contre-revue : Claude Code Sonnet high (`claude-sonnet-5`, session `b2b4cc3e-762b-40e7-9e12-315a123a6c95`) a fourni le candidat principal en Read/Grep/Glob uniquement, sans accès runtime ni permission contournée. Codex a appliqué le candidat, écrit les tests et corrigé les écarts établis : 24 échecs sur les 87 premiers contre-tests, puis 93/93 après correction et compléments. Les lacunes concernaient notamment l'autorité des notes internes, les égalités de dates, la provenance de sortie, les cibles ambiguës et les bornes/objets d'entrée. Une seule IA écrit à la fois ; ne pas attribuer à Claude une exécution des tests ni une contre-revue finale qu'il n'a pas effectuées.

Gates locaux après correction : **93 tests ciblés PASS avec vérification de types Deno ; suite backend locale 930 PASS / 0 FAIL / 6 ignorés ; frontend 288 PASS / 16 fichiers ; typecheck app + node, build et configuration des 97 fonctions PASS.** Suite backend exécutée avec `--no-check` selon le gate existant, cinq fichiers smoke runtime exclus et sans réseau autorisé ; les six ignorés du harness cargo sont préexistants. Baseline Deno inchangée : 65 erreurs connues/7 groupes ; lint inchangé : 756 erreurs/27 avertissements. Aucun seuil relevé. Les deux nouveaux fichiers passent leur lint sans erreur/avertissement, `deno fmt --check` et le typecheck ciblé. Avertissement de bundle frontend volumineux préexistant inchangé (~3,59 Mo). La CI GitHub `33337511099` concerne P1-B seulement : aucune nouvelle CI distante n'a été déclenchée pour ce lot non poussé.

Preuves locales hors dépôt : `outputs/p1c1-local-20260831/REVUE_CTO.md`, candidat Claude, logs avant/après et logs de gates. `roadmap-before.md` conserve la version documentaire d'entrée. Git local/GitHub revérifiés au même SHA `f54951f081e426bf204c7c87f84385e890f4fdc1` ; aucune divergence constatée. Aucun verdict runtime P1-C n'est revendiqué.

**Suite canonique : P1-C2 — concevoir la persistance des révisions, l'idempotence/CAS, l'autorité des sources et la revue humaine, avant tout patch DB/RLS/RPC.** Conserver les trois fichiers locaux ; pas de déploiement isolé nécessaire pour ce résolveur encore inutilisé. Un GO adapté reste nécessaire pour étendre le lot, commit/push ou agir sur le runtime. P1-C3, tarifs, Auth et pricing ne sont pas autorisés par le GO P1-C1 ; aucune recette P1-B déjà nettoyée à recommencer.

#### P1-C2 — audit terminé, habilitation validée avec parcours solo, 31 août 2026

GO reçu pour audit/conception Claude Code puis contre-revue Codex uniquement. **Audit terminé ; plan candidat documenté, aucune implémentation P1-C2 ni validation runtime.** Git local/origin/GitHub et Lovable revérifiés au SHA `f54951f081e426bf204c7c87f84385e890f4fdc1`, Lovable privé/ready/non publié. SELECT de métadonnées seulement : policies, privilèges, colonnes, contraintes et enums ; aucun email/client/tarif lu, aucune écriture live. Résolveur et 93 tests P1-C1 inchangés, aucun commit/push ni nouvelle CI. Claude Sonnet high, session `fef034b1-ae0d-4756-99c6-9bfee81c7f18`, Read/Grep/Glob ; Codex a corrigé le plan, pas le code.

Plan détaillé hors dépôt : `C:/Users/LENOVO/.codex/.chatgpt-projects/g-p-6a06fa989d1c8191a79126df51a03c8e/outputs/p1c2-audit-20260831/PLAN_P1C2_CTO.md`. Modèle candidat : versions sources/attestations immuables, révisions avec manifeste et snapshots, liens de provenance inter-dossiers contrôlés, événements de revue append-only, tête/génération et registre de commandes idempotentes. Aucun nouveau champ FSM ni event_type partagé ; aucune cascade de purge générale pour faciliter une sandbox. Séparer résultat calculé, revue humaine et future autorisation de projection.

Corrections importantes du rapport Claude : `ACCEPTED`/`REJECTED` existent bien dans `quote_case_status`, pas dans `quotation_versions.status` ; des consommateurs de `cargo_lines` existent malgré un ancien commentaire de migration. L'existence d'un acteur en DB ne prouve pas son identité. Un hash de payload n'atteste ni la fraîcheur, ni la complétude, ni l'exécution du résolveur. Les verrous P1-C2 ne sérialisent pas les anciens writers : on revoit une capture identifiée, jamais une vérité perpétuellement courante. P1-C3 devra contrôler sa fraîcheur avant projection/pricing. Aucun conflit protégé effacé ou fait canonique réécrit par une revue P1-C2.

**Arbitrage métier validé le 31 août 2026, sous condition de simplicité :** seuls des validateurs SODATRA désignés attestent les sources et valident les contradictions, mais les fonctions sont cumulables. Le cotateur actuel, qui traite seul les demandes reçues par email, doit pouvoir préparer, attester et valider depuis le même compte, sans deuxième personne, deuxième connexion ni changement de rôle par dossier. Une future équipe utilise le même parcours avec des habilitations attribuables ; aucune séparation obligatoire préparateur/validateur. Conserver la traçabilité même si l'acteur est identique. Revue intégrée au dossier, confirmations explicites sur les points nécessaires, pas de reconfirmation d'une décision strictement inchangée ni de circuit hiérarchique artificiel. Les sources ambiguës et révisions périmées restent bloquées ; aucune validation automatique globale.

Habilitation strictement P1-C2 : pas de réutilisation des rôles PAD, pas de RBAC global, aucun compte live habilité automatiquement. Prévoir l'identification et l'habilitation du cotateur actuel avant activation du futur workflow, sous autorisation runtime adaptée ; ne pas déduire un nom/UUID de l'accord métier. Ajouter aux tests le parcours complet par un seul utilisateur habilité et le refus de validation pour un préparateur non habilité. Le plan hors dépôt (§8) est actualisé. Cette décision autorise sa documentation, pas un patch applicatif/DB, commit/push ou changement runtime.

Suite décidée lors de cet audit : P1-C2-A local (contrat/adaptateur borné, stockage/RPC et tests locaux), puis P1-C2-B (orchestration et UI de revue), livraison/recette sous GO Git+runtime distinct, enfin P1-C3. Le GO et le résultat P1-C2-A sont consignés ci-dessous. L'arbitrage d'habilitation est clos : ne pas le redemander sans fait nouveau. Préserver les travaux locaux et le NO-GO production générale. Pas de nouvelle recette P1-B à lancer.

#### P1-C2-A — stockage et validation, PASS local, 31 août 2026

**Autorisation :** GO utilisateur sur « développement local P1-C2-A, le socle de stockage et de validation ». **PASS local uniquement ; P1-C2 n'est pas encore branché à l'application.** Aucun commit/push/PR, compte réel habilité, migration live, changement Lovable, pricing, tarif, email ou publication. Le GO n'autorise pas P1-C2-B ni P1-C3.

Quatre nouveaux fichiers, sans modification d'un consommateur existant :

- `supabase/functions/_shared/final-request-state-persistence.ts` : adaptateur pur d'une capture DB fermée et d'assertions typées vers C1, calcul refait côté serveur, cibles de revue/provenance et limitations explicites ; `pricingAuthorized: false` constant. Aucun accès DB, réseau ni authentification dans ce module.
- `supabase/functions/_tests/final_request_state_persistence.test.ts` : 45 tests de contrat, provenance, limites, conflits protégés et absence d'autorisation de pricing.
- `supabase/migrations/20260831120000_create_final_request_state_p1c2a.sql` : huit tables dédiées, sources/révisions/décisions/commandes immuables, tête à génération, habilitation dédiée avec historique, RPC contrôlées et RLS sans accès direct. Installation atomique ; toute réapplication ou collision du namespace est **refusée**, jamais adoptée silencieusement. Ce n'est pas une migration à réappliquer comme no-op.
- `supabase/tests/final_request_state_p1c2a.sql` : contrats SQL, privilèges, FK inter-dossiers, immutabilité, entrées invalides et régression du statut d'annulation. Script borné à la base fictive `dcq_p1c2a`, TCP interne `127.0.0.1:54380`, transaction annulée en fin de test ; ne pas le pointer vers Lovable.

Garanties établies localement :

- Le même utilisateur habilité peut préparer, attester et valider. Un préparateur non habilité ne peut pas valider. Aucun rôle PAD réutilisé ; attribution/révocation réservée à une opération administrateur explicite, indisponible au rôle applicatif `service_role`. Aucun utilisateur réel ajouté.
- Inventaire construit en DB à partir des emails/pièces jointes/documents/lots/faits protégés/versions du dossier, sans liste ni pagination déclarée par le navigateur. Sources versionnées et captures conservées ; changement d'une source ne reprend pas silencieusement son attestation. Les versions scénario ne deviennent pas des devis canoniques acceptables.
- Rejeu durable par clé et requête JSON structurellement identique, y compris représentation numérique `1000`/`1000.0`. Acteur/payload différent : conflit. Permission actuelle vérifiée même pour rejouer une ancienne réponse. Verrou dossier, tête/génération CAS et coordination avec la révocation d'habilitation ; une seule décision acceptée sur révision concurrente.
- Revue liée à une révision, capture, cible et instruction précises ; nouvelle révision sans héritage implicite de validation. Décision révoquée conservée dans l'historique. Le résultat C1 brut n'est jamais réécrit pour masquer un conflit. Choisir une instruction opposée à un fait protégé produit `needs_fact_reconciliation`, sans toucher à `quote_facts` ni permettre le pricing.
- Sources non attestées/tronquées/vides/non datées, faits protégés non mappables/ambigus et ambiguïtés de lots sont des limitations explicites. Travail partiel conservable, mais revue complète refusée tant que ces limitations ou conflits subsistent. Dates originales conservées ; précision non représentable refusée plutôt qu'arrondie. Le stockage refuse l'année zéro, absente du calendrier PostgreSQL.
- `anon`/`authenticated` sans accès au ledger ni aux RPC ; `service_role` limité à `frs_read`/`frs_mutate`, sans lecture/écriture directe, TRUNCATE, attribution d'habilitation ni exécution des helpers. Tables historiques protégées même contre UPDATE/DELETE/TRUNCATE du propriétaire. FK `RESTRICT`, sans purge générale en cascade.

Exécution et contre-revue : Claude Code, permissions Read/Grep/Glob uniquement, a fourni l'adaptateur candidat (Sonnet medium, session `633cf3b7-434f-489b-9ae1-7fb824b9c93f`) puis contre-revu le SQL (Sonnet high, `bc368232-d370-43b2-b4a3-ff81e78272b4`). Codex a assemblé le SQL, appliqué les fichiers, écrit/exécuté les contre-tests et corrigé les écarts. La première tentative Claude monolithique a été arrêtée après saturation de sortie sans candidat exploitable ; le lot a été découpé sans contourner ses permissions. Une seule IA écrit. Le défaut P1 signalé par Claude — annulation prétendument résolue alors que son assertion restait en conflit — a été reproduit, corrigé et testé ; contrôles additionnels des conflits protégés et des bornes UTF-16 ajoutés. Ne pas attribuer à Claude l'exécution de la CI ni une revue finale de chaque ligne corrigée ensuite.

**Preuves locales :** 138 tests ciblés C1 + adaptateur avec typecheck Deno (93 conservés + 45 nouveaux), 975 tests backend PASS / 0 FAIL / 6 ignorés, 288 tests frontend PASS ; typecheck app/node, configuration des 97 fonctions, build et baselines Deno/lint PASS. Baselines inchangées : 65 erreurs Deno dans 7 groupes, 756 erreurs et 27 avertissements lint ; aucun seuil relevé. Les deux nouveaux fichiers TypeScript passent aussi leur lint sans erreur et `deno fmt --check`. Suite backend complète selon le gate existant `--no-check`, cinq smoke runtime exclus et six tests cargo ignorés préexistants. Bundle ~3,59 Mo, avertissement connu inchangé. Pas de nouvelle CI GitHub, puisque rien n'a été poussé.

SQL exécuté sur PostgreSQL 17.10 dans un conteneur Docker jetable dédié, réseau `none`, sans port hôte, données fictives en tmpfs. **Schémas parents de contrat minimaux conformes aux colonnes auditées, pas un reset de tout l'historique applicatif.** Le script SQL de contrats passe ; intégration du parcours solo et **sept chevauchements réels à deux sessions** passent, dont validations concurrentes et révocation. Les 23 contre-tests adversariaux passent. Sentinelles faits/pricing/versions/brouillons/tarifs inchangées par les opérations P1-C2-A. Une seconde installation et une collision avec table incompatible sont refusées ; empreintes du ledger, des définitions et privilèges inchangées. Le PostgreSQL portable initialement bloqué par Windows n'a pas été forcé ; Docker a été utilisé une fois disponible, sans toucher aux conteneurs applicatifs existants.

Preuves et harness hors dépôt : `C:/Users/LENOVO/.codex/.chatgpt-projects/g-p-6a06fa989d1c8191a79126df51a03c8e/outputs/p1c2a-local-20260831/` (`gates-accepted.jsonl`, `focused-formatted.log`, `integration-final.log`, `adversarial-final.log`, `sql-contracts-final.log`, `review-regression-pass.log`, `reapplication-pass.log`, scripts et fixtures synthétiques). Les 912 fichiers suivis sont restés identiques à l'entrée du lot avant cette actualisation documentaire ; P1-C1 et son test restent byte-identiques. Nettoyage terminé : seul le conteneur de test identifié `dcq-p1c2a-20260831` a été arrêté, ses deux bases fictives en tmpfs éliminées et reproductibles par les scripts ; les onze autres conteneurs actifs sont restés inchangés. Aucun dossier client ni donnée runtime concerné.

**Limites et reprise :** l'identité JWT doit encore être dérivée/vérifiée par une Edge authentifiée P1-C2-B ; un UUID existant en DB n'est pas une preuve d'identité. Le SQL vérifie les contrats/provenances mais ne réimplémente pas C1 : l'orchestrateur serveur devra appeler l'adaptateur lui-même, sans accepter un résultat calculé fourni par le navigateur. Une revue porte sur une capture identifiée, pas sur une vérité perpétuellement courante : les anciens writers ne partagent pas ces verrous ; P1-C3 devra revérifier la fraîcheur avant toute projection. Aucune preuve UI, JWT de bout en bout, migration de l'historique complet ou recette runtime P1-C2 n'est revendiquée.

**Suite canonique : P1-C2-B local**, orchestration authentifiée et interface de revue simple dans le dossier, sous GO adapté ; préserver le parcours solo, les limitations visibles et l'absence de pricing. Avant une livraison Git/runtime distincte : revalider schémas/privilèges/migration contre Git et Lovable, organiser l'habilitation explicite du cotateur, recette et nettoyage autorisés. P1-C3 seulement ensuite. NO-GO production générale maintenu.

#### P1-C2-B — orchestration authentifiée et revue opérateur, PASS local, 1er septembre 2026

**Autorisation et verdict :** GO local utilisateur reçu, y compris le hotfix P1-C2-A permettant à l'Edge seule de lire les références d'attestation avec leur empreinte PostgreSQL. **PASS local du périmètre P1-C2-B ; P1-C global reste incomplet et le NO-GO production générale est maintenu.** Aucun commit, push, PR, migration live, accès Lovable, compte réel habilité, email, pricing, tarif ou publication.

Lot chirurgical :

- `supabase/functions/manage-final-request-state/domain.ts`, `index.ts` et `domain.test.ts` : contrat fermé `read/capture/attest_source/commit/review`, identité issue du JWT, contrôle RLS du dossier avant élévation `service_role`, CAS/idempotence, recalcul C1 côté serveur et erreurs non bavardes. Acteur, résultat, hash, inventaire et autorisation de pricing fournis par le navigateur sont refusés.
- `src/lib/finalRequestState.ts`, `src/components/case/FinalRequestStatePanel.tsx` et son test : panneau manuel et repliable, sources/limitations/historique/révisions, attestation et revue explicites, brouillons conservés après échec, double clic neutralisé et réponses tardives ignorées lors d'un changement de dossier. Aucune action de pricing, aucun envoi et aucun éditeur JSON/assertion libre.
- `src/lib/finalRequestAssertions.ts` et son test, `src/components/case/FinalRequestAssertionEditor.tsx` et son test : adaptateur de saisie humaine fermé sur les 17 champs et 7 opérations C1. Seules les sources versionnées client/current/attestées/datées sont utilisables ; scope, lot, devis, enums, nombres et booléens sont typés, l'extrait doit être présent mot pour mot. Aucun LLM, heuristique, champ monétaire ou parsing automatique. Le brouillon est borné à 100 assertions, conserve sa clé après erreur, refuse les doublons et ne recharge une révision que si sa capture correspond exactement.
- `src/pages/CaseView.tsx` : seule insertion du panneau dans le dossier. `supabase/config.toml` : déclaration unique de `manage-final-request-state`; la fonction vérifie elle-même le JWT réel comme les autres fonctions protégées du dépôt.
- Hotfix P1-C2-A dans la migration et son test SQL : la réponse de capture expose à l'Edge des `sourceAttestationRefs` calculées par `frs_hash` en PostgreSQL. L'orchestrateur retire ensuite `sourceHash` **et** `capture.inventoryHash` de toute réponse navigateur. Ni le navigateur ni TypeScript n'inventent ou ne réinjectent une empreinte.

Garanties vérifiées : l'Edge ne construit le client privilégié qu'après `requireUser` et un SELECT `quote_cases` avec le JWT utilisateur sous RLS ; le même cotateur habilité peut suivre le parcours solo, tandis que l'habilitation DB reste séparée et non attribuée ici. `commit` recalcule le résolveur P1-C1 depuis la capture relue ; `review` n'accepte que les cibles/candidats calculés serveur. Toutes les sorties forcent `pricingAuthorized: false`. Aucun appel à `run-pricing`, puzzle, faits, devis ou email. La contre-revue Claude Code Sonnet medium, strictement read-only, a trouvé l'exposition de `capture.inventoryHash`; Codex l'a corrigée et a ajouté les assertions de non-régression. Aucun autre défaut bloquant identifié après correction.

**Preuves locales après correction :** configuration de 98 fonctions PASS ; typecheck app/node PASS ; 337 tests frontend PASS ; 988 tests Deno PASS, 0 échec, 6 ignorés ; baselines inchangées à 65 erreurs Deno dans 7 groupes et 756 erreurs/27 avertissements lint ; lint ciblé des nouveaux fichiers TypeScript/TSX du lot sans erreur ; build PASS (~3,62 Mo, avertissement de taille connu). Les 13 tests du domaine, 31 tests de l'adaptateur, 7 tests de l'éditeur et 11 tests du panneau ciblés passent après la contre-revue. Le contrat SQL P1-C2-A repasse sur PostgreSQL 17.10. Une intégration synthétique réelle exécute capture, attestation avec hash DB invisible au navigateur, recalcul/commit C1 et revue, tout en prouvant inchangées les sentinelles pricing, faits, versions, brouillons et tarifs (`P1C2B_INTEGRATION_PASS`). Claude Code Sonnet a produit le cœur pur puis une contre-revue read-only complète ; le seul défaut produit P2 trouvé (limite UI codée en dur) et les deux frictions fail-closed ont été corrigés. Preuves hors dépôt : `outputs/p1c2b-local-20260831/`.

**Limites et reprise :** le panneau permet désormais capture, attestation, saisie humaine typée, révisions et revue, sans éditeur JSON ni déduction automatique. Ce choix garde le cotateur maître de chaque instruction et de son extrait, mais n'automatise pas encore le dépouillement d'un long email. Le précontrôle Lovable read-only ne révèle aucune collision : migration, namespace DB et Edge absents ; les deux identités candidates existent, mais aucune session live n'a encore été créée et aucun JWT n'a été testé. La livraison suivante est la publication/recette Git+runtime sous le GO reçu, avec habilitation explicite du cotateur et refus prouvé pour l'utilisateur test non habilité. P1-C3 ne peut projeter vers puzzle/pricing qu'après ces preuves et une revérification de fraîcheur.

### PACK P1-D — médiation backend des écritures frontend sensibles

État actuel : plusieurs composants écrivent directement dans la base ou le stockage, notamment :

- `src/components/case/CaseDocumentsTab.tsx` ;
- `src/components/case/DocumentMetadataEditor.tsx` ;
- `src/components/case/DesignationSuggestionBlock.tsx` ;
- certains chemins de `src/pages/Intake.tsx`.

À développer progressivement :

- Edge Functions ou RPC atomiques pour upload, métadonnées, timeline, suppression et décisions sensibles ;
- contrôles de rôle côté serveur ;
- idempotence et rollback compensatoire stockage/base ;
- journalisation métier ;
- maintien temporaire des lectures directes autorisées quand elles sont couvertes par RLS.

Interdiction : refactor global de tous les accès Supabase. Migrer un parcours complet à la fois.

### PACK P1-E — cycle de vie des dossiers

À clarifier et développer :

- usage réel de `HUMAN_REVIEW` ;
- doctrine et writers autorisés pour `ARCHIVED` ;
- correction contrôlée d'une décision `ACCEPTED` ou `REJECTED` erronée ;
- transitions autorisées, rôles et audit trail ;
- distinction statut technique, statut commercial et statut client.

Tests obligatoires : matrice complète des transitions, refus des transitions interdites, idempotence et historique immuable.

## 7. P2 — qualité, exploitation et dette produit

### PACK P2-A — dépendance Railway

- Auditer le chemin actif `createIntake` de `src/pages/Intake.tsx`.
- Auditer le fallback Railway du chargement camion.
- Décider entre migration Edge Function, maintien documenté ou suppression du fallback.
- Ajouter observabilité, délais, reprise et traitement explicite des erreurs.
- Ne pas supprimer Railway avant preuve qu'aucun parcours réel n'en dépend.

### PACK P2-B — document client professionnel

État actuel : le bouton « Imprimer PDF » de `CaseView.tsx` utilise `window.print()`.

À développer :

- template de devis versionné et stable ;
- pagination, en-têtes, pieds de page et références ;
- séparation coûts, débours, honoraires, hypothèses et exclusions ;
- rendu déterministe depuis une version de devis immuable ;
- contrôles visuels et tests de non-régression PDF ;
- conservation de la version envoyée au client.

### PACK P2-C — dette lint, taille du bundle et composants volumineux

- Mettre en place une baseline lint et un mécanisme de non-aggravation.
- Réduire `no-explicit-any` par domaine sans réécriture globale.
- Introduire du code splitting sur les écrans lourds après mesure.
- Découper uniquement les composants modifiés dans un chantier fonctionnel ou identifiés comme source de défauts.
- Mesurer le bundle avant/après ; éviter les refactors cosmétiques.

### PACK P2-D — documentation et gouvernance GitHub

- Réconcilier README, `MASTER_CONTEXT`, backlog différé et plan Lovable avec le code livré.
- Retirer les déclarations devenues fausses sur le multi-cargo et les scénarios.
- Requalifier les issues GitHub ouvertes : clôturer les preuves terminées, conserver les écarts réels.
- Documenter seulement les décisions structurantes, sans multiplier les rapports redondants.

## 8. Ordre obligatoire de livraison

Ordre recommandé, chaque pack nécessitant son propre périmètre et son GO CTO :

1. **P0-A** — filet de sécurité technique.
2. **P0-B** — preuve directe du garde-fou PAD.
3. **P0-C** — configuration déterministe des Edge Functions.
4. **P0-D** — validation des référentiels tarifaires. Volet technique P0-D-1 (reconstruction Git de la quarantaine live) appliqué ; volet métier en parallèle organisationnel uniquement si aucun patch technique concurrent n'est appliqué.
5. **P0-E** — recette authentifiée de bout en bout.
6. Verdict CTO de fin de P0 : GO/NO-GO pilote, distinct d'un GO publication.
7. **P1-A** — scénarios et hypothèses : P1-A1 à P1-A5 terminés, recettés et intégralement nettoyés.
8. **P1-B** — confirmation des propositions maritimes : terminé, correctifs et recette privée validés, nettoyage intégral prouvé le 31 août 2026.
9. **P1-C** — P1-C1, P1-C2-A et P1-C2-B, saisie humaine typée incluse, terminés/testés localement ; habilitation conçue avec préparation/validation cumulables pour le cotateur solo. Prochaine étape autorisée : livraison/recette Git+runtime avec habilitation explicite, puis P1-C3 projection contrôlée si PASS. Aucun runtime P1-C ni commit/push des lots locaux au moment de cette preuve locale.
10. **P1-D** — médiation backend, un parcours à la fois.
11. **P1-E** — cycle de vie des dossiers.
12. **P2-A à P2-D** selon le risque et les retours du pilote.

Ne pas lancer deux IA sur le même lot. Les validations métier peuvent avancer en parallèle du code, mais aucune donnée ne doit être activée pendant un patch non relié.

## 9. Gates et preuves minimales par changement

Pour tout patch :

1. vérifier dépôt, branche, `HEAD`, `origin/work` et worktree ;
2. énumérer les fichiers autorisés et interdits ;
3. relever les composants FROZEN applicables ;
4. capturer le comportement avant correction ;
5. appliquer le plus petit diff possible ;
6. exécuter les tests ciblés ;
7. exécuter typecheck, Vitest et build ;
8. exécuter les tests Deno concernés, puis la suite complète lorsque l'environnement P0-A est prêt ;
9. examiner le diff et l'absence de fichiers générés ;
10. vérifier sécurité, idempotence, RLS, provenance et non-régression ;
11. présenter le verdict avant tout commit ou push ;
12. obtenir le GO CTO de publication distinct de la réalisation ; il peut regrouper commit, push, PR, migration et runtime explicitement listés (§2.1), sans redemander une autorisation déjà donnée et toujours applicable.

Un build vert ne remplace pas les tests métier. Un test local vert ne prouve pas l'état Lovable. Une preuve Lovable ne prouve pas que Git peut reconstruire le même état.

## 10. Conditions de STOP immédiat

STOP et demander arbitrage CTO si :

- le dépôt ou la branche ne correspond pas à `douania/dakar-cargo-quotes` / `work` ;
- le worktree contient des modifications utilisateur qui chevauchent le lot ;
- `HEAD`, `origin/work` ou Lovable divergent sans explication ;
- le patch nécessite un fichier hors périmètre autorisé ;
- un composant FROZEN doit être modifié ;
- une migration, une policy RLS, Auth ou une fonction pricing doit être élargie au-delà du GO ;
- une source tarifaire officielle ou une validation métier est absente ;
- un test critique échoue et la cause n'est pas déterminée ;
- la version sûre d'une migration n'est pas déterminable ;
- une action peut modifier Lovable, une base live, des emails réels ou des données client sans GO explicite ;
- l'idempotence, le rollback ou la provenance ne peuvent pas être démontrés ;
- le chantier révèle un risque de mauvais devis, double comptage ou corruption de données.

#### Rapprochement des poids — recette TEST — 19 septembre 2026 — PASS calcul/version/brouillon, PDF visuel NOT_RUN

- GO recette utilisateur ; work/GitHub `2dec09071e9f83a076e97ef2d96c0dad1de17ccc` alignés, aucun patch applicatif, commit, migration ou déploiement ce tour.
- TEST `450cb321-8da6-4323-a579-187800d09e45` uniquement : ancien fait manuel 10000 kg conservé historique ; nouveau fait 9000 kg explicitement marqué simulation d'extraction IA, pas une extraction réelle.
- Confirmation authentifiée v4 `d257df1f-9c0a-447d-b2a3-dab6c49108dd`, puis rapprochement `3be77b2a-28d8-49f8-b139-ba07aa0687c3` : base révisable 10000 kg ; fait 9000 kg toujours courant, décisions PAD conservées, blocage PAD levé dans l'UI.
- Pricing Run #4 `188a2f92-0601-4d65-a94a-5ded3518dd5e` réussi ; snapshot v4 `cb3aaa21-1312-4634-8bed-d64aff331212` : cargo_weight=10 t, PAD 10×9678=96780 XOF, total provisoire 983380 XOF ; réserve globale et rapprochement figés.
- PDF v4 enregistré (`c811402b-4986-4b86-ab23-191399471224`) ; capture/export du lecteur IAB indisponibles : contenu et rendu PDF non vérifiés ce tour.
- Brouillon v4 `327fc4f9-d137-4737-afb3-a6a11492a521` enregistré avec réserve globale 10 t / 9 t ; destinataires vides, sent_at NULL, status draft.
- Défauts UI observés sans correction : notification création « vundefined / NaN » transitoire avant restitution v4 correcte ; formulaire rapprochement retenu remet ses champs à vide/défaut plutôt que restituer la justification enregistrée.
- Aucun changement GoTrans, barème, Auth/RLS ; fixtures et artefacts TEST conservés pour audit. Aucun test local relancé. Suite : contrôle du PDF v4 ; recette sur GoTrans distincte, pas validée par ce TEST.

#### Transport hors barème par groupe — 19 septembre 2026 — PASS_WITH_BASELINE local, non livré

- GO utilisateur : exception locale calcul gelé, proposition des lots et base hors supplément pour danger inconnu ; aucun tarif/fait/Cloud/publication. work `2dec09071e9f83a076e97ef2d96c0dad1de17ccc` inchangé, aligné origin/work ; notes antérieures préservées.
- Périmètre : 8 fichiers applicatifs/tests (helper km, moteur notes, formulaire, proposition pure et tests). Aucun contrat DB ni Edge supplémentaire.
- UI : lecture RLS du scénario sélectionné, références/types/quantités/poids préremplis, source id/hash conservée ; capacité et attestations restent vides/décochées. Réponse tardive après changement dossier/formulaire ignorée. Distance via proposition TomTom existante ; enregistrement et liaison restent explicites.
- Calcul scénario uniquement : danger inconnu sans UN/classe peut recevoir une base kilométrique sur opt-in explicite, avec réserve IMO et firm_eligible=false. Danger positif/UN/classe, capacité insuffisante/non justifiée, équipements spéciaux restent refusés ; barème exact prioritaire.
- Test moteur mixte synthétique 39×55t DG / 13×18t / 3×15t : premier transport null, deux autres calculés avec capacité fictive explicitement sourcée et distance test300km ; aucune qualification réelle GoTrans déduite.
- Tests : 492 Vitest PASS ; 76 Deno ciblés (45 handler +31 km) PASS ; typecheck, build, config97, bundles et diff-check PASS. Deno types49/5 inchangés ; suite Deno complète et recette Cloud NOT_RUN.
- Gate lint brut FAIL740/16 vs fichierbaseline737/16 ; comparaison ESLint de TOUS les fichiers suivis origin/work via git show=740/16, delta0 ; nouveaux fichiers0. PASS_WITH_BASELINE, pas CI verte ni baseline relevée.
- Contre-revue indépendante lecture seule PASS, 9 tests frontend rejoués ; sélection/snapshot non atomiques signalés non bloquants (proposition seule, qualifications non préremplies, contrôles moteur conservés).
- Aucune écriture Cloud, migration, Auth/RLS, commit/push/déploiement/envoi. GoTrans inchangé ; l'automatisation complète de qualification et de liaison n'est pas livrée par ce lot. Retour arrière : retirer uniquement ce diff local en préservant les notes précédentes.

#### Transport hors barème — livraison privée et recette — 19 septembre 2026 — PARTIAL recette étendue

- GO utilisateur : commit/push/preview, quotation-engine puis run-scenario-pricing, recette TEST sans migration ni envoi ; identité permanente Codex <noreply@openai.com> autorisée uniquement pour ce dépôt.
- Identité vérifiée dans `.git/config` via --show-origin ; configuration globale inchangée. Ne pas redemander pour les commits de ce dépôt.
- work `2dec0907` → `1d2220a683fcb4c1ae55843e2898b5a5643f197d`, push et ls-remote alignés ; 9 fichiers +215/-8, incluant notes précédentes. Worktree propre après commit.
- Lovable même HEAD/origin ; arbre supabase `6ce60a1d2483869f300feb4439b3070206af1f4c` ; build privé 17,72s, bundle index-ByZ6fsLL.js, HTTP200. Aucun patch Lovable.
- Accusés successifs Successfully deployed edge functions: quotation-engine, puis run-scenario-pricing. Chaque sonde OPTIONS200/POST non authentifié401 ; source Git inchangée. Hash bundle exécuté non exposé : NOT_VERIFIED.
- Recette authentifiée TEST 450cb321, scénario 27f1b955 rév.5, exécution1 du 19/09 à10:14 UTC : résultat enregistré, transport 1×20GP 10t vers N'Dioum 480,9km =634722 XOF, capacité synthétique20t clairement sourcée ; sous-total HT1444382/TTC1543382, estimation non ferme.
- UI nouvelle proposition vérifiée : lot-1/20gp/1/10000kg préremplis ; capacité/source vides, attestations ordinaire et danger inconnu décochées ; brouillon annulé sans enregistrement.
- Cas mixte et opt-in danger inconnu : tests locaux précédents PASS, recette Cloud spécifique NOT_RUN ce tour ; ne pas assimiler le TEST non-DG à cette preuve. Tests locaux non relancés, baseline précédente inchangée.
- Aucun fait, tarif, Auth/RLS, migration, GoTrans ou envoi modifié ; seule estimation TEST enregistrée. GoTrans nécessite encore hypothèse distance liée et qualification de capacité/transport ordinaire par lot.
- Suite : recette synthétique mixte danger connu/inconnu, puis application opérateur des hypothèses justifiées. Rollback par revert ciblé du commit et redéploiement coordonné des deux fonctions. Note de clôture locale non commitée.

#### Références routières existantes — 19 septembre 2026 — PARTIAL diagnostic, raccordement suspendu

- GO reprise références ordinaires/raccordement estimation ; work@1d2220a aligné origin, seule note de clôture antérieure modifiée, préservée ; aucune écriture Cloud.
- ROAD-LOAD-1 T12S4 reste INFO_MANQUANTE côté décision : contradiction ticket/dépliant non arbitrée, aucune tolérance déduite automatiquement pour les lots ordinaires.
- Lecture Cloud : transport_regulations contient PTR005=44t articulé5ess, ESS002=21t tandem, ESS003=27t tridem ; références génériques sans page. Ne pas promouvoir ces données historiques en preuve vérifiée.
- Annexe primaire relue https://e-docucenter.uemoa.int/fr/annexe : articulé5ess avec tridem=43t, deux tandems=46t, 6ess=51t ; tridem21/25t selon type. La configuration compte, PTRA différent de charge marchandise.
- Deux PDF de tickets retrouvés dans Downloads ; première page de chacun rendue, première page Mercedes lue : pesée chargée T12S4, pas preuve d'une capacité marchandise universelle. Pas de relecture complète revendiquée.
- Nouveau risque : brancher automatiquement la table existante sur max_payload_kg donnerait une fausse attestation ; le helper exige actuellement capacité conteneur/véhicule sourcée ET ordinary_transport=true.
- Proposition à arbitrer : contrat distinct de base transport conditionnelle avec configuration réglementaire sourcée et réserves véhicule/tare/essieux/CSC/gabarit, jamais une capacité vérifiée ; ne pas modifier silencieusement le sens du contrat actuel. Les55t/DG restent séparés.
- Aucun code, barème, fait, migration, commit, déploiement ni GoTrans modifié. Tests applicatifs/contre-revue NOT_RUN ; note locale seulement. Suite : autoriser explicitement cette distinction dans le calcul gelé, puis implementation/tests/contre-revue groupés.

#### Transport standard provisoire hors barème — 21 septembre 2026 — PASS local

- GO utilisateur : chiffrer séparément les lots GoTrans 13×20HQ à 18 t et 3×40HQ à 15 t ; conserver le lot 39×20HQ à 55 t / UN3536 hors estimation standard, en attendant le complément essieux.
- Politique métier provisoire et non réglementaire : TC sec 20/40 jusqu’à 18 000 kg ; véhicule, tare, essieux et affectation restent à confirmer. Danger inconnu : base seule, supplément IMO non inclus et jamais supposé nul.
- Les lots >18 t non qualifiés restent hors registre actif et ne bloquent pas les lots éligibles ; anciens groupes attestés compatibles ; marqueur et source provisoires validés strictement.
- Cas mixte moteur : 55 t DG → TO_CONFIRM ; 18 t et 15 t calculés séparément. Cas 18 t + 18 001 kg : 421 260 XOF + TO_CONFIRM, sans blocage global.
- 34 tests Deno ciblés, 5 frontend, typecheck, baseline Deno, bundles et build PASS ; 493 tests frontend globaux PASS. Contre-revue indépendante GO.
- Baseline hors lot : 1 test Deno `Intake.tsx` et lint global +3 restent FAIL dans des fichiers inchangés ; fichiers du lot ESLint PASS. GitHub frais NOT_VERIFIED (réseau indisponible).
- Aucun tarif, fait client, DB/Auth/RLS, migration, commit, push, Cloud, Edge ou envoi modifié. Retour arrière : retirer uniquement les six fichiers applicatifs/tests de ce lot et la présente note.

#### Restitution informative franchise et tranches — 21 septembre 2026 — PASS_WITH_BASELINE local

- GO utilisateur : commencer le lot global de restitution ; sous-périmètre livré strictement frontend, sans tarif, fait, migration, Cloud, publication ni envoi. `quotation-engine` reste FROZEN et inchangé.
- Les résultats de scénarios affichent désormais, par lot, les lignes magasinage/surestaries avec montant indicatif ou « À confirmer », franchise, tranches/calcul déjà fournis par le moteur et source ; magasinage, surestaries COC et détention après sortie restent séparés, hors total ferme.
- Deux fichiers applicatif/test : aucun calcul, montant, persistance ou contrat runtime modifié. Le tableau technique renvoie au nouveau détail pour éviter le doublon de lecture.
- Tests : 13 ciblés PASS ; typecheck et build PASS. Suite frontend : 493 PASS / 1 FAIL identique à `origin/work` (`LocalTransportEstimateFields` attend « Ajouter un lot admissible », UI inchangée affiche « Ajouter un lot ») : PASS_WITH_BASELINE.
- Retour arrière : revert de ces deux fichiers frontend ; aucun rollback DB/Cloud. Publication et extension structurée PDF/e-mail nécessitent GO distinct ; toute modification du moteur FROZEN exige une exception explicite.

#### Restitution structurée séjour et fraîcheur — 21 septembre 2026 — PASS technique privé / PARTIAL métier

- GO utilisateur : lot global franchises/tranches/exemple, exception pricing FROZEN, livraison privée et recette ; modèle de tâche vérifié `gpt-6-astra/high`.
- `work` a434c49→62af0982e8dba15e97dae8dd2d32e3c7b70da327 poussé, 13 fichiers +292/-14 ; Git/Lovable alignés, arbre supabase 0a2210f3fbee8200528031d2ae78bdde1f475b35. Présente note de clôture locale non commitée.
- Contrat informatif additionnel par ligne : franchise puis tranches complètes, taux/unité/sources/réserves ; exemple sur poids/quantité du lot et durée explicitement hypothétique, jamais ajouté aux totaux. P1 opérateur et P2/P3 historiques non promus en tarifs fermes ; aucun montant catalogue remplacé sans pièce.
- Scénarios conteneurs : contexte import transmis même sans durée liée ; gardes de calcul inchangées. CTA vers hypothèses existantes et avertissement daté quand le pricing canonique précède l’estimation sélectionnée. Les anciens résultats/snapshots ne sont pas réécrits.
- PDF/brouillon scénario : informations issues des raw_lines figées, sans migration ; retours ligne/pagination contrôlés sur PDF synthétique 2 pages. Exemple EUR décimal corrigé après contre-revue indépendante, verdict final PASS.
- Tests : 75 Deno ciblés/16 UI PASS ; globaux 1594 Deno PASS/1 FAIL/6 ignorés et 496 UI PASS/1 FAIL, deux échecs baseline Intake/LocalTransport inchangés. Typecheck/build/bundles/config PASS ; dette Deno49/5 et lint740/16 inchangée (comparaison fichiers à origin/work), donc PASS_WITH_BASELINE, pas CI intégralement verte.
- Lovable message umsg_01m321dgvkf7n92xrbr4wppqv6 : rebuild privé et quotation-engine→run-scenario-pricing→export-quotation-version-pdf→create-quotation-email-draft déployées ; sondes200/401. Projet workspace_edit, non publié. Empreinte du bundle runtime non exposée : NOT_VERIFIED, preuve de substitution conservée.
- Recette UI GoTrans : run5 d08f1b04-6db9-48bc-b75a-46365f832d9f à13:13:33 UTC, HT47925930/TTC48024930 XOF inchangés, ferme0 ; nouvelles réserves visibles, CTA/focus vers hypothèses et avertissement pricing07/06 vérifiés. Aucune hypothèse séjour ni armateur inventés : magasinage/surestaries restent à confirmer ; chiffrage positif live et export client NOT_RUN.
- Intégrité SELECT avant/après : empreintes 1428 faits,16 franchises,35 barèmes armateurs,35 paliers,219 tarifs port inchangées ; pricing canonique175 et versions14 stables, runs scénario23→24 seulement. Aucun changement Auth/RLS/migration, aucun envoi/publication publique.
- Retour arrière : revert ciblé62af098 puis rebuild/redéploiement des quatre fonctions ; aucun rollback DB, préserver l’historique. Suite métier : documenter/relier terminal, désignation, durées distinctes et armateur, confirmer franchises IMO et actualité documentaire sans prétendre tous les barèmes à jour.

#### Surestaries sans armateur — comparatif documentaire global — 21 septembre 2026 — PASS_WITH_BASELINE local

- GO utilisateur sur recommandation informative ; maintien recommandé GPT-6 Astra/high après documentation officielle. work@62af098 local/GitHub alignés, note de clôture précédente préservée ; aucune publication autorisée par ce GO de réalisation.
- Extension bornée de la restitution séjour sous exception FROZEN déjà accordée : branche scénario sans armateur, métadonnées seulement ; amount=null/TO_CONFIRM, sélection effective, totaux, faits et catalogues inchangés.
- Deux références publiques nommées/datées/consultées : CMA CGM Dakar City Center DEMURRAGE (01/01/2025), Hapag-Lloyd Sénégal import (01/05/2024), conversion informative BCEAO655,957 ; pas une fourchette exhaustive du marché ni un plafond garanti, actualité et booking à reconfirmer.
- Franchise propre à chaque référence, tranches11–20/21+, exemples15/20/25jours sur quantité par lot ; EUR conservé, conversion du total puis arrondi. Aucune durée retenue ni franchise applicable déduite ; magasinage/détention/TVA exclus.
- Gardes : importDakar/SN, COCsec20DV/40DV/40HC, pas de carrier connu/SOC/DG connu/température/spécial/transit/export. Danger inconnu : base standard explicitement hypothétique, réserve visible avant tableaux. Aucun cas client codé en dur.
- Contrat additif validé défensivement, gros montants rejetés ; contexte PDF/brouillon issu des références figées dans raw_lines, anciens snapshots compatibles, sans relecture du catalogue courant.
- Tests37Deno ciblés avec typage/17UI PASS ; globaux1601DenoPASS/1FAIL/6ignorés et497UI PASS/1FAIL, échecs Intake/LocalTransport identiques à origin/work (fichiers/tests inchangés). Typecheck/build/bundles/config PASS ; dette Deno49/5 et lint740/16 inchangée : PASS_WITH_BASELINE, pas CI verte intégrale.
- Contre-revue indépendante PASS,37Deno réexécutés ; dernier test renforcé sans durée liée et deux lots COC distincts PASS. Export texte vérifié, nouveau rendu PDF visuel et recette runtime NOT_RUN.
- Neuf fichiers code/tests plus présente clôture ; aucun SQL/Auth/RLS/migration/écriture Cloud/envoi/commit/push/déploiement. HEAD inchangé. Retour local : retirer uniquement ce diff, préserver la clôture antérieure ; aucun rollback DB.
- Suite sous GO publication distinct : commit/push work, reconstruction privée et déploiement coordonné quotation-engine/export-quotation-version-pdf/create-quotation-email-draft, puis relance et recette privée sans envoi ; les anciens runs ne sont pas réécrits.

#### Livraison privée du comparatif — 21 septembre 2026 — PASS recette comparative / PARTIAL métier

- GO distinct utilisateur : commit/push work, déploiement privé et recette sans envoi. 62af098→d727cdff7f1cebe2d270156023a746dacbff9ffc poussé, 10 fichiers +346/-5 ; Lovable synchronisé, non publié, visibilité projet workspace_edit (ne pas confondre le réglage public d'une publication future).
- Build privé PASS ; quotation-engine/export-quotation-version-pdf/create-quotation-email-draft déployées, accusés et sondes200/401 ; arbre supabase f62fae236d047bfc683a33c216481df3bde3948f inchangé. Empreinte de bundle runtime NOT_VERIFIED.
- Recette authentifiée : run6 aa477b43-30ba-4f94-93b1-09873d4df097, succès technique, totaux HT47925930/TTC48024930 XOF et ferme0 inchangés ; comparaison absente, donc recette fonctionnelle FAIL.
- Cause vérifiée : contexte séjour avec pays « Senegal » et port absent ; le contexte transport contient explicitement IMPORT/Senegal/Dakar Port. Le test initial utilisait SN et port dans séjour.
- Correctif borné sous GO du lot : alias SN/Senegal/Sénégal et port transport en secours uniquement pour la comparaison documentaire et contexte import Sénégal ; valeurs séjour explicites prioritaires, aucune sélection tarifaire ni garde de calcul modifiée.
- Tests après correctif : 38 Deno ciblés avec typage PASS, bundles isolés PASS ; tests négatifs pays/port/sens, priorité contexte séjour, non-mutation, montant null/TO_CONFIRM et magasinage inchangé. Contre-revue indépendante PASS avec 32 Deno réexécutés ; 17 UI/typecheck PASS avant ce correctif backend seulement, dettes globales inchangées.
- Correctif poussé d727cdff→70d1539758bb4b86a25c0bd4cf6c640329a33fa4, 3 fichiers +47/-2 ; arbre supabase 5e62ea20046f310c9a8b0eda9edde3867303e37d. Ensemble depuis62af098 : 10 fichiers +391/-5 avant présente clôture locale non commitée.
- Blocage de synchronisation historique levé : GitHub/Lovable ec7dc079994846412c72829294c313b6ce3ceac6 inclut70d1539 ; comparaison GitHub montre seulement .lovable/plan.md ajouté (30 lignes). Local70d1539 et clôture documentaire non commitée préservés, aucune synchronisation locale destructive.
- Intégrité SELECT après run6 : empreintes des1428faits/16franchises/35barèmes/35paliers/219tarifs inchangées ; pricing canonique175/versions14 stables, runs scénario24→25. Aucun autre recalcul tenté sur sources obsolètes.
- Livraison corrective confirmée par compte rendu Lovable transmis utilisateur et visible dans l'éditeur : build20s/HTTP200, quotation-engine seule déployée, OPTIONS200/POSTsansauth401, arbre5e62ea20 et HEADec7dc079 inchangés ; projet workspace_edit/is_published=false revérifié par connecteur. Empreinte bundle runtime NOT_VERIFIED.
- Recette authentifiée navigateur : run7 bb075738-8e8a-4353-8350-8cba7d33b6a0 à17:57:55UTC, success/partial, comparaison persistée et visible sur3×40HC COC seulement ; franchises10j, tranches11–20/21+, exemples15/20/25j et réserves/sources lisibles. Exemple25j : CMA1830300/Hapag1692369FCFA ; hypothétique, hors totaux.
- Intégrité finale : 1428faits et quatre catalogues byte-identiques par empreintes avant/après ; lignes run6/run7 identiques hors notes/stay_information, HT47925930/TTC48024930/ferme0 stables, canoniques175/versions14 inchangés ; un seul nouveau run scénario25→26. Aucun code/test modifié ni commit supplémentaire à cette recette.
- Reste métier : magasinage3lots et surestaries effectives à confirmer, aucun armateur/durée/franchise applicable promu ; hypothèse danger inconnu explicitée. PDF visuel live NOT_RUN ; prochaine étape métier : qualifier désignation magasinage DPW et conditions réellement applicables, sans prétendre tous les barèmes à jour.
- Aucun changement DB/Auth/RLS/migration/fait/barème ni envoi. Retour : revert des commits du lot puis reconstruction privée/redéploiement coordonné ; conserver les runs historiques.

#### Qualification magasinage DPW — 22 septembre 2026 — PARTIAL documentaire

- GO utilisateur sur magasinage DPW/conditions réellement applicables ; audit sources/code/SELECT seulement, pas de publication ni adoption automatique. Queue historique sans nouvelle entrée ; arbitrages antérieurs/hors lot conservés.
- Préflight work local70d1539, GitHubec7dc079 ; comparaison distante confirme uniquement .lovable/plan.md ajouté, clôture précédente locale préservée. Aucun code absent ni divergence applicative inexpliquée ; pas de changement HEAD.
- FAQ DPW https://dpw-prod-cd-1.dpworld.com/senegal/faqs relue22/09 : franchise générale10j sec local,2j frigo,21j Mali ; aucun taux magasinage publié dans cette page, aucune assimilation automatique aux lots IMO ou danger inconnu.
- Lecture PDF visuelle : DPW_TARIFS_2025_0001.pdf est un dépliant THC copyright2024, sans magasinage ; trois ligneswarehouseDPW6000/12000/12000XOF/EVP/j citent ce PDF, donc taux non justifiés par la pièce. Arrêté2015 local p.2 art.3 renvoie au tarifSEMPOS homologué22/03/2002 sans en donner la grille ; actualité non déduite.
- Politique existante P1×1,111 :414=394FCFA/t/j extrapolé ;419=1964 observéTOM, nonDPW ; P2/P3 restent historiques. Catalogue des désignations consulté explicitement dakar_terminal2014, pas preuve d'applicationDPW. Codes414transformateurs/419accessoires/417batteries restent candidats non adoptés.
- SELECT dossier5e9cd222 : aucune hypothèse pricing.container_stay_estimate ; dernier run7 inchangé, lot1DG/UN3536, lots2/3danger inconnu. RéférentielIMOclasse9 ALL indiqueMAX_3_DAYS (QHSSEv4,01/07/2025), contrainte de séjour et non franchise gratuite, actualité à corroborer sur pièce.
- Point technique conservé : garde magasinage exigeSN+port explicite dansscenarioStay, tandis que le runner du cas transmetSenegal/port danstransport ; correctif70d1539 limité au comparatif surestaries.20HQ etdangerinconnu restent également nonéligibles ; aucune garde assouplie.
- Contre-revue indépendante lecture seule PASS du constat. Tests NOT_RUN, aucun patch applicatif ni changement DB/Auth/RLS/barème/fait/scénario, aucun recalcul/envoi/commit/push/déploiement ; présente note uniquement, rollback documentaire local possible.
- Rectification utilisateur : grille Dakar Terminal déjà acceptée comme base informative P1×1,111/P2-P3 historiques ; obtenir une nouvelle grille DPW n’est pas un préalable à cette estimation. Les pièces complémentaires servent à corroborer l’application contractuelle/IMO, non à bloquer la restitution historique. Désignations et franchises propres aux lots restent à qualifier.

#### Rattachement magasinage sans durée — 22 septembre 2026 — PASS local / PARTIAL livraison

- GO utilisateur après confirmation du PDF Dakar Terminal : permettre la préparation informative sans inventer durée, catégorie confirmée ou franchise applicable. Queue : arbitrages historiques conservés, pièces routières/CSC hors lot toujours manquantes ; aucun nouveau GO déduit.
- Préflight work local70d1539→70d1539 ; fetch origin/work ec7dc079, diff distant limité à .lovable/plan.md (+30), aucun code applicatif divergent. Notes locales antérieures préservées.
- Quatre fichiers applicatifs/tests : validateur partagé séjour et son test, formulaire ContainerStayEstimateFields et son test. Aucune modification des règles monétaires ni du fichier moteur gelé.
- Hypothèse sans durées autorisée uniquement avec providerDPW et code410–419 explicites ; dates/source/identité exactes et rejets des valeurs invalides conservés. Deux durées null restent null et aucun montant séjour n’est produit.
- Aperçu du brouillon affiche franchise applicable à confirmer, référence DPW10j distincte de DT5j/10jMali, trois périodes relatives et taux P1×1,111/P2-P3 historiques ; sources et observation TOM distinctes. Aucun choix de catégorie automatiquement adopté.
- Après enregistrement/liaison et nouveau calcul isolé : chemin informatif existant disponible ; exemple sur poids du lot uniquement si conditions franchise déjà éligibles. Routage SN/port, exclusions20HQ/IMO/inconnu non assouplis ; GoTrans non recalculé.
- Tests :78Deno ciblés avec typage PASS,27UI PASS,typecheck/build/config97/bundles isolés PASS. Lint ciblé1prefer-const identique au fichier origin/work : PASS_WITH_BASELINE. CI complète et recette Cloud NOT_RUN.
- Contre-revue indépendante lecture seule PASS,30Deno avec typage rejoués ; erreur de typage du nouveau test corrigée avant clôture. Aucun blocage restant sur ce diff local.
- Aucun commit/push/déploiement, SQL/migration/DB/Auth/RLS/fait/catalogue/envoi ; runtime inchangé. Retour local : retirer uniquement ces quatre changements et cette clôture, conserver les notes antérieures.
- Suite : GO publication distinct pour commit/push work, preview privée et bundles consommateurs séjour, puis recette sans envoi. La qualification/adoption des catégories réelles et franchises n’est pas prétendue accomplie par ce correctif.

#### Livraison rattachement magasinage — 22 septembre 2026 — PASS privé / PARTIAL recette

- GO utilisateur commit/push, livraison privée et recette sans envoi. Fast-forward70d1539→ec7dc079 (plan Lovable seul), puis799ee83afe1907d0033809a4423ad30639946caa poussé :5fichiers,+117/-4, notes antérieures incluses ; arbre supabase9b406f1b867cac3812bde3d0efe1d444f4054e12.
- Tests frais sur livraison :78Deno avec typage,27UI et typecheck PASS ; contre-revue et build/bundles/config du lot conservés. CI complète NOT_RUN ce tour ; dettes historiques non corrigées.
- Lovable umsg_01m349n3sketdrz1vvpdnp7tpc : préflight799ee83/arbre conforme/propre ; build20,03s,index-q8T4D4_J.js,HTTP200 ; accusés exacts Successfully deployed edge functions: quotation-engine, puis run-scenario-pricing, puis manage-quote-scenario. Sondes OPTIONS200/POSTsansauth401 chacune.
- Post-contrôle Lovable HEAD/arbre inchangés, propre,HTTP200 ; connecteur confirme799ee83,visibilityworkspace_edit,is_published=false. Ne pas assimiler le réglage publish_visibility public à une publication ou à la visibilité projet. Empreinte bundle exécuté NOT_VERIFIED.
- Recette navigateur authentifié via skill computer-use : fixture TEST450cb321, révision en brouillon de l’hypothèse existante414 ; deux durées vidées, trois taux394/599/775 et périodes relatives/conditionnelles visibles, sources/réserves présentes, bouton enregistrer disponible. Capture visuelle contrôlée.
- Brouillon annulé sans sauvegarde ; UI restitue hypothèse12j initiale. Aucun scénario créé/sélectionné, aucune adoption GoTrans, aucun calcul/édition fait/barème/SQL/migration/Auth/RLS/envoi/publication publique.
- Limite : persistance sans durée/liaison/nouveau calcul authentifiés NOT_RUN ; tests locaux prouvent le chemin sans montant, mais ne remplacent pas cette recette complète. Aucun claim de confirmation métier.
- Retour arrière : revert ciblé799ee83 et reconstruction/redéploiement coordonné sous GO, pas de rollback DB ; conserver historique et notes. Présente clôture locale non commitée.

#### Lot 1 UI vue dossier (cockpit opérateur) — 22 septembre 2026 — PASS_WITH_BASELINE livré

- Origine : revue UI opérateur du dossier de test 450cb321 (PDF 18 pages + page en direct) ; maquette cible 7 écrans (canevas Design privé, lien dans `docs/CTO_GO_QUEUE.md`). Plan Lovable en mode plan (7 lots), contre-revue Claude, GO utilisateur « lot 1 avec découpage 1a 1b 1c et cinq réponses » (conflits explicites seulement ; outils avancés option A ; barèmes officiels = références OFFICIAL ; bouton primaire = navigation ; anciennes commandes déplacées, jamais supprimées).
- Exécutant unique Lovable, contre-revue Claude par étape sur worktree détaché. `origin/work` 799ee83 → 258b8d8 (commits code 1497b38, 8b272b8, b2403e9, 487a6a1), 25 fichiers `src`, présentation seule : aucun FROZEN, migration, DB/RLS/Auth, calcul, montant, fait, hypothèse, statut ni flux d'écriture modifié.
- 1a : `case-view/presentation.ts` (sélecteur pur PilotageViewModel, priorité d'action extraite de NextActionBanner, écart estimation/devis à devise identique) + test ; bandeau de pilotage dans `CaseView.tsx` ; `useCockpitState` lit version_number/snapshot en lecture. 1b : `estimatePresentation.ts` (tableau Prestation/Montant/Base/Statut/Détail, réserves « à traiter » vs « mentions standard »), `assumptionPresentation.ts` (hypothèses transport local / séjour en clair, JSON sous « Détail technique »), un bouton « Réviser » + menu par carte. 1c : MainLayout défilant (bandeau collant effectif), débordement horizontal supprimé (941/375 px), ancres `section-data` / `section-sources`, résumés dans les `<summary>`, « Outils avancés » replié (boutons Adopter/Synchroniser déportés par portal), tokens de thème sur les cartes scénario ; correctif print (attributs `data-print-layout`) : 1 page tronquée → 18 pages A4 prouvées par Playwright.
- Preuves locales à chaque étape : typecheck PASS ; Vitest 509/510 (échec `LocalTransportEstimateFields` identique à 799ee83) ; eslint 0 sur les fichiers touchés hors dette CaseView 76 = 76 ; `lint:baseline` 740/737 FAIL identique à la base (seuil du script obsolète) ; build PASS. CI GitHub NOT_RUN ce tour. Coût Lovable relevé : ≈ 21,6 crédits pour 1c et son correctif.
- Reste hors lot 1, GO distinct : lots 2 à 6 du plan Lovable (sections dépliées, tableau des révisions de `QuoteScenariosPanel`), intitulé de la zone d'actions cargo canonique, alignement du seuil lint. Retour arrière : revert ciblé des quatre commits code, aucun rollback DB. Clôture locale non commitée.

#### Lots 2 à 6 UI vue dossier (sections dépliées) — 22 septembre 2026 — PASS_WITH_BASELINE livrés

- GO utilisateur « GO lot 2 Marchandises, mêmes cinq réponses » (15:35 UTC) puis « go » sur les lots 3 à 6 (16:10 UTC), mêmes cinq décisions que le lot 1. Exécutant unique Lovable, un lot par tour, contre-revue Claude sur worktree détaché entre chaque, corrections mineures regroupées avec le lot suivant. Trace complète et identifiants de messages dans `docs/CTO_GO_QUEUE.md`.
- `origin/work` 49d7611 → a6fbbfb (commits code Lovable ee8f2ab, 412eebe, 63a15ec, 08c5e74, dd187a6, 6e91cdf, a6fbbfb). Présentation seule : aucun FROZEN, migration, DB/RLS/Auth, calcul, montant, fait, hypothèse, statut ni flux d'écriture modifié ; payloads `manage-pad-group-confirmation`, versions, envoi, scénarios et `set-case-fact` byte-identiques.
- Lot 2 Marchandises : carte de groupe, poids extrait / base retenue côte à côte, réserve unique, catégorie PAD en grand avec deux cases explicites et un bouton primaire par groupe, « Aide à la classification » repliée regroupant PAD-NST, candidats et alias déplacés depuis la section Devis. Lot 3 Devis : quatre tuiles, « n barèmes officiels cités » (références OFFICIAL uniques), « Créer vN » bloqué si `pricing_run_id` déjà versionné, « même montant que vN-1 », destinataire en erreur et marquage désactivé sans destinataire. Lot 4 Scénarios : `ScenarioRevisionTable.tsx` créé, `QuoteScenariosPanel.tsx` −425 lignes, une ligne par révision, détail de la seule sélectionnée, réserves non répétées, verrouillage intégral. Lot 5 Partenaires : plan d'actions ouvert avec étape restante, communication client en trois lignes, `partnerScopePresentation.ts` (phrase DAP/DDP seulement sur scope hors périmètre). Lot 6 Sources : `CaseFactsTable.tsx` créé, libellés métier + clé technique, domaines, origine et confiance lisibles, JSON résumé, onglets Faits / Documents / Historique.
- Preuves locales par lot : typecheck PASS ; Vitest 512/513 → 526/527 (seul échec `LocalTransportEstimateFields` identique à la base) ; eslint stable ou en baisse (CaseView 76 → 73) ; `lint:baseline` 740 → 732 erreurs, gate OK depuis le lot 3 ; build PASS ; rendus vérifiés sur 450cb321 dans le navigateur intégré. CI GitHub NOT_RUN ce tour.
- Reste sous GO distinct : câblage des conflits explicites (état PAD) vers `conflictFactKeys` du tableau des faits, humanisation des raisons brutes de qualification partenaire, intitulé de la zone d'actions cargo canonique, abaissement du seuil lint du script à 732/16. Retour arrière : revert ciblé des commits code du lot concerné, aucun rollback DB. Clôture locale non commitée.

#### Lot 7 UI vue dossier (reliquats) — 22 septembre 2026 — PASS_WITH_BASELINE livré

- GO utilisateur « go » (18:35 UTC) sur les quatre reliquats des lots 1 à 6, exécutant unique Lovable, contre-revue Claude sur worktree détaché. `origin/work` 1ea91e3 → 628f6cd, 9 fichiers (+83/−9), `case-view/factConflicts.ts` et son test créés.
- Livré : conflit explicite `PAD_GROUP_WEIGHT_CONFLICT` remonté du panneau PAD vers `conflictFactKeys` du tableau des faits (fonction pure, aucune déduction par confiance) ; raisons de `qualifyScope` traduites en présentation dans `partnerScopePresentation.ts` sans toucher `scopeQualification.ts` ; zone « Actions cargo canonique » visible seulement avec un bouton déporté (`has-[button]:flex`, règle vérifiée dans le CSS construit) ; `scripts/check-lint-baseline.mjs` à 732/16.
- Preuves locales : typecheck PASS ; Vitest 534/535 (seul échec `LocalTransportEstimateFields` identique à la base) ; eslint 0 sur les ajouts, CaseView 73 inchangé ; `lint:baseline` 732/732 OK ; build PASS. Aperçu non revérifié en direct ce tour. CI GitHub NOT_RUN. Aucun FROZEN, migration, DB/RLS/Auth ni flux d'écriture modifié.
- Aucun reliquat UI ouvert après ce lot. Retour arrière : revert ciblé des cinq commits, aucun rollback DB. Clôture locale non commitée.

## 11. Procédure de reprise dans une nouvelle session

La nouvelle session doit commencer par :

1. lire les sections 1 et 2 intégralement, puis la section du pack actif et les règles pertinentes ;
2. lire les instructions `AGENTS.md` applicables ;
3. vérifier localement :
   - remote Git ;
   - branche `work` ;
   - `git status --short --branch` ;
   - `HEAD` et `origin/work` ;
4. vérifier GitHub si l'accès est disponible : issues, PR, dernier commit et CI ;
5. vérifier Lovable en lecture seule seulement si le pack concerne le runtime ;
6. comparer l'état réel aux preuves de la section 4 ;
7. marquer comme obsolète toute donnée de cette feuille de route contredite par une preuve plus récente ;
8. sélectionner un seul pack non terminé ;
9. produire le périmètre, les fichiers autorisés, les tests et les conditions de STOP ;
10. vérifier le GO CTO du lot : reprendre le périmètre déjà autorisé s'il reste applicable ; demander seulement l'autorisation manquante ou l'arbitrage d'un nouveau blocage (§2.1).

Prompt de reprise minimal :

> Lire `docs/CTO_GO_QUEUE.md`, puis les sections 1–2 de `docs/CTO_DEVELOPMENT_ROADMAP.md` et le pack actif ; vérifier le dépôt `douania/dakar-cargo-quotes` sur `work`, comparer `HEAD`, `origin/work` et l'état Lovable pertinent. Reprendre le lot sous son GO existant après préflight conforme ; sinon présenter le seul arbitrage manquant. Aucun patch, commit, push ou changement runtime sans GO correspondant ; pas de nouveau GO demandé pour une action déjà autorisée et inchangée.

## 12. Règle de mise à jour de cette feuille de route

Mettre ce document à jour uniquement lorsqu'un événement change l'état canonique :

- pack terminé et vérifié ;
- décision CTO structurante ;
- migration ou déploiement réalisé ;
- risque critique découvert ;
- modification de doctrine pricing, Auth, RLS ou runtime ;
- priorité ou dépendance durablement modifiée.

Chaque mise à jour doit indiquer la date, les preuves, le SHA concerné et le verdict. Éviter les mises à jour purement narratives ou les rapports docs-only sans décision.
