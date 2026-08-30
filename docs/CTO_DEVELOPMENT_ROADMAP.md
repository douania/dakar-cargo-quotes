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

Mise à jour du 30 août 2026 : **PASS du correctif frontend P1-B `91474c4f`, publié/synchronisé en privé, CI GitHub verte et reprise versionnée prouvée ; PARTIAL de la recette P1-B globale.** Après révocation PAD : total392184, version historique intacte ; retrait explicite commission : total388880 ; multi-lots et décision CMA devenue orpheline après variante ONE : blocages sans total attendus. Les alertes s'actualisent. 271 tests frontend et 837 tests Deno réussis (6 ignorés), sept gates locaux verts. **Révocation de l'orphelin et nettoyage suspendus : le contrôle de sécurité du navigateur exige une autorisation spécifique pour cette écriture métier.** Aucun contournement, aucun nouveau PDF/brouillon/email ; tarifs et migration inchangés. Storage plateforme accessible, objets de test toujours présents. P1-C reste suspendu jusqu'au PASS runtime P1-B et nettoyage ; aucun GO de production générale.

La reconstruction et la réconciliation des migrations sont terminées. Le parcours authentifié LoLo a été prouvé jusqu'au brouillon non envoyé puis intégralement nettoyé. P1-A2 fournit sur Git et Lovable l'objet scénario versionné, sa sélection et sa comparaison, sans pricing. P1-A3 ajoute la promotion explicite, unitaire et attestée d'une hypothèse vers un fait non monétaire. P1-A4 fournit sur Git et Lovable un ledger et un calcul de pricing isolés par scénario, sans contamination des faits ni du pricing canonique. P1-A5 fournit sur Git et Lovable des sorties de travail versionnées, PDF et brouillons non envoyés qui exposent le scénario, les hypothèses, exclusions, réserves et doubles totaux sans jamais devenir un devis canonique ou ferme ; la recette runtime partielle/bloquée, l'idempotence, la non-sélection, l'absence d'envoi et le nettoyage intégral sont prouvés. La production générale reste conditionnée par la gouvernance des comptes Auth et par la validation des familles tarifaires encore hors du périmètre ferme ; RoRo/ConRo reste fail-closed sans barème Dakar Terminal vérifié.

## 2. Sources de vérité et règles d'autorité

- Dépôt : `douania/dakar-cargo-quotes`.
- Branche obligatoire : `work`.
- Source statique principale : GitHub, branche `work`.
- Runtime canonique : Lovable Cloud.
- Projet Lovable : `c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef` (`dakotation-pro` / Dakar Cargo Quotes).
- État applicatif Git/Lovable vérifié le 29 août 2026 après P1-A5 : commit applicatif `32d3206a6877ede52f343858c11801b464db4669`, régénération automatique bénigne des types `56af13b5`, puis merge Lovable `78f14f924d2fe2f57fc5b79f3903b2d36f9d495f`. Le dépôt local `work` et `origin/work` sont alignés sur ce dernier SHA avant le présent commit documentaire ; le projet Lovable reste privé et non publié.
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
7. **P1-A** — scénarios et hypothèses : P1-A1 à P1-A5 terminés, recettés et intégralement nettoyés.
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
