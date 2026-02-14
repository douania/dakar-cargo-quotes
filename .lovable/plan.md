

# Correctif : Repartition CAF proportionnelle aux valeurs EXW par article

## Diagnostic

### Situation actuelle
- `analyze-attachments` extrait les articles avec `items[].unit_price`, `items[].total`, `items[].hs_code`
- `build-case-puzzle` **aplatit** ces donnees : seuls `cargo.value` (total) et `cargo.hs_code` (concatene) sont stockes comme facts
- `run-pricing` transmet `cargoValue` (total) et `hsCode` (string) au moteur
- `quotation-engine` repartit CAF/N (equitable) — faux si les articles ont des valeurs differentes

### Exemple reel (LCL 25607)
- Article 1 (8525.50.00.00) : 165 EUR
- Article 2 (8507.20.00.00) : 3 760 EUR
- Total CIF : 4 655 EUR

Repartition actuelle (CAF/N) : 2 327,50 EUR chacun — **faux**
Repartition correcte (proportionnelle) : 165/3925 = 4.2% et 3760/3925 = 95.8%

## Contrainte architecturale

Le user demande "correction uniquement dans quotation-engine", mais les valeurs par article ne sont actuellement **pas transmises** au moteur. Elles sont perdues dans `build-case-puzzle`.

**Solution chirurgicale en 3 touches minimales** (principe du projet : surgical corrections only) :

| Fichier | Nature de la modification |
|---|---|
| `build-case-puzzle/index.ts` | Ajouter 1 fact `cargo.articles_detail` (JSON) quand les items ont des valeurs unitaires |
| `run-pricing/index.ts` | Ajouter 1 mapping `cargo.articles_detail` vers un nouveau champ `articlesDetail` |
| `quotation-engine/index.ts` | Utiliser `articlesDetail` pour repartition proportionnelle, fallback CAF/N si absent |

Aucune modification du frontend, de la base de donnees, ni des autres edge functions.

## Plan d'implementation

### Etape 1 — build-case-puzzle : persister le detail articles

Dans la section qui traite les facts issus des pieces jointes, ajouter l'injection d'un fait JSON `cargo.articles_detail` contenant le tableau `items` extrait par `analyze-attachments` :

```text
Nouveau fact :
  fact_key: "cargo.articles_detail"
  value_json: [
    { "hs_code": "8525.50.00.00", "value": 165, "currency": "EUR", "description": "Circuit de control" },
    { "hs_code": "8507.20.00.00", "value": 3760, "currency": "EUR", "description": "Batterie" }
  ]
  source_type: "attachment_extracted"
```

Points cles :
- Insertion uniquement si `items` existe et contient au moins 2 elements avec des valeurs > 0
- Si un seul article ou pas de valeurs, on ne cree pas le fact (comportement actuel preserve)
- Aucun impact sur les autres facts existants

### Etape 2 — run-pricing : transmettre articlesDetail

Ajouter dans l'interface `PricingInputs` :
```text
articlesDetail?: Array<{ hs_code: string; value: number; currency: string; description?: string }>
```

Ajouter dans le switch de mapping des facts :
```text
case "cargo.articles_detail":
  inputs.articlesDetail = JSON.parse(value)
  break
```

Ajouter dans l'objet `engineRequest` transmis au moteur :
```text
articlesDetail: inputs.articlesDetail
```

### Etape 3 — quotation-engine : repartition proportionnelle

Modifier la section droits et taxes (lignes 2037-2090) :

```text
Logique :
1. Si request.articlesDetail existe et contient N articles avec valeurs :
   - totalEXW = somme des article.value
   - Pour chaque article :
     ratio = article.value / totalEXW
     cafArticle = caf.cafValue * ratio
   - Utiliser cafArticle au lieu de cafPerArticle

2. Sinon (fallback) :
   - Garder la repartition equitable CAF/N actuelle

3. cafNote mis a jour pour indiquer la methode utilisee :
   "Repartition proportionnelle aux valeurs EXW" ou "Repartition equitable (valeurs EXW non disponibles)"
```

Le reste du code (lookup HS, calcul taxes, dutyBreakdown, duties_total) reste identique.

### Interface QuotationRequest mise a jour

Ajouter un champ optionnel :
```text
articlesDetail?: Array<{
  hs_code: string;
  value: number;
  currency: string;
  description?: string;
}>
```

## Resultat attendu

Apres correctif et relance du pricing :

```text
duty_breakdown: [
  {
    article_index: 1,
    hs_code: "8525.50.00.00",
    caf: 128,282 FCFA,     // 4.2% du total
    description: "Circuit de control",
    ...
  },
  {
    article_index: 2,
    hs_code: "8507.20.00.00",
    caf: 2,925,198 FCFA,   // 95.8% du total
    description: "Batterie",
    ...
  }
]
```

## Ce qui ne change PAS

- Aucune modification du frontend (DutyBreakdownTable affiche deja le tableau)
- Aucune migration de base de donnees (value_json existe deja sur quote_facts)
- Les cas a 1 seul article fonctionnent exactement comme avant
- Les cas sans valeurs par article utilisent le fallback CAF/N

## Risques et mitigations

| Risque | Mitigation |
|---|---|
| Ancien dossier sans `cargo.articles_detail` | Fallback CAF/N (code existant) |
| Conversion devise (articles en EUR, CAF en FCFA) | Les articles sont en devise source, conversion appliquee au total avant repartition |
| Arrondis cumulatifs | Ajustement du dernier article pour coller au total exact |

