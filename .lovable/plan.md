

# P1 Corrigé — Auto-create partner requests from blocking freight gaps

## STRUCTURAL_PATCH_ALLOWED — Exception on build-case-puzzle (FROZEN)

**Business problem**: No link between `cargo.freight_cost` blocking gap detection and partner request creation. Operator must manually create requests without context.

**Scope**: Post-processing block only, no modification to existing logic.

---

## Changes

### 1. `supabase/functions/build-case-puzzle/index.ts` — Insert between L3690 and L3692

Add a ~45-line non-blocking `try/catch` block after the final log and before the `return new Response(...)`.

Logic:
1. Query open blocking gaps where `gap_key = 'cargo.freight_cost'` and `status = 'open'`
2. If none found, skip entirely
3. Query `quote_request_lines` for the case
4. Build targets:
   - If lines exist: one target per line (`lot_index = line_index`, mode from `request_type_hint`)
   - If no lines: one target with `lot_index = null`, mode from `detectedType` (already in scope at L3667/L3696)
5. For each target:
   - Compute `purpose`: if mode contains `AIR` (case-insensitive) then `'air_tariff'`, else `'freight_rate'`
   - Check existence: `SELECT id FROM external_quote_requests WHERE case_id AND related_lot_index IS NOT DISTINCT FROM target.lot_index AND purpose = computedPurpose AND status <> 'closed' LIMIT 1`
   - If none: insert `external_quote_requests` with `partner_name: 'A definir'`, `status: 'draft'`, `created_by: null`
   - Build `purpose_detail` as human-readable TEXT from quote_facts (`routing.origin_country`, `routing.destination_port`, `routing.transport_mode`, `routing.incoterm`, `cargo.weight_kg`, `cargo.volume_cbm`)
   - Insert timeline event `external_request_created` with `actor_type: 'system'`
6. All errors: `console.warn`, never fatal

**Transport mode priority**: `request_type_hint` (from lines) > `detectedType` (in scope) > fallback `'UNKNOWN'` (treated as `freight_rate`)

**Idempotence**: Applicative only (SELECT before INSERT). Not DB-enforced. Documented as P1 limitation.

### 2. `src/components/puzzle/ExternalRequestsPanel.tsx` — ~15 lines

In the request header row (around L260-266):
- Add a `Badge` "Systeme" when `req.created_by === null`
- Add an info banner inside expanded content (L281-284) for auto-generated drafts: `"Demande creee automatiquement suite a un gap fret bloquant."`
- Change `purpose_detail` display from `<p>` to `<p className="whitespace-pre-line">` for multi-line text

### 3. `docs/MASTER_CONTEXT.md` — ~15 lines

Add section "Exception controlee -- P1 Auto-EQ sur build-case-puzzle" documenting:
- Business gap, patch scope, idempotence limitation (applicative only), non-blocking constraint

---

## What does NOT change

- No new tables or columns
- No changes to gap detection logic, `run-pricing`, `quotation-engine`, `set-case-fact`
- No auto-send, no auto-inject into `quote_facts`
- Manual "Nouvelle demande" button unchanged

