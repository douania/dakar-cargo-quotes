/**
 * DCQ-P0-INTAKE-ATOMIC-BATCH — tests PURS du constructeur de lot Intake.
 *
 * Aucun mock Supabase, aucun réseau : on vérifie que le payload unique envoyé
 * à set-intake-facts-batch conserve les régressions déjà corrigées (PHNX,
 * INT Nordic), la garde inland Dakar/Kaolack, la provenance honnête et
 * l'absence totale de valeur canonique null.
 */

import { describe, expect, it } from "vitest";
import { parseTextOverrides } from "./intakeTextOverrides";
import {
  buildIntakeBatchKey,
  buildIntakeFactBatch,
  MAX_SOURCE_EXCERPT,
  type IntakeBatchFact,
} from "./intakeFactBatch";

const CASE_ID = "0b4e2f6a-8f1d-4b6e-9a3c-2d5e7f901234";

/** Texte de régression PHNX, reproduit à l'identique. */
const PHNX_TEXT =
  "50 tonnes de sel en sacs de 25 kg, conditionnées dans deux conteneurs de 20 pieds.";

/** Texte de régression INT Nordic, reproduit à l'identique. */
const INT_NORDIC_TEXT = "1 pallet, 200 kgs / 80x60x75 cm / Non stackable, general cargo.";

/** Texte de régression P0-E — dossier mixte 20'/40' + livraison inland. */
const P0E_TEXT =
  "Cotation import maritime FCL en DAP. Port d'origine : Le Havre. Port de destination : Dakar. " +
  "Livraison finale : Mbour, Sénégal. Conteneurs : 1 x 20 pieds Dry et 1 x 40 pieds Dry.";

function factByKey(facts: IntakeBatchFact[], key: string): IntakeBatchFact | undefined {
  return facts.find((f) => f.fact_key === key);
}

/** Aucun null/undefined ne doit survivre à la sérialisation JSON du lot. */
function expectNoNullValues(facts: IntakeBatchFact[]) {
  const serialized = JSON.parse(JSON.stringify(facts)) as Array<Record<string, unknown>>;
  for (const fact of serialized) {
    const valueKeys = Object.keys(fact).filter((k) => k !== "fact_key");
    expect(valueKeys, `${fact.fact_key}: exactement une colonne de valeur`).toHaveLength(1);
    expect(fact[valueKeys[0]], `${fact.fact_key}: valeur définie`).not.toBeNull();
    expect(JSON.stringify(fact)).not.toContain(":null");
  }
}

describe("buildIntakeFactBatch — régression PHNX (2 x 20')", () => {
  const batch = buildIntakeFactBatch({
    caseId: CASE_ID,
    text: PHNX_TEXT,
    analysis: null,
    textOverrides: parseTextOverrides(PHNX_TEXT),
    hasExtractedDocument: false,
  });

  it("publie 2 conteneurs de 20 pieds, jamais type:null", () => {
    expect(factByKey(batch.facts, "cargo.container_count")?.value_number).toBe(2);
    expect(factByKey(batch.facts, "cargo.containers")?.value_json).toEqual([
      { type: "20'", quantity: 2 },
    ]);
    expect(factByKey(batch.facts, "cargo.container_type")?.value_text).toBe("20'");
  });

  it("dérive service.mode et routing.transport_mode avec la même provenance", () => {
    expect(factByKey(batch.facts, "service.mode")?.value_text).toBe("SEA_FCL_IMPORT");
    expect(factByKey(batch.facts, "routing.transport_mode")?.value_text).toBe("MARITIME");
    expect(batch.source_type).toBe("email_body");
  });

  it("ne porte aucune valeur canonique null", () => {
    expectNoNullValues(batch.facts);
  });
});

describe("buildIntakeFactBatch — régression INT Nordic (dimensions ≠ conteneurs)", () => {
  const batch = buildIntakeFactBatch({
    caseId: CASE_ID,
    text: INT_NORDIC_TEXT,
    analysis: null,
    textOverrides: parseTextOverrides(INT_NORDIC_TEXT),
    hasExtractedDocument: false,
  });

  it("n'invente AUCUNE donnée conteneur depuis 80x60x75 cm", () => {
    expect(factByKey(batch.facts, "cargo.container_count")).toBeUndefined();
    expect(factByKey(batch.facts, "cargo.containers")).toBeUndefined();
    expect(factByKey(batch.facts, "cargo.container_type")).toBeUndefined();
    expect(factByKey(batch.facts, "service.mode")).toBeUndefined();
  });

  it("un lot peut être vide : la création du dossier reste due", () => {
    expect(batch.facts.filter((f) => f.fact_key.startsWith("cargo."))).toHaveLength(0);
    expectNoNullValues(batch.facts);
  });
});

describe("buildIntakeFactBatch — dossier mixte 20'/40' + inland (P0-E)", () => {
  const overrides = parseTextOverrides(P0E_TEXT);
  const batch = buildIntakeFactBatch({
    caseId: CASE_ID,
    text: P0E_TEXT,
    analysis: { destination: "Dakar", weight_kg: 10000 },
    textOverrides: overrides,
    hasExtractedDocument: false,
  });

  it("publie les deux groupes typés sans type legacy mixte", () => {
    expect(factByKey(batch.facts, "cargo.container_count")?.value_number).toBe(2);
    expect(factByKey(batch.facts, "cargo.containers")?.value_json).toEqual([
      { type: "20' Dry", quantity: 1 },
      { type: "40' Dry", quantity: 1 },
    ]);
    expect(factByKey(batch.facts, "cargo.container_type")).toBeUndefined();
  });

  it("Dakar ne masque jamais Mbour : ville finale + POD distincts", () => {
    expect(factByKey(batch.facts, "routing.destination_city")?.value_text).toBe("Mbour");
    expect(factByKey(batch.facts, "routing.destination_port")?.value_text).toBe("Dakar");
    expect(factByKey(batch.facts, "routing.origin_port")?.value_text).toBe("Le Havre");
  });

  it("publie le poids issu de l'analyse", () => {
    expect(factByKey(batch.facts, "cargo.weight_kg")?.value_number).toBe(10000);
    expectNoNullValues(batch.facts);
  });
});

describe("buildIntakeFactBatch — garde inland sans extraction locale", () => {
  it("ne publie pas la destination IA quand requires_final_destination est vrai", () => {
    const text = "Door delivery required. Port of Discharge: Dakar Port.";
    const batch = buildIntakeFactBatch({
      caseId: CASE_ID,
      text,
      analysis: { destination: "Dakar" },
      textOverrides: parseTextOverrides(text),
      hasExtractedDocument: false,
    });
    expect(factByKey(batch.facts, "routing.destination_city")).toBeUndefined();
    expect(factByKey(batch.facts, "routing.destination_country")).toBeUndefined();
  });

  it("route un pays connu vers destination_country, pas destination_city", () => {
    const batch = buildIntakeFactBatch({
      caseId: CASE_ID,
      text: "Livraison à Bamako",
      analysis: { destination: "Mali" },
      textOverrides: {},
      hasExtractedDocument: false,
    });
    expect(factByKey(batch.facts, "routing.destination_country")?.value_text).toBe("Mali");
    expect(factByKey(batch.facts, "routing.destination_city")).toBeUndefined();
  });
});

describe("buildIntakeFactBatch — provenance honnête", () => {
  it("sans document analysé : email_body", () => {
    const batch = buildIntakeFactBatch({
      caseId: CASE_ID,
      text: PHNX_TEXT,
      analysis: null,
      textOverrides: parseTextOverrides(PHNX_TEXT),
      hasExtractedDocument: false,
    });
    expect(batch.source_type).toBe("email_body");
  });

  it("avec extraction document : attachment_extracted, y compris les dérivés", () => {
    const batch = buildIntakeFactBatch({
      caseId: CASE_ID,
      text: "Marchandise : pompes industrielles",
      analysis: {
        cargo_description: "Pompes industrielles",
        container_count: 3,
        container_type: "40' HC",
        weight_kg: 21000,
      },
      textOverrides: {},
      hasExtractedDocument: true,
    });
    expect(batch.source_type).toBe("attachment_extracted");
    // Le lot entier — dérivés compris — porte UNE provenance ; la confiance
    // est imposée côté serveur et n'apparaît nulle part dans le payload.
    expect(factByKey(batch.facts, "service.mode")?.value_text).toBe("SEA_FCL_IMPORT");
    expect(JSON.stringify(batch)).not.toContain("confidence");
    expect(JSON.stringify(batch)).not.toContain("manual_input");
  });
});

describe("buildIntakeFactBatch — clé d'idempotence et extrait bornés", () => {
  it("namespace la clé sur le dossier, format stable", () => {
    expect(buildIntakeBatchKey(CASE_ID)).toBe(`intake:${CASE_ID}:v1`);
    expect(buildIntakeBatchKey(CASE_ID)).toMatch(/^intake:[A-Za-z0-9._:-]{8,120}$/);
  });

  it("borne source_excerpt et n'invente aucun extrait quand le texte est vide", () => {
    const longText = "x".repeat(5000);
    const batch = buildIntakeFactBatch({
      caseId: CASE_ID,
      text: longText,
      analysis: null,
      textOverrides: {},
      hasExtractedDocument: false,
    });
    expect(batch.source_excerpt.length).toBeLessThanOrEqual(MAX_SOURCE_EXCERPT);
    const empty = buildIntakeFactBatch({
      caseId: CASE_ID,
      text: "   ",
      analysis: null,
      textOverrides: {},
      hasExtractedDocument: false,
    });
    expect(empty.source_excerpt).toBeNull();
  });

  it("transmet le workflow sans lui attribuer de confiance côté client", () => {
    const batch = buildIntakeFactBatch({
      caseId: CASE_ID,
      text: PHNX_TEXT,
      analysis: null,
      textOverrides: parseTextOverrides(PHNX_TEXT),
      hasExtractedDocument: false,
      workflowKey: "SEA_FCL_IMPORT",
    });
    expect(batch.workflow_key).toBe("SEA_FCL_IMPORT");
    expect(JSON.stringify(batch)).not.toContain("confidence");
  });

  it("cargo.containers recoupe toujours cargo.container_count", () => {
    const batch = buildIntakeFactBatch({
      caseId: CASE_ID,
      text: P0E_TEXT,
      analysis: null,
      textOverrides: parseTextOverrides(P0E_TEXT),
      hasExtractedDocument: false,
    });
    const count = factByKey(batch.facts, "cargo.container_count")?.value_number;
    const groups = factByKey(batch.facts, "cargo.containers")?.value_json as
      | Array<{ quantity: number }>
      | undefined;
    expect(groups?.reduce((acc, g) => acc + g.quantity, 0)).toBe(count);
  });
});
