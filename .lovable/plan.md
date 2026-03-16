
Objectif

- Corriger le fait que le rerun continue d’injecter `AGENCY` alors que les lignes moteur `Suivi` / `Administratif` sont déjà présentes.

Constat établi

- Le code source de `run-pricing` contient déjà le mapping P5.4 :
  - `Suivi` → `AGENCY`
  - `Administratif` → `AGENCY`
  - `Dédouanement` / `Douane` → `CUSTOMS_DAKAR`
- Pourtant, le dernier run enregistré pour ce dossier contient encore :
  - les lignes moteur `Suivi`, `Administratif`
  - la ligne enrichie `AGENCY`
- Les logs runtime confirment encore :
  - `Lot 1 ... TRUCKING, AGENCY`
  - `Lot 2 ... TRUCKING, AGENCY`

Conclusion

- Le problème n’est plus “le mapping manque dans le fichier”.
- Le vrai problème est que `inferCoveredServiceKeys()` ne reconnaît pas correctement la couverture `AGENCY` au runtime.

Plan de correction

1. Renforcer `inferCoveredServiceKeys()` dans `supabase/functions/run-pricing/index.ts`
   - normaliser `line.category` avant lookup (`trim`, normalisation Unicode, protection contre variantes d’espaces/accents)
   - conserver le mapping actuel
   - ajouter un fallback sûr sur `line.description` pour les cas déjà validés métier :
     - `Suivi opérationnel` → `AGENCY`
     - `Ouverture de dossier` → `AGENCY`
     - `Frais de documentation` / `documentation` → `AGENCY`
     - `dédouanement` / `douane` → `CUSTOMS_DAKAR`

2. Ajouter une trace runtime minimale
   - log par lot / mono-lot de :
     - catégories vues
     - clés couvertes déduites
     - clés manquantes finales
   - objectif : vérifier immédiatement au prochain rerun si le souci venait d’une variante de chaîne ou d’un désalignement runtime.

3. Garder le patch strictement chirurgical
   - aucun changement UI
   - aucun changement base de données
   - aucun changement sur `quotation-engine`
   - aucun changement des préchecks existants mono-lot / multi-lot

Résultat attendu après rerun

- `CUSTOMS_DAKAR` reste supprimé
- `AGENCY` disparaît
- Les lignes moteur fines restent visibles :
  - `Suivi opérationnel`
  - `Ouverture de dossier`
  - `Frais de documentation`
- Les autres lignes P5 utiles restent en place :
  - `PICKUP_ORIGIN`
  - `PRE_CARRIAGE`
  - `SEA_FREIGHT` / `AIR_FREIGHT`
  - `AIR_HANDLING` / `PORT_DAKAR_HANDLING`
  - `TRUCKING` si non couvert

Détail technique

- Fichier ciblé : `supabase/functions/run-pricing/index.ts`
- Zone ciblée : `ENGINE_CATEGORY_TO_SERVICE_KEY` + `inferCoveredServiceKeys()`
- Aucun changement de schéma backend requis
- Note séparée : l’avertissement console React sur les refs dans `PricingResultPanel` existe bien, mais il est indépendant de ce bug métier de déduplication.
