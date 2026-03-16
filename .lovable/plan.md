
Objectif

- Corriger la vraie panne qui bloque P5 pour que le résultat change réellement au rerun.

Do I know what the issue is?

- Oui.

Ce que j’ai vérifié

- Les logs runtime récents de `run-pricing` montrent maintenant :
  - `ReferenceError: readOverridesFromFacts is not defined`
- Dans `supabase/functions/run-pricing/index.ts`, les appels existent bien :
  - `readOverridesFromFacts(...)`
  - `resolveEffectiveServiceKeys(...)`
- Mais leurs définitions n’existent nulle part dans le fichier ni ailleurs dans les fonctions backend.
- J’ai aussi relu le parsing déjà fait côté UI dans :
  - `src/pages/QuotationSheet.tsx`
  - `src/pages/CaseView.tsx`

Le vrai problème

- Le bloc P5 ne tombe plus sur le problème de déduplication.
- Il casse avant même l’enrichissement, parce que des helpers requis ont été appelés sans être définis.
- Concrètement :
  - `readOverridesFromFacts` manque
  - `resolveEffectiveServiceKeys` manque aussi probablement juste après
- Résultat :
  - le `try/catch` de P5 attrape l’erreur
  - l’enrichissement package est sauté
  - donc soit rien ne change, soit seules les lignes moteur restent affichées

Plan de correction

1. Compléter les helpers manquants dans `supabase/functions/run-pricing/index.ts`
   - ajouter un type local `ServiceOverrides`
   - ajouter `readOverridesFromFacts(facts)`
   - ajouter `resolveEffectiveServiceKeys(packageKey, overrides)`

2. Aligner la logique backend sur la logique déjà utilisée côté UI
   - lire le fact courant `service.overrides`
   - accepter `value_json` objet ou JSON string
   - fallback sûr vers `{ add: [], remove: [] }`
   - nettoyer les clés :
     - trim
     - uppercase
     - filtrage allowlist des `service_key` connus

3. Résoudre le package effectif de façon stable
   - partir de `SERVICE_PACKAGES[packageKey]`
   - retirer les clés présentes dans `remove`
   - ajouter les clés de `add` sans doublons
   - conserver l’ordre stable

4. Garder le patch chirurgical
   - aucun changement base de données
   - aucun changement UI
   - aucun changement du moteur `quotation-engine`
   - on conserve la déduplication P5.4/P5.4b déjà ajoutée

Résultat attendu après implémentation

- plus d’erreur `readOverridesFromFacts is not defined`
- plus d’erreur `resolveEffectiveServiceKeys is not defined`
- le bloc P5 s’exécute enfin
- les lignes package réapparaissent
- la déduplication peut enfin s’appliquer réellement :
  - `AGENCY` masqué si `Suivi` / `Administratif` existent déjà
  - `CUSTOMS_DAKAR` masqué si `Dédouanement` / `Douane` existent déjà
  - les autres lignes utiles P5 restent injectées

Fichier à modifier

- `supabase/functions/run-pricing/index.ts`

Risques

- Faibles
- Patch localisé à la couche P5, sans impact sur le calcul moteur principal
