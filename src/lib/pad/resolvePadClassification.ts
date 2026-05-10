/**
 * PAD-RUNTIME-EXPAND / Lot B
 *
 * Helper pur `resolvePadClassification`.
 *
 * Garde-fous absolus :
 *  - Aucune lecture DB (pas de Supabase).
 *  - Aucun appel réseau (pas de fetch).
 *  - Aucune dépendance React/DOM.
 *  - Aucun Date.now / Math.random : déterministe par construction.
 *  - Ne calcule jamais de montant.
 *  - Ne lit jamais port_tariffs.
 *  - Famille canonique invariante : "DROIT_PASSAGE".
 *  - PORT_TAX n'est JAMAIS retourné comme canonical_rate_family.
 *  - BLANK_IN_PDF n'est jamais transformé en 0 (le helper ne touche pas aux montants).
 *  - Aucune réduction pêche P01–P05 appliquée.
 *  - HS → NST uniquement via context.hsToNstMapping explicite (pas de
 *    découpage HS10 → CN8 / chapitre HS hardcodé).
 *  - T13 transit/transbordement conteneur : remap vers C01/C02/C03 uniquement
 *    si context.containerSizeToCxxMapping explicitement fourni.
 *
 * Ce module n'est branché à aucune Edge Function ni à aucun composant UI.
 * Il sera consommé au Lot C (ou ultérieur) après GO CTO séparé.
 */

import type {
  PadAliasCandidate,
  PadAliasKind,
  PadBlockingGap,
  PadCanonicalRateFamily,
  PadClassificationSource,
  PadContainerSize,
  PadContainerSizeToCxx,
  PadDesignationMatchCandidate,
  PadHsToNstMapping,
  PadNstRuleCandidate,
  ResolvePadContext,
  ResolvePadInput,
  ResolvePadOutput,
} from "./types";
import {
  findInvoiceLabelAlias,
  INVOICE_LABEL_RECOGNIZED_WARNING,
  INVOICE_LABEL_UNMAPPED_WARNING,
  PORT_TAX_ALIAS_WARNING,
} from "./invoiceLabelAliases";

const CANONICAL_FAMILY: PadCanonicalRateFamily = "DROIT_PASSAGE";

/** Catégories PAD reconnues (T01..T14, P01..P05, C01..C03). */
const KNOWN_PAD_CATEGORIES: ReadonlySet<string> = new Set([
  "T01", "T02", "T03", "T04", "T05", "T06", "T07",
  "T08", "T09", "T10", "T11", "T12", "T13", "T14",
  "P01", "P02", "P03", "P04", "P05",
  "C01", "C02", "C03",
]);

const TRANSIT_OPS = new Set(["TRANSIT_IMPORT", "TRANSIT_EXPORT", "TRANSBORDEMENT"]);

/* -------------------------------------------------------------------------- */
/* Helpers internes purs                                                       */
/* -------------------------------------------------------------------------- */

function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toString()
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
}

function isKnownCategory(cat: string | null | undefined): boolean {
  if (!cat) return false;
  return KNOWN_PAD_CATEGORIES.has(cat.toUpperCase());
}

function uniqueCategories(items: { pad_category: string }[]): string[] {
  const set = new Set<string>();
  for (const it of items) set.add(it.pad_category.toUpperCase());
  return Array.from(set);
}

interface BaseSkeleton {
  operation_type: ResolvePadInput["operation_type"];
  cargo_type: ResolvePadInput["cargo_type"];
  container_size: PadContainerSize;
}

function makeOutput(
  base: BaseSkeleton,
  patch: {
    classification: string | null;
    confidence: number;
    source: PadClassificationSource;
    reason: string;
    needs_human_review: boolean;
    blocking_gap: PadBlockingGap;
    warnings: string[];
  },
): ResolvePadOutput {
  return {
    canonical_rate_family: CANONICAL_FAMILY,
    classification: patch.classification,
    operation_type: base.operation_type ?? null,
    cargo_type: base.cargo_type ?? null,
    container_size: base.container_size ?? null,
    confidence: patch.confidence,
    source: patch.source,
    reason: patch.reason,
    needs_human_review: patch.needs_human_review,
    blocking_gap: patch.blocking_gap,
    warnings: patch.warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Resolver principal                                                          */
/* -------------------------------------------------------------------------- */

export function resolvePadClassification(
  input: ResolvePadInput,
  context: ResolvePadContext = {},
): ResolvePadOutput {
  const warnings: string[] = [];

  const base: BaseSkeleton = {
    operation_type: input.operation_type ?? null,
    cargo_type: input.cargo_type ?? null,
    container_size: input.container_size ?? null,
  };

  /* ---- 0. Détection libellé facture (informatif, jamais classifiant) ---- */
  const invoiceAlias = findInvoiceLabelAlias(input.invoice_label ?? null);
  if (invoiceAlias) {
    if (invoiceAlias.normalized_label === "port_tax") {
      warnings.push(PORT_TAX_ALIAS_WARNING);
    } else {
      warnings.push(INVOICE_LABEL_RECOGNIZED_WARNING);
    }
  } else if (input.invoice_label && normalize(input.invoice_label).length > 0) {
    warnings.push(INVOICE_LABEL_UNMAPPED_WARNING);
  }

  /* ---- 1. Préchecks structurels (ops/cargo) ---- */
  if (!input.operation_type) {
    return makeOutput(base, {
      classification: null,
      confidence: 0,
      source: "none",
      reason: "operation_type manquant ; impossible de cibler une ligne port_tariffs.",
      needs_human_review: true,
      blocking_gap: "pricing.operation_type_required",
      warnings,
    });
  }
  if (!input.cargo_type) {
    return makeOutput(base, {
      classification: null,
      confidence: 0,
      source: "none",
      reason: "cargo_type manquant ; impossible de cibler une ligne port_tariffs.",
      needs_human_review: true,
      blocking_gap: "pricing.cargo_type_required",
      warnings,
    });
  }

  /* ---- 2. operator_confirmed ---- */
  const known = input.known_pad_category?.toUpperCase().trim() ?? "";
  if (known) {
    if (!isKnownCategory(known)) {
      return makeOutput(base, {
        classification: null,
        confidence: 0,
        source: "none",
        reason: `known_pad_category="${known}" inconnue (hors T01..T14/P01..P05/C01..C03).`,
        needs_human_review: true,
        blocking_gap: "pricing.pad_classification_needs_review",
        warnings,
      });
    }

    // Cas spécial T13 transit/transbordement conteneur
    if (
      known === "T13" &&
      base.cargo_type === "CONTENEUR" &&
      TRANSIT_OPS.has(String(base.operation_type))
    ) {
      return resolveT13TransitContainer(base, context, warnings);
    }

    return makeOutput(base, {
      classification: known,
      confidence: 1.0,
      source: "operator_confirmed",
      reason: `Catégorie PAD ${known} confirmée par opérateur (priorité absolue).`,
      needs_human_review: false,
      blocking_gap: null,
      warnings,
    });
  }

  /* ---- 3. validated_alias (désignation OU invoice_label) ---- */
  const aliasMatches = matchValidatedAliases(input, context);
  if (aliasMatches.length > 0) {
    const cats = uniqueCategories(aliasMatches);
    if (cats.length > 1) {
      return makeOutput(base, {
        classification: null,
        confidence: 0,
        source: "none",
        reason: `Collision d'alias validés vers plusieurs catégories : ${cats.join(", ")}.`,
        needs_human_review: true,
        blocking_gap: "pricing.pad_classification_needs_review",
        warnings,
      });
    }
    const cat = cats[0];
    const kindList = Array.from(new Set(aliasMatches.map((a) => a.alias_kind)));
    return makeOutput(base, {
      classification: cat,
      confidence: 0.9,
      source: "validated_alias",
      reason: `Alias validé (${kindList.join("+")}) → ${cat}.`,
      needs_human_review: false,
      blocking_gap: null,
      warnings,
    });
  }

  /* ---- 4. hs_to_nst (mapping explicite injecté) ---- */
  const hsResult = matchHsToNst(input, context);
  if (hsResult.matched) {
    if (!hsResult.unique || !hsResult.pad_category) {
      return makeOutput(base, {
        classification: null,
        confidence: 0,
        source: "none",
        reason:
          hsResult.unique === false
            ? "Mapping HS/CN/NHM → NST non unique : revue opérateur requise."
            : "Mapping HS/CN/NHM → NST trouvé mais aucune règle PAD validée associée.",
        needs_human_review: true,
        blocking_gap: "pricing.pad_classification_needs_review",
        warnings,
      });
    }
    return makeOutput(base, {
      classification: hsResult.pad_category,
      confidence: 0.85,
      source: "hs_to_nst",
      reason: `Mapping ${hsResult.source_kind?.toUpperCase()} ${hsResult.source_code} → NST ${hsResult.nst_code} → PAD ${hsResult.pad_category}.`,
      needs_human_review: false,
      blocking_gap: null,
      warnings,
    });
  }

  /* ---- 5. nst_rule direct ---- */
  const nstResult = matchNstRule(input, context);
  if (nstResult) {
    const cats = uniqueCategories(nstResult.rules);
    if (cats.length > 1) {
      return makeOutput(base, {
        classification: null,
        confidence: 0,
        source: "none",
        reason: `Plusieurs règles NST candidates pour ${input.nst_code} : ${cats.join(", ")}.`,
        needs_human_review: true,
        blocking_gap: "pricing.pad_classification_needs_review",
        warnings,
      });
    }
    const cat = cats[0];
    const requiresValidation = nstResult.rules.some(
      (r) => r.requires_operator_validation,
    );
    return makeOutput(base, {
      classification: cat,
      confidence: requiresValidation ? 0.5 : 0.8,
      source: "nst_rule",
      reason: `Règle NST ${nstResult.rules[0].nst_level} ${input.nst_code} → ${cat}${requiresValidation ? " (TO_CONFIRM)" : ""}.`,
      needs_human_review: requiresValidation,
      blocking_gap: requiresValidation ? "pricing.pad_classification_needs_review" : null,
      warnings,
    });
  }

  /* ---- 6. designation_match ---- */
  const desMatches = matchDesignation(input, context);
  if (desMatches.length > 0) {
    const cats = Array.from(
      new Set(desMatches.map((d) => d.pad_category_candidate.toUpperCase())),
    );
    if (cats.length > 1) {
      return makeOutput(base, {
        classification: null,
        confidence: 0,
        source: "none",
        reason: `Plusieurs catégories candidates depuis désignation : ${cats.join(", ")}.`,
        needs_human_review: true,
        blocking_gap: "pricing.pad_classification_needs_review",
        warnings,
      });
    }
    return makeOutput(base, {
      classification: cats[0],
      confidence: 0.7,
      source: "designation_match",
      reason: `Match désignation validé → ${cats[0]}.`,
      needs_human_review: false,
      blocking_gap: null,
      warnings,
    });
  }

  /* ---- 7. ai_suggestion (jamais OFFICIAL) ---- */
  const ai = (input.ai_suggestion ?? "").toString().toUpperCase().trim();
  if (ai && isKnownCategory(ai)) {
    return makeOutput(base, {
      classification: ai,
      confidence: 0.5,
      source: "ai_suggestion",
      reason: `Suggestion IA (${ai}) — validation opérateur requise.`,
      needs_human_review: true,
      blocking_gap: "pricing.pad_classification_needs_review",
      warnings,
    });
  }

  /* ---- 8. none + gap ---- */
  // Si on a HS ou NST en input mais aucun mapping fourni → demander HS/NST exploitable
  const hasHsOrNst =
    !!input.hs_code || !!input.cn_code || !!input.nhm_code || !!input.nst_code;
  if (hasHsOrNst) {
    return makeOutput(base, {
      classification: null,
      confidence: 0,
      source: "none",
      reason:
        "Codes HS/CN/NHM/NST fournis mais aucun mapping explicite résolu. Mapping de référence requis.",
      needs_human_review: true,
      blocking_gap: "pricing.hs_or_nst_required",
      warnings,
    });
  }

  return makeOutput(base, {
    classification: null,
    confidence: 0,
    source: "none",
    reason:
      "Aucune source ne permet de déterminer la catégorie PAD. Confirmation opérateur requise.",
    needs_human_review: true,
    blocking_gap: "pricing.pad_category_required",
    warnings,
  });
}

/* -------------------------------------------------------------------------- */
/* Sous-fonctions                                                              */
/* -------------------------------------------------------------------------- */

function resolveT13TransitContainer(
  base: BaseSkeleton,
  context: ResolvePadContext,
  warnings: string[],
): ResolvePadOutput {
  const size = base.container_size;
  if (size === null || size === undefined || size === "") {
    return makeOutput(base, {
      classification: null,
      confidence: 0,
      source: "none",
      reason:
        "T13 transit/transbordement conteneur : taille conteneur requise pour mapper vers C01/C02/C03.",
      needs_human_review: true,
      blocking_gap: "pricing.container_size_required_for_T13_transit",
      warnings,
    });
  }
  const mapping = context.containerSizeToCxxMapping ?? [];
  const hit = mapping.find(
    (m: PadContainerSizeToCxx) => String(m.container_size) === String(size),
  );
  if (!hit) {
    return makeOutput(base, {
      classification: null,
      confidence: 0,
      source: "none",
      reason: `T13 transit/transbordement conteneur : aucun mapping taille ${size} → Cxx fourni en contexte. Lovable n'invente pas C01/C02/C03.`,
      needs_human_review: true,
      blocking_gap: "pricing.pad_classification_needs_review",
      warnings,
    });
  }
  return makeOutput(base, {
    classification: hit.classification,
    confidence: 0.95,
    source: "operator_confirmed",
    reason: `T13 transit/transbordement conteneur : taille ${size} → ${hit.classification} (mapping fourni en contexte).`,
    needs_human_review: false,
    blocking_gap: null,
    warnings,
  });
}

function matchValidatedAliases(
  input: ResolvePadInput,
  context: ResolvePadContext,
): PadAliasCandidate[] {
  const aliases = context.aliases ?? [];
  if (aliases.length === 0) return [];

  const designation = normalize(input.designation);
  const invoice = normalize(input.invoice_label);

  const matches: PadAliasCandidate[] = [];
  for (const a of aliases) {
    if (!a.is_validated) continue;
    if (!isKnownCategory(a.pad_category)) continue;
    const term = normalize(a.normalized_term);
    if (!term) continue;
    if (a.alias_kind === "designation" && designation && designation === term) {
      matches.push(a);
    } else if (
      (a.alias_kind === "invoice_label" || a.alias_kind === "carrier_label") &&
      invoice &&
      invoice === term
    ) {
      // Garde-fou : un invoice_label ne peut JAMAIS classifier seul.
      // On l'ignore comme source de classification.
      // (Il a déjà ajouté un warning DROIT_PASSAGE dans le préchecks.)
      continue;
    }
  }
  return matches;
}

interface HsResult {
  matched: boolean;
  unique?: boolean;
  pad_category?: string | null;
  source_code?: string;
  source_kind?: PadHsToNstMapping["source_kind"];
  nst_code?: string;
}

function matchHsToNst(
  input: ResolvePadInput,
  context: ResolvePadContext,
): HsResult {
  const mappings = context.hsToNstMapping ?? [];
  if (mappings.length === 0) return { matched: false };

  const candidates: { code: string; kind: PadHsToNstMapping["source_kind"] }[] = [];
  if (input.hs_code) candidates.push({ code: input.hs_code, kind: "hs" });
  if (input.cn_code) candidates.push({ code: input.cn_code, kind: "cn" });
  if (input.nhm_code) candidates.push({ code: input.nhm_code, kind: "nhm" });

  for (const c of candidates) {
    const hits = mappings.filter(
      (m) => m.source_kind === c.kind && m.source_code === c.code,
    );
    if (hits.length === 0) continue;
    // Le mapping fournit lui-même `is_unique` ; on respecte le contrat appelant.
    const unique = hits.length === 1 && hits[0].is_unique;
    return {
      matched: true,
      unique,
      pad_category: unique ? hits[0].pad_category : null,
      source_code: c.code,
      source_kind: c.kind,
      nst_code: hits[0].nst_code,
    };
  }
  return { matched: false };
}

function matchNstRule(
  input: ResolvePadInput,
  context: ResolvePadContext,
): { rules: PadNstRuleCandidate[] } | null {
  if (!input.nst_code) return null;
  const rules = (context.nstRules ?? []).filter(
    (r) => r.nst_code === input.nst_code,
  );
  if (rules.length === 0) return null;
  // Ne garder que les catégories PAD valides (filtre défensif)
  const valid = rules.filter((r) => isKnownCategory(r.pad_category));
  if (valid.length === 0) return null;
  return { rules: valid };
}

function matchDesignation(
  input: ResolvePadInput,
  context: ResolvePadContext,
): PadDesignationMatchCandidate[] {
  const desc = normalize(input.designation);
  if (!desc) return [];
  const matches = (context.designationMatches ?? []).filter(
    (d) =>
      d.is_validated &&
      isKnownCategory(d.pad_category_candidate) &&
      normalize(d.normalized_term) === desc,
  );
  return matches;
}

// re-export pour confort de tests
export type { PadAliasKind };
