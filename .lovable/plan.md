# Livraison privée — correctif run6 (comparatif surestaries documentaire)

## Blocage actuel

L'espace de travail Lovable n'a toujours pas intégré le dernier commit :

- Espace de travail : `d727cdff…` (lot précédent)
- GitHub `work` : `70d1539758bb4b86a25c0bd4cf6c640329a33fa4` (correctif validé)

La synchronisation GitHub → Lovable se fait côté plateforme (Paramètres → Git/GitHub), pas depuis mes outils. **Avant toute exécution, il faut que l'espace de travail affiche `70d15397…`** : relancer « Re-check sync status » dans les paramètres Git du projet ; si le SHA ne bouge pas, pousser un commit anodin sur `work` pour relancer l'ingestion.

## Étapes d'exécution (une fois la synchronisation confirmée)

1. **Préflight** : vérifier HEAD = `origin/work` = `70d15397…`, arbre `HEAD:supabase` = `5e62ea20046f310c9a8b0eda9edde3867303e37d`, worktree propre. STOP sur divergence.
2. **Aperçu privé** : reconstruire via `npx vite build` (sans installation, sans édition), vérifier HTTP 200.
3. **Déploiement unique** : `quotation-engine` seule via Lovable Cloud, rapporter l'accusé exact.
4. **Sondes non mutantes** : OPTIONS (200 attendu), POST sans authentification (401 attendu) — joignabilité et refus d'accès seulement, pas une preuve de calcul authentifié.
5. **Post-contrôle** : revérifier HEAD et arbre `supabase` byte-identiques, worktree propre, `is_published=false`.

## Gardes-fous

- Aucune édition de fichier, aucun commit, aucune migration/SQL.
- Aucun changement Auth/RLS, tarif, fait client, barème.
- Aucune autre fonction Edge (`export-quotation-version-pdf` et `create-quotation-email-draft` déjà livrées, sources inchangées).
- Aucune publication publique, aucun réglage de visibilité, aucun envoi, aucun calcul de dossier.
- Dettes historiques (TS2345 dans `run-pricing/index.ts`, lint 740/16, tests obsolètes) signalées seulement, jamais corrigées dans ce lot.
- Empreinte de bundle runtime non exposée : NOT_VERIFIED ; preuve de substitution = sources Git inchangées + accusé exact + sondes.
- Arrêt au premier échec.

La recette authentifiée et le nouveau calcul dans l'interface vous reviennent.
