
# Plan révisé — Diagnostic infra injection variables VITE_*
## Périmètre : lecture seule sur le runtime + écriture documentaire uniquement

## Contexte verrouillé

- Le guard `src/integrations/supabase/guard.ts` s'affiche correctement sur le site publié et la preview → bundle frontend bien chargé.
- `.env` sandbox contient `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` avec les noms exacts attendus par `client.ts`.
- Code applicatif correct. Problème = injection des variables `VITE_*` dans le build Lovable (publish ET/OU preview froide).
- Hash bundle précédent connu : `index-IZ9GpTvG.js`.
- Entrée backlog existante `INFRA-PUBLISH-VITE-ENV-001`, statut actuel `mitigation_appliquee_cause_racine_a_confirmer`.

## Périmètre des modifications autorisées

**Zéro modification applicative.**

Écritures autorisées **uniquement** :
1. Création de `docs/audits/INFRA-PUBLISH-VITE-ENV-001-evidence.md`.
2. Mise à jour **chirurgicale** de l'entrée `INFRA-PUBLISH-VITE-ENV-001` dans `docs/DEFERRED_BACKLOG.md` (statut + lien d'évidence uniquement).

Interdits explicites :
- pas de modification de `src/`
- pas de modification de `supabase/`
- pas de modification de `.env`
- pas de modification de `client.ts`, `types.ts`, `config.toml`
- aucune migration
- aucune edge function
- aucun changement RLS
- aucun hardcoding de clés
- pas de réécriture/reformatage globale du backlog

## Étapes

### 1. Capturer le bundle publish

```bash
curl -s https://dakotation-pro.lovable.app/ -o /tmp/index_publish.html
PUB_BUNDLE=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/index_publish.html | head -1)
curl -sI https://dakotation-pro.lovable.app/ > /tmp/headers_publish_root.txt
curl -sI "https://dakotation-pro.lovable.app${PUB_BUNDLE}" > /tmp/headers_publish_bundle.txt
curl -s "https://dakotation-pro.lovable.app${PUB_BUNDLE}" -o /tmp/bundle_publish.js
```

### 2. Capturer le bundle preview

```bash
PREVIEW=https://id-preview--c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef.lovable.app
curl -s ${PREVIEW}/ -o /tmp/index_preview.html
PRE_BUNDLE=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/index_preview.html | head -1)
curl -s "${PREVIEW}${PRE_BUNDLE}" -o /tmp/bundle_preview.js
```

### 3. Métriques d'évidence (publish + preview)

Pour chaque bundle :
- chemin exact (`/assets/index-XXXXXXX.js`)
- taille en octets
- comparaison avec hash précédent connu `index-IZ9GpTvG.js` → changé / inchangé
- `grep -c 'snjewofqxfsdmaszapux'`
- `grep -c 'VITE_SUPABASE_URL'` (vérifie si le nom littéral subsiste, indicateur d'absence d'inlining)
- `grep -oE 'https://[a-z0-9]+\.supabase\.co' | sort -u`
- en-têtes cache : `cache-control`, `age`, `etag`, `cf-cache-status`, `x-served-by`, etc.

### 4. Production de `docs/audits/INFRA-PUBLISH-VITE-ENV-001-evidence.md`

Contenu obligatoire :
- date/heure UTC de capture
- URL publish testée
- URL preview testée
- ancien bundle connu : `index-IZ9GpTvG.js`
- bundle publish actuel + taille + verdict (changé/inchangé)
- bundle preview actuel + taille + verdict (changé/inchangé)
- compteur grep `snjewofqxfsdmaszapux` (publish + preview)
- compteur grep `VITE_SUPABASE_URL` (publish + preview)
- URLs `*.supabase.co` détectées (publish + preview)
- en-têtes cache/CDN pertinents (publish + preview)
- verdict explicite parmi :
  - **H1** : publish KO / preview OK → bug pipeline publish
  - **H2** : publish KO + bundle inchangé vs ancien → cache CDN servant ancien bundle
  - **H4** : publish KO + bundle changé sans variables injectées → injection cassée au build neuf
  - **Preview** : injection preview KO ou OK
- mention explicite : **H3 lifecycle ne peut pas être conclue par curl seul** ; nécessite reproduction navigateur avant/après interaction chat Lovable, hors périmètre de ce diagnostic.
- message support Lovable prêt à copier-coller (avec hash, URL, compteurs).

### 5. Mise à jour chirurgicale de `docs/DEFERRED_BACKLOG.md`

Sur l'entrée existante `INFRA-PUBLISH-VITE-ENV-001` uniquement :
- remplacer la valeur du champ statut par `diagnostic_confirme_escalade_support_requise` **si** les preuves confirment l'absence (sinon statut nuancé reflétant l'observation réelle).
- ajouter une ligne référence : `evidence: docs/audits/INFRA-PUBLISH-VITE-ENV-001-evidence.md`.
- ne pas toucher au reste de l'entrée, ne pas reformater le fichier, ne pas réordonner les entrées, ne pas modifier l'en-tête.

## Livrables finaux

1. **Diff réel** des deux fichiers documentaires (création audit + édition ciblée backlog), uniquement.
2. **Contenu intégral** de `docs/audits/INFRA-PUBLISH-VITE-ENV-001-evidence.md`.
3. **Verdict explicite** H1 / H2 / H4 + état preview, avec note H3 hors périmètre curl.
4. **Message support Lovable** prêt à copier-coller.

## Garanties

- Aucun fichier sous `src/`, `supabase/`, `.env`, `client.ts`, `types.ts`, `config.toml` n'est lu ni écrit en modification.
- Aucune dépendance ajoutée.
- Aucune migration, aucune edge function, aucun changement RLS.
- Si une étape exige une lecture supplémentaire de fichier applicatif, elle reste strictement en lecture.
