
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

---

# FLOW-FIX-1 — Normalisation pays + inférence port maritime Sénégal

## Diagnostic

`resolveCountry()` retournait le texte brut du fact (ex: `"SENEGAL"`) au lieu du code ISO (`"SN"`).
Conséquence : `detectFlowType` comparait `"SENEGAL" !== 'SN'` → classait un import vers Dakar comme `EXPORT_SENEGAL`.

De plus, `routing.destination_port` n'était jamais inféré, créant un gap bloquant permanent sur les imports maritimes vers le Sénégal.

## Correctif

### 1. Normalisation pays → ISO

- Nouvelle map `COUNTRY_NAME_TO_ISO` (~45 pays, FR/EN)
- Nouveau helper `normalizeCountryToISO(raw)` : ISO 2 lettres si connu, sinon passthrough
- `resolveCountry()` applique la normalisation sur le chemin "direct fact"
- Les chemins DB et `PORT_COUNTRY_MAP` restent inchangés (déjà en ISO)

### 2. Inférence port de déchargement (maritime uniquement)

- Après détection du flowType, si :
  - flowType ∈ {IMPORT_PROJECT_DAP, IMPORT_PROJECT_DAP_EXW, SEA_LCL_IMPORT, TRANSIT_REGIONAL_VIA_DAKAR}
  - destCountry = SN
  - routing.destination_port absent
- Alors injecte `routing.destination_port = "Dakar"` via `supersede_fact`
  - source_type = `port_inference`, confidence = 0.85
  - Timeline event avec `inference_rule: FLOW-FIX-1_SN_MONO_PORT`

### Garde-fous

- Ne s'applique PAS aux flux aérien, terrestre, ou ambigus
- Ne surcharge pas un port déjà existant
- Limité au Sénégal (mono-port commercial : Dakar/PAD)

### Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `supabase/functions/build-case-puzzle/index.ts` | `COUNTRY_NAME_TO_ISO` + `normalizeCountryToISO()` + normalisation dans `resolveCountry` + inférence port maritime |
| `.lovable/plan.md` | Phase FLOW-FIX-1 |
| `docs/DEFERRED_BACKLOG.md` | Entrée future : map pays en DB |

### Ce que ce lot ne fait PAS

- Pas de migration
- Pas de zone FROZEN
- Pas de changement UI
- Pas de généralisation à d'autres pays mono-port (futur lot)
- Backward compatible

## Statut : FLOW-FIX-1 **FERMÉ**

## Phases précédentes

- PACKAGE-FILTER-1 : filtrage contextuel services par package
- COCKPIT-11D : connexion données cargo au template partenaire
- COCKPIT-11C micro-correctif : regex déduplication "au départ" corrigé
- COCKPIT-11B : agrégation multi-blocs scope dans email
- COCKPIT-11 : extraction de scope fournisseur multi-postes
- COCKPIT-10 : template partenaire professionnel
