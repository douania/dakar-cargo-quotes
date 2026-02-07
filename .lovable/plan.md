

# Correctif M3.5.1 — Deux bugs identifes

## Diagnostic

Le `PORT_COUNTRY_MAP` fonctionne correctement (les logs montrent `destCountry=SN, originCountry=SA`). Mais le flow reste `UNKNOWN` pour deux raisons distinctes.

### Bug 1 : `hasContainers` toujours `false`

Le fait `cargo.containers` est stocke avec :
- `value_text = null`
- `value_json = [{quantity: 2, type: "40'"}]`

Mais le code qui construit la `factMap` (ligne 285) fait :

```text
value: f.value_text || String(f.value_number || '')
```

Resultat : `value = ""` (chaine vide), donc `!!factMap.get('cargo.containers')?.value` = `false`.

**Correction** : dans la construction de la factMap, si `value_text` est null et `value_json` existe, utiliser `JSON.stringify(value_json)` comme valeur.

Ligne concernee dans `build-case-puzzle/index.ts` (~ligne 285) :

```text
// Avant
value: f.value_text || String(f.value_number || '')

// Apres
value: f.value_text || (f.value_json ? JSON.stringify(f.value_json) : '') || String(f.value_number || '')
```

Cela rendra `hasContainers = true` pour ce cas.

### Bug 2 : "Analyser la demande" n'appelle pas `build-case-puzzle`

Le bouton "Analyser la demande" dans `QuotationHeader` appelle la fonction `qualify-quotation-minimal`. Cette fonction est un module **stateless de Phase 8.8** qui genere des questions de clarification pour le client. Elle ne connait pas et n'utilise pas le moteur d'hypotheses M3.5.1.

Le bouton "Re-analyser le dossier" (ajoute recemment) appelle bien `build-case-puzzle`, mais il est petit et peu visible.

**Correction** : le flux "Analyser la demande" doit d'abord lancer `build-case-puzzle` (qui injecte les assumptions M3.5.1), puis seulement si des gaps bloquants subsistent, appeler `qualify-quotation-minimal` pour generer les questions.

### Flux corrige

```text
Bouton "Analyser la demande" clique
       |
       v
1. Appel build-case-puzzle (extraction + M3.4 + M3.5.1)
       |
       v
2. Verifier les gaps bloquants restants
       |
       +-- gaps bloquants > 0 --> Appel qualify-quotation-minimal --> questions client
       |
       +-- gaps bloquants = 0 --> Toast "Dossier complet, pret pour decisions"
```

## Modifications

### Fichier 1 : `supabase/functions/build-case-puzzle/index.ts`

**Changement unique** : Ligne ~285, corriger la construction de la factMap pour inclure `value_json`.

### Fichier 2 : `src/pages/QuotationSheet.tsx`

**Changement** : Dans la fonction `handleRequestClarification` (qui est passee au bouton "Analyser la demande"), ajouter un appel a `build-case-puzzle` en amont de `qualify-quotation-minimal`. Enchainer les deux etapes :

1. Lancer `build-case-puzzle` avec le `thread_id` et `case_id`
2. Verifier si des gaps bloquants restent
3. Seulement si oui, lancer `qualify-quotation-minimal`
4. Si non, afficher un toast de succes

### Fichier 3 : Suppression du bouton "Re-analyser" separe

Le bouton "Re-analyser le dossier" devient inutile car "Analyser la demande" fera desormais les deux etapes. Il sera supprime pour eviter la confusion.

## Ce qui ne change pas

| Element | Impact |
|---|---|
| Edge function `build-case-puzzle` | Correctif mineur (1 ligne) |
| Edge function `qualify-quotation-minimal` | Aucun |
| Pricing engine | Aucun |
| Schema DB | Aucun |
| Hierarchie des sources | Inchangee |
| RLS | Aucun |

## Resultat attendu apres correctif

Pour le cas Aboudi (Dammam vers Dakar, 2x 40' conteneurs, vehicules) :

1. Clic sur "Analyser la demande"
2. `build-case-puzzle` s'execute
3. `detectFlowType` : destCountry=SN, hasContainers=true --> `IMPORT_PROJECT_DAP`
4. Assumptions injectees : `service.package = DAP_PROJECT_IMPORT`, `regulatory.dpi_expected = true`
5. Gaps reduits grace aux assumptions
6. Si gaps restants : questions de clarification generees
7. Si aucun gap : toast "Dossier complet"

