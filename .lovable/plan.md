

# Correction suppression dossiers orphelins + filtre dashboard

## Constat

1. **Migration precedente inoperante** : les 3 UUIDs dans le DELETE etaient faux (probablement tronques/reconstruits incorrectement). Aucun dossier n'a ete supprime.
2. **Filtre dashboard insuffisant** : les dossiers INTAKE a 0% sans client passent le filtre car `status !== 'NEW_THREAD'` est vrai pour INTAKE.

## Dossiers orphelins reels en base (thread_id = NULL)

| UUID reel | Status | Completeness | request_type | Action |
|-----------|--------|-------------|--------------|--------|
| `0f23304a-1705-408f-8ceb-627473f17f08` | NEW_THREAD | 0% | null | Supprimer |
| `e5dbb910-b00b-44e3-8608-337e3525bae1` | INTAKE | 0% | null | Supprimer |
| `91921bb4-87a7-4664-9d67-721e50e76863` | INTAKE | 0% | null | Supprimer |

Les 4 autres dossiers sans thread_id (ab959454, 7eab135d, 31efcc01, 5514fedc) ont du contenu reel (83-100% completeness, request_type renseigne) -- ce sont des dossiers Intake legitimes, on ne les touche pas.

## Etape 1 -- Migration corrective : supprimer les 3 vrais orphelins

```text
DELETE FROM quote_cases
WHERE id IN (
  '0f23304a-1705-408f-8ceb-627473f17f08',
  'e5dbb910-b00b-44e3-8608-337e3525bae1',
  '91921bb4-87a7-4664-9d67-721e50e76863'
);
```

FK CASCADE gerera les tables enfants (verifie precedemment : 0 rows liees).

## Etape 2 -- Renforcer le filtre Dashboard

Le filtre actuel laisse passer les INTAKE a 0% sans client. Correction du predicat :

```text
// Ancien filtre (insuffisant)
clientNames[c.id] || (c.puzzle_completeness ?? 0) > 0 || c.request_type || (c.status !== 'NEW_THREAD')

// Nouveau filtre (strict)
clientNames[c.id] || (c.puzzle_completeness ?? 0) > 0 || c.request_type
```

Supprimer la condition `status !== 'NEW_THREAD'`. Un dossier sans client, sans progression, et sans request_type est un orphelin quel que soit son status (NEW_THREAD ou INTAKE).

## Fichiers modifies

- Migration SQL : DELETE avec les bons UUIDs
- `src/pages/Dashboard.tsx` : simplification du filtre (suppression de la clause status)

## Risque

Nul. Les dossiers Intake legitimes ont tous un `request_type` ou un `puzzle_completeness > 0`, donc ils passent toujours le filtre.

