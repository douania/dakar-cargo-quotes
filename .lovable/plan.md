
Diagnostic confirmé

- Le problème n’est pas côté UI ni cache React Query.
- `CaseView` et `QuotationSheet` relancent bien `build-case-puzzle`.
- Le code source contient déjà `FLOW-FIX-1` dans `supabase/functions/build-case-puzzle/index.ts` :
  - normalisation `SENEGAL` → `SN`
  - inférence `routing.destination_port = Dakar` pour les imports maritimes vers le Sénégal
- Mais les logs runtime du rerun montrent encore l’ancien comportement :
  - `destCountry=SENEGAL`
  - `Detected flow type: EXPORT_SENEGAL`
  - aucun log `[FLOW-FIX-1]`
- Conclusion : le gap persiste très probablement parce que la fonction backend exécutée n’embarque pas encore le correctif présent dans le repo. Le problème ressemble à un drift repo/runtime, pas à une règle absente du code.

Plan d’exécution

1. Redéployer uniquement `build-case-puzzle`
   - Pas de migration
   - Pas de changement UI
   - Pas de refactor global

2. Relancer l’analyse sur le dossier courant
   - Rejouer `build-case-puzzle` après redéploiement
   - Vérifier dans les logs :
     - `destCountry=SN`
     - un flow import maritime cohérent
     - le log d’inférence Dakar

3. Vérifier les effets métier
   - `quote_facts` contient `routing.destination_port = Dakar`
   - `source_type = port_inference`
   - le gap ouvert `routing.destination_port` est résolu/fermé
   - le dossier n’est plus bloqué par ce gap

4. Filet de sécurité si le gap reste ouvert après redéploiement
   - Appliquer un micro-correctif local dans `supabase/functions/build-case-puzzle/index.ts`
   - Aligner la persistance finale sur le flow réellement déduit (`assumptionResult.flowType`) si nécessaire
   - Ne toucher à rien d’autre

Détails techniques

- Avec le code actuel, `resolveCountry()` ne devrait plus jamais logger `SENEGAL` en sortie directe : il doit renvoyer `SN`.
- Le log actuel prouve donc que la version exécutée n’est pas celle que montre le repo.
- Le pipeline de relance côté frontend est correct ; je ne vois pas de bug UI principal à corriger pour ce symptôme.

Blast radius attendu

- Cas normal : redéploiement d’une seule edge function, zéro patch code supplémentaire
- Cas de secours : 1 seul fichier edge function (`supabase/functions/build-case-puzzle/index.ts`), sans migration ni impact frontend

Livrable attendu après exécution

- confirmation du runtime corrigé
- preuve loguée du flow import + inférence Dakar
- statut final du gap bloquant
- diff réel uniquement si un micro-patch supplémentaire s’avère nécessaire
