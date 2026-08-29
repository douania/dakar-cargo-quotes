/**
 * Phase P1-A3 — Contrat front de la promotion d'une hypothèse en fait.
 *
 * Tests purs : aucun mock Supabase, aucun appel réseau, aucun DOM.
 * Verrouillent ce que l'UI a le droit de proposer et ce qu'elle envoie ;
 * l'autorité reste l'Edge Function, la RPC service_role-only et les contraintes
 * de la table.
 */

import { describe, expect, it } from "vitest";
import {
  buildPromotionRequestBody,
  canPromote,
  findPromotableFactKey,
  formatCurrentFactValue,
  formatPromotedValue,
  buildPromotionSignature,
  PROMOTABLE_FACT_KEYS,
  PROMOTABLE_STATUSES,
  PROMOTABLE_VALUE_TYPES,
  PROMOTION_BASES,
  PROMOTION_BASIS_LABELS,
  promotableKeysFor,
  promotionBlockReason,
  type PromotionDraft,
} from "./factPromotion";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const ASSUMPTION_ID = "22222222-2222-4222-8222-222222222222";
const FACT_ID = "33333333-3333-4333-8333-333333333333";
const SCENARIO_ID = "44444444-4444-4444-8444-444444444444";
const SCOPE_HASH = "a".repeat(64);
const IDEM = "promote-key-0001";

function draft(overrides: Partial<PromotionDraft> = {}): PromotionDraft {
  return {
    assumptionId: ASSUMPTION_ID,
    assumptionStatus: "active",
    valueType: "number",
    value: 12000,
    assumedFactKey: "cargo.weight_kg",
    factKey: "cargo.weight_kg",
    basis: "document_evidence",
    attested: true,
    currentFact: null,
    scenario: null,
    ...overrides,
  };
}

describe("allowlist de promotion", () => {
  it("n'expose aucune clé monétaire, tarifaire ou à montant imbriqué", () => {
    for (const key of [
      "cargo.value",
      "cargo.caf_value",
      "cargo.freight_cost",
      "cargo.pad_rate_fcfa_per_ton",
      "cargo.freight_exchange_rate",
      "cargo.articles_detail",
      "cargo.containers",
      "service.overrides",
      "service.mode",
      "service.package",
    ]) {
      expect(findPromotableFactKey(key)).toBeNull();
    }
  });

  it("exclut les classifications à workflow dédié (HS, PAD)", () => {
    expect(findPromotableFactKey("cargo.hs_code")).toBeNull();
    expect(findPromotableFactKey("cargo.pad_category")).toBeNull();
  });

  it("ne connaît que les types text et number", () => {
    expect([...PROMOTABLE_VALUE_TYPES]).toEqual(["text", "number"]);
    for (const entry of PROMOTABLE_FACT_KEYS) {
      expect(PROMOTABLE_VALUE_TYPES).toContain(entry.valueType);
      expect(entry.label.trim()).not.toBe("");
    }
  });

  it("déclare une étiquette pour chaque base de promotion", () => {
    expect(PROMOTION_BASES).toHaveLength(5);
    for (const basis of PROMOTION_BASES) {
      expect(PROMOTION_BASIS_LABELS[basis]).toBeTruthy();
    }
  });
});

describe("clés proposables", () => {
  it("filtre par type de valeur", () => {
    const numbers = promotableKeysFor("number", "cargo.weight_kg");
    expect(numbers).toHaveLength(1);
    expect(numbers[0].valueType).toBe("number");

    const texts = promotableKeysFor("text", "routing.destination_city");
    expect(texts).toHaveLength(1);
    expect(texts[0].valueType).toBe("text");
  });

  it("ne propose rien pour un type non promouvable", () => {
    for (const t of ["boolean", "date", "json", null]) {
      expect(promotableKeysFor(t, null)).toHaveLength(0);
    }
  });

  it("ne propose aucune cible arbitraire quand l'hypothèse n'en déclare pas", () => {
    expect(promotableKeysFor("number", null)).toHaveLength(0);
    expect(promotableKeysFor("text", "   ")).toHaveLength(0);
  });

  it("verrouille la cible quand l'hypothèse a nommé son fait anticipé", () => {
    const keys = promotableKeysFor("number", "cargo.weight_kg");
    expect(keys).toHaveLength(1);
    expect(keys[0].factKey).toBe("cargo.weight_kg");
  });

  it("ne propose rien quand le fait anticipé n'est pas promouvable", () => {
    expect(promotableKeysFor("number", "cargo.value")).toHaveLength(0);
    expect(promotableKeysFor("text", "cargo.hs_code")).toHaveLength(0);
  });

  it("ne propose rien quand le type ne correspond pas au fait anticipé", () => {
    expect(promotableKeysFor("text", "cargo.weight_kg")).toHaveLength(0);
  });
});

describe("éligibilité et motif de refus", () => {
  it("n'autorise que active et client_confirmed", () => {
    expect([...PROMOTABLE_STATUSES]).toEqual(["active", "client_confirmed"]);
    expect(canPromote("active", "number", "cargo.weight_kg")).toBe(true);
    expect(canPromote("client_confirmed", "number", "cargo.weight_kg")).toBe(true);
    for (const status of ["refuted", "superseded", "promoted_to_fact"]) {
      expect(canPromote(status, "number", "cargo.weight_kg")).toBe(false);
    }
  });

  it("explique toujours pourquoi elle ne propose rien", () => {
    expect(promotionBlockReason("active", "number", "cargo.weight_kg")).toBeNull();
    expect(promotionBlockReason("active", "number", null)).toContain("aucun fait cible");
    expect(promotionBlockReason("promoted_to_fact", "number", null)).toContain("déjà promue");
    expect(promotionBlockReason("refuted", "number", null)).toContain("active ou confirmée");
    expect(promotionBlockReason("active", "json", null)).toContain("Texte ou Nombre");
    expect(promotionBlockReason("active", "number", "cargo.value")).toContain("monétaires");
  });
});

describe("construction du payload", () => {
  it("produit un corps complet et sans identité ni provenance", () => {
    const result = buildPromotionRequestBody(CASE_ID, IDEM, draft());
    expect(result.ok).toBe(true);
    const body = result.ok ? result.body : {};

    expect(body).toMatchObject({
      case_id: CASE_ID,
      assumption_id: ASSUMPTION_ID,
      idempotency_key: IDEM,
      fact_key: "cargo.weight_kg",
      promotion_basis: "document_evidence",
      attested: true,
      expected_assumption_status: "active",
      expected_value_type: "number",
      expected_value: 12000,
      expect_no_current_fact: true,
    });

    // Identité, état, provenance, confiance et valeur écrite appartiennent au
    // serveur : rien de tout cela ne doit partir d'ici.
    for (const forbidden of [
      "actor_user_id", "user_id", "created_by", "status", "confidence",
      "source_type", "value_text", "value_number", "value_json",
      "fact_category", "promoted_fact_id", "request_fingerprint",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
    // Aucune forme de masse.
    for (const batch of ["assumption_ids", "assumptions", "promote_all", "all", "batch", "bulk"]) {
      expect(body).not.toHaveProperty(batch);
    }
  });

  it("refuse sans attestation", () => {
    const result = buildPromotionRequestBody(CASE_ID, IDEM, draft({ attested: false }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("attestation");
  });

  it("refuse sans base de promotion", () => {
    const result = buildPromotionRequestBody(CASE_ID, IDEM, draft({ basis: null }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("base");
  });

  it("refuse une clé non promouvable", () => {
    for (const key of ["cargo.value", "cargo.hs_code", "cargo.articles_detail"]) {
      const result = buildPromotionRequestBody(CASE_ID, IDEM, draft({ factKey: key }));
      expect(result.ok).toBe(false);
    }
  });

  it("refuse un statut non promouvable", () => {
    for (const status of ["refuted", "superseded", "promoted_to_fact"]) {
      const result = buildPromotionRequestBody(
        CASE_ID, IDEM, draft({ assumptionStatus: status }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("refuse une valeur incompatible avec la clé", () => {
    expect(buildPromotionRequestBody(CASE_ID, IDEM, draft({ valueType: "text", value: "12000" })).ok)
      .toBe(false);
    expect(buildPromotionRequestBody(
      CASE_ID,
      IDEM,
      draft({
        factKey: "cargo.container_count",
        assumedFactKey: "cargo.container_count",
        value: 2.5,
      }),
    ).ok).toBe(false);
    expect(buildPromotionRequestBody(CASE_ID, IDEM, draft({ value: -1 })).ok).toBe(false);
    expect(buildPromotionRequestBody(CASE_ID, IDEM, draft({ value: Number.NaN })).ok).toBe(false);
  });

  it("respecte les vocabulaires fermés", () => {
    const okMode = buildPromotionRequestBody(CASE_ID, IDEM, draft({
      factKey: "routing.terminal_operation_mode", valueType: "text", value: "LOLO",
      assumedFactKey: "routing.terminal_operation_mode",
    }));
    expect(okMode.ok).toBe(true);

    const badMode = buildPromotionRequestBody(CASE_ID, IDEM, draft({
      factKey: "routing.terminal_operation_mode", valueType: "text", value: "RO-RO",
      assumedFactKey: "routing.terminal_operation_mode",
    }));
    expect(badMode.ok).toBe(false);
    expect(badMode.ok === false && badMode.message).toContain("LOLO");
  });

  it("borne la longueur d'une valeur textuelle", () => {
    const result = buildPromotionRequestBody(CASE_ID, IDEM, draft({
      factKey: "cargo.description",
      assumedFactKey: "cargo.description",
      valueType: "text",
      value: "x".repeat(501),
    }));
    expect(result.ok).toBe(false);
  });

  it("atteste le fait courant remplacé quand il y en a un", () => {
    const result = buildPromotionRequestBody(CASE_ID, IDEM, draft({
      currentFact: { id: FACT_ID, value_text: null, value_number: 9000, source_type: "ai_extraction" },
    }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.body).toMatchObject({
      expect_no_current_fact: false,
      expected_current_fact_id: FACT_ID,
    });
  });

  it("n'émet aucun identifiant de fait quand aucun n'a été affiché", () => {
    const result = buildPromotionRequestBody(CASE_ID, IDEM, draft({ currentFact: null }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.body.expect_no_current_fact).toBe(true);
    expect(result.ok && result.body).not.toHaveProperty("expected_current_fact_id");
  });

  it("fige le périmètre du scénario à sa révision exacte", () => {
    const result = buildPromotionRequestBody(CASE_ID, IDEM, draft({
      scenario: { scenarioId: SCENARIO_ID, scopeHash: SCOPE_HASH },
    }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.body).toMatchObject({
      scenario_id: SCENARIO_ID,
      expected_scope_hash: SCOPE_HASH,
    });

    const bad = buildPromotionRequestBody(CASE_ID, IDEM, draft({
      scenario: { scenarioId: SCENARIO_ID, scopeHash: "pas-un-hash" },
    }));
    expect(bad.ok).toBe(false);
  });

  it("refuse des identifiants ou une clé d'idempotence invalides", () => {
    expect(buildPromotionRequestBody("nope", IDEM, draft()).ok).toBe(false);
    expect(buildPromotionRequestBody(CASE_ID, IDEM, draft({ assumptionId: "nope" })).ok).toBe(false);
    expect(buildPromotionRequestBody(CASE_ID, "court", draft()).ok).toBe(false);
    expect(buildPromotionRequestBody(CASE_ID, "x".repeat(129), draft()).ok).toBe(false);
  });

  it("échoe la valeur VERBATIM, sans jamais la reformater", () => {
    // L'écho sert d'assertion d'égalité contre le ledger : le normaliser ici
    // produirait un conflit de valeur périmée impossible à résoudre.
    const result = buildPromotionRequestBody(CASE_ID, IDEM, draft({
      factKey: "cargo.description", valueType: "text", value: "  Bus 40 places  ",
      assumedFactKey: "cargo.description",
    }));
    expect(result.ok && result.body.expected_value).toBe("  Bus 40 places  ");

    const numeric = buildPromotionRequestBody(CASE_ID, IDEM, draft({ value: 12000.5 }));
    expect(numeric.ok && numeric.body.expected_value).toBe(12000.5);
  });

  it("réutilise la même signature pour le même geste logique et la change si l'attestation change", () => {
    const a = buildPromotionSignature(CASE_ID, draft());
    const b = buildPromotionSignature(CASE_ID, draft());
    const c = buildPromotionSignature(CASE_ID, draft({ basis: "operator_expertise" }));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

describe("rendu opérateur", () => {
  it("affiche la valeur exacte qui sera écrite", () => {
    expect(formatPromotedValue("number", 12000)).toBe((12000).toLocaleString("fr-FR"));
    expect(formatPromotedValue("text", "LOLO")).toBe("LOLO");
    expect(formatPromotedValue("text", null)).toBe("—");
  });

  it("affiche le fait courant remplacé, ou son absence", () => {
    expect(formatCurrentFactValue(null)).toContain("Aucun fait courant");
    expect(formatCurrentFactValue({
      id: FACT_ID, value_text: null, value_number: 9000, source_type: "ai_extraction",
    })).toBe((9000).toLocaleString("fr-FR"));
    expect(formatCurrentFactValue({
      id: FACT_ID, value_text: "CIF", value_number: null, source_type: "manual_input",
    })).toBe("CIF");
  });
});
