/**
 * CLIENT-REPLY-LANGUAGE-INVARIANT-1
 * Tests unitaires purs pour buildClientQuestionsFromGaps — support bilingue fr/en.
 *
 * Run: deno test supabase/functions/_tests/client_gap_policy_language.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildClientQuestionsFromGaps,
} from "../_shared/client-gap-policy.ts";

// ─── 1. Questions françaises par défaut ───────────────────────────────────────

Deno.test("1 - buildClientQuestionsFromGaps produit des questions en français par défaut", () => {
  const gaps = [
    { gap_key: "cargo.description" },
    { gap_key: "cargo.weight_kg" },
  ];
  const questions = buildClientQuestionsFromGaps(gaps);
  assertEquals(questions.length, 2);
  assertEquals(questions.some((q) => q.includes("désignation")), true);
  assertEquals(questions.some((q) => q.includes("poids")), true);
});

Deno.test("1b - buildClientQuestionsFromGaps language='fr' explicite produit du français", () => {
  const gaps = [{ gap_key: "routing.transport_mode" }, { gap_key: "cargo.hs_code" }];
  const questions = buildClientQuestionsFromGaps(gaps, "fr");
  assertEquals(questions.length, 2);
  assertEquals(questions.some((q) => q.includes("avion")), true);
  assertEquals(questions.some((q) => q.includes("douanier")), true);
});

// ─── 2. Questions anglaises ───────────────────────────────────────────────────

Deno.test("2 - buildClientQuestionsFromGaps produit des questions en anglais pour language='en'", () => {
  const gaps = [
    { gap_key: "cargo.description" },
    { gap_key: "cargo.weight_kg" },
  ];
  const questions = buildClientQuestionsFromGaps(gaps, "en");
  assertEquals(questions.length, 2);
  assertEquals(questions.some((q) => q.toLowerCase().includes("description")), true);
  assertEquals(questions.some((q) => q.toLowerCase().includes("weight")), true);
});

Deno.test("2b - questions anglaises pour routing et pricing", () => {
  const gaps = [
    { gap_key: "routing.transport_mode" },
    { gap_key: "pricing.pad_category" },
    { gap_key: "routing.origin_port" },
  ];
  const questions = buildClientQuestionsFromGaps(gaps, "en");
  assertEquals(questions.length, 3);
  assertEquals(questions.some((q) => q.toLowerCase().includes("air")), true);
  assertEquals(questions.some((q) => q.toLowerCase().includes("port handling")), true);
  assertEquals(questions.some((q) => q.toLowerCase().includes("departure")), true);
});

// ─── 3. Stabilité sort + dedupe ───────────────────────────────────────────────

Deno.test("3 - buildClientQuestionsFromGaps est stable (sort + dedupe)", () => {
  const gapsA = [
    { gap_key: "cargo.weight_kg" },
    { gap_key: "cargo.description" },
    { gap_key: "cargo.description" }, // doublon
  ];
  const gapsB = [
    { gap_key: "cargo.description" },
    { gap_key: "cargo.weight_kg" },
  ];
  const a = buildClientQuestionsFromGaps(gapsA);
  const b = buildClientQuestionsFromGaps(gapsB);
  // Même résultat quel que soit l'ordre en entrée ou les doublons
  assertEquals(a, b);
  // Exactement 2 questions (doublon éliminé)
  assertEquals(a.length, 2);
});

Deno.test("3b - stabilité sort + dedupe en anglais", () => {
  const gapsA = [
    { gap_key: "routing.destination_country" },
    { gap_key: "cargo.value" },
    { gap_key: "cargo.value" }, // doublon
  ];
  const gapsB = [
    { gap_key: "cargo.value" },
    { gap_key: "routing.destination_country" },
  ];
  const a = buildClientQuestionsFromGaps(gapsA, "en");
  const b = buildClientQuestionsFromGaps(gapsB, "en");
  assertEquals(a, b);
  assertEquals(a.length, 2);
});

// ─── 4. Fallback français si langue inconnue/non supportée ────────────────────

Deno.test("4 - buildClientQuestionsFromGaps retombe sur le français pour une langue inconnue", () => {
  const gaps = [{ gap_key: "cargo.description" }];
  // Langue non supportée → le ternaire (=== "en") est false → map française
  const questions = buildClientQuestionsFromGaps(gaps, "de" as unknown as "fr" | "en");
  assertEquals(questions.length, 1);
  assertEquals(questions[0].includes("désignation"), true);
});

Deno.test("4b - buildClientQuestionsFromGaps avec gap_key inconnu ne produit pas de question", () => {
  const gaps = [{ gap_key: "cargo.unknown_field" }];
  const qFr = buildClientQuestionsFromGaps(gaps, "fr");
  const qEn = buildClientQuestionsFromGaps(gaps, "en");
  assertEquals(qFr.length, 0);
  assertEquals(qEn.length, 0);
});
