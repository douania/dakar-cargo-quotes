# Plan UI opérateur — vue dossier

## Statut
**PARTIAL — plan prêt pour validation CTO lot par lot.** Aucun code applicatif n’a été modifié. Préflight vérifié : dépôt propre, `HEAD` = `origin/work` (`799ee83afe1907d0033809a4423ad30639946caa`). Lovable utilise une branche technique `edit/...`; recontrôle obligatoire avant chaque lot.

## Faits vérifiés dans le code
- `CaseView.tsx` fait 2 720 lignes. L’estimation est déjà visible avant les sections repliées; `#section-pricing` précède `#section-scenarios`. Diagnostics et sources sont fermés par défaut.
- La synthèse est dispersée entre `NextActionBanner`, `ReadyActionsPanel`, `CaseActionPlan`, `CommunicationSummaryCard`, le stepper local et les cartes readiness. `NextActionBanner` et `ReadyActionsPanel` suivent la même priorité, mais sans fonction partagée.
- `useCockpitState` fournit statut, gaps, demandes/faits partenaires, clarifications client, version, PDF et brouillon. Il ne fournit pas numéro/snapshot financier de la version sélectionnée.
- L’estimation sélectionnée remonte déjà de `QuoteScenariosPanel` vers `CaseView` avec totaux, devise, lignes, réserves et blocages. La version client est `quotation_versions.is_selected`; son snapshot porte les totaux.
- Les hypothèses sont typées. Pour `routing.local_transport_estimate` et `pricing.container_stay_estimate`, le rendu JSON retombe aujourd’hui sur `JSON.stringify()`.
- Les faits chargés sont les faits courants. Aucun signal générique autoritatif « fait en conflit » n’est disponible; seuls des conflits spécifiques existent (PAD/poids et demande consolidée).
- La création de version est désactivée uniquement sur dossier verrouillé. `quotation_versions.pricing_run_id` existe et permettrait, en lecture, de détecter qu’un run est déjà versionné.
- Débordement confirmé : `SidebarInset` et le `<main>` flex n’ont pas `min-w-0`; descendants rigides/`whitespace-nowrap` imposent une largeur intrinsèque supérieure à l’espace restant avec la sidebar.
- L’impression ouvre déjà tous les `<details>` de `.case-print-root`, puis restaure leur état.
- Les composants Phase 3B nommés par le CTO resteront byte-identiques.

## Hypothèses
- « Bandeau fixe » = sticky sous l’en-tête, statique à l’impression.
- Son unique bouton primaire ouvre/focalise l’action existante; il ne duplique aucune mutation ni confirmation. Les actions internes restent disponibles en style secondaire.
- Écart = estimation sélectionnée moins total de la version sélectionnée, seulement si nombres finis et devise identique; sinon « non comparable ».
- Aucune valeur de la maquette 450cb321 ne sera codée en dur.
- Un GO, des tests, une contre-revue et un diff réel seront requis pour chaque lot.

## Risques
- **Divergence UI** : extraire la priorité existante dans un sélecteur frontend pur partagé; ne pas créer une quatrième hiérarchie.
- **Fausse précision** : conflit, barème officiel et écart seulement si les données les attestent.
- **Mutation involontaire** : les composants actuels restent propriétaires de leurs appels; les nouveaux conteneurs composent seulement la vue.
- **Impression** : accordéons montés même fermés; conserver les tests avant/après impression.
- **Responsive** : corriger les minima flex; pas de `overflow-x-hidden` global. Scroll local réservé aux tables.

## Sources de vérité du bandeau
Créer un `PilotageViewModel` frontend pur et testé :
1. **Étapes** : Estimation = run scénario sélectionné réussi; Devis calculé = dernier run canonique réussi; Version = version sélectionnée; PDF/Brouillon = objets de cette version; Envoi = statut `SENT/ACCEPTED/REJECTED`. Étape courante = première incomplète.
2. **Action/blocage** : priorité existante de `NextActionBanner`/`ReadyActionsPanel` : gaps/PAD → client/partenaire → faits/offre → pricing → version → PDF → brouillon → envoi. CTA = navigation vers l’action existante.
3. **Devis confirmé** : numéro + total du snapshot de la version sélectionnée. Sans version, ne pas présenter le dernier run comme devis client.
4. **Estimation** : total indicatif du run scénario sélectionné, explicitement non ferme.
5. **Écart** : soustraction arithmétique neutre, même devise uniquement.
6. **Points à traiter** : union dédupliquée des gaps ouverts, blockers/réserves scénario et problèmes PAD explicitement retournés. Mentions standard séparées; aucune déduction de conflit par faible confiance.

## Hypothèses JSON lisibles
Adaptateur pur, sans changement de stockage :
- dispatch par `assumed_fact_key`;
- transport local : destination, distance, équipement, poids, base, TVA, source;
- séjour : opérateur, durée, franchise, groupes, désignation, tranches, source;
- dictionnaire de libellés/unités pour les autres clés connues;
- JSON inconnu/invalide : « Données structurées à consulter », jamais dump brut principal;
- brut conservé dans `<details>Détail technique</details>`;
- tests d’immutabilité.

## Plan par lots

### Lot 1 — Écran principal
**But** : en-tête compact, bandeau sticky, CTA primaire unique, compteur/liste uniques, estimation tabulaire, réserves actionnables vs standard, hypothèses lisibles, sections fermées avec résumé.

**Fichiers** — modifier : `CaseView.tsx`, `MainLayout.tsx`, `useCockpitState.ts`, `NextActionBanner.tsx`, `ScenarioEstimateResult.tsx`, `QuoteScenarioAssumptionsPanel.tsx`, `PricingLaunchPanel.tsx`, `index.css`; créer : `case-view/presentation.ts` et son test; adapter les tests cockpit/estimation/hypothèses/pricing.

**Réutilisé** : données cockpit, `SelectedScenarioEstimate`, priorités et callbacks existants. **Manquant** : numéro/snapshot de la version dans la projection cockpit; conflit générique exclu.

**Tests** : préserver estimation d’abord, sections fermées, ordre des ancres, zéro pricing au montage, verrous et impression; ajouter CTA unique, progression, écart/devise, tableau responsive, absence de JSON brut.

**Risque/taille** : élevé, 700–1 100 lignes tests compris. Contre-revue obligatoire.

### Lot 2 — Marchandises/PAD
**Fichiers** : `CaseView.tsx`, `PadGroupConfirmationsPanel.tsx`, test; extraction optionnelle `PadClassificationHelp.tsx`.

**Réutilisé** : lecture/mutations `manage-pad-group-confirmation`, poids, rapprochement, décisions, NST/candidats/alias. Aucun calcul ajouté. Le montant PAD n’est montré que s’il existe.

**Tests** : conserver les 9 contrats de mutation/non-automatisme; ajouter poids côte à côte, réserve unique, aide repliée, CTA de confirmation par groupe.

**Risque/taille** : moyen, 250–450 lignes.

### Lot 3 — Devis, versions, envoi
**Fichiers** : `CaseView.tsx`, `PricingResultPanel.tsx`, `QuotationVersionCard.tsx`, `SendQuotationPanel.tsx`, `usePricingResultData.ts`, `LineProvenanceBadges.tsx`, tests de sélection/envoi.

**Réutilisé** : version, sélection, PDF, brouillon, pré-vérifications, marquage manuel. Sélectionner `pricing_run_id` côté frontend pour désactiver « Créer vN » si le run est déjà versionné. Compter seulement les références explicitement officielles.

**Tests** : quatre tuiles, création désactivée sans nouveau run, destinataire en erreur, marquage désactivé, mention envoi manuel; contrats d’envoi inchangés.

**Risque/taille** : moyen-haut, 450–750 lignes.

### Lot 4 — Scénarios
**Fichiers** : `QuoteScenariosPanel.tsx`, `CaseView.tsx`, test; extraction optionnelle `ScenarioRevisionTable.tsx`.

**Réutilisé** : queries, sélection, comparaison, création/révision, calcul isolé et sortie existants. Données suffisantes pour une ligne par révision et le détail de la sélection.

**Tests** : mutations inchangées; ajouter tableau, détail unique, réserves non répétées, contraste sombre et verrous.

**Risque/taille** : élevé (composant 2 063 lignes), 450–800 lignes.

### Lot 5 — Partenaires/coordination
**Fichiers** : `CaseView.tsx`, `CaseActionPlan.tsx`, `CommunicationSummaryCard.tsx`, `PartnerScopeCard.tsx`, tests ciblés.

**Réutilisé** : cockpit, plan d’actions, communications, demandes et qualification de périmètre. La phrase « hors devis DAP » utilise seulement incoterm/package + qualification déjà calculée.

**Tests** : étape restante mise en évidence, trois lignes client, état collecte, explication hors périmètre, aucune mutation au montage.

**Risque/taille** : moyen, 250–450 lignes.

### Lot 6 — Sources/faits/documents
**Fichiers** : `CaseView.tsx`, `case-view/constants.ts`, `FactHistoryPopover.tsx`; créer `CaseFactsTable.tsx` + test.

**Réutilisé** : faits/documents/timeline, édition, historique, handlers. Libellé métier visible, clé technique secondaire, groupement par domaine.

**Limite** : surligner seulement les conflits explicitement exposés; « Arbitrer » générique reste hors lot sans source fiable.

**Tests** : faible confiance ≠ conflit, JSON résumé, édition/historique inchangés.

**Risque/taille** : moyen-haut, 350–600 lignes.

### Lot 7 — Outils avancés, responsive, impression
**Fichiers** : `CaseView.tsx`, `index.css`, test cockpit; extraction optionnelle `AdvancedCaseTools.tsx`. Les panneaux cargo/sync restent inchangés sans GO explicite.

**Réutilisé** : cargo canonique, synchronisation legacy, intention, demande consolidée, codes support. Regroupement atténué, fermé par défaut.

**Tests/recette** : aucun appel au montage; impression complète; Playwright à 926 px sidebar ouverte, 1280 px et mobile. Critère : aucun scroll horizontal du document; scroll local possible dans les tables.

**Risque/taille** : moyen, 150–300 lignes.

## Tests conservés / adaptés
- **Conserver les contrats** : payloads et appels pricing/PAD/scénarios/version/PDF/brouillon/envoi; invalidations; locks; aucune mutation au montage; impression.
- **Adapter seulement** : libellés, emplacement, cartes→tableaux et vocabulaire `Estimation/Devis/Version/Envoi`.
- Après chaque lot : tests ciblés puis `npm run ci` si le GO l’autorise; dette identique à `origin/work` = `PASS_WITH_BASELINE`.

## Décisions CTO séparées
1. **Conflits génériques** : recommander uniquement les signaux explicites existants; toute heuristique/nouveau statut exige un lot métier/DB.
2. **Outils avancés** : A recommandé — prévisualisations seules dans ce bloc, actions d’adoption/sync dans une zone opératoire; B — les conserver mais corriger la promesse « aucun outil n’écrit ».
3. **Barèmes officiels** : compter les références uniques marquées `OFFICIAL`; une définition juridique différente exige arbitrage.
4. **CTA primaire** : recommander navigation/focus, pas exécution directe.
5. **Anciennes commandes** : déplacement/reclassement seulement; suppression fonctionnelle sous GO produit distinct.
