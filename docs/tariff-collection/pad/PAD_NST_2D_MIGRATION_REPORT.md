# PAD-NST-2D — Migration Report

**Date**: 2026-05-07
**Phase**: PAD-NST-2D — Table `pad_nst_recommendation_rules` (vide)
**Migration**: `supabase/migrations/20260507183406_dd1113d8-145b-4323-9bde-6837c0678f21.sql`

## Table Created

`public.pad_nst_recommendation_rules` — Maps NST 2007 groups/divisions to PAD tariff categories (T01-T14, P01-P05).

## Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Table exists | yes | yes | ✅ |
| Row count | 0 | 0 | ✅ |
| RLS enabled | yes | yes | ✅ |
| Policy SELECT authenticated | 1 | 1 | ✅ |
| Policy INSERT/UPDATE/DELETE | 0 | 0 | ✅ |

## Constraints (8)

| Constraint | Type |
|-----------|------|
| `pad_nst_recommendation_rules_pkey` | PRIMARY KEY |
| `uq_pad_nst_rule` | UNIQUE (nst_level, nst_code, pad_category) |
| `chk_pad_nst_rule_level` | CHECK: group \| division |
| `chk_pad_nst_rule_code_format` | CHECK: division=`^[0-9]{2}$`, group=`^[0-9]{2}\.[0-9A-Z]$` |
| `chk_pad_nst_rule_pad_category` | CHECK: `^(T(0[1-9]\|1[0-4])\|P0[1-5])$` |
| `chk_pad_nst_rule_confidence` | CHECK: 0 to 1 |
| `chk_pad_nst_rule_evidence_level` | CHECK: pad_official_extract, nstr_bridge_inferred, expert_rule, operator_override |
| `chk_pad_nst_rule_validation_status` | CHECK: candidate, validated, rejected, deprecated |

## Indexes (5)

| Index | Columns |
|-------|---------|
| `pad_nst_recommendation_rules_pkey` | id |
| `uq_pad_nst_rule` | (nst_level, nst_code, pad_category) |
| `idx_pad_nst_rules_level_code` | (nst_level, nst_code) |
| `idx_pad_nst_rules_pad_category` | (pad_category) |
| `idx_pad_nst_rules_active_validated` | (nst_level, nst_code, confidence DESC) WHERE is_active AND validated |

## Perimeter Confirmation

| Item | Status |
|------|--------|
| `src/` modifications | ❌ None |
| Edge Functions | ❌ None |
| `config.toml` | ❌ None |
| Runtime impact | ❌ None |
| Data imported | ❌ None (0 rows) |

## Notes

- No FK to `commodity_categories` — only CHECK regex on `pad_category`.
- No `updated_at` trigger — to be added when operator editing is implemented.
- Resolution logic (group > division, no auto-validate on conflict) is documented but not yet implemented in runtime.
