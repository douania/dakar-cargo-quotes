

# Archiver les 4 dossiers de test

## Action

Passer les 4 dossiers identifies comme dossiers de test au statut `ARCHIVED` dans la base de donnees.

| ID (abrege) | Client | Statut actuel |
|-------------|--------|---------------|
| 843a1f1c | QCS-Quick Cargo Service | READY_TO_PRICE |
| 4f2baa5b | STL Lojistik | NEED_INFO |
| 7e6bdba7 | ABOUDI Logistics | NEED_INFO |
| 0f1a53ac | Bruhat | NEED_INFO |

## Requete SQL

```text
UPDATE quote_cases 
SET status = 'ARCHIVED', updated_at = now()
WHERE id IN (
  '843a1f1c-f3cc-4950-a867-915e93c8fe84',
  '4f2baa5b-d39c-4e13-ba82-75f84fef8936',
  '7e6bdba7-c174-4447-b8be-4b25ca7d8ced',
  '0f1a53ac-da4f-4adf-9f20-be422a675168'
);
```

## Resultat attendu

- La section "Dossiers en cours" du Dashboard sera vide et automatiquement masquee (la condition `activeCases.length > 0` existe deja)
- Les 4 dossiers restent en base mais ne sont plus visibles
- Operation reversible si necessaire
- Aucune modification de code

## Fichiers concernes

Aucun fichier modifie. Operation purement base de donnees.

