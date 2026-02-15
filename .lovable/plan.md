
# P2.1 — Repricing correctif append-only (Option C — FSM protege)

## Diagnostic confirme

Le dossier `d14b1e46` est en statut `SENT`. La fonction `run-pricing` contient 4 points ou le statut du case est modifie. Pour un repricing correctif, ces transitions doivent etre conditionnelles : les dossiers finalises (`SENT`, `QUOTED_VERSIONED`) ne doivent pas voir leur statut regresse.

## Fichier unique : `supabase/functions/run-pricing/index.ts`

### Modification 1 — Ligne 105 : Etendre les statuts autorises

```text
// Avant
const pricingAllowedStatuses = ["ACK_READY_FOR_PRICING", "PRICED_DRAFT", "HUMAN_REVIEW"];

// Apres
const pricingAllowedStatuses = [
  "ACK_READY_FOR_PRICING",
  "PRICED_DRAFT",
  "HUMAN_REVIEW",
  "QUOTED_VERSIONED",
  "SENT",
];
```

### Modification 2 — Apres ligne 116 : Definir le flag de protection FSM

Ajouter une constante qui conditionne toutes les transitions :

```text
const previousStatus = caseData.status;
const isFinalized = ["SENT", "QUOTED_VERSIONED"].includes(previousStatus);
```

### Modification 3 — Lignes 137-152 : Conditionner la transition vers PRICING_RUNNING

La transition vers `PRICING_RUNNING` et son event timeline ne doivent s'executer que si le dossier n'est PAS finalise :

```text
// 5. Transition to PRICING_RUNNING (skip for finalized cases)
if (!isFinalized) {
  await serviceClient
    .from("quote_cases")
    .update({ 
      status: "PRICING_RUNNING",
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", case_id);

  await serviceClient.from("case_timeline_events").insert({
    case_id,
    event_type: "status_changed",
    previous_value: previousStatus,
    new_value: "PRICING_RUNNING",
    actor_type: "system",
  });
}
```

### Modification 4 — Lignes 378-408 : Conditionner la transition vers PRICED_DRAFT

Meme logique apres le pricing reussi :

```text
// 14. Transition case to PRICED_DRAFT (skip for finalized cases)
if (!isFinalized) {
  await serviceClient
    .from("quote_cases")
    .update({ 
      status: "PRICED_DRAFT",
      pricing_runs_count: runNumber,
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", case_id);

  await serviceClient.from("case_timeline_events").insert({
    case_id,
    event_type: "status_changed",
    previous_value: "PRICING_RUNNING",
    new_value: "PRICED_DRAFT",
    actor_type: "system",
  });
} else {
  // Finalized case: only update pricing_runs_count, no status change
  await serviceClient
    .from("quote_cases")
    .update({ 
      pricing_runs_count: runNumber,
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", case_id);
}
```

### Modification 5 — Rollback (ligne 295 et autres)

Les rollbacks existants utilisent deja `previousStatus` comme cible, donc pour un dossier `SENT`, le rollback restaure vers `SENT`. Aucune modification necessaire ici.

## Trace timeline pour dossiers finalises

Le `pricing_completed` event (lignes 389-400) reste emis pour tous les cas — il documente le run sans impacter le FSM.

## Verification du flux

```text
Cas normal (ACK_READY_FOR_PRICING) :
  ACK_READY → PRICING_RUNNING → PRICED_DRAFT  (inchange)

Cas correctif (SENT) :
  SENT → [run execute, nouveau pricing_run cree] → SENT  (statut preserve)
  Timeline : pricing_completed event emis, pas de status_changed
```

## Etapes d'execution

1. Appliquer les 4 modifications dans `run-pricing/index.ts`
2. Deployer la fonction
3. Appeler `run-pricing` sur `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
4. Verifier : `totals.ht != totals.ttc`, `honoraires_tva > 0`, `case.status == SENT`

## Ce qui ne change PAS

- `quotation-engine` : intact
- Autres edge functions : intactes
- Schema DB : aucune migration
- Anciens pricing_runs : intacts
- Frontend : intact

## Risque

Minimal. Le flag `isFinalized` est local, clair, et n'impacte que les transitions FSM. Le pricing_run est toujours cree (append-only). Les rollbacks fonctionnent deja correctement grace a `previousStatus`.
