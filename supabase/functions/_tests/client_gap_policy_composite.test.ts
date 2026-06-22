// COMPOSITE-CARGO-GAPS-1 — couverture de la politique de gaps client pour les
// dossiers cargo composites (bus + autre marchandise type matériel médical).
//
// Module sous test : _shared/client-gap-policy.ts (pur, sans I/O).
// Aucune dépendance réseau ni Supabase.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const {
  isClientResolvableGap,
  buildClientQuestionsFromGaps,
  CLIENT_RESOLVABLE_GAP_KEYS,
} = await import("../_shared/client-gap-policy.ts");

// Clés émises par build-case-puzzle (detectCargoConflictGuards) pour le dossier
// GWC composite bus + conteneurs additionnels.
const COMPOSITE_GUARD_KEYS = [
  "cargo.pieces_count_conflict",
  "cargo.weight_total_confirmation",
  "cargo.value_conflict",
  "cargo.mixed_scope_confirmation",
];

// =====================================================================
// 0. Les 4 gaps de garde composites sont désormais client-resolvables
// =====================================================================
Deno.test("composite guard keys are client-resolvable", () => {
  for (const key of COMPOSITE_GUARD_KEYS) {
    assert(
      isClientResolvableGap(key),
      `${key} doit être client-resolvable`,
    );
    assert(
      CLIENT_RESOLVABLE_GAP_KEYS.has(key),
      `${key} doit être dans la whitelist`,
    );
  }
});

// =====================================================================
// 1. Dossier composite bus + medical → questions bus + médical générées
// =====================================================================
Deno.test("composite case produces bus + medical/other-cargo questions", () => {
  const gaps = [
    { gap_key: "cargo.hs_code" },
    { gap_key: "cargo.value" },
    ...COMPOSITE_GUARD_KEYS.map((k) => ({ gap_key: k })),
  ];
  const questions = buildClientQuestionsFromGaps(gaps);
  const joined = questions.join("\n");

  // Bloc bus : nombre de bus, 40'FR, un bus par 40'FR, châssis, valeur+devise.
  assert(/bus/i.test(joined), "doit mentionner les bus");
  assert(/40'FR/.test(joined), "doit demander le nombre de 40'FR");
  assert(/châssis/i.test(joined), "doit demander les numéros de châssis");

  // Bloc autre marchandise : contenu par conteneur, par article, non-DGR.
  assert(/conteneur additionnel/i.test(joined), "doit couvrir les conteneurs additionnels");
  assert(/par article/i.test(joined), "doit demander le détail par article");
  assert(/non-DGR/i.test(joined), "doit demander la confirmation non-DGR");
  assert(/packing list/i.test(joined), "doit demander la packing list");
});

// =====================================================================
// 2. Le 20' n'est PAS automatiquement qualifié médical
// =====================================================================
Deno.test("20ft container is not auto-qualified as medical", () => {
  const questions = buildClientQuestionsFromGaps([
    { gap_key: "cargo.mixed_scope_confirmation" },
  ]);
  const joined = questions.join("\n");

  // Ne doit jamais affirmer que le 20' contient du médical.
  assert(
    !/20'?\s*(?:ft)?[^.\n]*(?:contient|est)[^.\n]*médical/i.test(joined),
    "ne doit pas présumer que le 20' contient du matériel médical",
  );
  // Doit explicitement refuser la présomption d'identité de contenu.
  assert(
    /n'est pas présumé identique/i.test(joined),
    "doit indiquer que le contenu du 20' n'est pas présumé identique au 40'",
  );
});

// =====================================================================
// 3. Ancienne offre SODATRA (5 bus) n'est jamais citée comme source primaire
// =====================================================================
Deno.test("no question cites a previous SODATRA quotation as primary source", () => {
  const questions = buildClientQuestionsFromGaps(
    COMPOSITE_GUARD_KEYS.map((k) => ({ gap_key: k })),
  );
  const joined = questions.join("\n");

  // Aucune référence à un numéro d'offre antérieur, ni à "5 bus" présupposés.
  assert(!/0027/.test(joined), "ne doit pas citer l'offre N°0027");
  assert(!/\b5\s*bus/i.test(joined), "ne doit pas présupposer 5 bus");
  assert(!/\b15\b/.test(joined), "ne doit pas affirmer 15 comme un fait");
});

// =====================================================================
// 4. Les gaps HS10 et valeur restent présents
// =====================================================================
Deno.test("HS code and value questions are preserved", () => {
  const questions = buildClientQuestionsFromGaps([
    { gap_key: "cargo.hs_code" },
    { gap_key: "cargo.value" },
  ]);
  assertEquals(questions.length, 2);
  const joined = questions.join("\n");
  assert(/HS code/i.test(joined), "doit conserver la question HS");
  assert(/valeur commerciale/i.test(joined), "doit conserver la question valeur");
});

// =====================================================================
// 5. Pas de doublon si une clé de gap apparaît plusieurs fois
// =====================================================================
Deno.test("duplicate gap keys are deduplicated", () => {
  const questions = buildClientQuestionsFromGaps([
    { gap_key: "cargo.value_conflict" },
    { gap_key: "cargo.value_conflict" },
    { gap_key: "cargo.mixed_scope_confirmation" },
  ]);
  assertEquals(questions.length, 2);
});

// =====================================================================
// 6. Parité bilingue : les questions composites existent aussi en anglais
//    (la map EN a été ajoutée en amont — ne pas la laisser incomplète).
// =====================================================================
Deno.test("composite questions exist in EN with the same fact-safe framing", () => {
  const questions = buildClientQuestionsFromGaps(
    COMPOSITE_GUARD_KEYS.map((k) => ({ gap_key: k })),
    "en",
  );
  // Une question EN par clé composite (aucune ne tombe dans le vide).
  assertEquals(questions.length, COMPOSITE_GUARD_KEYS.length);
  const joined = questions.join("\n");
  assert(/non-DGR/.test(joined), "EN doit demander la confirmation non-DGR");
  assert(/per item/i.test(joined), "EN doit demander le détail par article");
  // Mêmes garde-fous fact-safe qu'en FR.
  assert(!/0027/.test(joined), "EN ne doit pas citer l'offre N°0027");
  assert(!/\b15\b/.test(joined), "EN ne doit pas affirmer 15 comme un fait");
  assert(
    /not presumed identical/i.test(joined),
    "EN doit indiquer que le 20' n'est pas présumé identique au 40'",
  );
});
