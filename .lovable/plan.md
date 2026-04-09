
# TARIFF-COHERENCE-1 — Correction prudente des recouvrements package / lignes moteur

## Statut : DONE (2026-04-09)

### Correctifs appliqués

1. **Canonicalisation THC moteur** (`supabase/functions/run-pricing/index.ts`)
   - Ajout `'Terminal (DPW)': 'DTHC'` et `'Terminal': 'DTHC'` dans `ENGINE_CATEGORY_TO_SERVICE_KEY`
   - Les lignes moteur THC import reçoivent désormais `service_key = 'DTHC'`

2. **Déduplication DTHC** (`supabase/functions/run-pricing/index.ts`)
   - Ajout `'DTHC': 'TERMINAL_HANDLING'` dans `DEDUP_GROUP_MAP`
   - La ligne package DTHC est sautée quand la ligne moteur THC officielle est présente
   - PORT_DAKAR_HANDLING volontairement NON fusionné (doctrine métier non validée)

3. **Whitelist DAP_PROJECT_IMPORT** (`src/pages/case-view/helpers.ts`)
   - Retrait de `SEA_FREIGHT` et `DISCHARGE` des extras compatibles
   - Liste finale : `SURVEY, AGENCY, PORT_CHARGES, ON_CARRIAGE`

### Dette reportée

- PORT_DAKAR_HANDLING vs DTHC → voir `docs/DEFERRED_BACKLOG.md` (TARIFF-COHERENCE-1-DEBT)
