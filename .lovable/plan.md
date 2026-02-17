

# Correction du gap `cargo.description` qui ne se resout jamais

## Probleme

Le moteur `build-case-puzzle` (ligne 1235) verifie uniquement les facts extraits par l'IA **durant le run courant** (`extractedKeys`) pour determiner si un gap doit etre resolu. Les facts deja presents en base (injectes manuellement via `set-case-fact` ou lors de runs precedents) ne sont **pas consultes**.

Consequence : meme apres injection de `cargo.description` via `set-case-fact`, le gap reste ouvert car l'IA ne re-extrait pas cette cle depuis les emails.

## Solution

Enrichir la verification a la ligne 1235 pour consulter egalement les facts existants en base (`is_current = true`).

## Modification

### Fichier unique : `supabase/functions/build-case-puzzle/index.ts`

**Avant la boucle `for (const requiredKey of mandatoryFacts)` (vers ligne 1234) :**

Ajouter une requete pour charger toutes les `fact_key` existantes en base pour ce dossier :

```text
const { data: existingDbFacts } = await serviceClient
  .from("quote_facts")
  .select("fact_key")
  .eq("case_id", case_id)
  .eq("is_current", true);

const existingDbKeys = (existingDbFacts || []).map(f => f.fact_key);
```

**Ligne 1235 — modifier la condition `hasFact` :**

```text
// Avant (bug)
const hasFact = extractedKeys.includes(requiredKey);

// Apres (correctif)
const hasFact = extractedKeys.includes(requiredKey) || existingDbKeys.includes(requiredKey);
```

## Impact

| Element | Impact |
|---------|--------|
| Fichier modifie | `supabase/functions/build-case-puzzle/index.ts` |
| Lignes modifiees | ~5 lignes ajoutees, 1 ligne modifiee |
| Backend | La fonction sera redeployee automatiquement |
| Frontend | Aucun changement |
| Migration SQL | Aucune |
| Risque | Tres faible — lecture seule supplementaire |

## Resultat attendu

1. Injecter `cargo.description` via `set-case-fact`
2. Relancer `build-case-puzzle`
3. Le gap `cargo.description` passe de `open` a `resolved`
4. Le statut du dossier passe de `NEED_INFO` a `READY_TO_PRICE`

