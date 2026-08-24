# Dakar Cargo Quotes — feuille de route CTO canonique

## 1. Objet et statut

Ce document est le point de reprise canonique du développement après l'audit CTO du 22 août 2026.

Il sert à :

- conserver l'état vérifié du dépôt Git et de Lovable Cloud ;
- distinguer les travaux terminés de ceux restant à livrer ;
- imposer l'ordre P0, P1 puis P2 ;
- définir les tests, risques, conditions d'arrêt et autorisations nécessaires ;
- permettre à une nouvelle session de reprendre sans dépendre de l'historique d'une conversation.

Statut produit au 22 août 2026 : **PARTIAL — NO-GO pour une production générale**.

La reconstruction et la réconciliation des migrations sont terminées. Le chantier suivant est le P0 technique décrit ci-dessous.

## 2. Sources de vérité et règles d'autorité

- Dépôt : `douania/dakar-cargo-quotes`.
- Branche obligatoire : `work`.
- Source statique principale : GitHub, branche `work`.
- Runtime canonique : Lovable Cloud.
- Projet Lovable : `c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef` (`dakotation-pro` / Dakar Cargo Quotes).
- Commit Git, `origin/work` et Lovable observé : `6913c297ceb1ebaab7119b8fd0ddccc0a243831e`.
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
- aucun email réel, aucune autre famille tarifaire activée, aucune publication publique et aucun résidu sandbox créé ;
- limite explicite : le parcours UI authentifié complet n'a pas été exécuté, faute de session applicative disponible dans l'aperçu ou Chrome. Il reste dans le PACK P0-E et ne remet pas en cause la recette technique P0-D3.

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

Parcours minimum :

1. création ou import d'une demande ;
2. extraction et consolidation des faits ;
3. affichage et résolution des gaps ;
4. résolution des prérequis PAD/package ;
5. exécution pricing et reprise après échec ;
6. création et sélection d'une version de devis ;
7. rendu imprimable/PDF ;
8. création d'un brouillon email ;
9. envoi contrôlé à une adresse de test autorisée ;
10. vérification de l'audit trail et de l'absence de doublons après réexécution.

Conditions : compte de test autorisé, dossier sandbox clairement identifié, données non sensibles, plan de nettoyage validé et GO CTO runtime explicite.

Critère de sortie : preuves horodatées du parcours complet, absence de régression sécurité/données et décision CTO distincte de publication.

## 6. P1 — fonctions métier incomplètes après P0

### PACK P1-A — scénarios et hypothèses opérateur

État actuel : table et panneau en lecture seule présents ; aucune hypothèse enregistrée dans le runtime observé.

À développer :

- création et modification contrôlée d'hypothèses ;
- statuts, révisions, supersession et résolution ;
- validation opérateur et visibilité client ;
- promotion explicite hypothèse vers fait, avec provenance ;
- interdiction de promotion automatique ;
- objets de scénario identifiables et versionnés ;
- pricing par scénario sans contamination des faits canoniques ;
- comparaison de scénarios ;
- génération PDF/email identifiant clairement hypothèses, exclusions et scénario choisi.

Tests obligatoires : RLS, rôles, idempotence, concurrence, provenance, supersession, absence d'écriture automatique dans `quote_facts`, isolation entre scénarios.

### PACK P1-B — intégration humaine des propositions de frais maritimes

État actuel : moteur et UI `proposal_only`, `amount = null`, suggestions jamais comptées.

À développer :

- action explicite de confirmation, rejet ou ajustement par l'opérateur ;
- justification et source de la décision ;
- création d'une ligne tarifaire ou TO_CONFIRM seulement après confirmation ;
- versionnement et audit trail ;
- recalcul déterministe sans double comptage ;
- révocation ou remplacement contrôlé d'une décision ;
- présentation client distinguant montant ferme, provisoire et exclu.

Tests obligatoires : aucune suggestion comptée avant confirmation, double clic idempotent, permissions, devise, arrondis, commission sur débours, relecture d'une version historique.

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

STOP : aucun patch avant validation CTO du modèle, des invariants et des cas de conflit GWC ou équivalents.

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
7. **P1-A** — scénarios et hypothèses.
8. **P1-B** — confirmation des propositions maritimes.
9. **P1-C** — conception puis implémentation de `final_request_state`.
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
12. demander un GO CTO séparé pour commit, push, PR, migration ou runtime.

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

## 11. Procédure de reprise dans une nouvelle session

La nouvelle session doit commencer par :

1. lire ce document intégralement ;
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
10. attendre le GO CTO correspondant avant tout patch.

Prompt de reprise minimal :

> Lire intégralement `docs/CTO_DEVELOPMENT_ROADMAP.md`, vérifier le dépôt `douania/dakar-cargo-quotes` sur la branche `work`, comparer `HEAD`, `origin/work` et l'état Lovable pertinent, puis produire uniquement le diagnostic de reprise du premier pack non terminé. Aucun patch, commit, push ou changement runtime sans nouveau GO CTO.

## 12. Règle de mise à jour de cette feuille de route

Mettre ce document à jour uniquement lorsqu'un événement change l'état canonique :

- pack terminé et vérifié ;
- décision CTO structurante ;
- migration ou déploiement réalisé ;
- risque critique découvert ;
- modification de doctrine pricing, Auth, RLS ou runtime ;
- priorité ou dépendance durablement modifiée.

Chaque mise à jour doit indiquer la date, les preuves, le SHA concerné et le verdict. Éviter les mises à jour purement narratives ou les rapports docs-only sans décision.
