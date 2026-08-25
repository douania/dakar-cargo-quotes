/**
 * Shared service-scope resolution — verbatim extraction from `run-pricing/index.ts`
 * (P5 helpers) so `build-case-puzzle` can compute the SAME `effectiveServiceKeys`
 * that `run-pricing` feeds to `resolvePadScopeBlocker`.
 *
 * NOTHING here is new doctrine: `SERVICE_PACKAGES`, `PACKAGE_SERVICE_DEFAULT_UNITS`,
 * `readOverridesFromFacts` and `resolveEffectiveServiceKeys` are moved as-is from
 * run-pricing, which now imports them from this module. The single source of truth
 * prevents the two functions from drifting into two divergent PAD scope doctrines.
 */

// P5: SERVICE_PACKAGES mapping (mirror of src/features/quotation/constants.ts)
export const SERVICE_PACKAGES: Record<string, string[]> = {
  DAP_PROJECT_IMPORT: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'EMPTY_RETURN', 'CUSTOMS_DAKAR'],
  TRANSIT_GAMBIA_ALL_IN: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'BORDER_FEES', 'AGENCY'],
  EXPORT_SENEGAL: ['PORT_CHARGES', 'THC_EXPORT', 'CUSTOMS_EXPORT', 'DOCUMENTATION_BL', 'VGM_WEIGHING', 'SEA_FREIGHT', 'AGENCY'],
  BREAKBULK_PROJECT: ['DISCHARGE', 'PORT_DAKAR_HANDLING', 'TRUCKING', 'SURVEY', 'CUSTOMS_DAKAR'],
  AIR_IMPORT_DAP: ['AIR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  LCL_IMPORT_DAP: ['PORT_DAKAR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  TRANSIT_REGIONAL_VIA_DAKAR: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'BORDER_FEES', 'CUSTOMS_DAKAR', 'AGENCY'],
  DAP_PROJECT_IMPORT_EXW: ['PICKUP_ORIGIN', 'PRE_CARRIAGE', 'SEA_FREIGHT', 'PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'EMPTY_RETURN', 'CUSTOMS_DAKAR'],
  AIR_IMPORT_EXW: ['PICKUP_ORIGIN', 'PRE_CARRIAGE', 'AIR_FREIGHT', 'AIR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  LCL_IMPORT_EXW: ['PICKUP_ORIGIN', 'PRE_CARRIAGE', 'SEA_FREIGHT', 'PORT_DAKAR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  // Package-DDP micro-lot: alias service-identique des variantes DAP.
  AIR_IMPORT_DDP: ['AIR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  LCL_IMPORT_DDP: ['PORT_DAKAR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  // Import project DDP: alias service-identique de DAP_PROJECT_IMPORT — parité stricte avec
  // src/features/quotation/constants.ts, où la clé existait déjà. Sans elle, un dossier
  // DDP_PROJECT_IMPORT résolvait un périmètre VIDE côté backend: le garde PAD ne voyait plus
  // PORT_DAKAR_HANDLING et laissait passer un chiffrage sans catégorie/tarif PAD (fail-open).
  // La sémantique DDP (droits/taxes) reste portée par routing.incoterm + customs, pas ici.
  DDP_PROJECT_IMPORT: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'EMPTY_RETURN', 'CUSTOMS_DAKAR'],
};

// P5: Default units per service_key (aligned with service_quantity_rules)
export const PACKAGE_SERVICE_DEFAULT_UNITS: Record<string, string> = {
  PICKUP_ORIGIN: 'forfait',
  PRE_CARRIAGE: 'voyage',
  SEA_FREIGHT: 'EVP',
  AIR_FREIGHT: 'kg',
  AIR_HANDLING: 'forfait',
  CUSTOMS_DAKAR: 'forfait',
  TRUCKING: 'voyage',
  AGENCY: 'forfait',
  DTHC: 'forfait',
  EMPTY_RETURN: 'forfait',
  PORT_DAKAR_HANDLING: 'forfait',
  PORT_CHARGES: 'forfait',
  CUSTOMS_EXPORT: 'forfait',
  DISCHARGE: 'forfait',
  SURVEY: 'forfait',
  BORDER_FEES: 'forfait',
  CUSTOMS_BAMAKO: 'forfait',
  ON_CARRIAGE: 'voyage',
  // P7: Export-specific service units
  THC_EXPORT: 'EVP',
  DOCUMENTATION_BL: 'BL',
  VGM_WEIGHING: 'EVP',
  STUFFING_FACTORY: 'EVP',
  STUFFING_CFS: 'EVP',
  EMPTY_REPO: 'EVP',
};

// ═══ P5: Service overrides helpers ═══

export type ServiceOverrides = { add: string[]; remove: string[] };

type ServiceOverrideFact = {
  fact_key: string;
  value_json?: unknown;
  value_text?: string;
};

type ServiceOverrideFactMap = Record<
  string,
  { value_json?: unknown; value_text?: string } | undefined
>;

export const ALL_KNOWN_SERVICE_KEYS = new Set(Object.keys(PACKAGE_SERVICE_DEFAULT_UNITS));

export function readOverridesFromFacts(
  facts: ServiceOverrideFactMap | ServiceOverrideFact[],
): ServiceOverrides {
  const empty: ServiceOverrides = { add: [], remove: [] };
  try {
    let raw: unknown = null;
    if (Array.isArray(facts)) {
      const f = facts.find((fact) => fact.fact_key === 'service.overrides');
      raw = f?.value_json ?? f?.value_text ?? null;
    } else if (facts && typeof facts === 'object') {
      raw = facts['service.overrides']?.value_json
        ?? facts['service.overrides']?.value_text ?? null;
    }
    if (!raw) return empty;
    let parsed = raw;
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return empty; } }
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return empty; } }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
    const sanitize = (arr: unknown): string[] => {
      if (!Array.isArray(arr)) return [];
      return arr.filter((v): v is string => typeof v === 'string')
        .map(v => v.trim().toUpperCase())
        .filter(v => v && ALL_KNOWN_SERVICE_KEYS.has(v));
    };
    const parsedRecord = parsed as Record<string, unknown>;
    return { add: sanitize(parsedRecord.add), remove: sanitize(parsedRecord.remove) };
  } catch { return empty; }
}

export function resolveEffectiveServiceKeys(packageKey: string, overrides: ServiceOverrides): string[] {
  const base = SERVICE_PACKAGES[packageKey];
  if (!base) return [];
  const removeSet = new Set(overrides.remove);
  const result = base.filter(k => !removeSet.has(k));
  for (const k of overrides.add) { if (!result.includes(k)) result.push(k); }
  return result;
}
