
# Détail des droits et taxes par article — COMPLÉTÉ

## Résumé des modifications

### Backend (quotation-engine)
- Déclaration `dutyBreakdown[]` au niveau fonction (avant le bloc `if (!isTransit)`)
- Construction d'un objet détaillé par article après les calculs existants (DD, RS, surtaxe, TIN, TCI, PCS, PCC, COSEC, TVA)
- Retour dans la réponse sous `duty_breakdown`

### Backend (run-pricing)
- Passage de `duty_breakdown` dans `outputs_json`

### Frontend
- Nouveau composant `DutyBreakdownTable` (collapsible)
- Hook `usePricingResultData` étendu avec `outputs_json` et type `DutyBreakdownItem`
- Intégré dans `PricingResultPanel` après les lignes tarifaires

## Vérifié
- Pricing run #15 sur case acddafa7 : duty_breakdown correctement stocké
- Total droits : 823 829 FCFA (cohérent avec le total debours)
