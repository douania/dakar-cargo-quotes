/**
 * PAD-RUNTIME-EXPAND / Lot B — Tests unitaires resolvePadClassification.
 *
 * Tests purs : aucun mock Supabase, aucun appel réseau, aucun DOM.
 */

import { describe, expect, it } from "vitest";
import { resolvePadClassification } from "../resolvePadClassification";
import type {
  PadAliasCandidate,
  PadNstRuleCandidate,
  ResolvePadContext,
  ResolvePadInput,
} from "../types";

const baseImportContainer: Pick<ResolvePadInput, "operation_type" | "cargo_type"> = {
  operation_type: "IMPORT",
  cargo_type: "CONTENEUR",
};

describe("resolvePadClassification — invariants", () => {
  it("retourne toujours canonical_rate_family = DROIT_PASSAGE", () => {
    const out = resolvePadClassification({});
    expect(out.canonical_rate_family).toBe("DROIT_PASSAGE");
  });
});

describe("resolvePadClassification — operator_confirmed", () => {
  it("1. known_pad_category=T12 prime sur tout", () => {
    const ctx: ResolvePadContext = {
      aliases: [
        {
          normalized_term: "riz",
          pad_category: "T01",
          alias_kind: "designation",
          is_validated: true,
        },
      ],
    };
    const out = resolvePadClassification(
      {
        ...baseImportContainer,
        known_pad_category: "T12",
        designation: "riz",
        ai_suggestion: "T05",
      },
      ctx,
    );
    expect(out.classification).toBe("T12");
    expect(out.source).toBe("operator_confirmed");
    expect(out.confidence).toBe(1);
    expect(out.needs_human_review).toBe(false);
    expect(out.blocking_gap).toBeNull();
  });

  it("2. known_pad_category=T10 retourne classification T10 (montant non géré ici)", () => {
    const out = resolvePadClassification({
      ...baseImportContainer,
      known_pad_category: "T10",
    });
    expect(out.classification).toBe("T10");
    expect(out.source).toBe("operator_confirmed");
    // Le helper ne calcule jamais de montant — pas de propriété 'amount' dans la sortie.
    expect((out as unknown as { amount?: unknown }).amount).toBeUndefined();
  });

  it("12. known_pad_category=P02 (pêche) : classification servie sans réduction automatique", () => {
    const out = resolvePadClassification({
      ...baseImportContainer,
      known_pad_category: "P02",
    });
    expect(out.classification).toBe("P02");
    expect(out.source).toBe("operator_confirmed");
    // Aucune mention de réduction
    expect(out.reason.toLowerCase()).not.toContain("reduction");
    expect(out.reason.toLowerCase()).not.toContain("réduction");
  });

  it("known_pad_category inconnu → needs_human_review", () => {
    const out = resolvePadClassification({
      ...baseImportContainer,
      known_pad_category: "ZZZ",
    });
    expect(out.classification).toBeNull();
    expect(out.needs_human_review).toBe(true);
    expect(out.blocking_gap).toBe("pricing.pad_classification_needs_review");
  });
});

describe("resolvePadClassification — préchecks structurels", () => {
  it("3. operation_type manquant → pricing.operation_type_required", () => {
    const out = resolvePadClassification({
      cargo_type: "CONTENEUR",
      known_pad_category: "T12",
    });
    expect(out.blocking_gap).toBe("pricing.operation_type_required");
    expect(out.classification).toBeNull();
    expect(out.needs_human_review).toBe(true);
  });

  it("4. cargo_type manquant → pricing.cargo_type_required", () => {
    const out = resolvePadClassification({
      operation_type: "IMPORT",
      known_pad_category: "T12",
    });
    expect(out.blocking_gap).toBe("pricing.cargo_type_required");
    expect(out.classification).toBeNull();
    expect(out.needs_human_review).toBe(true);
  });
});

describe("resolvePadClassification — invoice_label (jamais classifiant)", () => {
  it("5. 'taxe de port' confirme DROIT_PASSAGE mais ne donne PAS de classification", () => {
    const out = resolvePadClassification({
      ...baseImportContainer,
      invoice_label: "Taxe de port",
    });
    expect(out.canonical_rate_family).toBe("DROIT_PASSAGE");
    expect(out.classification).toBeNull();
    expect(out.warnings).toContain("invoice_label_recognized_as_droit_passage");
    expect(out.blocking_gap).toBe("pricing.pad_category_required");
  });

  it("6. 'PORT_TAX' ne retourne JAMAIS canonical_rate_family PORT_TAX et ajoute warning spécifique", () => {
    const out = resolvePadClassification({
      ...baseImportContainer,
      invoice_label: "PORT_TAX",
    });
    expect(out.canonical_rate_family).toBe("DROIT_PASSAGE");
    expect((out.canonical_rate_family as string)).not.toBe("PORT_TAX");
    expect(out.warnings).toContain("port_tax_alias_treated_as_droit_passage");
  });

  it("15. invoice_label inconnu → warning invoice_label_unmapped (non bloquant à lui seul)", () => {
    const out = resolvePadClassification({
      ...baseImportContainer,
      invoice_label: "Some unknown carrier label XYZ",
    });
    expect(out.warnings).toContain("invoice_label_unmapped");
    // le blocage vient de l'absence de catégorie, pas du libellé inconnu
    expect(out.blocking_gap).toBe("pricing.pad_category_required");
  });

  it("invoice_label fourni en context.aliases ne peut JAMAIS classifier seul", () => {
    const ctx: ResolvePadContext = {
      aliases: [
        {
          normalized_term: "taxe de port",
          pad_category: "T05",
          alias_kind: "invoice_label",
          is_validated: true,
        },
      ],
    };
    const out = resolvePadClassification(
      {
        ...baseImportContainer,
        invoice_label: "Taxe de port",
      },
      ctx,
    );
    expect(out.classification).toBeNull();
    expect(out.source).not.toBe("validated_alias");
  });
});

describe("resolvePadClassification — validated_alias désignation", () => {
  it("7. alias désignation validé → source validated_alias", () => {
    const ctx: ResolvePadContext = {
      aliases: [
        {
          normalized_term: "riz",
          pad_category: "T01",
          alias_kind: "designation",
          is_validated: true,
        },
      ],
    };
    const out = resolvePadClassification(
      { ...baseImportContainer, designation: "Riz" },
      ctx,
    );
    expect(out.source).toBe("validated_alias");
    expect(out.classification).toBe("T01");
    expect(out.needs_human_review).toBe(false);
  });

  it("8. collision multi-catégories → needs_human_review", () => {
    const aliases: PadAliasCandidate[] = [
      {
        normalized_term: "graines",
        pad_category: "T05",
        alias_kind: "designation",
        is_validated: true,
      },
      {
        normalized_term: "graines",
        pad_category: "T08",
        alias_kind: "designation",
        is_validated: true,
      },
    ];
    const out = resolvePadClassification(
      { ...baseImportContainer, designation: "graines" },
      { aliases },
    );
    expect(out.classification).toBeNull();
    expect(out.needs_human_review).toBe(true);
    expect(out.blocking_gap).toBe("pricing.pad_classification_needs_review");
  });

  it("alias non validé est ignoré", () => {
    const ctx: ResolvePadContext = {
      aliases: [
        {
          normalized_term: "x",
          pad_category: "T01",
          alias_kind: "designation",
          is_validated: false,
        },
      ],
    };
    const out = resolvePadClassification(
      { ...baseImportContainer, designation: "x" },
      ctx,
    );
    expect(out.source).not.toBe("validated_alias");
  });
});

describe("resolvePadClassification — nst_rule", () => {
  it("9. NST rule candidate avec requires_operator_validation=true → needs_human_review", () => {
    const rules: PadNstRuleCandidate[] = [
      {
        nst_level: "group",
        nst_code: "01.1",
        pad_category: "T01",
        confidence: 0.7,
        requires_operator_validation: true,
        validation_status: "candidate",
      },
    ];
    const out = resolvePadClassification(
      { ...baseImportContainer, nst_code: "01.1" },
      { nstRules: rules },
    );
    expect(out.source).toBe("nst_rule");
    expect(out.classification).toBe("T01");
    expect(out.needs_human_review).toBe(true);
    expect(out.confidence).toBeLessThanOrEqual(0.5);
  });

  it("NST rule validée (sans confirmation requise) → pas de needs_human_review", () => {
    const rules: PadNstRuleCandidate[] = [
      {
        nst_level: "group",
        nst_code: "02.1",
        pad_category: "T08",
        confidence: 0.95,
        requires_operator_validation: false,
        validation_status: "validated",
      },
    ];
    const out = resolvePadClassification(
      { ...baseImportContainer, nst_code: "02.1" },
      { nstRules: rules },
    );
    expect(out.source).toBe("nst_rule");
    expect(out.needs_human_review).toBe(false);
  });
});

describe("resolvePadClassification — ai_suggestion", () => {
  it("10. IA seule → source=ai_suggestion, needs_human_review=true, confidence<=0.5", () => {
    const out = resolvePadClassification({
      ...baseImportContainer,
      ai_suggestion: "T05",
    });
    expect(out.source).toBe("ai_suggestion");
    expect(out.needs_human_review).toBe(true);
    expect(out.confidence).toBeLessThanOrEqual(0.5);
    expect(out.classification).toBe("T05");
  });

  it("IA inconnue → ignorée", () => {
    const out = resolvePadClassification({
      ...baseImportContainer,
      ai_suggestion: "ZZZ",
    });
    expect(out.source).not.toBe("ai_suggestion");
    expect(out.classification).toBeNull();
  });
});

describe("resolvePadClassification — T13 transit conteneur", () => {
  it("11. T13 transit conteneur sans container_size → blocking_gap container_size_required_for_T13_transit", () => {
    const out = resolvePadClassification({
      operation_type: "TRANSIT_IMPORT",
      cargo_type: "CONTENEUR",
      known_pad_category: "T13",
    });
    expect(out.classification).toBeNull();
    expect(out.needs_human_review).toBe(true);
    expect(out.blocking_gap).toBe(
      "pricing.container_size_required_for_T13_transit",
    );
  });

  it("T13 transit conteneur avec container_size mais SANS mapping en context → needs_human_review (pas d'invention)", () => {
    const out = resolvePadClassification({
      operation_type: "TRANSBORDEMENT",
      cargo_type: "CONTENEUR",
      known_pad_category: "T13",
      container_size: 20,
    });
    expect(out.classification).toBeNull();
    expect(out.needs_human_review).toBe(true);
    expect(out.blocking_gap).toBe("pricing.pad_classification_needs_review");
  });

  it("T13 transit conteneur avec container_size ET mapping explicite → classification C0x", () => {
    const out = resolvePadClassification(
      {
        operation_type: "TRANSIT_EXPORT",
        cargo_type: "CONTENEUR",
        known_pad_category: "T13",
        container_size: 40,
      },
      {
        containerSizeToCxxMapping: [
          { container_size: 20, classification: "C01" },
          { container_size: 40, classification: "C02" },
        ],
      },
    );
    expect(out.classification).toBe("C02");
    expect(out.needs_human_review).toBe(false);
  });
});

describe("resolvePadClassification — propriétés générales", () => {
  it("13. idempotence : mêmes inputs deux fois → même output", () => {
    const input: ResolvePadInput = {
      ...baseImportContainer,
      known_pad_category: "T12",
      designation: "riz",
      invoice_label: "Taxe de port",
    };
    const a = resolvePadClassification(input);
    const b = resolvePadClassification(input);
    expect(a).toEqual(b);
  });

  it("14. BLANK_IN_PDF : la sortie ne contient jamais de propriété montant et n'invente pas 0", () => {
    const out = resolvePadClassification({
      operation_type: "EXPORT",
      cargo_type: "CONVENTIONNEL",
      known_pad_category: "T13",
    });
    // Cas T13 EXPORT/CONVENTIONNEL est BLANK_IN_PDF dans le barème.
    // Le helper retourne la classification mais ne touche pas aux montants.
    const keys = Object.keys(out);
    expect(keys).not.toContain("amount");
    expect(keys).not.toContain("amount_fcfa_per_tonne");
    // Le 0 n'est jamais inventé : le helper renvoie classification, pas montant.
    expect(out.classification).toBe("T13");
  });

  it("HS code fourni sans mapping context → gap pricing.hs_or_nst_required", () => {
    const out = resolvePadClassification({
      ...baseImportContainer,
      hs_code: "1006300000",
    });
    expect(out.blocking_gap).toBe("pricing.hs_or_nst_required");
    expect(out.classification).toBeNull();
    expect(out.needs_human_review).toBe(true);
  });

  it("HS code mappé via context.hsToNstMapping unique + pad_category → source=hs_to_nst", () => {
    const out = resolvePadClassification(
      { ...baseImportContainer, hs_code: "1006300000" },
      {
        hsToNstMapping: [
          {
            source_code: "1006300000",
            source_kind: "hs",
            nst_code: "01.1",
            nst_level: "group",
            pad_category: "T01",
            is_unique: true,
          },
        ],
      },
    );
    expect(out.source).toBe("hs_to_nst");
    expect(out.classification).toBe("T01");
  });

  it("Aucun signal → gap pricing.pad_category_required", () => {
    const out = resolvePadClassification(baseImportContainer);
    expect(out.blocking_gap).toBe("pricing.pad_category_required");
    expect(out.classification).toBeNull();
    expect(out.needs_human_review).toBe(true);
  });
});
