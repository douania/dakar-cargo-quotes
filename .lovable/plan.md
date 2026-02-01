

# Phase 7.0.3-fix: Correctifs CTO Bloquants Finaux

## Résumé des 2 bloquants + 1 quasi-bloquant

| Issue | Fichier | Risque | Solution |
|-------|---------|--------|----------|
| RPC sans REVOKE/GRANT | Migration SQL | Sécurité - bypass RLS | REVOKE PUBLIC + GRANT service_role |
| Erreurs facts avalées | build-case-puzzle | Défauts silencieux | Fail fast + track errors |
| event_type invalide | run-pricing | Timeline échoue | Ajouter `status_rollback` au CHECK |

---

## 1. Migration SQL : Sécuriser les RPC SECURITY DEFINER

### Problème actuel

Les fonctions `get_next_pricing_run_number` et `supersede_fact` sont `SECURITY DEFINER` mais sans contrôle d'accès explicite. Par défaut PostgreSQL accorde `EXECUTE` à `PUBLIC`, donc tout rôle (`authenticated`, `anon`) peut potentiellement les appeler.

### Patch SQL

```sql
-- Phase 7.0.3-fix: Sécurisation RPC + ajout event_type status_rollback

-- 1. Sécuriser get_next_pricing_run_number
REVOKE ALL ON FUNCTION public.get_next_pricing_run_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_pricing_run_number(UUID) TO service_role;

-- 2. Sécuriser supersede_fact (signature complète avec 12 paramètres)
REVOKE ALL ON FUNCTION public.supersede_fact(
  UUID, TEXT, TEXT, TEXT, NUMERIC, JSONB, TIMESTAMPTZ, TEXT, UUID, UUID, TEXT, NUMERIC
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supersede_fact(
  UUID, TEXT, TEXT, TEXT, NUMERIC, JSONB, TIMESTAMPTZ, TEXT, UUID, UUID, TEXT, NUMERIC
) TO service_role;

-- 3. Ajouter status_rollback au CHECK constraint de case_timeline_events
-- (nécessite de recréer la contrainte)
ALTER TABLE case_timeline_events 
DROP CONSTRAINT IF EXISTS case_timeline_events_event_type_check;

ALTER TABLE case_timeline_events 
ADD CONSTRAINT case_timeline_events_event_type_check 
CHECK (event_type IN (
  'case_created', 'status_changed', 'fact_added', 'fact_updated', 'fact_superseded',
  'gap_identified', 'gap_resolved', 'gap_waived', 'pricing_started', 'pricing_completed',
  'pricing_failed', 'output_generated', 'human_approved', 'human_rejected',
  'sent', 'archived', 'email_received', 'email_sent', 'attachment_analyzed',
  'clarification_sent', 'manual_action',
  'status_rollback',  -- AJOUT: rollback de statut
  'fact_insert_failed'  -- AJOUT: échec insertion fact
));
```

---

## 2. Edge Function build-case-puzzle : Fail Fast

### Problème actuel (lignes 266-268, 298-300)

```typescript
if (supersedeError) {
  console.error(`Failed to supersede fact ${fact.key}:`, supersedeError);
  continue;  // ❌ DÉFAUT SILENCIEUX
}
```

Le case peut passer `READY_TO_PRICE` même si des facts critiques ont échoué.

### Stratégie retenue : Fail Fast + Error Tracking

1. **Accumuler les erreurs** dans un tableau `factErrors[]`
2. **Insérer un event timeline** `fact_insert_failed` pour chaque échec
3. **Bloquer READY_TO_PRICE** si `factErrors.length > 0`
4. **Forcer status `FACTS_PARTIAL`** avec le détail des échecs

### Modifications clés

```typescript
// Avant la boucle des facts
const factErrors: Array<{ key: string; error: string }> = [];

// Dans la boucle, remplacer le `continue` par :
if (supersedeError) {
  factErrors.push({ key: fact.key, error: supersedeError.message });
  
  await serviceClient.from("case_timeline_events").insert({
    case_id,
    event_type: "fact_insert_failed",
    event_data: { 
      fact_key: fact.key, 
      error: supersedeError.message,
      is_critical: mandatoryFacts.includes(fact.key)
    },
    actor_type: "system",
  });
  
  continue; // Continue pour tenter les autres facts
}

// Après la boucle, AVANT le calcul du status
if (factErrors.length > 0) {
  // Bloquer READY_TO_PRICE si des facts ont échoué
  newStatus = "FACTS_PARTIAL";
  
  console.error(`${factErrors.length} fact errors for case ${case_id}:`, factErrors);
  
  // Retourner avec indicateur d'erreur
  return new Response(
    JSON.stringify({
      case_id,
      new_status: newStatus,
      facts_added: factsAdded,
      facts_updated: factsUpdated,
      fact_errors: factErrors,
      ready_to_price: false,
      error_summary: `${factErrors.length} facts failed to save`
    }),
    { status: 207, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

### Optimisation : Skip si valeur identique

Réintroduire le check de changement de valeur AVANT d'appeler la RPC :

```typescript
if (existingFact) {
  const existingValue = existingFact.value_text || existingFact.value_number || existingFact.value_json;
  
  // Skip si valeur identique (évite les écritures inutiles)
  if (JSON.stringify(existingValue) === JSON.stringify(factValue)) {
    continue; // Pas de changement, on passe au suivant
  }
  
  // Sinon, supersede...
}
```

---

## 3. Résumé des fichiers modifiés

| Fichier | Action |
|---------|--------|
| `supabase/migrations/[new].sql` | REVOKE/GRANT RPC + CHECK event_type étendu |
| `supabase/functions/build-case-puzzle/index.ts` | Fail fast + error tracking + skip identical |

---

## 4. Impact sécurité

| Avant | Après |
|-------|-------|
| `authenticated` peut appeler `supersede_fact` | Seul `service_role` peut l'exécuter |
| Erreurs facts ignorées silencieusement | Erreurs trackées + status bloqué |
| `status_rollback` échoue en DB | Event_type valide |

---

## 5. Tests de validation post-déploiement

1. **Test REVOKE** : Appeler `supersede_fact` via client anon → doit échouer avec "permission denied"
2. **Test Fail Fast** : Simuler une erreur RPC (e.g., case_id invalide) → status doit être `FACTS_PARTIAL`, pas `READY_TO_PRICE`
3. **Test timeline** : Vérifier que `status_rollback` et `fact_insert_failed` sont bien stockés sans erreur constraint

