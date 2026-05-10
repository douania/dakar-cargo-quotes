// Smoke tests Deno pour le resolver PAD partagé (Lot C).
// Exécution : via supabase--test_edge_functions ou `deno test`.

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolvePadClassification } from "./resolvePadClassification.ts";

Deno.test("known_pad_category=T12 → operator_confirmed", () => {
  const out = resolvePadClassification({
    designation: "ciment",
    invoice_label: null,
    hs_code: null,
    nst_code: null,
    operation_type: "IMPORT",
    cargo_type: "CONTENEUR",
    container_size: null,
    known_pad_category: "T12",
  });
  assertEquals(out.classification, "T12");
  assertEquals(out.source, "operator_confirmed");
  assertEquals(out.canonical_rate_family, "DROIT_PASSAGE");
});

Deno.test("aucun input PAD → source none + blocking_gap", () => {
  const out = resolvePadClassification({
    designation: null,
    invoice_label: null,
    hs_code: null,
    nst_code: null,
    operation_type: "IMPORT",
    cargo_type: "CONTENEUR",
    container_size: null,
    known_pad_category: null,
  });
  assertEquals(out.classification, null);
  assertEquals(out.source, "none");
  assert(out.blocking_gap !== null, "blocking_gap doit être défini");
});

Deno.test("designation matchant un alias validé → validated_alias", () => {
  // Lot C.1 : on fournit la désignation déjà normalisée legacy (comme le fait
  // le shadow block dans run-pricing après normalizePricingText). Le test
  // exige strictement validated_alias + T12, plus de repli sur "none".
  const out = resolvePadClassification(
    {
      designation: "materiaux de construction",
      invoice_label: null,
      hs_code: null,
      nst_code: null,
      operation_type: "IMPORT",
      cargo_type: "CONTENEUR",
      container_size: null,
      known_pad_category: null,
    },
    {
      aliases: [
        {
          pad_category: "T12",
          alias_kind: "designation",
          normalized_term: "materiaux de construction",
          is_validated: true,
        },
      ],
    },
  );
  assertEquals(out.source, "validated_alias");
  assertEquals(out.classification, "T12");
});
