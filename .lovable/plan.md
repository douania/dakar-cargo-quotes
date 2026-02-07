

# Phase M2.3 — Recommandation intelligente basee sur l'historique

## Perimetre

Creation d'une seule Edge Function `suggest-historical-lines` qui reutilise la logique de scoring de M2.2 en interne (pas d'appel HTTP inter-fonctions) pour calculer des suggestions tarifaires agregees. Zero migration SQL, zero UI, zero modification moteur normatif.

## Decision architecturale : appel direct DB vs appel HTTP a M2.2

Le spec propose d'appeler `find-similar-quotations` en interne. Deux options :

1. **Appel HTTP** a l'Edge Function M2.2 : ajoute un hop reseau, latence, et dependance a l'URL de deploiement
2. **Reutilisation directe** de la meme logique (query DB + scoring en memoire) : plus simple, plus rapide, zero dependance reseau

**Choix** : Option 2 — dupliquer la logique de scoring dans la fonction (environ 60 lignes). Le code de scoring est stable et simple. Si le scoring evolue, les deux fonctions partagent les memes tables et la meme vue. Cela evite les problemes de latence, d'authentification inter-services, et de gestion d'erreurs en cascade.

## Etape unique — Edge Function `suggest-historical-lines`

Fichier : `supabase/functions/suggest-historical-lines/index.ts`

Config.toml : ajout section :
```text
[functions.suggest-historical-lines]
verify_jwt = false
```

### Logique complete

1. **CORS** + **correlationId** (pattern standard)
2. **Auth** : JWT valide via `getClaims()` — rejet 401 si absent/invalide
3. **Validation** : memes regles que M2.2 (destination_country + 1 champ secondaire)
4. **Charger profils** : `SELECT * FROM historical_quotation_profiles ORDER BY created_at DESC LIMIT 500`
5. **Scoring en memoire** : meme algorithme que M2.2 (normalisation, poids, seuil >= 40)
6. **Limiter** : `Math.min(input.limit ?? 3, 10)` — defaut 3, max 10 (moins que M2.2 car recommandation)
7. **Charger lignes** : pour chaque cotation retenue, charger depuis `historical_quotation_lines`
8. **Agregation** :
   - Regrouper par cle `bloc|category|description`
   - Compter les occurrences
   - Calculer la moyenne des montants
   - Determiner la confiance : `occurrences / total_quotations`
9. **Filtrage** : garder uniquement `confidence >= 0.5`
10. **Retourner** `respondOk({ suggested_lines, based_on_quotations })`
11. **logRuntimeEvent** a chaque sortie

### Format de sortie

```text
{
  "suggested_lines": [
    {
      "bloc": "debours",
      "category": "THC",
      "description": "THC Import 40DV",
      "suggested_amount": 110000,
      "currency": "FCFA",
      "confidence": 0.67,
      "based_on": 2
    }
  ],
  "based_on_quotations": 3
}
```

Retourne `{ "suggested_lines": [], "based_on_quotations": 0 }` si aucun match.

### Codes d'erreur

| Code | Cas |
|------|-----|
| AUTH_MISSING_JWT | Pas de token |
| AUTH_INVALID_JWT | Token invalide |
| VALIDATION_FAILED | Donnees insuffisantes |
| UPSTREAM_DB_ERROR | Echec lecture DB |
| UNKNOWN | Exception non geree |

## Fichiers crees/modifies

| Fichier | Action |
|---------|--------|
| `supabase/functions/suggest-historical-lines/index.ts` | Nouveau |
| `supabase/config.toml` | Ajout section fonction |

## Fichiers NON modifies

- Zero fichier UI
- Zero migration SQL
- Zero modification moteur normatif
- Zero modification API existante (y compris `find-similar-quotations`)

## Section technique — Detail de l'agregation

```text
// Pour chaque ligne de chaque cotation similaire :
key = `${bloc}|${category}|${description}`

aggregated[key] = {
  bloc, category, description,
  total_amount += amount,
  count += 1,
  currencies: Set(currency)
}

// Puis pour chaque groupe :
suggested_amount = total_amount / count
confidence = count / total_quotations
currency = premiere devise trouvee (majoritaire)

// Filtrage final :
garder si confidence >= 0.5
```

## Verification post-execution

1. Edge Function deployee sans erreur
2. Appel sans JWT retourne 401
3. Appel avec entree invalide retourne 400 VALIDATION_FAILED
4. Appel valide sans historique retourne `suggested_lines: [], based_on_quotations: 0`
5. Apres insertion de 3 cotations similaires via M2.1 : suggestions coherentes avec confidence correcte
6. `logRuntimeEvent` present dans les logs pour chaque appel

