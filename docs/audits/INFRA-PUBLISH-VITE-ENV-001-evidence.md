# INFRA-PUBLISH-VITE-ENV-001 — Évidence diagnostic injection variables VITE_*

> Diagnostic infra runtime en lecture seule, capture brute des bundles servis par Lovable.
> Aucune modification applicative. Seuls deux fichiers documentaires sont écrits dans ce diagnostic :
> ce fichier d'évidence et la mise à jour ciblée de l'entrée `INFRA-PUBLISH-VITE-ENV-001` du backlog.

## 1. Métadonnées de capture

| Champ | Valeur |
|-------|--------|
| Date / heure UTC | 2026-04-25 ~14:12 UTC |
| Sandbox | dev-server Lovable agent |
| URL publish testée | `https://dakotation-pro.lovable.app` |
| URL preview testée | `https://id-preview--c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef.lovable.app` |
| Hash bundle précédent connu | `index-IZ9GpTvG.js` (référence pré-mitigation) |
| Project ref Supabase attendu dans le bundle | `snjewofqxfsdmaszapux` |
| URL Supabase attendue | `https://snjewofqxfsdmaszapux.supabase.co` |

## 2. Contrôle environnement sandbox (référence)

Le `.env` du sandbox contient bien les noms exacts attendus par `src/integrations/supabase/client.ts` :

```
VITE_SUPABASE_PROJECT_ID=<REDACTED>
VITE_SUPABASE_PUBLISHABLE_KEY=<REDACTED>
VITE_SUPABASE_URL=<REDACTED>
```

`client.ts` lit `import.meta.env.VITE_SUPABASE_URL` et `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`.
Le code applicatif est donc cohérent avec le `.env`. Le problème ne peut pas venir d'un mauvais nom de variable.

## 3. Capture publish (`https://dakotation-pro.lovable.app`)

### 3.1 Chargement HTML

- HTTP : `200`
- Taille `index.html` : `11431 octets`
- Bundle référencé : `/assets/index-KBaKelj-.js`
- Comparaison vs hash précédent `index-IZ9GpTvG.js` : **CHANGÉ** → un nouveau build a bien été produit après la mitigation guard.

### 3.2 En-têtes HTTP

Racine `/` :
```
content-type: text/html; charset=utf-8
cache-control: no-cache, must-revalidate, max-age=0
x-content-type-options: nosniff
cf-ray: 9f1df14b1e2d199c-AMS
set-cookie: __dpl=366c9657-7728-4414-9aa6-aa1633eee628; ...
```

Bundle `/assets/index-KBaKelj-.js` :
```
content-type: text/javascript; charset=utf-8
etag: "de103149d279c36c5251c196bf737830"
x-content-type-options: nosniff
cf-ray: 9f1df14c180edf76-AMS
```

Aucun en-tête `age`, `cf-cache-status`, ou `x-served-by` exploitable indiquant un cache CDN servant un ancien artefact.
La racine est en `no-cache, must-revalidate, max-age=0` → l'`index.html` est bien révalidé à chaque requête. Combiné au hash de bundle changé, **cela élimine H2 (cache CDN d'ancien bundle)**.

### 3.3 Métriques bundle publish

| Métrique | Valeur |
|----------|--------|
| Taille bundle | `3 320 336` octets |
| `grep -c 'snjewofqxfsdmaszapux'` | **0** |
| `grep -c 'VITE_SUPABASE_URL'` | `1` (origine : guard.ts, chaîne `a_.push("VITE_SUPABASE_URL")`) |
| `grep -c 'VITE_SUPABASE_PUBLISHABLE_KEY'` | `1` (origine : guard.ts, chaîne `a_.push("VITE_SUPABASE_PUBLISHABLE_KEY")`) |
| URLs `*.supabase.co` détectées | **aucune** |
| `import.meta.env` occurrences | `0` |

Extraits de contexte autour des littéraux trouvés (montrent que ce sont des chaînes pushées par le guard, pas des références non substituées) :
```
;var i=wJ.exports;const a_=[];a_.push("VITE_SUPABASE_URL");a_.push("VITE_SUPABASE_PUBLISHABLE_KEY");if(a_.length>0){const t=`[supabase/gu...
```

### 3.4 Interprétation publish

- `import.meta.env` a bien été transformé par Vite (`0` occurrence dans le bundle minifié) → la passe de remplacement Vite a été exécutée.
- Mais aucune URL `*.supabase.co` ni le project ref `snjewofqxfsdmaszapux` n'apparaissent dans le bundle.
- Conclusion : Vite a remplacé `import.meta.env.VITE_SUPABASE_URL` et `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` par `undefined` ou chaîne vide. **Les variables VITE_* n'étaient pas disponibles dans l'environnement de build au moment du publish.**

## 4. Capture preview (`https://id-preview--c3b5e3c2-...lovable.app`)

### 4.1 Réponse HTTP

- HTTP : `302` redirect (auth Lovable, attendu pour curl non authentifié).
- Aucun bundle `/assets/index-*.js` exposé directement à curl.
- En conséquence : **le test curl ne peut pas conclure sur la preview**. Le bundle preview n'est observable qu'avec une session authentifiée navigateur.

### 4.2 Note sur H3

H3 (lifecycle preview Lovable réveillée par interaction chat) **ne peut pas être conclue ni écartée par curl seul**.
Sa confirmation nécessiterait :
- une observation navigateur authentifié de la preview à froid (sans interaction chat) → vérifier si le guard panel s'affiche,
- puis une nouvelle observation après envoi d'un message dans le chat Lovable → vérifier si l'app monte normalement,
- comparaison des bundles servis avant/après.

Cette procédure est hors périmètre du présent diagnostic.

## 5. Verdict

| Hypothèse | Évidence | Verdict |
|-----------|----------|---------|
| **H1** publish KO / preview OK | Publish : project ref absent, `import.meta.env` substitué à vide. Preview : non testable par curl. | **Plausible mais non isolable** (preview indéterminée par curl). |
| **H2** cache CDN servant ancien bundle | Bundle hash changé (`index-KBaKelj-` ≠ ancien `index-IZ9GpTvG-`). `cache-control: no-cache` sur la racine. | **RÉFUTÉE.** |
| **H3** lifecycle preview Lovable | Non observable par curl. | **Indéterminée**, requiert reproduction navigateur. |
| **H4** injection cassée au build neuf | Nouveau bundle, Vite a tourné (`import.meta.env` substitué), mais valeurs vides. | **CONFIRMÉE pour le publish.** |

### Verdict consolidé

**H4 confirmée côté publish** : le pipeline de publish Lovable a bien produit un nouveau bundle après la mitigation guard, Vite a effectué la substitution `import.meta.env.*`, mais les variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` n'étaient **pas exposées** au processus de build, donc ont été remplacées par `undefined` / chaîne vide. Le bundle publié ne contient ni l'URL Supabase ni le project ref.

**Côté preview** : verdict indéterminé via curl (302 auth). Reproduction navigateur authentifié requise pour conclure sur H3.

**H2 réfutée** : pas un problème de cache CDN sur ancien bundle.

## 6. Message support Lovable prêt à copier-coller

```
Sujet : [Project c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef] Variables VITE_* non injectées au build publish

Bonjour,

Le site publié https://dakotation-pro.lovable.app affiche un écran noir
parce que les variables VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY
ne sont pas injectées dans le bundle au moment du build de publish.

Évidence factuelle (capture 2026-04-25 ~14:12 UTC) :

- index.html publish : HTTP 200, 11431 octets, cache-control no-cache.
- Bundle servi : /assets/index-KBaKelj-.js (3 320 336 octets), etag
  "de103149d279c36c5251c196bf737830". Hash différent de l'ancien
  bundle index-IZ9GpTvG.js → un nouveau build a bien été produit.
- grep snjewofqxfsdmaszapux sur le bundle : 0 occurrence
  (le project ref Supabase attendu n'est PAS embarqué).
- grep https://[a-z0-9]+\.supabase\.co : aucune URL Supabase trouvée.
- grep import.meta.env : 0 occurrence (Vite a bien tourné et substitué).
- Conclusion : Vite a remplacé import.meta.env.VITE_SUPABASE_URL et
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY par undefined / chaîne
  vide → ces variables n'étaient pas exposées à l'environnement de build
  Lovable au moment du publish.

Côté sandbox, le .env contient bien les noms exacts attendus :
VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_PROJECT_ID.
Le code src/integrations/supabase/client.ts les lit correctement
(fichier auto-généré, non modifié).

Demande :
1. Vérifier que les variables VITE_SUPABASE_URL et
   VITE_SUPABASE_PUBLISHABLE_KEY sont bien transmises au pipeline de
   build publish, pas seulement au sandbox de développement.
2. Vérifier que le publish utilise bien le dernier état du projet et
   ne rate pas l'étape d'injection des variables d'environnement Vite.
3. Vérifier que la preview Lovable reçoit ces variables dès le démarrage
   à froid, sans nécessiter d'interaction dans le chat (point H3 que
   nous ne pouvons pas confirmer côté client par curl).

Project ID : c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef
Project ref Supabase attendu : snjewofqxfsdmaszapux
URL publish : https://dakotation-pro.lovable.app
URL preview : https://id-preview--c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef.lovable.app

Une mitigation fail-fast (src/integrations/supabase/guard.ts) est déjà
en place et affiche un panneau d'erreur lisible côté navigateur quand
les variables sont absentes. Aucun hardcoding de clé n'a été effectué
dans le code applicatif.

Merci.
```

## 7. Garde-fous gouvernance

- Aucun fichier sous `src/`, `supabase/`, `.env`, `client.ts`, `types.ts`, `config.toml` n'a été modifié dans ce diagnostic.
- Aucune migration, edge function, RLS, ni hardcoding de clé.
- Seules deux écritures documentaires : ce fichier d'évidence + mise à jour chirurgicale de l'entrée `INFRA-PUBLISH-VITE-ENV-001` dans `docs/DEFERRED_BACKLOG.md` (statut + lien d'évidence uniquement).
