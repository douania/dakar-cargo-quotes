

# Correction ensure-quote-case : request_type null-safe (sans pollution enum)

## Probleme

`ensure-quote-case` (ligne 102) insere `request_type: workflowKey` directement, soit `"WF_SIMPLE_QUOTE"`. Cette valeur n'existe pas dans l'enum `quote_request_type`, ce qui fait crasher l'INSERT et empeche la creation du dossier en base. Toute la chaine tombe en cascade (documents, facts, CaseView).

## Approche CTO validee

**Ne PAS ajouter `WF_*` a l'enum** `quote_request_type`. Cet enum represente le mode transport (SEA_FCL_IMPORT, etc.), pas le type de workflow Railway. Melanger les deux serait une dette structurelle.

A la place : mapping defensif dans `ensure-quote-case` + erreur bloquante dans `Intake.tsx`.

## Modifications

### Fichier 1 : `supabase/functions/ensure-quote-case/index.ts`

**Ligne 68** : Remplacer `const workflowKey = body.workflow_key || "WF_SIMPLE_QUOTE";` par un mapping qui ne passe que les valeurs enum valides dans `request_type`, et met `null` sinon.

**Lignes 96-107** : Dans l'insert, utiliser `safeRequestType` (null si workflow key) au lieu de `workflowKey` brut.

```text
// Avant (ligne 102)
request_type: workflowKey,

// Apres
const ALLOWED_REQUEST_TYPES = new Set([
  "SEA_FCL_IMPORT", "SEA_LCL_IMPORT", "SEA_BREAKBULK_IMPORT",
  "AIR_IMPORT", "ROAD_IMPORT", "MULTIMODAL_IMPORT",
]);
const workflowKey = body.workflow_key ?? null;
const safeRequestType = ALLOWED_REQUEST_TYPES.has(workflowKey ?? "")
  ? workflowKey
  : null;

// insert
request_type: safeRequestType,
```

Le `workflow_key` est conserve dans `event_data` du timeline event (deja le cas, ligne ~122), donc aucune perte d'information.

### Fichier 2 : `src/pages/Intake.tsx`

**Lignes 249-258** : Transformer le `console.warn` en erreur bloquante. Si `ensure-quote-case` echoue, les etapes suivantes (upload document, injection facts) sont inutiles et vont cascader en erreurs.

```text
// Avant
if (ensureErr) {
  console.warn("[Intake] ensure-quote-case failed:", ensureErr);
}

// Apres
const { data: ensureData, error: ensureErr } = await supabase.functions.invoke(...);
if (ensureErr || ensureData?.error) {
  throw new Error(
    "Creation du dossier en base impossible: " +
    (ensureData?.error || ensureErr?.message || "reponse invalide")
  );
}
```

Cela garantit que l'utilisateur voit une erreur claire au lieu d'un echec silencieux suivi de multiples erreurs FK/RLS.

## Pas de migration SQL necessaire

- `request_type` est deja `nullable` (confirme par la requete schema)
- Aucune modification d'enum
- Les event_types `document_uploaded` et `fact_injected_manual` ont deja ete ajoutes dans la migration precedente

## Flux corrige

```text
1. createIntake(Railway) → case_id + workflow_key="WF_SIMPLE_QUOTE"
2. ensure-quote-case → insert request_type=NULL (WF_* filtre) → OK
3. Upload document → case_documents (FK satisfaite) → OK
4. Timeline "document_uploaded" → OK
5. injectContainerFacts → set-case-fact (ownership OK) → OK
6. CaseView → quote_cases existe → affichage OK
```

## Risques

- Zero regression : `request_type` est nullable, NULL est une valeur valide partout
- Le workflow_key reste trace dans `event_data` du timeline
- L'erreur bloquante empeche les cascades d'erreurs silencieuses

