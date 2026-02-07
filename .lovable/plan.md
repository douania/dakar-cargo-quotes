
# Phase FIX-EMAIL-500 — Correction du crash email-admin

## Cause racine identifiee

La base de donnees cloud subit des timeouts intermittents (erreur PostgREST `PGRST002`). Quand `get_threads_paginated` est appele pendant un de ces timeouts :

1. Ligne 200-206 : la requete Supabase echoue, `error` est un objet PostgREST `{code, details, hint, message}`
2. Ligne 206 : `throw error` lance cet objet
3. Ligne 1122 : `error instanceof Error` retourne `false` car c'est un objet plain, PAS une instance de `Error`
4. Resultat : le catch retourne `"Erreur inconnue"` au lieu du vrai message

## Correction (1 seul fichier, 1 seul bloc)

Fichier : `supabase/functions/email-admin/index.ts`

### Modification au catch global (lignes 1117-1126)

Remplacer la logique de serialisation d'erreur pour couvrir les 3 cas possibles :

```text
Avant :
  error instanceof Error ? error.message : "Erreur inconnue"

Apres :
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? (error as any).message
      : String(error)
```

Cela couvrira :
- Les `Error` JavaScript natifs
- Les objets PostgREST `{code, message, details, hint}`
- Tout autre type d'erreur inattendu

### Ajout de log detaille

Ajouter au `console.error` existant le code PostgREST si present, pour faciliter le diagnostic futur :

```text
console.error("Email admin error:", JSON.stringify(error));
```

## Resume

| Element | Avant | Apres |
|---|---|---|
| Message erreur | "Erreur inconnue" | Message reel (ex: "Could not query the database...") |
| Log serveur | Objet brut | JSON serialise complet |
| Fichiers modifies | 0 | 1 seul (`email-admin/index.ts`) |
| Lignes modifiees | 0 | 3 lignes dans le catch |
| Migration DB | Aucune | Aucune |
| Autres fonctions | Aucune | Aucune |
