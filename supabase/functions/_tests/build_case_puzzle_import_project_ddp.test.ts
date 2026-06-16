import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const { ASSUMPTION_RULES } = await import("../build-case-puzzle/index.ts");
const { SERVICE_PACKAGES } = await import(
  "../../../src/features/quotation/constants.ts"
);

// Mirror of the incoterm-aware switch in applyAssumptionRules (P3a / Package-DDP).
// Pure resolution: given the detected flow + incoterm, which package is injected?
function resolvePackage(flowType: string, incoterm: string): string {
  const upper = incoterm.toUpperCase();
  const ORIGIN_INCOTERMS_P3 = new Set(["EXW", "FCA", "FAS"]);
  let resolved = flowType;
  if (ORIGIN_INCOTERMS_P3.has(upper) && ASSUMPTION_RULES[`${flowType}_EXW`]) {
    resolved = `${flowType}_EXW`;
  } else if (upper === "DDP" && ASSUMPTION_RULES[`${flowType}_DDP`]) {
    resolved = `${flowType}_DDP`;
  }
  const rule = ASSUMPTION_RULES[resolved]?.find(
    (r: { key: string }) => r.key === "service.package",
  );
  return rule?.value ?? "";
}

Deno.test("IMPORT_PROJECT_DAP + DDP → DDP_PROJECT_IMPORT", () => {
  assertEquals(
    resolvePackage("IMPORT_PROJECT_DAP", "DDP"),
    "DDP_PROJECT_IMPORT",
  );
});

Deno.test("IMPORT_PROJECT_DAP + DAP stays DAP_PROJECT_IMPORT", () => {
  assertEquals(
    resolvePackage("IMPORT_PROJECT_DAP", "DAP"),
    "DAP_PROJECT_IMPORT",
  );
});

Deno.test("IMPORT_PROJECT_DAP_DDP rule expects DPI", () => {
  const rule = ASSUMPTION_RULES["IMPORT_PROJECT_DAP_DDP"];
  assert(rule, "IMPORT_PROJECT_DAP_DDP rule must exist");
  const dpi = rule.find(
    (r: { key: string }) => r.key === "regulatory.dpi_expected",
  );
  assertEquals(dpi?.value, "true");
});

Deno.test("AIR_IMPORT + DDP and SEA_LCL_IMPORT + DDP do not regress", () => {
  assertEquals(resolvePackage("AIR_IMPORT", "DDP"), "AIR_IMPORT_DDP");
  assertEquals(resolvePackage("SEA_LCL_IMPORT", "DDP"), "LCL_IMPORT_DDP");
});

Deno.test("SERVICE_PACKAGES exposes DDP_PROJECT_IMPORT services", () => {
  assert(
    Array.isArray(SERVICE_PACKAGES["DDP_PROJECT_IMPORT"]),
    "DDP_PROJECT_IMPORT must be defined in SERVICE_PACKAGES",
  );
  // Same service composition as DAP variant for this patch.
  assertEquals(
    SERVICE_PACKAGES["DDP_PROJECT_IMPORT"],
    SERVICE_PACKAGES["DAP_PROJECT_IMPORT"],
  );
});
