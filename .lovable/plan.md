

# Fix: guard emails.length === 0 trop strict pour cases sans thread_id

## Diagnostic

Le fix precedent (inner → left join) a resolu le 404. Mais le guard suivant (ligne 863) bloque systematiquement les cases sans thread_id :

```text
emails = []  (car thread_id est null, on skip le chargement)
→ if (emails.length === 0) → return 400 "No emails found in thread"
```

Le guard ne distingue pas deux situations :
1. `thread_id` existe mais aucun email trouve → erreur legitime
2. `thread_id` est null → comportement attendu, le puzzle doit continuer sans emails

## Correction (1 ligne)

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`, ligne 863

Remplacer :

```text
if (emails.length === 0) {
```

Par :

```text
if (caseData.thread_id && emails.length === 0) {
```

Ainsi :
- Si `thread_id` existe et 0 emails → erreur 400 (inchange)
- Si `thread_id` est null → le puzzle continue avec `emails = []` et `threadContext = ""`

## Ce qui ne change PAS

- Le chargement des emails (lignes 852-861) : deja corrige
- Le chargement des attachments (ligne 870-875) : `emailIds` sera un tableau vide, la requete retournera 0 resultats, pas d'erreur
- L'extraction AI (ligne 888) : recevra un `threadContext` vide et un `attachmentContext` vide, ce qui est acceptable (elle retournera peu/pas de faits)
- Tout le reste du flux en aval

## Risque

Aucun. On permet simplement au puzzle de s'executer avec un contexte email vide. L'AI retournera moins de faits, ce qui est le comportement attendu pour un case sans thread.

