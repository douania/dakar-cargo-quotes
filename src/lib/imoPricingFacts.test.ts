import { describe, it, expect } from "vitest";
import { resolveImoPricingFacts, scopeImoFactsForLot } from "../../supabase/functions/_shared/imo-pricing-facts.ts";
import { buildFeeCaseContextFromFacts } from "../../supabase/functions/_shared/fee-case-facts.ts";
import { resolveImoTerminalRule } from "../../supabase/functions/_shared/imo-terminal-rules.ts";

const un = { fact_key: "cargo.un_number", value_text: "UN3536" };
const cls = { fact_key: "cargo.imo_class", value_text: "9" };
const dg = { fact_key: "cargo.dangerous_goods", value_text: "YES" };
const no = { ...dg, value_text: "NO" };

describe("conversion partagée dossier / honoraires / séjour", () => {
  it("déduit la classe et le danger sans changer les faits client", () => {
    const facts = Object.freeze([Object.freeze({ ...un })]);
    expect(resolveImoPricingFacts(facts)).toMatchObject({ dangerousGoods: true, blockers: [], classification: { imdgClass: "9", status: "DERIVED" } });
    expect(facts).toEqual([un]);
  });
  it.each([[un, { ...cls, value_text: "3" }], [un, no]])("bloque une contradiction ONU/classe ou ONU/non-DG", (...facts) => {
    expect(resolveImoPricingFacts(facts)).toMatchObject({ dangerousGoods: null, blockers: ["IMO_CLASSIFICATION_CONFLICT"] });
  });
  it.each(["UN9999", "UN1950", "UN0000"])("ne tarife pas automatiquement un numéro non résolu %s", value_text => {
    expect(resolveImoPricingFacts([{ ...un, value_text }]).blockers).toEqual(["IMO_CLASSIFICATION_REQUIRED"]);
  });
  it("alimente les honoraires et le séjour avec la même classe dérivée", () => {
    const factsMap = new Map([[un.fact_key, un]]);
    const context = buildFeeCaseContextFromFacts({ factsMap, requestType: "SEA_FCL_IMPORT", asOfDate: "2026-09-12" });
    expect(context.dangerousGoods).toBe(true);
    const imo = resolveImoPricingFacts([un]);
    const storage = resolveImoTerminalRule([{
      imdg_class: "9", un_scope: "ALL", storage_regime: "MAX_3_DAYS", storage_max_days: 3,
      pad_prior_approval: "YES", firefighter_supervision: false, transshipment_max_days: 7,
    }], imo.classification.imdgClass, imo.classification.unNumber);
    expect(storage).toMatchObject({ status: "RESOLVED", storageMaxDays: 3, padPriorApproval: "YES" });
  });
  it("ne donne pas une condition d'honoraires ferme sur une contradiction", () => {
    const factsMap = new Map([un, no].map(f => [f.fact_key, f]));
    expect(buildFeeCaseContextFromFacts({ factsMap, requestType: "SEA_FCL_IMPORT", asOfDate: "2026-09-12" }).dangerousGoods).toBeNull();
  });
  it("ne réécrit pas la précédence DG-1 des dossiers sans numéro ONU", () => {
    expect(resolveImoPricingFacts([no, cls]).dangerousGoods).toBe(false);
    expect(resolveImoPricingFacts([]).dangerousGoods).toBeNull();
  });
});

describe("isolation ONU par lot", () => {
  it("bloque un ONU global sans classification du lot", () => {
    const scoped = scopeImoFactsForLot([un, cls, dg], []);
    expect(scoped).toEqual({ facts: [], blockers: ["IMO_LOT_CLASSIFICATION_REQUIRED"] });
  });
  it("un lot déclaré dangereux doit encore préciser son ONU ou sa classe", () => {
    expect(scopeImoFactsForLot([un, cls, dg], [{ key: dg.fact_key, value: "YES" }]).blockers)
      .toEqual(["IMO_LOT_CLASSIFICATION_REQUIRED"]);
  });
  it("un lot explicitement non dangereux ne reprend pas l'ONU ou la classe globale", () => {
    const scoped = scopeImoFactsForLot([un, cls, no], [{ key: no.fact_key, value: "NO" }]);
    expect(scoped).toEqual({ facts: [no], blockers: [] });
    expect(resolveImoPricingFacts(scoped.facts).dangerousGoods).toBe(false);
  });
  it("un ONU de lot différent ne reprend pas l'ancienne classe ni le NO global", () => {
    const lotUn = { ...un, value_text: "UN1203" };
    const scoped = scopeImoFactsForLot([lotUn, cls, no], [{ key: un.fact_key, value: "UN1203" }]);
    expect(resolveImoPricingFacts(scoped.facts)).toMatchObject({ dangerousGoods: true, blockers: [], classification: { imdgClass: "3" } });
  });
  it("l'override honoraires de lot, même vide, prime sur les faits du dossier", () => {
    const base = { factsMap: new Map([[un.fact_key, un]]), requestType: "SEA_FCL_IMPORT", asOfDate: "2026-09-12" };
    expect(buildFeeCaseContextFromFacts({ ...base, override: { imo_facts: [no] } }).dangerousGoods).toBe(false);
    expect(buildFeeCaseContextFromFacts({ ...base, override: { imo_facts: [] } }).dangerousGoods).toBeNull();
  });
});
