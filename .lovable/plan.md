

# Correctif : NOT NULL constraint sur quote_cases.thread_id

## Diagnostic

Deux erreurs en cascade :

1. **Backend** (`ensure-quote-case`) : INSERT avec `thread_id = null` echoue car la colonne a une contrainte NOT NULL.
2. **Frontend** (`QuotationSheet.tsx`) : SELECT sur `quote_cases` avec `.eq("thread_id", "subject:...")` echoue car le type est UUID et la valeur n'en est pas un.

## Correctifs

### 1. Migration SQL : rendre `thread_id` nullable

```sql
ALTER TABLE public.quote_cases ALTER COLUMN thread_id DROP NOT NULL;
```

Risque : nul. Les cases existants ont tous un `thread_id` reel. Ce changement autorise simplement les nouveaux cases crees via le fallback synthetique.

### 2. Frontend : guard dans QuotationSheet.tsx

Dans le hook `useQuoteCaseData` (ou directement dans QuotationSheet), ajouter un guard pour ne pas envoyer de requete `.eq("thread_id", stableThreadRef)` quand `stableThreadRef` commence par `subject:`. Le SELECT doit etre skippe dans ce cas (pas de case existant a chercher par ref synthetique).

Localisation : fichier `src/hooks/useQuoteCaseData.ts` — le hook qui fait le SELECT sur `quote_cases`.

### 3. Aucun changement sur ensure-quote-case

Le code edge function est deja correct apres le patch precedent. Une fois la contrainte NOT NULL levee, l'INSERT fonctionnera.

## Resume

| Correctif | Fichier | Nature |
|---|---|---|
| DROP NOT NULL | Migration SQL | Schema |
| Guard ref synthetique | useQuoteCaseData.ts | Frontend |
| Aucun | ensure-quote-case | Deja patche |

## Risque global

Minimal. La migration est additive (nullable), le guard frontend est un simple `if`.

