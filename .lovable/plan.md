
## Phase 16 — Suppression `cargo.freight_exchange_rate` + Hard Guard unifié + Coherence checks

### Statut : ✅ APPLIQUÉ

### Modifications (3 fichiers, 0 migration DB)

#### 1. `supabase/functions/run-pricing/index.ts`
- `freightExchangeRate` supprimé de `PricingInputs`
- `case "cargo.freight_exchange_rate"` supprimé de `buildPricingInputs`
- Hard guard unifié : suppression de `.not("gap_key", "in", ...)` — tout gap bloquant ouvert retourne HTTP 400
- Blocs HS / régime / FOB transformés en **coherence checks** :
  - Plus aucun upsert `quote_gaps` ni `case_timeline_events`
  - `console.error("[COHERENCE] puzzle/pricing drift", ...)` ajouté
  - `pricing_runs` en `status: "blocked"` conservé (audit trail)
  - Retour HTTP 200 soft blocker avec `coherence_drift: true`

#### 2. `supabase/functions/build-case-puzzle/index.ts`
- Variables `freightExchangeRate156`, `needsUsdRate156`, `hasUsdRate156` supprimées
- `policyRequiredKeys.add("cargo.freight_exchange_rate")` supprimé
- `"cargo.freight_exchange_rate"` retiré de `policyKeysAll`
- Bloc `ensureBlockingGap156("cargo.freight_exchange_rate", ...)` supprimé
- `"cargo.freight_exchange_rate"` retiré de `policyDowngradeKeys`

#### 3. `src/components/puzzle/PricingLaunchPanel.tsx`
- `onComplete?.()` ajouté dans le bloc `catch` pour refresh gaps sur HTTP 400

### Vérification grep
- `freight_exchange_rate` : 0 occurrence active dans `run-pricing`, commentaires uniquement dans `build-case-puzzle`
- Les 3 gaps DDP restants (`cargo.hs_code`, `customs.regime_code`, `cargo.freight_cost`) sont intacts
