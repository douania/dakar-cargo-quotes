

# Phase DASHBOARD-SEARCH-FIX — Recherche dans body_html

## Cause racine

Le mot "Usmani" se trouve uniquement dans le champ `body_html` (signature email), pas dans `body_text`, `subject` ni `from_address`. Le Dashboard ne filtre actuellement que sur ces 3 champs, ce qui rend l'email invisible a la recherche.

Le module "Gestion emails" fonctionne car il utilise la Edge Function `search-emails` qui interroge le contenu HTML cote serveur.

## Solution

Modifier le Dashboard pour :

1. **Charger `body_html` dans la requete Supabase** (ajouter ce champ au `select`)
2. **Inclure `body_html` dans le filtre de recherche** client-side

## Modifications (1 seul fichier)

**Fichier** : `src/pages/Dashboard.tsx`

### Changement 1 — Requete Supabase (ligne 65)

Ajouter `body_html` au select :

```text
Avant :  .select('id, subject, from_address, received_at, body_text, extracted_data, thread_id')
Apres :  .select('id, subject, from_address, received_at, body_text, body_html, extracted_data, thread_id')
```

### Changement 2 — Interface QuotationRequest (ligne 38)

Ajouter le champ optionnel :

```text
body_html?: string;
```

### Changement 3 — Filtre de recherche (lignes 158-164)

Ajouter `body_html` au filtre :

```text
Avant :
  r.subject?.toLowerCase().includes(q) ||
  r.from_address?.toLowerCase().includes(q) ||
  r.body_text?.toLowerCase().includes(q)

Apres :
  r.subject?.toLowerCase().includes(q) ||
  r.from_address?.toLowerCase().includes(q) ||
  r.body_text?.toLowerCase().includes(q) ||
  r.body_html?.toLowerCase().includes(q)
```

## Resume

| Element | Valeur |
|---|---|
| Fichier modifie | `src/pages/Dashboard.tsx` uniquement |
| Lignes modifiees | 3 |
| Migration DB | Aucune |
| Edge Functions | Aucune |
| Cause | "Usmani" present dans `body_html` uniquement (signature email) |
| Risque | Minimal — `body_html` peut etre volumineux, mais le filtre est local et le nombre d'emails est limite a 100 |

