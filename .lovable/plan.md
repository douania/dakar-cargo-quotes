
# Fix SQL-level filtering in reclassify-threads (audit CTO valide)

## Probleme

Le garde temporel de 90 jours est en place mais ne s'execute jamais sur les emails deja threades car le filtre `only_unthreaded` (defaut `true`) ajoute `WHERE thread_ref IS NULL` a la requete SQL.

## Correction chirurgicale : 1 fichier, 2 lignes ajoutees

### `supabase/functions/reclassify-threads/index.ts`

**Ligne 468** : ajouter apres `destructiveRebuild` :

```typescript
const reclassifyAll = body.reclassify_all === true;
```

**Lignes 499-501** : remplacer :

```typescript
if (onlyUnthreaded) {
  emailsQuery = emailsQuery.is('thread_ref', null);
}
```

par :

```typescript
if (!reclassifyAll && onlyUnthreaded) {
  emailsQuery = emailsQuery.is('thread_ref', null);
}
```

**Ligne 485 (log)** : ajouter `reclassify_all` dans le log existant pour tracabilite.

## Comportement resultant

| Appel | Resultat |
|---|---|
| `POST /reclassify-threads` (rien) | Mode incremental sur (thread_ref IS NULL) -- comportement inchange |
| `POST /reclassify-threads { reclassify_all: true }` | Re-evalue TOUS les emails, le garde 90j eclate les threads incorrects |
| `POST /reclassify-threads { reclassify_all: true, since: "2025-01-01" }` | Reclassification partielle temporelle |

## Ce qui ne change PAS

- Defaut `only_unthreaded = true` : conserve
- Garde temporel 90 jours : deja en place
- Logique de groupement (sujet, projet, participants) : inchangee
- Mode incremental par defaut : preserve
- Aucune migration DB

## Apres deploiement

Lancer en dry_run :
```
POST /reclassify-threads { "reclassify_all": true, "dry_run": true, "since": "2025-01-01T00:00:00Z", "limit": 200 }
```
Verifier que le thread `c9c683bf` est eclate, puis relancer sans `dry_run`.
