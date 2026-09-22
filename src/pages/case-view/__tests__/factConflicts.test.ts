import { describe, expect, it } from "vitest";
import { factKeysForExplicitIssues } from "../factConflicts";

describe("factKeysForExplicitIssues", () => {
  it("traduit uniquement le conflit de poids PAD explicite", () => {
    expect([...factKeysForExplicitIssues(["PAD_GROUP_WEIGHT_CONFLICT"])]).toEqual([
      "cargo.weight_kg",
      "cargo.weight_per_container_kg",
    ]);
  });

  it("ignore les issues sans traduction et ne déduit aucun conflit", () => {
    expect([...factKeysForExplicitIssues(["PAD_CONFIRMATION_REQUIRED", "UNKNOWN_ISSUE"])]).toEqual([]);
  });
});