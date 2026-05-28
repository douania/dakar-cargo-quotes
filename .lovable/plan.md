# CMA-CGM-TEMPLATES-CLEANUP-1 — Plan d'exécution data-only

## Préchecks SELECT (exécutés)

| charge_code | default_amount | evidence_level | operation_type | is_active | Précheck |
|---|---|---|---|---|---|
| SVC | 18000 | historical_only | ALL | true | OK |
| TBL | 25000 | historical_only | ALL | true | OK |
| DOF | 5000 | validated_internal | ALL | true | OK (operation_type=ALL → IMPORT) |
| CMF | 10 | validated_internal | ALL | true | Inchangé |
| COMM | 2.8 | validated_internal | ALL | true | Inchangé |
| CMDF | 600 | validated_internal | ALL | true | Inchangé |
| LOC_TERM | 11.50 | historical_only | ALL | true | Inchangé |
| ISPS_TERM | 8.85 | historical_only | ALL | true | Inchangé |
| THO | NULL | historical_only | ALL | false | Inchangé |

Total CMA_CGM : 9 lignes. Les 3 préchecks cibles (SVC, TBL, DOF) matchent exactement les conditions WHERE du SQL fourni.

Note : DOF est déjà `validated_internal` (le SQL ne touche pas `evidence_level` pour DOF, seul `operation_type` + `source_documents` + `notes` changent → cohérent).

## Action proposée

Exécuter le bloc SQL fourni via `supabase--insert` (UPDATE data-only, transactionnel, avec garde `GET DIAGNOSTICS rc` qui RAISE si ≠ 1 ligne touchée par UPDATE).

Aucune migration schéma, aucun patch code, aucun changement RLS, aucun runtime smoke.

### Bloc à exécuter

```sql
BEGIN;
DO $$
DECLARE rc integer;
BEGIN
  UPDATE public.carrier_billing_templates
  SET evidence_level = 'validated_internal',
      operation_type = 'IMPORT',
      source_documents = ARRAY['CMA CGM/CNC SENEGAL LOCAL CHARGES - Effective 20-Jan-2023 (PDF officiel)'],
      notes = 'General Administrative Fee at destination / Frais de Service de Consignation - confirmé PDF officiel'
  WHERE carrier='CMA_CGM' AND charge_code='SVC'
    AND default_amount=18000 AND evidence_level='historical_only';
  GET DIAGNOSTICS rc = ROW_COUNT;
  IF rc <> 1 THEN RAISE EXCEPTION 'SVC update expected 1 row, got %', rc; END IF;

  UPDATE public.carrier_billing_templates
  SET evidence_level='validated_internal', operation_type='IMPORT',
      source_documents=ARRAY['CMA CGM/CNC SENEGAL LOCAL CHARGES - Effective 20-Jan-2023 (PDF officiel)'],
      notes='Stamp duty at destination/import - confirmé PDF officiel ; export à traiter séparément si nécessaire'
  WHERE carrier='CMA_CGM' AND charge_code='TBL'
    AND default_amount=25000 AND evidence_level='historical_only';
  GET DIAGNOSTICS rc = ROW_COUNT;
  IF rc <> 1 THEN RAISE EXCEPTION 'TBL update expected 1 row, got %', rc; END IF;

  UPDATE public.carrier_billing_templates
  SET operation_type='IMPORT',
      source_documents=ARRAY['CMA CGM/CNC SENEGAL LOCAL CHARGES - Effective 20-Jan-2023 (PDF officiel)'],
      notes='Delivery Order Fee at destination / BAD électronique - confirmé PDF officiel'
  WHERE carrier='CMA_CGM' AND charge_code='DOF'
    AND default_amount=5000 AND operation_type='ALL';
  GET DIAGNOSTICS rc = ROW_COUNT;
  IF rc <> 1 THEN RAISE EXCEPTION 'DOF update expected 1 row, got %', rc; END IF;
END $$;
COMMIT;
```

## Postchecks SELECT (à exécuter après UPDATE)

1. SVC : `evidence_level='validated_internal'`, `operation_type='IMPORT'`, `default_amount=18000`
2. TBL : `evidence_level='validated_internal'`, `operation_type='IMPORT'`, `default_amount=25000`
3. DOF : `operation_type='IMPORT'`, `default_amount=5000`
4. CMF / LOC_TERM / ISPS_TERM / THO / COMM / CMDF inchangés
5. Total lignes CMA_CGM = 9 (inchangé)

## Rollback (conservé, à exécuter uniquement en cas de régression)

Bloc fourni par la consigne (restitue SVC/TBL → `historical_only`, ALL, source_documents factures D5/D6, notes to_confirm ; DOF → ALL).

## Gouvernance — sujets différés

À mettre à jour dans `docs/DEFERRED_BACKLOG.md` après PASS (chantier suivant, hors scope de ce plan) :
- `CMA-CMF-REEFER-EXTEND-1` — REEFER 20 USD/TEU
- `CMA-LOC-ISPS-AMOUNT-FIX-1` — refonte barème LOC_TERM/ISPS_TERM par taille
- `CMA-EXP-DOC-CHARGES-EXTEND-1` — DOC_ORIG, SWB, ADDL_ADMIN
- `CMA-SOURCE-DISTINCT-CMDF-COMM-1` — source PDF distincte pour CMDF/COMM

## Verdict attendu après exécution

PASS si les 3 UPDATE retournent 1 ligne chacun et postchecks conformes. FAIL → rollback manuel.

Approuver pour basculer en build mode et exécuter via `supabase--insert`.
