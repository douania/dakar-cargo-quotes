/**
 * Phase P1-A1 — Contrat front des hypothèses de scénario.
 *
 * Tests purs : aucun mock Supabase, aucun appel réseau, aucun DOM.
 * Verrouillent ce que l'UI a le droit de proposer et ce qu'elle envoie ;
 * l'autorité reste la RPC service_role-only et les contraintes de la table.
 */

import { describe, expect, it } from "vitest";
import {
  allowedActionsForStatus,
  ASSUMPTION_OPERATIONS,
  buildAssumptionRequestBody,
  formatAssumptionValue,
  isMutableStatus,
  isRealIsoDate,
  isValidScopeKey,
  parseAssumptionValueInput,
  type AssumptionDraft,
} from "./scenarioAssumptions";

const CASE_ID = "11111111-1111-1111-1111-111111111111";
const ASSUMPTION_ID = "22222222-2222-2222-2222-222222222222";
const KEY = "idem-key-0001";

function draft(overrides: Partial<AssumptionDraft> = {}): AssumptionDraft {
  return {
    statement: "Poids brut estimé à 12 tonnes",
    basis: "Analogie avec le dossier précédent",
    assumptionType: "weight",
    valueType: "number",
    valueInput: "12000",
    scopeKey: "case",
    assumedFactKey: "cargo.weight_kg",
    gapKey: "",
    sourceType: "operator_guidance",
    riskLevel: "medium",
    clientVisible: false,
    ...overrides,
  };
}

describe("actions autorisées", () => {
  it("n'expose de transition que depuis le statut active", () => {
    expect(allowedActionsForStatus("active")).toEqual(["revise", "confirm_client", "refute"]);
    for (const status of ["client_confirmed", "refuted", "superseded", "promoted_to_fact"]) {
      expect(allowedActionsForStatus(status)).toEqual([]);
      expect(isMutableStatus(status)).toBe(false);
    }
    expect(isMutableStatus("active")).toBe(true);
  });

  it("n'expose jamais la promotion ni la suppression", () => {
    const everything = [
      ...ASSUMPTION_OPERATIONS,
      ...allowedActionsForStatus("active"),
    ];
    for (const op of everything) {
      expect(op).not.toMatch(/promot|delete|remove|price|total/i);
    }
    expect([...ASSUMPTION_OPERATIONS]).toEqual([
      "create",
      "revise",
      "confirm_client",
      "refute",
    ]);
  });
});

describe("valeur typée", () => {
  it("convertit chaque type vers une représentation unique", () => {
    expect(parseAssumptionValueInput("number", " 12000 ")).toEqual({ ok: true, value: 12000 });
    expect(parseAssumptionValueInput("number", "-3.5")).toEqual({ ok: true, value: -3.5 });
    expect(parseAssumptionValueInput("text", "  8704.21 ")).toEqual({ ok: true, value: "8704.21" });
    expect(parseAssumptionValueInput("boolean", true)).toEqual({ ok: true, value: true });
    expect(parseAssumptionValueInput("boolean", "false")).toEqual({ ok: true, value: false });
    expect(parseAssumptionValueInput("date", "2026-08-28")).toEqual({ ok: true, value: "2026-08-28" });
    expect(parseAssumptionValueInput("json", '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("refuse les saisies incohérentes avec le type déclaré", () => {
    expect(parseAssumptionValueInput("number", "douze").ok).toBe(false);
    expect(parseAssumptionValueInput("number", "").ok).toBe(false);
    expect(parseAssumptionValueInput("number", "Infinity").ok).toBe(false);
    expect(parseAssumptionValueInput("text", "   ").ok).toBe(false);
    expect(parseAssumptionValueInput("date", "28/08/2026").ok).toBe(false);
    expect(parseAssumptionValueInput("date", "2026-02-30").ok).toBe(false);
    expect(parseAssumptionValueInput("json", "pas du json").ok).toBe(false);
    expect(parseAssumptionValueInput("json", '"chaine"').ok).toBe(false);
    expect(parseAssumptionValueInput("json", "12").ok).toBe(false);
    expect(parseAssumptionValueInput("boolean", "peut-être").ok).toBe(false);
  });

  it("valide les dates calendaires réelles", () => {
    expect(isRealIsoDate("2024-02-29")).toBe(true);
    expect(isRealIsoDate("2026-02-29")).toBe(false);
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("2026-04-31")).toBe(false);
  });

  it("affiche les scalaires sans dump JSON", () => {
    expect(formatAssumptionValue("boolean", true)).toBe("Oui");
    expect(formatAssumptionValue("boolean", false)).toBe("Non");
    expect(formatAssumptionValue("text", "8704.21")).toBe("8704.21");
    expect(formatAssumptionValue("date", "2026-08-28")).toBe("2026-08-28");
    expect(formatAssumptionValue("json", { a: 1 })).toBe('{"a":1}');
    expect(formatAssumptionValue(null, null)).toBe("—");
  });
});

describe("périmètre", () => {
  it("accepte les formes documentées et refuse les identifiants techniques", () => {
    expect(isValidScopeKey("case")).toBe(true);
    expect(isValidScopeKey("lot:2")).toBe(true);
    expect(isValidScopeKey("commodity:bus")).toBe(true);
    expect(isValidScopeKey("service_transport")).toBe(true);

    expect(isValidScopeKey("Lot:2")).toBe(false);
    expect(isValidScopeKey("lot 2")).toBe(false);
    expect(isValidScopeKey("")).toBe(false);
    expect(isValidScopeKey("a".repeat(121))).toBe(false);
    // Arbitrage CTO n°4 : jamais un identifiant de ligne dans le périmètre.
    expect(isValidScopeKey(`line:${ASSUMPTION_ID}`)).toBe(false);
  });
});

describe("construction de la requête", () => {
  it("produit un payload de création complet", () => {
    const result = buildAssumptionRequestBody(CASE_ID, "create", KEY, draft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      case_id: CASE_ID,
      operation: "create",
      idempotency_key: KEY,
      statement: "Poids brut estimé à 12 tonnes",
      assumed_value_type: "number",
      assumed_value: 12000,
      client_visible: false,
      scope_key: "case",
      assumption_type: "weight",
      assumed_fact_key: "cargo.weight_kg",
    });
    expect("gap_key" in result.body).toBe(false);
  });

  it("n'émet jamais d'identité, de statut ni de lien de supersession", () => {
    const bodies = [
      buildAssumptionRequestBody(CASE_ID, "create", KEY, draft()),
      buildAssumptionRequestBody(CASE_ID, "revise", KEY, draft(), ASSUMPTION_ID),
      buildAssumptionRequestBody(CASE_ID, "confirm_client", KEY, null, ASSUMPTION_ID),
      buildAssumptionRequestBody(CASE_ID, "refute", KEY, null, ASSUMPTION_ID),
    ];
    const forbidden = [
      "id",
      "created_by",
      "resolved_by",
      "actor_user_id",
      "user_id",
      "status",
      "resolved_at",
      "promoted_fact_id",
      "superseded_by_assumption_id",
      "supersedes_assumption_id",
      "request_fingerprint",
    ];
    for (const result of bodies) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const key of forbidden) {
        expect(Object.keys(result.body)).not.toContain(key);
      }
    }
  });

  it("n'envoie que le statut pour confirm_client et refute", () => {
    for (const operation of ["confirm_client", "refute"] as const) {
      const result = buildAssumptionRequestBody(CASE_ID, operation, KEY, draft(), ASSUMPTION_ID);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(Object.keys(result.body).sort()).toEqual([
        "assumption_id",
        "case_id",
        "idempotency_key",
        "operation",
      ]);
    }
  });

  it("n'envoie aucun champ de périmètre sur une révision", () => {
    const result = buildAssumptionRequestBody(
      CASE_ID,
      "revise",
      KEY,
      draft({ scopeKey: "lot:2", gapKey: "cargo.weight_kg" }),
      ASSUMPTION_ID,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const key of ["scope_key", "assumption_type", "gap_key", "assumed_fact_key"]) {
      expect(Object.keys(result.body)).not.toContain(key);
    }
    expect(result.body.assumption_id).toBe(ASSUMPTION_ID);
  });

  it("exige une cible pour toute opération autre que la création", () => {
    for (const operation of ["revise", "confirm_client", "refute"] as const) {
      expect(buildAssumptionRequestBody(CASE_ID, operation, KEY, draft()).ok).toBe(false);
    }
  });

  it("refuse un dossier, une clé ou un contenu invalides", () => {
    expect(buildAssumptionRequestBody("not-a-uuid", "create", KEY, draft()).ok).toBe(false);
    expect(buildAssumptionRequestBody(CASE_ID, "create", "court", draft()).ok).toBe(false);
    expect(buildAssumptionRequestBody(CASE_ID, "create", "x".repeat(129), draft()).ok).toBe(false);
    expect(buildAssumptionRequestBody(CASE_ID, "create", KEY, draft({ statement: "  " })).ok).toBe(false);
    expect(
      buildAssumptionRequestBody(CASE_ID, "create", KEY, draft({ statement: "x".repeat(2001) })).ok,
    ).toBe(false);
    expect(
      buildAssumptionRequestBody(CASE_ID, "create", KEY, draft({ valueInput: "douze" })).ok,
    ).toBe(false);
    expect(
      buildAssumptionRequestBody(CASE_ID, "create", KEY, draft({ scopeKey: "Lot 2" })).ok,
    ).toBe(false);
  });

  it("reste fail-closed sur la visibilité client", () => {
    const closed = buildAssumptionRequestBody(CASE_ID, "create", KEY, draft());
    expect(closed.ok).toBe(true);
    expect(closed.body?.client_visible).toBe(false);

    const open = buildAssumptionRequestBody(CASE_ID, "create", KEY, draft({ clientVisible: true }));
    expect(open.ok).toBe(true);
    expect(open.body?.client_visible).toBe(true);
  });
});
