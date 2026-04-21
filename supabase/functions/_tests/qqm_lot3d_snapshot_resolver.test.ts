/**
 * Lot 3D-1 — Tests du résolveur QQM snapshot.
 *
 * Pure function imported directly from generate-quotation-version/index.ts.
 * Note: importing index.ts charge `Deno.serve(...)` mais ne l'exécute pas tant
 * qu'aucune requête n'arrive — sûr pour les tests unitaires sur le helper.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveSnapshotQualification } from "../generate-quotation-version/index.ts";

const toConfirmLine = { service_code: "THC_EXPORT", source: { type: "TO_CONFIRM" } };
const okLine = { service_code: "SEA_FREIGHT", source: { type: "catalogue_sodatra" } };

Deno.test("absent + sans TO_CONFIRM → firm", () => {
  const r = resolveSnapshotQualification(undefined, [okLine]);
  assertEquals(r.level, "firm");
  assertEquals(r.reasons, []);
  assertEquals(r.firmTotalPolicy, "all_included");
});

Deno.test("firm explicite + sans TO_CONFIRM → firm", () => {
  const r = resolveSnapshotQualification(
    { level: "firm", reasons: [], firmTotalPolicy: "all_included" },
    [okLine],
  );
  assertEquals(r.level, "firm");
});

Deno.test("absent + avec TO_CONFIRM → provisional + reason", () => {
  const r = resolveSnapshotQualification(undefined, [okLine, toConfirmLine]);
  assertEquals(r.level, "provisional");
  assertEquals(r.firmTotalPolicy, "excludes_reserved_items");
  assertEquals(r.reasons.some((x) => x.code === "RATE_PENDING_CONFIRMATION"), true);
});

Deno.test("firm + avec TO_CONFIRM → upgrade provisional + reason", () => {
  const r = resolveSnapshotQualification(
    { level: "firm", reasons: [], firmTotalPolicy: "all_included" },
    [toConfirmLine],
  );
  assertEquals(r.level, "provisional");
  assertEquals(r.firmTotalPolicy, "excludes_reserved_items");
  assertEquals(r.reasons.some((x) => x.code === "RATE_PENDING_CONFIRMATION"), true);
});

Deno.test("provisional (DDP) sans TO_CONFIRM → préservé tel quel", () => {
  const r = resolveSnapshotQualification(
    {
      level: "provisional",
      reasons: [{ code: "MISSING_CARGO_VALUE", message: "Cargo value manquante" }],
      firmTotalPolicy: "excludes_reserved_items",
    },
    [okLine],
  );
  assertEquals(r.level, "provisional");
  assertEquals(r.reasons.length, 1);
  assertEquals(r.reasons[0].code, "MISSING_CARGO_VALUE");
});

Deno.test("provisional + TO_CONFIRM → merge RATE_PENDING_CONFIRMATION", () => {
  const r = resolveSnapshotQualification(
    {
      level: "provisional",
      reasons: [{ code: "MISSING_CARGO_VALUE", message: "x" }],
      firmTotalPolicy: "excludes_reserved_items",
    },
    [toConfirmLine],
  );
  assertEquals(r.level, "provisional");
  assertEquals(r.reasons.length, 2);
  assertEquals(r.reasons.some((x) => x.code === "RATE_PENDING_CONFIRMATION"), true);
  assertEquals(r.reasons.some((x) => x.code === "MISSING_CARGO_VALUE"), true);
});

Deno.test("partial + TO_CONFIRM → partial préservé + merge reason", () => {
  const r = resolveSnapshotQualification(
    {
      level: "partial",
      reasons: [{ code: "PARTIAL_SCOPE", message: "Scope partiel" }],
      firmTotalPolicy: "excludes_reserved_items",
    },
    [toConfirmLine],
  );
  assertEquals(r.level, "partial");
  assertEquals(r.reasons.some((x) => x.code === "PARTIAL_SCOPE"), true);
  assertEquals(r.reasons.some((x) => x.code === "RATE_PENDING_CONFIRMATION"), true);
});

Deno.test("partial sans TO_CONFIRM → partial préservé", () => {
  const r = resolveSnapshotQualification(
    { level: "partial", reasons: [{ code: "PARTIAL_SCOPE", message: "x" }], firmTotalPolicy: "excludes_reserved_items" },
    [okLine],
  );
  assertEquals(r.level, "partial");
  assertEquals(r.reasons.length, 1);
});

Deno.test("source string TO_CONFIRM (legacy shape) → détecté", () => {
  const r = resolveSnapshotQualification(undefined, [{ service_code: "X", source: "TO_CONFIRM" }]);
  assertEquals(r.level, "provisional");
});

Deno.test("dédup reason : provisional déjà avec RATE_PENDING_CONFIRMATION → pas de doublon", () => {
  const r = resolveSnapshotQualification(
    {
      level: "provisional",
      reasons: [{ code: "RATE_PENDING_CONFIRMATION", message: "déjà là" }],
      firmTotalPolicy: "excludes_reserved_items",
    },
    [toConfirmLine],
  );
  assertEquals(r.reasons.length, 1);
});
