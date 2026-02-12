
Objectif: faire en sorte que l’UI ne “voit” plus l’ancien `service.package = BREAKBULK_PROJECT` (superseded) et qu’elle synchronise réellement les services affichés avec le package courant (`DAP_PROJECT_IMPORT`), de manière idempotente après refresh et sans écraser les edits opérateur.

## Diagnostic (preuves)
1) Côté backend et base, c’est déjà correct:
- Pour le case `4f2baa5b-...`, le fact **courant** est `service.package = DAP_PROJECT_IMPORT` (is_current = true).
- L’ancien `service.package = BREAKBULK_PROJECT` est bien `is_current = false`.

2) Côté frontend, on charge et on affiche encore des faits “historiques”:
- La requête UI charge `quote_facts` **sans filtre `is_current`**, donc on reçoit **les 2** lignes `service.package` (BREAKBULK puis DAP).
- Dans `QuotationSheet.tsx`, le badge passe `detectedPackage={quoteFacts?.find(...)}`
  - `find()` retourne le **premier** match (donc BREAKBULK) car les faits sont triés `created_at.asc`.

Résultat: l’UI peut afficher “Breakbulk” même quand le package courant est DAP.

3) Synchronisation services potentiellement non déterministe:
- L’auto-injection de services est dans un gros `useEffect` “overlay facts” piloté par `factsApplied`.
- Si des services Breakbulk ont déjà été injectés dans la session avant correction, et que le ré-overlay ne se rejoue pas au bon moment, l’écran peut rester “bloqué” sur l’ancien set de services.

## Correctif proposé (Phase V4.1.4d)
### A) Ne charger que les faits courants (source de vérité UI)
Fichier: `src/hooks/useQuoteCaseData.ts`
- Modifier la query `quote_facts` pour filtrer `is_current = true`.
- (Optionnel mais recommandé) Ajouter `source_type` et `is_current` au select pour debug/évolutivité.

Effets:
- `quoteFacts` ne contiendra plus le vieux `BREAKBULK_PROJECT`.
- Le badge, les panels et toute logique `.find()` ou “premier match” ne pourront plus se tromper.

### B) Corriger l’affichage du package détecté (robustesse)
Fichier: `src/pages/QuotationSheet.tsx`
- Remplacer l’usage de `quoteFacts.find(f => f.fact_key === 'service.package')` par une valeur “latest/current” fiable:
  - soit via le filtre `is_current=true` (A) => `find()` redevient OK
  - soit via un helper `getLatestFact(quoteFacts, 'service.package')` (si on garde l’historique pour une autre raison)

### C) Rendre la synchro “package → services” réellement idempotente
Fichier: `src/pages/QuotationSheet.tsx`
- Extraire l’injection de services dans un `useEffect` dédié qui dépend explicitement de:
  - `currentServicePackage` (fact courant `service.package`)
  - `serviceLines`
  - `quoteCase?.id`
- Logique:
  1) Si pas de package courant, ne rien faire.
  2) Si `SERVICE_PACKAGES[currentPackage]` existe:
     - Si `serviceLines` est vide => injecter.
     - Si `serviceLines` correspond manifestement à un autre package (ex: set de services typiques Breakbulk) ET que l’opérateur n’a pas “touché” les services dans la session => remplacer.
     - Sinon => ne pas écraser.

#### Protection des edits opérateur (promesse de la phase 4c)
Problème actuel: modifier une ligne via l’UI ne change pas `source` vers `manual`, donc on ne peut pas protéger correctement.
Solution:
- Introduire un `servicesTouchedRef` (et/ou un wrapper) pour marquer “touched by user” dès que l’opérateur:
  - ajoute/supprime une ligne
  - édite une ligne dans `ServiceLinesForm`
- Passer à `ServiceLinesForm` des handlers “UI” qui:
  - marquent `servicesTouchedRef.current = true`
  - et, si nécessaire, convertissent `source` en `'manual'` (uniquement pour les edits UI)
- Garder `updateServiceLine` “raw” pour les mises à jour automatiques (pricing) afin de ne pas passer en manuel quand l’IA renseigne le tarif.

### D) (Optionnel mais utile) Bouton de resynchronisation forcée
Si `servicesTouchedRef.current === true` et qu’il y a mismatch package/services:
- Afficher une action non destructive: “Synchroniser les services avec le package détecté” (toast avec bouton, ou petit bouton dans la carte Services).
- Ça évite de bloquer l’utilisateur tout en respectant la sécurité (pas d’écrasement silencieux).

## Fichiers impactés
- `src/hooks/useQuoteCaseData.ts` (filtre `is_current=true` pour facts)
- `src/pages/QuotationSheet.tsx` (affichage package + synchro reactive + protection edits)
- (Optionnel) pas besoin de toucher aux fonctions backend / ni au schéma.

## Validation (checklist)
1) Ouvrir `/quotation/c627ed62-...`
2) Vérifier que le badge “package” affiche `DAP PROJECT IMPORT` (et plus Breakbulk).
3) Vérifier que la liste des services injectés est:
   - `DTHC`, `Transport`, `Restitution vide`, `Dédouanement Dakar`, etc.
   - et que `Déchargement navire / Survey` disparaissent.
4) Tester le cas “opérateur édite un service”:
   - Modifier une ligne (description/qty)
   - Relancer re-analyse
   - Vérifier que l’app n’écrase pas automatiquement sans action explicite (ou qu’elle propose un bouton “Synchroniser” selon l’option D).

## Risques / Trade-offs
- Filtrer `is_current=true` simplifie énormément et évite les faux affichages, mais retire l’historique “pour UI”. Si on veut afficher l’historique plus tard, on fera une requête dédiée “audit”.
- La protection des edits est indispensable: sans marquage “manual/touched”, tout mécanisme de remplacement automatique finira par écraser un ajustement opérateur.

## Résultat attendu
- L’UI devient cohérente avec l’état métier courant en base (pattern “state-based UI”, idempotent au refresh).
- Plus d’affichage Breakbulk causé par un fact superseded.
- Services toujours alignés avec `service.package` courant, tout en protégeant les edits manuels.
