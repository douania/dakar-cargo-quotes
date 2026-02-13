

# Patch chirurgical : ensure-quote-case — filtrage des thread_ref synthetiques

## Contexte

Le Patch 1 (QuotationSheet.tsx) genere des `stableThreadRef` synthetiques de la forme `subject:<normalized>`. Si ce ref est transmis a `ensure-quote-case` comme `thread_id`, il sera passe a `.eq("id", thread_id)` sur `email_threads` — ce qui echouera car ce n'est pas un UUID valide.

## Modification

**Fichier** : `supabase/functions/ensure-quote-case/index.ts`

### Changement 1 — Detection du prefixe `subject:` (apres ligne 71)

Ajouter apres la validation de `thread_id` :

```text
let effectiveThreadRef = thread_id;
if (typeof thread_id === 'string' && thread_id.startsWith('subject:')) {
  effectiveThreadRef = null;
}
```

### Changement 2 — Remplacer `thread_id` par `effectiveThreadRef` dans les requetes

4 endroits concernes :

| Ligne | Usage actuel | Remplacement |
|---|---|---|
| 77 | `.eq("id", thread_id)` (SELECT email_threads) | `.eq("id", effectiveThreadRef)` — avec guard null |
| 91 | `.eq("thread_id", thread_id)` (SELECT quote_cases) | `.eq("thread_id", effectiveThreadRef)` — avec guard null |
| 114 | `thread_id` dans INSERT quote_cases | `effectiveThreadRef` |
| 134 | `thread_id` dans event_data | Conserver `thread_id` original (pour tracabilite) |

### Comportement attendu

- Si `thread_id = "subject:demande de prix"` :
  - `effectiveThreadRef = null`
  - Le SELECT sur `email_threads` est skippe (pas de thread reel)
  - Le SELECT sur `quote_cases` cherche par `thread_id IS NULL` — ne trouve rien
  - Le INSERT cree un case avec `thread_id = null`
  - L'event_data conserve le `thread_id` original pour audit

- Si `thread_id` est un UUID normal : comportement inchange.

### Logique adaptee (step 3 skippe si null)

Quand `effectiveThreadRef` est `null`, le step 3 (verify thread exists) est skippe car il n'y a pas de thread reel. Le thread objet est initialise avec des valeurs par defaut (`is_quotation_thread: false`, `subject_normalized: null`).

## Ce qui ne change pas

- Interface `EnsureCaseRequest` / `EnsureCaseResponse`
- Logique JWT
- Timeline events
- Aucun autre fichier

## Risque

Minimal — fallback uniquement pour les refs synthetiques. Les UUID reels passent par le chemin existant sans modification.

