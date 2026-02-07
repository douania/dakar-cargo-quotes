

# Correctif M3.6-fix : Debloquer l'injection de service.package

## Probleme identifie

La contrainte CHECK `quote_facts_fact_category_check` sur la table `quote_facts` n'autorise que 7 categories :

```text
cargo, routing, timing, pricing, documents, contacts, other
```

Le moteur M3.5.1 tente d'injecter des faits avec les categories `service` et `regulatory`, qui sont rejetees avec l'erreur :

```text
new row for relation "quote_facts" violates check constraint "quote_facts_fact_category_check"
```

Resultat : `service.package = DAP_PROJECT_IMPORT` n'est jamais persiste, donc l'overlay M3.6 ne trouve rien a injecter.

## Solution

**Migration SQL** : Modifier la contrainte CHECK pour ajouter les categories manquantes `service` et `regulatory`.

```text
ALTER TABLE quote_facts DROP CONSTRAINT quote_facts_fact_category_check;
ALTER TABLE quote_facts ADD CONSTRAINT quote_facts_fact_category_check
  CHECK (fact_category = ANY (ARRAY[
    'cargo', 'routing', 'timing', 'pricing',
    'documents', 'contacts', 'other',
    'service', 'regulatory'
  ]));
```

## Impact

| Element | Impact |
|---|---|
| Edge functions | Aucun changement de code |
| Frontend | Aucun changement de code |
| Donnees existantes | Aucun impact (ajout de valeurs, pas de suppression) |
| RLS | Aucun impact |

## Resultat attendu

Apres cette migration :

1. `build-case-puzzle` injecte `service.package = DAP_PROJECT_IMPORT` avec succes
2. L'overlay M3.6 lit ce fait et pre-remplit les 5 lignes de service
3. L'operateur voit les services automatiquement sans avoir a les ajouter

## Verification

Un simple re-clic sur "Analyser la demande" sur le cas Aboudi suffira a valider que les services apparaissent.

