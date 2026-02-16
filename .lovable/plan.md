

# Ajout de la saisie de destination dans CaseView

## Diagnostic

| Element | Etat actuel |
|---------|-------------|
| Alerte "missing_fields" | Affiche la question mais aucun champ de saisie |
| `set-case-fact` whitelist | `routing.destination_city` **absent** |
| UI de saisie | **inexistante** |

L'operateur voit le probleme mais ne peut rien faire.

## Corrections

### 1. Edge Function `set-case-fact` -- Ajouter la cle a la whitelist

Fichier : `supabase/functions/set-case-fact/index.ts`

Ajouter `routing.destination_city` dans `ALLOWED_FACT_KEYS` (ligne 14-21).

### 2. CaseView -- Formulaire inline sous l'alerte missing_fields

Fichier : `src/pages/CaseView.tsx`

Transformer l'alerte passive en alerte actionnable :
- Pour chaque champ manquant dont le `field` correspond a une cle connue (`routing.destination_city`), afficher un champ `Input` + bouton "Enregistrer"
- Au clic, appeler l'Edge Function `set-case-fact` avec le `case_id`, `fact_key` et `value_text`
- Apres succes, rafraichir les donnees du dossier (appel `loadCase()`)
- Afficher un toast de confirmation

Le formulaire sera minimaliste : un input texte + un bouton par champ manquant, directement dans le bloc d'alerte.

## Section technique

### Whitelist (set-case-fact)

```text
const ALLOWED_FACT_KEYS = new Set([
  "client.code",
  "cargo.caf_value",
  "cargo.weight_kg",
  "cargo.chargeable_weight_kg",
  "cargo.articles_detail",
  "routing.incoterm",
  "routing.destination_city",  // AJOUT
]);
```

### Composant inline (CaseView.tsx)

Sous l'alerte missing_fields existante, pour chaque champ `f` :
- Si `f.field` est dans une map de champs editables, afficher un `Input` pre-labellise
- Bouton "Enregistrer" qui POST vers `/set-case-fact`
- State local pour la valeur et le loading
- Toast sonner en cas de succes/erreur
- Appel `loadCase()` apres succes pour rafraichir le statut

### Mapping des champs editables

```text
routing.destination_city -> Input texte, placeholder "Ex: Dakar, Bamako..."
```

Ce mapping est extensible pour d'autres champs manquants a l'avenir.

## Fichiers concernes

| Fichier | Action |
|---------|--------|
| `supabase/functions/set-case-fact/index.ts` | MODIFIER -- ajouter 1 cle a la whitelist |
| `src/pages/CaseView.tsx` | MODIFIER -- formulaire inline sous l'alerte |

## Composants FROZEN impactes : AUCUN

## Impact

- Zero refactor global
- Pattern existant reutilise (set-case-fact)
- UX : l'operateur peut corriger le champ manquant sans quitter la page
