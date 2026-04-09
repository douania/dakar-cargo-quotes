
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
| `supabase/functions/send-external-quote-request/index.ts` | Ajoute `cargo.containers` à la query, extraction synthétique inline (même logique), suppression `.select()` dupliqué |
| `src/lib/partnerEmailTemplate.ts` | Label poids : `Poids total : X kg` |
| `supabase/functions/_shared/partner-email-template.ts` | Idem label poids |

### Ce que ce lot ne fait PAS

- Pas de migration
- Pas de zone FROZEN
- Backward compatible

## Statut : COCKPIT-11D **FERMÉ**

---

# PACKAGE-FILTER-1 — Filtrage contextuel des services compatibles

## Diagnostic

La section "Services supplémentaires" dans `ServiceOverridePanel.tsx` affichait un catalogue quasi global (~15 services) même quand le package était clairement identifié (ex: EXPORT_SENEGAL). Le filtre `isServiceRelevant()` ne connaissait que le mode transport (SEA/AIR) et le flow (IMPORT/EXPORT), pas la logique métier du package.

## Correctif

### Nouveau helper dans `src/pages/case-view/helpers.ts`

- `PACKAGE_COMPATIBLE_EXTRAS` : whitelist explicite d'extras compatibles pour chacun des 10 packages
- `isServiceCompatibleWithPackage(service, packageCode, mode)` : utilise la whitelist si le package est connu, sinon fallback sur `isServiceRelevant()`
- TRUCKING exclu de EXPORT_SENEGAL (= "Transport routier vers site", service destination)

### Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `src/pages/case-view/helpers.ts` | Nouveau helper + map whitelist (10 packages) |
| `src/pages/case-view/ServiceOverridePanel.tsx` | 1 import + 1 ligne : `isServiceRelevant` → `isServiceCompatibleWithPackage` |

### Ce que ce lot ne fait PAS

- Pas de migration
- Pas de zone FROZEN
- Pas de refactor du catalogue `serviceTemplates`
- Backward compatible (fallback si package inconnu)

## Statut : PACKAGE-FILTER-1 **FERMÉ**

## Phases précédentes

- COCKPIT-11C micro-correctif : regex déduplication "au départ" corrigé
- COCKPIT-11B : agrégation multi-blocs scope dans email
- COCKPIT-11 : extraction de scope fournisseur multi-postes
- COCKPIT-10 : template partenaire professionnel
