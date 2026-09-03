# Dakar Cargo Quotes — consignes agents (Codex, Claude Code, autres IA)

Répondre en français. Rôle : exécutant technique sous gouvernance CTO.

## Sources de vérité (lire dans cet ordre, ne rien supposer d'autre)
1. `docs/CTO_DEVELOPMENT_ROADMAP.md` — feuille de route canonique, état vérifié, packs, GO en cours. **Lire la section 1 et la section 2 en entier, puis seulement la section du pack actif.** Ne pas relire tout le document à chaque tour.
2. `docs/MASTER_CONTEXT.md` — doctrine et architecture des modules (consulter par module concerné).
3. `docs/SECURITY_CONTRACT.md`, `docs/STATUS_REGISTRY.md`, `docs/DEFERRED_BACKLOG.md` — subordonnés à la roadmap ; ouvrir uniquement si le lot les concerne.

Dépôt : `douania/dakar-cargo-quotes`. Branche obligatoire : `work` (alimente Lovable). Runtime canonique : Lovable Cloud (jamais Supabase Cloud en direct).

## Préflight obligatoire (lecture seule, avant tout travail)
```
git rev-parse --show-toplevel && git branch --show-current
git status --short --branch && git rev-parse HEAD && git ls-remote origin refs/heads/work
```
Expliquer tout écart local/GitHub avant d'agir. Si un lot local annoncé est absent : STOP.

## Règles non négociables
- Vérité seulement. Ne jamais inventer fichier, commit, test, migration ou état runtime. Si non vérifié : « Je ne sais pas. »
- Distinguer faits vérifiés / hypothèses / risques / recommandations.
- Corrections chirurgicales. Zéro refactor global. Ne pas toucher un composant FROZEN.
- Aucun patch, commit, push, migration, déploiement, email ou changement de doctrine sans GO CTO explicite pour ce lot précis.
- Une seule IA écrit à la fois sur un même lot ; l'autre est en contre-revue lecture seule.
- Préserver Auth, RLS, idempotence, intégrité des données, traçabilité.
- Un test non exécuté vaut NOT_RUN, jamais PASS. Comparer à la baseline `origin/work` : dette identique = PASS_WITH_BASELINE.

## STOP immédiat si
plus de 3 fichiers hors GO · DB/RLS/Auth/Supabase/migration non autorisés · composant FROZEN · périmètre élargi · donnée client/secret destiné au commit · divergence Git inexpliquée.

## Commandes de contrôle
`npm run ci` = check:function-config + typecheck + test + typecheck:deno + test:deno + lint:baseline + build. Ne jamais lancer `test:deno:live` sans GO.

## Documentation
Pas de nouveau `.md`, pas de commit docs-only, pas de rapport long sauf décision structurante, résultat de patch/migration ou changement de statut canonique. Mettre à jour la roadmap en fin de lot uniquement (section datée, ≤ 20 lignes).

## Format de sortie attendu
Statut : PASS / FAIL / PARTIAL / BLOCKED / UNKNOWN
Faits vérifiés · Hypothèses · Risques · Recommandation · Action suivante
Rapport compact : repo, branche, HEAD base → HEAD nouveau, diff exact, tests exécutés / NOT_RUN, impact DB/Auth/RLS/runtime, rollback.
