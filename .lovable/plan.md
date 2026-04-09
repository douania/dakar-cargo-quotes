
# COCKPIT-11D — Connecter les vraies données cargo au template partenaire

## Diagnostic

Les facts cargo sont stockés dans des colonnes que le code ne lisait pas :
- `cargo.containers` → `value_json` (ex: `[{"type":"40HC","quantity":5}]`)
- `cargo.weight_kg` → `value_number` (ex: `135000`)
- `cargo.volume_cbm` → `value_number`

Le code ne lisait que `value_text`, qui est `NULL` pour ces facts.
Résultat : le bloc Conteneurs/Poids de l'email partenaire était **toujours vide**.

## Correctif

### Nouveau helper partagé (UI)

`src/lib/extractContainerSynthetics.ts` — `buildFactMapWithSynthetics(rows)`
- Lit `value_text`, `value_number`, `value_json`
- Dérive `cargo.container_type`, `cargo.container_count`, `cargo.fcl_lcl` depuis `cargo.containers` JSON
- Multi-types supporté : `"2x 20GP + 3x 40HC"`
- Ne surcharge pas les clefs si elles existent déjà en base

### Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `src/lib/extractContainerSynthetics.ts` | Nouveau helper |
| `src/components/puzzle/PartnerSuggestionPanel.tsx` | Query: `value_number` + `value_json` + `cargo.containers`, utilise `buildFactMapWithSynthetics` |
| `src/components/puzzle/PartnerScopeCard.tsx` | Idem |
| `supabase/functions/send-external-quote-request/index.ts` | Ajoute `cargo.containers` à la query, extraction synthétique inline (même logique) |

### Ce que ce lot ne fait PAS

- Pas de modification des templates email (ils lisent déjà les bonnes clefs)
- Pas de migration
- Pas de zone FROZEN
- Backward compatible

## Phases précédentes

- COCKPIT-11C micro-correctif : regex déduplication "au départ" corrigé
- COCKPIT-11B : agrégation multi-blocs scope dans email
- COCKPIT-11 : extraction de scope fournisseur multi-postes
- COCKPIT-10 : template partenaire professionnel
