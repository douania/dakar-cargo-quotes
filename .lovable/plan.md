

# Phase 13 — Correction Idempotence + Points Mineurs

## Problème Bloquant Identifié

L'idempotency_key est actuellement calculée APRÈS l'insertion de `decision_proposals` (ligne 254-260), ce qui utilise le `proposal_id` généré. En cas de retry réseau ou double-clic:
- Un nouveau `decision_proposals` est inséré
- Un nouveau `proposal_id` est généré
- Donc une nouvelle `idempotency_key`
- **Idempotence cassée**

---

## Correction Chirurgicale (3 fichiers, ~40 lignes)

### Fichier 1: `supabase/functions/commit-decision/index.ts`

**Modification**: Calculer `idempotencyKey` AVANT tout INSERT, basée sur payload stable.

| Lignes | Action |
|--------|--------|
| 217-260 | Réorganiser le flux |

**Nouveau flux (étapes 4-7):**

```text
AVANT (actuel):
4. Récupérer facts/gaps pour hash
5. INSERT decision_proposals (génère proposal_id)
6. Calculer idempotencyKey avec proposal_id  ← PROBLÈME
7. Appeler RPC

APRÈS (corrigé):
4. Récupérer facts/gaps pour hash
5. Calculer idempotencyKey SANS proposal_id  ← STABLE
6. Vérifier idempotence via RPC (check first)
   - Si existant → return 200 idempotent (SANS insert proposal)
7. INSERT decision_proposals (seulement si nouveau)
8. Appeler RPC commit (qui re-check idempotence)
```

**Code de la nouvelle idempotencyKey (stable):**

```typescript
// Étape 5 — Calculer idempotency_key AVANT insert (payload stable)
const optionsHash = await computeCanonicalHash(proposal_json?.options ?? []);
const idempotencyKey = await computeCanonicalHash({
  case_id,
  decision_type,
  selected_key,
  override_reason: override_reason ?? null,
  options_hash: optionsHash, // Lie à la proposition IA
});

// Étape 6 — Check idempotence AVANT insert proposal
const { data: existingDecision } = await serviceClient
  .from('operator_decisions')
  .select('id, decision_version')
  .eq('case_id', case_id)
  .eq('idempotency_key', idempotencyKey)
  .maybeSingle();

if (existingDecision) {
  // Retour idempotent SANS créer de proposal orpheline
  const { data: finalDecisions } = await serviceClient
    .from('operator_decisions')
    .select('decision_type')
    .eq('case_id', case_id)
    .eq('is_final', true);
  
  const completedTypes = new Set(finalDecisions?.map(d => d.decision_type) || []);
  const remainingDecisions = ALL_DECISION_TYPES.filter(t => !completedTypes.has(t)).length;

  return new Response(
    JSON.stringify({
      decision_id: existingDecision.id,
      decision_version: existingDecision.decision_version,
      idempotent: true,
      remaining_decisions: remainingDecisions,
      all_complete: remainingDecisions === 0
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Étape 7 — INSERT proposal (seulement si décision nouvelle)
const proposalBatchId = crypto.randomUUID();
const now = new Date().toISOString();

const { data: proposal, error: proposalError } = await serviceClient
  .from('decision_proposals')
  .insert({
    case_id,
    decision_type,
    proposal_batch_id: proposalBatchId,
    options_json: proposal_json,
    generated_at: now,
    generated_by: 'ai',
    facts_hash: factsHash,
    gaps_hash: gapsHash
  })
  .select('id')
  .single();

// Étape 8 — Appeler RPC avec la clé stable
const { data: rpcResult, error: rpcError } = await serviceClient
  .rpc('commit_decision_atomic', {
    p_case_id: case_id,
    p_decision_type: decision_type,
    p_idempotency_key: idempotencyKey,  // Clé stable
    p_proposal_id: proposal.id,
    // ... reste inchangé
  });
```

---

### Fichier 2: `supabase/functions/_shared/canonical-hash.ts`

**Modification**: Ajouter gestion `NaN`/`Infinity` dans le bon ordre.

| Lignes | Action |
|--------|--------|
| 48-55 | Déplacer avant le test `object` ou garder tel quel (non bloquant) |

Le code actuel est correct car `typeof number !== 'object'`, donc pas de changement nécessaire.

Les génériques `Record<string, unknown>` sont déjà corrects (lignes 41-44).

---

### Fichier 3: `src/components/puzzle/DecisionSupportPanel.tsx`

**Modification**: Invalider les deux query keys après unlock pricing.

| Lignes | Action |
|--------|--------|
| 180-181 | Déjà correct! |

Le code actuel invalide déjà les deux:
```typescript
queryClient.invalidateQueries({ queryKey: ['quote-case-status'] });
queryClient.invalidateQueries({ queryKey: ['quote-case'] });
```

**Vérification**: Le premier invalide avec un prefix, donc `['quote-case-status', caseId]` sera aussi invalidé.

---

## Résumé des Modifications

| Fichier | Lignes modifiées | Impact |
|---------|------------------|--------|
| `commit-decision/index.ts` | ~217-280 | Réorganisation flux idempotence |
| `canonical-hash.ts` | Aucune | Déjà correct |
| `DecisionSupportPanel.tsx` | Aucune | Déjà correct |

---

## Checklist Post-Correction

| Test | Attendu |
|------|---------|
| Double-clic commit | Même `decision_id`, `idempotent: true` |
| Retry réseau | Pas de proposal orpheline |
| Gaps bloquants | 409 sans artefact |
| 5/5 décisions | Status `DECISIONS_COMPLETE` |
| Bouton unlock | Visible si status correct |

---

## Estimation

| Tâche | Temps |
|-------|-------|
| Modification commit-decision | 15 min |
| Vérification autres fichiers | 5 min |
| Déploiement + test | 10 min |
| **Total** | **~30 min** |

