

# Correctif : Erreur 404 dans analyze-document

## Diagnostic

| Fonction | Client Supabase | Peut lire `documents` ? |
|----------|----------------|------------------------|
| `parse-document` | `SERVICE_ROLE_KEY` | Oui (bypass RLS) |
| `analyze-document` | `ANON_KEY` | **Non** (RLS: `false`) |

La policy RLS sur la table `documents` est `"Deny all client access"` avec `qual = false`. Le client anon ne voit aucune ligne.

## Correction chirurgicale

### Fichier : `supabase/functions/analyze-document/index.ts`

Remplacer l'utilisation de `SUPABASE_ANON_KEY` par `SUPABASE_SERVICE_ROLE_KEY` (lignes 20-22).

Avant :
```text
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

Apres :
```text
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);
```

## Justification

- La fonction est deja protegee par `requireUser(req)` en ligne 17, donc seul un utilisateur authentifie peut l'appeler
- Le `SERVICE_ROLE_KEY` est necessaire uniquement pour bypasser la RLS restrictive sur `documents`
- C'est le meme pattern que `parse-document` qui utilise deja `SERVICE_ROLE_KEY`
- Modification de 2 lignes, zero refactor

## Fichiers concernes

| Fichier | Action |
|---------|--------|
| `supabase/functions/analyze-document/index.ts` | MODIFIER -- 2 lignes (client key) |

## Impact

- Aucun composant FROZEN touche
- Aucune nouvelle dependance
- Coherent avec le pattern des autres Edge Functions
