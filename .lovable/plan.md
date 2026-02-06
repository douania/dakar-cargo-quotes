

# Phase 16 — Patch d'etat minimal : READY_TO_PRICE -> DECISIONS_PENDING

## Etat verifie en base (lecture directe)

| Element | Valeur |
|---------|--------|
| `quote_cases.status` | `READY_TO_PRICE` |
| `puzzle_completeness` | 100% |
| `case_timeline_events` | 21 evenements |
| `operator_decisions` | 0 |

## Cause du blocage

`commit-decision` n'accepte que `DECISIONS_PENDING` ou `DECISIONS_COMPLETE`. Aucune Edge Function ne gere la transition `READY_TO_PRICE -> DECISIONS_PENDING`. C'est un trou dans la machine d'etats, documente pour correction future.

## Action : Patch DB minimal (2 operations)

### Operation 1 — Transition de statut

```sql
UPDATE quote_cases
SET status = 'DECISIONS_PENDING'
WHERE id = 'd14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1';
```

### Operation 2 — Event d'audit (tracabilite obligatoire)

```sql
INSERT INTO case_timeline_events (
  case_id,
  actor_type,
  event_type,
  previous_value,
  new_value,
  created_at
)
VALUES (
  'd14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1',
  'user',
  'status_changed',
  'READY_TO_PRICE',
  'DECISIONS_PENDING',
  now()
);
```

### Verification post-patch

- `quote_cases.status` = `DECISIONS_PENDING`
- `case_timeline_events` count = 22
- Aucun `commit-decision` lance

## Ce qui est hors perimetre

- Zero refactor de code
- Zero modification d'Edge Function
- Zero ajout de logique de transition

## Etape suivante (apres confirmation patch)

Lancement sequentiel de `commit-decision` x5 dans l'ordre : regime, routing, services, incoterm, container.

## Section technique

Le patch est applique via des operations SQL directes (INSERT/UPDATE sur donnees existantes). Les deux tables ciblees (`quote_cases` et `case_timeline_events`) ne necessitent pas de migration schema. L'`actor_type = 'user'` respecte la contrainte DB (les valeurs autorisees sont `user`, `system`, `ai`). Ce patch documente le trou architectural pour correction en phase ulterieure.

