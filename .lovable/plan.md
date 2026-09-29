# Dossier guidé — plan corrigé le 29 septembre 2026

## Statut et portée du GO
- GO utilisateur sur la correction du plan, puis réalisation et corrections Premium le 29 septembre 2026, incluant bascule et tests. GO de publication reçu : commit/push sur work, synchronisation de l’aperçu privé Lovable et recette synthétique, sans envoi client ni publication publique.
- Codex est le seul écrivain du lot. Autres agents en lecture seule ; auto-revue ciblée conformément à roadmap §2.1, présentation seule.
- Base Git vérifiée : `work` / `a305c74ac6881c46f2599b43b7728cfc7d1db1e8`. Les 13 commits Lovable depuis `864522d` sont récupérés en avance rapide ; note locale de roadmap et `.claude/` préservés.
- Les maquettes sont des exemples fictifs, pas une recette Lovable : 42 contrôles fonctionnels du prototype PASS ; recette visuelle navigateur et validation utilisateur des trois situations NOT_RUN.

## Objectif et critères utilisateur
À l'ouverture, l'opérateur doit identifier en quelques secondes la situation, la prochaine action utile et ce que le client recevrait. Le seuil de cinq secondes est une cible à éprouver avec l'utilisateur, pas une mesure déjà obtenue.

## Organisation cible
- En-tête court : client, trajet, marchandise et situation en langage métier.
- Quatre accès quotidiens : **À faire**, **Marchandise**, **Devis**, **Échanges et documents**. Le dernier regroupe explicitement client et partenaires.
- Accueil « À faire » : une prochaine action conseillée, son motif en une phrase, un bouton principal. Les autres actions indépendantes restent accessibles ; aucune liste imposant que seule la première tâche soit active.
- Le bouton principal ouvre le contrôle utile sur place quand c'est possible, sinon ouvre directement le panneau existant et place le focus sur la bonne action. Il ne confirme, ne calcule et n'envoie rien par lui-même.
- Les documents, sources des informations, consultations et bases opérateur restent accessibles sans « mode expert ». Seuls diagnostics, clés techniques et historique détaillé sont repliés.
- La qualification accompagne toujours le montant : estimation de travail, total partiel avec postes à confirmer, ou version destinée au client. Une version créée n'est pas automatiquement un devis ferme.
- Les contrôles métier et la fraîcheur des données déterminent les possibilités réelles. L'absence d'action conseillée ne signifie pas « dossier terminé » ; traiter explicitement chargement, erreur et statut sans action.

## Trois situations à valider
| Situation | Information visible | Action conseillée | Critère de réussite |
|---|---|---|---|
| Dossier incomplet | Information manquante ou conflit précis, source et conséquence ; aucun montant inventé | Examiner l'écart ou compléter l'information | L'opérateur trouve la source et distingue poids total / individuel ; aucun fait déduit ni validé implicitement |
| Devis avec réserves | Montant partiel et liste des postes non chiffrés immédiatement associés | Examiner le poste et la réserve portée par l'offre | « À confirmer » n'est jamais rendu comme zéro ; les réserves restent dans les sorties existantes ; aucune nouvelle interdiction d'envoi créée par la présentation |
| Devis prêt à envoyer | Version sélectionnée, montant qualifié, PDF, destinataire et brouillon correspondant | Relire les éléments à envoyer | L'opérateur comprend que l'envoi est manuel hors application, puis tracé par « Marquer comme envoyé » ; une version différente ou un brouillon non enregistré conserve les protections actuelles |

Scénarios de non-régression : mono-lot et multi-lot, dossier vide, chargement/erreur, consultation partenaire en attente, absence d'estimation avec devis existant, changement de version, formulaire non enregistré, dossier verrouillé/terminal. Le défaut PENDING de relance du dossier vide reste à signaler ; ce lot de présentation ne l'autorise pas à être corrigé silencieusement.

## Langage et comportement
- gap → information manquante ; pricing/run → calcul du devis ; scope → prestations demandées ; faits → informations du dossier ; PAD → catégorie de marchandise au port (avec référence précise dans le détail).
- Éviter « Approuver » sans objet : nommer l'information ou la base retenue et conserver la confirmation existante.
- Ne pas fusionner « créer une version », « préparer le PDF », « préparer le message » et « marquer comme envoyé » en une action unique.
- Aucun envoi automatique ajouté. `SendQuotationPanel` trace actuellement un envoi manuel ; les avertissements de communication ne deviennent pas des blocages supplémentaires.

## Périmètre de réalisation approuvé
- `src/pages/CaseView.tsx` : composition, navigation et retour à la présentation précédente.
- `src/pages/case-view/presentation.ts` et `constants.ts` : modèle de présentation et libellés ; préserver les priorités existantes de `selectPilotageAction`, ne pas créer un nouveau moteur de workflow.
- Un composant de présentation `src/components/case/CaseTodoCard.tsx` et son test si nécessaire ; ne pas y déplacer les mutations métier.
- GO de correction après revue Premium du 29 septembre : `src/components/puzzle/SendQuotationPanel.tsx` et son test existant `QuotationSelectionSync.test.tsx` ; projection en lecture seule de la préparation enregistrée vers l’accueil, sans nouvelle requête, mutation ni instance de formulaire.
- Tests existants `src/pages/case-view/__tests__/presentation.test.ts` et `cockpit-layout.test.tsx` : compléter les cas affectés.
- Roadmap : note de clôture datée de vingt lignes maximum, en préservant la note locale antérieure. Aucun autre fichier ou refactor global implicite.
- Réutiliser les panneaux existants avec une seule instance active de leurs formulaires, identifiants et mutations. Vérifier la conservation des saisies lors des changements de rubrique ou de présentation ; ne pas monter deux cockpits concurrents.
- Interdits : DB, Auth/RLS, migrations, fonctions serveur, calculs/tarifs, payloads, transitions, création automatique de faits/hypothèses, changement des règles de qualification, composants FROZEN.

## Retour arrière obligatoire
Deux mécanismes complémentaires sont prévus ; la bascule locale et l'application inverse du patch sont maintenant testées (bilan ci-dessous) :
1. **Retour opérateur immédiat** : accès visible « Présentation précédente », rétablissant l'organisation à quatre onglets de la base `a305c74`. Préférence locale d'affichage uniquement ; aucun rôle expert ni changement métier. Protéger les saisies non enregistrées et la sélection courante. Cette bascule n'est pas une protection contre une application qui ne démarre plus.
2. **Rollback de publication** : isoler les futurs commits applicatifs de ce lot, enregistrer leurs SHA exacts et le SHA de base réellement utilisé. Si l'interface casse, masque une réserve/action ou ne satisfait pas l'utilisateur, révoquer uniquement ces commits, du plus récent au plus ancien, par revert ciblé sur `work`, puis reconstruire l'aperçu Lovable sous le GO de publication/rollback correspondant. Ne pas réinitialiser toute la branche ni restaurer aveuglément des fichiers si d'autres lots ont avancé.

- Aucun rollback DB : les dossiers, calculs, versions, PDF, brouillons et historiques existants sont conservés. Le retour d'interface n'annule pas les actions métier réalisées entre-temps.
- Avant publication, prouver la bascule et répéter l'application inverse du diff applicatif dans un espace de validation isolé ; vérifier le build et la présence des commandes de l'ancienne vue. La preuve reste NOT_RUN tant que le code n'existe pas.
- Pour annuler uniquement la présente modification documentaire, restaurer `.lovable/plan.md` depuis `a305c74` après vérification qu'aucune édition ultérieure ne serait perdue. Ne pas toucher la roadmap ni `.claude/`.

## Vérifications et livraison proposées
- Tests ciblés : trois situations ci-dessus, navigation vers les bons panneaux, indépendance des actions, réserves/montants, états inconnus et retour à la présentation précédente sans perte de saisie.
- Vérifier l'écran sur ordinateur et mobile, au clavier, puis l'impression complète ; aucune information essentielle accessible seulement au survol.
- Exécuter `npm run ci` et comparer les échecs à la baseline `origin/work` de départ ; une étape non exécutée reste NOT_RUN, une dette identique PASS_WITH_BASELINE. Aucun `test:deno:live`.
- Auto-revue ciblée du diff pour ce lot de présentation ; si un impact métier/sécurité est découvert, STOP et contre-revue indépendante proportionnée suivant roadmap §2.1.
- Recette utilisateur privée des trois situations avant validation finale de l'ergonomie. Les tests synthétiques ne remplacent pas son appréciation.
- Commit/push `work`, déploiement/aperçu et toute écriture Cloud exigent le GO de publication nommant ces actions ; aucune publication publique ni envoi client implicite.

## Modèle conseillé
- Recommandation de jugement pour ce travail dans Codex : **GPT-6 Astra, effort high** pour la réalisation ; **xhigh** pour un point difficile de conservation des états ou la revue finale si nécessaire. Medium suffit pour une retouche de texte isolée ; max/ultra n'est pas justifié par défaut.
- Le choix privilégie la qualité sur un écran dense et des exigences exactes. Ce n'est pas un benchmark de ce dépôt et aucun réglage de la conversation n'a été changé.
- Sources officielles consultées le 29 septembre 2026 : [choix du modèle](https://developers.openai.com/api/docs/guides/model-selection), [effort de raisonnement](https://developers.openai.com/api/docs/guides/reasoning). Disponibilité dans ChatGPT ou sélecteur Lovable à vérifier séparément ; ne pas assimiler ces interfaces à Codex.

## Réalisation locale — 29 septembre 2026
- Accueil guidé et quatre accès quotidiens, retour à la présentation précédente mémorisé localement ; mêmes instances des panneaux/formulaires. Bouton principal de navigation vers le contrôle existant ; aucune mutation ajoutée.
- Version sélectionnée : total et qualification explicites, postes non chiffrés et réserves opérateur avec périmètre ; qualification absente signalée comme inconnue ; envoi manuel distingué du marquage.
- Revue Frontend Design Premium puis corrections : informations manquantes nommées avec focus direct, « Imprimer le dossier » distinct du PDF client, résumé PDF/destinataire/objet/message enregistré et avertissement de saisie non enregistrée, focus Documents, étapes du devis repliables sur plusieurs lignes en mobile.
- Tests des trois fichiers concernés 61/61 PASS dans la suite complète ; typecheck et build PASS. CI arrêtée au seul échec Vitest de baseline (613 PASS / 1 FAIL, LocalTransportEstimateFields:35). Types Deno 49 et lint 732/16 sans aggravation ; audit statique Premium 120 constats identiques à l’archive baseline, aucun ajout ; pas de conformité globale revendiquée.
- Navigateur Edge local, données synthétiques : trois situations à 1280/375 px, navigation clavier, maintien de saisie lors de la bascule, sections imprimées PASS ; panneaux métier simulés, donc ce contrôle ne constitue pas une recette complète Lovable.
- Reprise navigateur : trois accueils à 1280/375/320 px et rubrique Devis à 375/320 px sans débordement ; focus clavier information/documents/PDF, bascule et conservation des saisies PASS. Données et panneaux métier simulés ; projection du véritable panneau d’envoi éprouvée par tests de composants.
- Patch applicatif à sept fichiers appliqué puis inversé dans une archive isolée de `a305c74` : fichiers restaurés identiques (fins de ligne normalisées), nouveau composant supprimé par l'inverse ; build de la base restaurée PASS au lot initial. Aucun reset ni changement de HEAD du dépôt.
- Au départ de la publication autorisée : recette utilisateur/Lovable NOT_RUN ; aucun changement DB/Auth/RLS, migration, fonction serveur ou envoi prévu. Résultat de publication et SHA de rollback à consigner dans la note canonique de clôture de la roadmap.
