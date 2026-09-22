# Plan UI opérateur — vue dossier

## Statut

**PARTIAL — plan prêt pour validation CTO lot par lot.** Aucun code applicatif, test, fichier métier ou runtime n’a été modifié pendant cette analyse. Le dépôt est propre et `HEAD` correspond à `origin/work` au SHA `799ee83afe1907d0033809a4423ad30639946caa`, mais l’espace Lovable porte une branche technique `edit/...` plutôt que la branche locale nommée `work`; cette différence de nom doit être recontrôlée au préflight de chaque lot. Les entrées `PENDING` de `docs/CTO_GO_QUEUE.md` sont anciennes et sans recouvrement direct avec cette refonte de présentation; elles restent à arbitrer séparément.

## Faits vérifiés dans le code

- `src/pages/CaseView.tsx` fait **2 720 lignes**. L’estimation est déjà rendue avant les sections repliées et `#section-pricing` précède `#section-scenarios` (`CaseView.tsx:1292-1337`, `2041-2052`). Les diagnostics et les sources sont des `<details>` fermés par défaut.
- La synthèse est aujourd’hui dispersée entre `NextActionBanner`, `ReadyActionsPanel`, `CaseActionPlan`, `CommunicationSummaryCard`, le stepper local de `CaseView`, `PricingLaunchPanel`, `PricingReadinessCard`, `PartnerCollectionReadinessCard` et `PricingCommWarnings`. Plusieurs de ces composants recalculent des variantes de la même priorité.
- `useCockpitState` fournit déjà : statut, gaps bloquants/PAD, demandes partenaires, faits partenaires, clarifications client, version sélectionnée, PDF et brouillon. Il ne fournit pas le numéro ni le snapshot financier de la version sélectionnée.
- Le devis visible vient du dernier `pricing_run` réussi (`usePricingResultData`) et la version réellement destinée au client est identifiable par `quotation_versions.is_selected`; son snapshot contient les totaux. `quotation_versions.pricing_run_id` existe mais n’est pas sélectionné par les hooks/composants frontend actuels.
- L’estimation sélectionnée est déjà remontée de `QuoteScenariosPanel` vers `CaseView` sous forme de `SelectedScenarioEstimate`, avec totaux indicatifs, devise, lignes, réserves et blocages.
- Les hypothèses sont stockées typées dans `quote_scenario_assumptions`. Les deux JSON guidés sont déjà identifiés par `routing.local_transport_estimate` et `pricing.container_stay_estimate`, mais `formatAssumptionValue()` retombe actuellement sur `JSON.stringify()` pour le JSON (`scenarioAssumptions.ts:221-242`).
- Les faits affichés par `CaseView` sont uniquement les faits courants. Le code ne fournit pas de signal générique et autoritatif « fait en conflit »; seuls certains conflits explicites existent, notamment `PAD_GROUP_WEIGHT_CONFLICT` et les conflits du modèle de demande consolidée.
- La création de version est actuellement désactivée seulement si le dossier est verrouillé. Le lien `pricing_run_id` permet toutefois, en lecture frontend, de savoir si le dernier run possède déjà une version; l’Edge est déjà idempotente sur `(case_id, pricing_run_id)`.
- La cause structurelle du débordement est confirmée : la colonne flex `SidebarInset` et son `<main>` interne n’ont pas `min-w-0`, donc leur largeur minimale reste dictée par les descendants. Les aggravants sont le stepper en `whitespace-nowrap`, les tableaux non systématiquement enveloppés et plusieurs dispositions rigides. À 926 px, la largeur disponible après la sidebar de 16 rem ne peut pas absorber ces minima.
- L’impression complète est déjà protégée par `beforeprint`/`afterprint`, qui ouvre tous les `<details>` puis restaure leur état, et par les règles `@media print` de `src/index.css`.
- Les composants Phase 3B interdits seront laissés byte-identiques : `SimilarQuotationsPanel`, `LearnFromEmailPanel`, `QuotationExcelExport`, `CargoLinesForm`, `ServiceLinesForm`, `QuotationPreview`, `QuotationTotalsCard`.

## Hypothèses de mise en œuvre

- « Bandeau fixe » signifie **sticky sous l’en-tête existant**, pas `position: fixed` hors flux. Il restera statique à l’impression.
- Le bouton primaire unique du bandeau **ouvre la bonne section et focalise l’action existante**; il ne duplique pas les mutations ni ne contourne leurs confirmations. Les commandes internes restent présentes mais utilisent des variantes secondaires/outline.
- L’écart affiché est une simple différence de présentation : `estimation.indicative_total_ttc − version sélectionnée.snapshot.totals.total_payable` (fallback `total_ttc`), uniquement si les deux nombres sont finis et dans la même devise. Sinon : « non comparable ».
- Les montants, intitulés et compteurs des maquettes sont des exemples du dossier 450cb321; aucune valeur ne sera codée en dur.
- Chaque lot aura son propre GO de réalisation, ses tests ciblés, sa contre-revue proportionnée et son diff réel avant passage au lot suivant.

## Risques

- **Duplication de vérité UI** : ajouter une nouvelle hiérarchie au bandeau ferait diverger `NextActionBanner`, `ReadyActionsPanel` et `CaseActionPlan`. Le plan extrait leurs règles actuelles dans un résolveur frontend pur partagé, sans changer leur ordre métier.
- **Fausse précision** : « conflit », « barème officiel » et écart estimation/devis ne seront affichés que si les données portent explicitement cette information.
- **Régression de mutations** : les gros composants (`QuoteScenariosPanel` 2 063 lignes, `PricingResultPanel` 776, hypothèses 841) resteront propriétaires de leurs appels. Les nouveaux conteneurs ne feront que composer leurs vues et transmettre les callbacks existants.
- **Impression tronquée** : les accordéons resteront montés même fermés; chaque lot conservera le test d’ouverture/restauration et un contrôle visuel d’impression.
- **Responsive masqué plutôt que corrigé** : aucun `overflow-x-hidden` global ne sera utilisé pour cacher le problème. La chaîne flex sera corrigée et seules les tables auront un défilement local si nécessaire.

## Source de vérité du bandeau

Une fonction frontend pure et testée construira un `PilotageViewModel` à partir de données déjà chargées :

1. **Étapes**
   - Estimation : run du scénario sélectionné en succès.
   - Devis calculé : statut au moins `PRICED_DRAFT` et dernier `pricing_run` réussi présent.
   - Version : version canonique sélectionnée.
   - PDF : document PDF rattaché à cette version.
   - Brouillon : brouillon rattaché à cette version.
   - Envoi client : statut `SENT`, `ACCEPTED` ou `REJECTED`.
   - L’étape courante est la première non terminée; les statuts terminaux restent en lecture seule.
2. **Action attendue / blocage principal** : reprise stricte de la priorité existante de `NextActionBanner`/`ReadyActionsPanel` (gaps, PAD, partenaire, client, sélection partenaire, pricing, version, PDF, brouillon, envoi). Le CTA navigue vers l’action existante; aucune nouvelle mutation.
3. **Devis confirmé** : numéro et `total_payable` du snapshot de la version sélectionnée, car c’est l’objet destiné au client. Sans version sélectionnée, la tuile l’indique au lieu de présenter le dernier run comme un devis envoyé.
4. **Estimation scénario** : `indicative_total_ttc` du run sélectionné, explicitement « non ferme ».
5. **Écart** : soustraction arithmétique seulement, avec signe, devise commune et libellé neutre; aucune conclusion commerciale automatique.
6. **Points à traiter** : union dédupliquée des signaux explicites déjà présents : gaps ouverts, blockers/réserves du run scénario, problèmes PAD retournés par la lecture existante. Les mentions standard sont séparées des éléments actionnables. Aucun conflit n’est inventé à partir d’une faible confiance seule.

## Rendu lisible des hypothèses JSON

Créer un adaptateur de présentation pur, sans écriture ni changement de stockage :

- dispatch par `assumed_fact_key`;
- `routing.local_transport_estimate` : destination, distance, véhicule/conteneur, poids, base tarifaire, TVA et source sous forme de phrases;
- `pricing.container_stay_estimate` : opérateur, durée si connue, franchise, groupes, désignation, tranches et source; une valeur absente reste « à confirmer »;
- autres JSON connus : dictionnaire de libellés par clé et formatage unités/dates/booléens;
- JSON inconnu ou invalide : résumé sûr « Données structurées à consulter », jamais dump brut dans la vue principale;
- le JSON brut reste accessible dans un `<details>` « Détail technique » pour support et audit;
- tests d’immutabilité : l’adaptateur ne modifie jamais l’objet fourni.

## Plan par lots

### Lot 1 — Écran principal et hiérarchie opérateur

**Objectif** : en-tête compact, bandeau sticky, unique bouton primaire, liste unique de points à traiter, estimation en tableau, réserves séparées, hypothèses lisibles, six sections repliées avec résumé.

**Fichiers prévus**
- Modifiés : `src/pages/CaseView.tsx`, `src/components/layout/MainLayout.tsx`, `src/hooks/useCockpitState.ts`, `src/components/case/NextActionBanner.tsx`, `src/components/case/ScenarioEstimateResult.tsx`, `src/components/case/QuoteScenarioAssumptionsPanel.tsx`, `src/components/puzzle/PricingLaunchPanel.tsx`, `src/index.css`.
- Créés : `src/pages/case-view/presentation.ts`, `src/pages/case-view/__tests__/presentation.test.ts`.
- Tests modifiés : `cockpit-layout.test.tsx`, `ScenarioEstimateResult.test.tsx`, `QuoteScenarioAssumptionsPanel.test.tsx`, `PricingLaunchPanel.test.tsx`.

**Réutilisé** : `useCockpitState`, `SelectedScenarioEstimate`, priorités de `NextActionBanner`/`ReadyActionsPanel`, callbacks de navigation existants, composants Button/Badge/Table/Details.

**Données disponibles** : statut, gaps, version/PDF/brouillon, estimation, lignes/sources/réserves, hypothèses. **À compléter côté frontend seulement** : numéro/snapshot de la version sélectionnée dans la projection de cockpit; catégorisation « actionnable/standard » des codes connus. Le conflit générique reste exclu sans décision.

**Tests** : conserver estimation d’abord, sections diagnostics/sources fermées, ordre pricing avant scénarios, zéro pricing au montage, verrous terminaux, impression complète. Ajouter CTA unique, progression, écart même devise, non-comparabilité, tableau responsive et absence de JSON brut.

**Risque / taille** : élevé, car composition centrale; environ **700–1 100 lignes** de diff, tests compris. Contre-revue frontend obligatoire avant GO lot 2.

### Lot 2 — Marchandises et catégories PAD

**Fichiers prévus** : modifier `CaseView.tsx`, `PadGroupConfirmationsPanel.tsx` et son test; éventuellement créer `PadClassificationHelp.tsx` si le regroupement ne tient pas proprement dans le panneau existant.

**Réutilisé** : lecture `manage-pad-group-confirmation`, `WeightReconciliationForm`, `GroupDecision`, `PadNstSuggestionsPanel`, `CommodityClassificationCandidatesPanel`; mêmes appels `record`/`reconcile_weight`, mêmes attestations.

**Données disponibles** : groupes, équipement, propriété SOC/COC, danger, poids scénario/dossier, rapprochement, catégorie proposée/confirmée, justification, assistance. **Manquant** : aucun pour la structure cible; le montant PAD ne sera affiché que s’il existe déjà dans les données du run/fait, jamais recalculé ici.

**Tests** : les 9 tests de sécurité/mutation restent sémantiquement inchangés; seules les recherches de libellés évoluent. Ajouter lecture côte à côte, réserve unique, aide repliée et bouton de confirmation unique par groupe.

**Risque / taille** : moyen, **250–450 lignes**.

### Lot 3 — Devis confirmé, versions et envoi

**Fichiers prévus** : modifier `CaseView.tsx`, `PricingResultPanel.tsx`, `QuotationVersionCard.tsx`, `SendQuotationPanel.tsx`, `usePricingResultData.ts`, `LineProvenanceBadges.tsx`; adapter `QuotationSelectionSync.test.tsx` et `PricingLaunchPanel.test.tsx` si leurs libellés changent.

**Réutilisé** : création de version, sélection atomique, export PDF, création/sauvegarde du brouillon, pré-vérifications et marquage manuel existants.

**Données disponibles** : quatre chiffres, lignes, `TO_CONFIRM`, sources, versions, PDF, brouillon, destinataire. **Complément frontend** : sélectionner `pricing_run_id` sur les versions afin de désactiver « Créer vN » quand le run visible est déjà versionné. Compter les références officielles uniquement depuis les lignes/sources explicitement marquées officielles.

**Tests** : conserver sélection/version/brouillon synchronisés, guards d’envoi et absence d’envoi SMTP. Ajouter quatre tuiles, création désactivée sans nouveau run, destinataire en erreur, marquage désactivé, mention « envoi manuel hors application ».

**Risque / taille** : moyen-haut, **450–750 lignes**.

### Lot 4 — Scénarios et variantes

**Fichiers prévus** : modifier `QuoteScenariosPanel.tsx`, `CaseView.tsx`, `QuoteScenariosPanel.test.tsx`; créer au besoin `ScenarioRevisionTable.tsx` pour isoler la présentation.

**Réutilisé** : six queries actuelles, sélection, comparaison, création/révision, calcul isolé et sortie de travail. Aucun changement des payloads.

**Données disponibles** : racine, numéro/date/motif de révision, points ouverts, liens d’hypothèses/réserves, run et qualification, sélection. **Manquant** : rien pour le tableau; le détail reste celui de la seule révision sélectionnée.

**Tests** : contrats de création/révision/pricing inchangés; ajouter une ligne par révision, un seul détail développé, réserves non répétées, contraste sombre et verrouillages.

**Risque / taille** : élevé à cause du composant de 2 063 lignes, **450–800 lignes**.

### Lot 5 — Partenaires et coordination

**Fichiers prévus** : modifier `CaseView.tsx`, `CaseActionPlan.tsx`, `CommunicationSummaryCard.tsx`, `PartnerScopeCard.tsx`; créer des tests ciblés de section si absents.

**Réutilisé** : `useCockpitState`, plan d’actions existant, résumé communication, demandes partenaires et qualification de périmètre. Les panneaux détaillés actuels restent propriétaires de leurs actions.

**Données disponibles** : étapes, demandes, réponses/faits, clarifications, destinataire via le brouillon, périmètre fournisseur et qualification `out_of_scope`. **Limite** : la phrase « pourquoi hors devis DAP » sera produite seulement depuis le package/incoterm et la qualification déjà calculée, sans nouvelle règle d’exclusion.

**Tests** : étape restante mise en évidence, trois lignes client, état direct/partenaire, explication hors périmètre, aucune mutation au montage.

**Risque / taille** : moyen, **250–450 lignes**.

### Lot 6 — Sources, faits et documents

**Fichiers prévus** : modifier `CaseView.tsx`, `case-view/constants.ts`, `FactHistoryPopover.tsx`; créer `CaseFactsTable.tsx` et son test pour sortir le tableau du fichier monolithique.

**Réutilisé** : queries faits/documents/timeline, éditeur et ajout de fait, historique, `CaseDocumentsTab`, handlers existants.

**Données disponibles** : domaine, clé, valeur, source, confiance, historique. **Manquant** : un indicateur générique fiable de conflit. Le lot surlignera seulement les conflits explicitement exposés par une source existante approuvée; sinon la fonction « Arbitrer » générique reste hors lot.

**Tests** : regroupement par domaine, libellé lisible + clé technique, JSON résumé, édition inchangée, faible confiance non assimilée à un conflit, onglets et historique préservés.

**Risque / taille** : moyen-haut, **350–600 lignes**.

### Lot 7 — Outils avancés et clôture responsive/impression

**Fichiers prévus** : modifier `CaseView.tsx`, `src/index.css`, `cockpit-layout.test.tsx`; créer éventuellement `AdvancedCaseTools.tsx`. Les composants cargo canonique/synchronisation restent inchangés sauf GO explicite ultérieur.

**Réutilisé** : preview cargo, synchronisation legacy, intention, demande consolidée et codes support; regroupement sous un accordéon atténué fermé par défaut.

**Données disponibles** : tout existe. **Conflit de maquette** : la synchronisation legacy et l’adoption cargo peuvent écrire après action explicite; il serait faux d’afficher « aucun outil n’écrit de fait » si ces commandes restent dans ce bloc.

**Tests/validation** : outils fermés par défaut, aucun appel au montage, ouverture avant impression, restauration après impression; Playwright à 926 px sidebar ouverte, 1280 px, mobile, et aperçu d’impression. Critère : `scrollWidth === clientWidth` pour le document; défilement horizontal autorisé uniquement dans les tables locales.

**Risque / taille** : moyen, **150–300 lignes**.

## Tests qui restent tels quels ou évoluent

- **Contrats à conserver tels quels** : aucune invocation pricing au montage; locks `SENT/ACCEPTED/REJECTED/ARCHIVED/PRICING_RUNNING`; appels/payloads PAD, scénarios, versions, PDF, brouillon et envoi; invalidations de cache; immutabilité des données; impression ouvrant puis restaurant les sections.
- **Assertions à faire évoluer** : libellés de navigation, emplacement des composants, structure cartes→tableaux, intitulés `Pricing Run`→`Devis`, `case`→`dossier`, `sortie de travail` limitée à la zone scénario/support.
- **Nouveaux tests** : résolveur du bandeau, priorité unique, agrégation/déduplication des points, formatteurs JSON, écart de devise, désactivation de version sans nouveau run, résumés repliés, accessibilité des tableaux/menus et non-débordement Playwright.
- Après chaque lot : tests ciblés, puis `npm run ci` selon le GO; dette identique à `origin/work` = `PASS_WITH_BASELINE`, jamais corrigée hors lot.

## Ce qui exige une décision CTO séparée

1. **Conflits de faits** : aucune source générique autoritative n’existe dans la lecture actuelle. Recommandation : lot 1/6 n’affiche que les conflits explicites PAD/demande consolidée. Toute détection heuristique ou nouveau statut exige un lot métier/DB séparé.
2. **Outils avancés** : choisir entre (A recommandé) n’y montrer que les prévisualisations sans écriture et conserver les actions d’adoption/synchronisation dans un emplacement explicitement opératoire, ou (B) conserver ces actions dans le bloc mais corriger la promesse de la maquette.
3. **« n barèmes officiels cités »** : recommandation de compter les références uniques explicitement `OFFICIAL`; si le CTO veut mesurer des barèmes juridiques plutôt que des références de lignes, il faut définir cette sémantique hors présentation.
4. **Action primaire** : recommandation de naviguer/focaliser l’action existante, pas de l’exécuter depuis le bandeau. Une exécution directe obligerait à déplacer ou dupliquer confirmations et mutations.
5. **Masquage d’anciennes commandes** : aucune fonctionnalité ne sera supprimée. Toute suppression réelle d’un bouton ou d’un parcours, plutôt qu’un déplacement/reclassement visuel, demandera un GO produit distinct.
