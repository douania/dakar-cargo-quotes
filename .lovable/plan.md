

# Fix: qualify-quotation-minimal crash sur references synthetiques

## Diagnostic

Les logs montrent clairement :

```
invalid input syntax for type uuid: "subject:ddp rate request dakar lcl 25607"
```

Le fichier `qualify-quotation-minimal/index.ts` utilise `thread_id` (qui peut etre une reference synthetique comme `subject:...`) dans deux requetes qui attendent un UUID :

1. **Ligne 182** : `.eq('id', thread_id)` — fallback qui tente de chercher un email par ID avec une string non-UUID
2. **Ligne 200** : `.eq('thread_id', thread_id)` — cherche le quote_case par thread_id, mais les cases synthetiques ont `thread_id = NULL`

## Correction (2 touches chirurgicales)

### Touch 1 — Guard sur le fallback email par ID (ligne 178-194)

Le fallback `.eq('id', thread_id)` ne doit s'executer que si `thread_id` ressemble a un UUID. Pour les references synthetiques, on skip ce fallback.

```text
// Avant la ligne 179, ajouter un guard :
const isSyntheticRef = thread_id.startsWith('subject:');

if (!emails || emails.length === 0) {
  if (!isSyntheticRef) {
    // Fallback: chercher par ID si thread_ref est un UUID
    const { data: singleEmail, error: singleError } = await supabase
      .from('emails')
      .select(...)
      .eq('id', thread_id)
      .single();
    if (!singleError && singleEmail) {
      emails.push(singleEmail);
    }
  }
}
```

Si apres ce guard il n'y a toujours pas d'emails, on continue avec un tableau vide (pas de 404) car la fonction est read-only et doit pouvoir fonctionner sans emails.

### Touch 2 — Chargement du quote_case pour refs synthetiques (ligne 197-201)

Pour les references synthetiques, chercher le case par son `id` passe via le `case_id` de la page (extrait de l'URL). Mais cette fonction recoit `thread_id`, pas `case_id`.

Solution : si `thread_id` est synthetique, chercher le case via `case_timeline_events` ou simplement skipper le chargement du case (la fonction est read-only).

```text
let quoteCase = null;
if (!isSyntheticRef) {
  // Recherche standard par thread_id
  const { data } = await supabase
    .from('quote_cases')
    .select('id, status')
    .eq('thread_id', thread_id)
    .maybeSingle();
  quoteCase = data;
}
// Si pas de case, existingGaps et existingFacts restent vides
// La fonction genere les questions basiques a partir des emails
```

## Ce qui ne change PAS

- Le prompt IA (lignes 49-117)
- Le parsing de la reponse IA (lignes 269-317)
- Le filtrage V4.2.3b (lignes 323-337)
- La regle CTO `can_proceed = false`

## Impact

- References synthetiques : la fonction retourne des questions basiques sans contexte de faits/gaps (comportement degrade acceptable)
- References UUID : comportement inchange
- Pas de modification de schema DB
- Pas de changement de contrat API

## Resume

| Ligne | Avant | Apres |
|---|---|---|
| 178-194 | Fallback `.eq('id', thread_id)` sans guard | Guard `isSyntheticRef` pour eviter crash UUID |
| 197-201 | `.eq('thread_id', thread_id)` sans guard | Skip si synthetique |

## Deploiement

Redeployer `qualify-quotation-minimal` uniquement.

