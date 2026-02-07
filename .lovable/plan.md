

# Phase M2.2 — Moteur de similarite des cotations historiques (corrections CTO integrees)

## Corrections CTO integrees

### Correction 1 — Validation d'entree renforcee
`destination_country` obligatoire + au moins un parmi `final_destination`, `cargo_description`, `hs_code`. Sinon `VALIDATION_FAILED`.

### Correction 2 — Critere poids securise
Le bonus poids (+10) ne s'applique que si `input.total_weight_kg > 0` ET `historical.total_weight_kg > 0`. Sinon 0 point sans erreur.

### Correction 3 — Normalisation des comparaisons
Toutes les comparaisons texte utilisent `trim().toLowerCase()` pour `destination_country`, `final_destination`, `incoterm`, `transport_mode`, `carrier`.

### Correction 4 — Limite maximale securisee
`const limit = Math.min(input.limit ?? 5, 20);` applique cote serveur.

---

## Etape 1 — Migration SQL

Creation de la vue `historical_quotation_profiles` :

```text
CREATE VIEW historical_quotation_profiles AS
SELECT
  hq.id AS quotation_id,
  hq.origin_country,
  hq.destination_country,
  hq.final_destination,
  hq.incoterm,
  hq.transport_mode,
  hq.cargo_description,
  hq.total_weight_kg,
  hm.hs_code,
  hm.carrier,
  hm.container_types,
  hm.container_count,
  hq.created_at
FROM historical_quotations hq
LEFT JOIN historical_quotation_metadata hm
  ON hm.quotation_id = hq.id;
```

Pas de RLS sur la vue (herite des tables sous-jacentes avec SELECT public read).

## Etape 2 — Edge Function `find-similar-quotations`

Fichier : `supabase/functions/find-similar-quotations/index.ts`

Config.toml :
```text
[functions.find-similar-quotations]
verify_jwt = false
```
JWT valide dans le code via `getClaims()` (meme pattern que M2.1).

### Logique complete

1. **CORS** : `handleCors(req)`
2. **Correlation** : `getCorrelationId(req)`
3. **Auth** : valider JWT via `getClaims()` -> 401 si absent/invalide
4. **Validation** (correction CTO 1) :
   - `destination_country` obligatoire
   - Au moins un parmi : `final_destination`, `cargo_description`, `hs_code`
   - Sinon `VALIDATION_FAILED`
5. **Limite** (correction CTO 4) : `Math.min(input.limit ?? 5, 20)`
6. **Charger profils** : `SELECT * FROM historical_quotation_profiles ORDER BY created_at DESC LIMIT 500`
7. **Scoring en memoire** :

| Critere | Points | Normalisation |
|---------|--------|---------------|
| Meme destination finale | +30 | trim().toLowerCase() |
| Meme pays destination | +20 | trim().toLowerCase() |
| Meme mode transport | +10 | trim().toLowerCase() |
| Meme incoterm | +10 | trim().toLowerCase() |
| Meme HS code (prefixe 4 chiffres) | +10 | prefixe substring(0,4) |
| Meme carrier | +5 | trim().toLowerCase() |
| Poids dans +/-30% | +10 | seulement si les deux > 0 (CTO 2) |
| Meme type conteneur (intersection) | +5 | trim().toLowerCase() sur chaque element |

8. **Filtrer** : score >= 40
9. **Trier** par score decroissant, limiter a `limit`
10. **Enrichir** : charger lignes depuis `historical_quotation_lines` pour chaque resultat
11. **Retourner** `respondOk({ similar_quotations: [...] })`
12. **logRuntimeEvent** avant chaque return

### Fonction de scoring (pseudo-code)

```text
function computeScore(input, profile):
  score = 0
  n = (s) => (s || '').trim().toLowerCase()

  if n(input.final_destination) && n(input.final_destination) === n(profile.final_destination): score += 30
  if n(input.destination_country) === n(profile.destination_country): score += 20
  if n(input.transport_mode) === n(profile.transport_mode): score += 10
  if n(input.incoterm) === n(profile.incoterm): score += 10

  // HS code : prefixe 4 chiffres
  if input.hs_code && profile.hs_code:
    if input.hs_code.substring(0,4) === profile.hs_code.substring(0,4): score += 10

  if n(input.carrier) && n(input.carrier) === n(profile.carrier): score += 5

  // Poids : seulement si les deux > 0 (CTO correction 2)
  if input.total_weight_kg > 0 && profile.total_weight_kg > 0:
    ratio = input.total_weight_kg / profile.total_weight_kg
    if ratio >= 0.7 && ratio <= 1.3: score += 10

  // Conteneurs : intersection
  if input.container_types?.length && profile.container_types?.length:
    inputSet = input.container_types.map(n)
    profileSet = profile.container_types.map(n)
    if intersection(inputSet, profileSet).length > 0: score += 5

  return score
```

### Format de sortie

```text
{
  "similar_quotations": [
    {
      "quotation_id": "uuid",
      "score": 82,
      "route": "CN -> SN -> Bamako",
      "incoterm": "CIF",
      "transport_mode": "maritime",
      "cargo_description": "steel pipes",
      "total_weight_kg": 25000,
      "lines": [
        { "bloc": "debours", "category": "THC", "description": "THC Import 40DV", "amount": 110000, "currency": "FCFA" }
      ]
    }
  ]
}
```

Retourne `{ "similar_quotations": [] }` si aucun resultat (jamais d'erreur pour 0 match).

## Fichiers crees/modifies

| Fichier | Action |
|---------|--------|
| Migration SQL | Vue `historical_quotation_profiles` |
| `supabase/functions/find-similar-quotations/index.ts` | Nouveau |
| `supabase/config.toml` | Ajout section `find-similar-quotations` |

## Fichiers NON modifies

- Zero fichier UI
- Zero modification moteur `quotation-engine`
- Zero modification API existante
- Zero modification tables existantes

## Verification post-execution

1. Vue `historical_quotation_profiles` creee et fonctionnelle
2. Edge Function deployee sans erreur
3. Appel sans JWT -> 401
4. Appel avec destination_country seul (sans final_destination/cargo/hs) -> 400 VALIDATION_FAILED
5. Appel valide retourne `similar_quotations` (vide si pas de donnees)
6. Insertion test via M2.1, puis appel M2.2 -> match avec score > 40
7. Verification normalisation : "SN" et "sn" donnent le meme score
8. Verification poids : input=0 ne crash pas, donne 0 point
