import { describe, expect, it } from "vitest";
import { resolveImoFromUn } from "../../supabase/functions/_shared/imo-un-resolution.ts";
import { IMDG_UN_NUMBERS_BY_CLASS, IMDG_UN_REFERENCE } from "../../supabase/functions/_shared/imo-un-reference.ts";

describe("IMO-UN-AUTO — classification principale sourcée", () => {
  it.each(["UN3536", "un 3536", "3536", 3536])("déduit la classe 9 du numéro GoTrans %s", (un) => {
    const result = resolveImoFromUn(un);
    expect(result.status).toBe("DERIVED");
    expect(result.unNumber).toBe("UN3536");
    expect(result.imdgClass).toBe("9");
    expect(result.source).toBe(IMDG_UN_REFERENCE);
  });

  it.each([
    ["UN1203", "3"], ["UN1005", "2.3"], ["UN1789", "8"],
    ["UN3480", "9"], ["UN3090", "9"], ["UN3551", "9"],
    ["UN0004", "1.1"], ["UN0336", "1.4"],
  ])("classe %s sans confondre risque principal et subsidiaire", (un, cls) => {
    expect(resolveImoFromUn(un).imdgClass).toBe(cls);
  });

  it("conserve le groupe de compatibilité des explosifs dans la référence", () => {
    expect(resolveImoFromUn("0004").referenceClass).toBe("1.1D");
  });

  it("confirme une classe déclarée concordante et bloque une contradiction", () => {
    expect(resolveImoFromUn("3536", "classe 9").status).toBe("CONFIRMED");
    const conflict = resolveImoFromUn("3536", "3");
    expect(conflict.status).toBe("CONFLICT");
    expect(conflict.imdgClass).toBeNull();
    expect(conflict.message).toContain("classe 3");
  });

  it.each(["0190", "1950", "2037"])("ne devine pas la division de UN%s", (un) => {
    expect(resolveImoFromUn(un).status).toBe("NEEDS_DIVISION");
    expect(resolveImoFromUn(un).imdgClass).toBeNull();
  });

  it("accepte uniquement une division déclarée compatible avec la classe générale", () => {
    expect(resolveImoFromUn("1950", "2.1")).toMatchObject({ status: "DECLARED", imdgClass: "2.1" });
    expect(resolveImoFromUn("0190", "1.4")).toMatchObject({ status: "DECLARED", imdgClass: "1.4" });
    expect(resolveImoFromUn("1950", "3")).toMatchObject({ status: "CONFLICT", imdgClass: null });
  });

  it("ne confond pas numéro inconnu, classe déclarée et absence de danger", () => {
    expect(resolveImoFromUn("9999")).toMatchObject({ status: "UNKNOWN_UN", imdgClass: null, source: null });
    expect(resolveImoFromUn("9999", "9")).toMatchObject({ status: "UNKNOWN_UN", imdgClass: "9", source: null });
    expect(resolveImoFromUn(null, "9")).toMatchObject({ status: "DECLARED", imdgClass: "9", source: null });
    expect(resolveImoFromUn(null)).toMatchObject({ status: "MISSING", imdgClass: null });
  });

  it.each([["UN0000", null], ["3536/3480", null], ["3536", "9A"], ["3536", "inconnu"], ["3536", "2"]])(
    "refuse un format invalide sans masquer la valeur déclarée : %s / %s", (un, cls) => {
      expect(resolveImoFromUn(un, cls)).toMatchObject({ status: "INVALID", imdgClass: null });
    },
  );

  it("couvre exactement les 2347 numéros de la projection BAM, sans doublon ni division inventée", () => {
    const seen = new Set<string>();
    const unresolved: string[] = [];
    for (const [rawClass, numbers] of Object.entries(IMDG_UN_NUMBERS_BY_CLASS)) {
      for (const un of numbers.split(" ")) {
        expect(un).toMatch(/^\d{4}$/);
        expect(seen.has(un), `doublon UN${un}`).toBe(false);
        seen.add(un);
        const result = resolveImoFromUn(un);
        expect(result.referenceClass).toBe(rawClass);
        if (!result.imdgClass) unresolved.push(un);
        else expect(result.status).toBe("DERIVED");
      }
    }
    expect(seen.size).toBe(2347);
    expect(unresolved.sort()).toEqual(["0190", "1950", "2037"]);
  });
});
