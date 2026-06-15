/**
 * DCQ-EMAIL-ATTACHMENT-GATE-P0-3 — Gate des pièces jointes décisives.
 *
 * PORTÉE LIMITÉE :
 *   Teste UNIQUEMENT les helpers purs de build-case-puzzle :
 *     - isDecisiveAttachmentCandidate / isAttachmentAnalysisBlocking
 *     - decideDecisiveAttachmentGapAction (idempotence / résolution)
 *   Aucun appel DB, aucun IMAP. La création/résolution réelle du gap
 *   (I/O Supabase) reste dans le handler serve et n'est pas couverte ici.
 *
 * Exécution :
 *   deno test --no-check --config supabase/functions/deno.json \
 *     supabase/functions/_tests/build_case_puzzle_attachment_gate.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Empêche le serveur de démarrer lors de l'import (pattern existant build-case-puzzle).
Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const {
  isDecisiveAttachmentCandidate,
  isAttachmentAnalysisBlocking,
  decideDecisiveAttachmentGapAction,
} = await import("../build-case-puzzle/index.ts");

type Att = {
  filename?: string | null;
  content_type?: string | null;
  extracted_text?: string | null;
  extracted_data?: unknown;
  is_analyzed?: boolean | null;
};

// ─── 1. PDF cotation non analysé → bloque ────────────────────────────
Deno.test("1 - PDF cotation non analyse bloque", () => {
  const att: Att = {
    filename: "Cotation_maritime_2026.pdf",
    content_type: "application/pdf",
    extracted_text: null,
    extracted_data: null,
    is_analyzed: false,
  };
  assertEquals(isDecisiveAttachmentCandidate(att), true);
  assertEquals(isAttachmentAnalysisBlocking(att), true);
});

// ─── 2. Excel tariff non analysé → bloque ────────────────────────────
Deno.test("2 - Excel tariff non analyse bloque", () => {
  const att: Att = {
    filename: "tariff_grid_q3.xlsx",
    content_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extracted_text: null,
    extracted_data: null,
    is_analyzed: false,
  };
  assertEquals(isDecisiveAttachmentCandidate(att), true);
  assertEquals(isAttachmentAnalysisBlocking(att), true);
});

// ─── 3. logo / image001 / signature → ne bloque pas ──────────────────
Deno.test("3 - Assets non documentaires ne bloquent pas", () => {
  const logo: Att = { filename: "logo.png", content_type: "image/png", is_analyzed: false };
  const inline: Att = { filename: "image001.png", content_type: "image/png", is_analyzed: false };
  const sig: Att = { filename: "signature.jpg", content_type: "image/jpeg", is_analyzed: false };
  const tmp: Att = { filename: "~$draft.xlsx", content_type: "application/vnd.ms-excel", is_analyzed: false };

  for (const a of [logo, inline, sig, tmp]) {
    assertEquals(isDecisiveAttachmentCandidate(a), false, `candidate ${a.filename}`);
    assertEquals(isAttachmentAnalysisBlocking(a), false, `blocking ${a.filename}`);
  }
});

// ─── 4. Fichier décisif analysé avec extracted_text → ne bloque pas ──
Deno.test("4 - Decisif analyse avec texte ne bloque pas", () => {
  const withText: Att = {
    filename: "commercial_invoice.pdf",
    content_type: "application/pdf",
    extracted_text: "INVOICE No 12345 ... total 5000 USD",
    extracted_data: null,
    is_analyzed: true,
  };
  const withData: Att = {
    filename: "packing_list.pdf",
    content_type: "application/pdf",
    extracted_text: null,
    extracted_data: { extracted_info: { packages: 12 } },
    is_analyzed: true,
  };
  assertEquals(isDecisiveAttachmentCandidate(withText), true);
  assertEquals(isAttachmentAnalysisBlocking(withText), false);
  assertEquals(isAttachmentAnalysisBlocking(withData), false);

  // Variantes d'erreur explicite → bloque même si is_analyzed
  const errored: Att = {
    filename: "devis.pdf",
    content_type: "application/pdf",
    extracted_data: { type: "error", message: "parse failed" },
    is_analyzed: true,
  };
  const reimport: Att = {
    filename: "offre.pdf",
    content_type: "application/pdf",
    extracted_data: { requires_reimport: true },
    is_analyzed: true,
  };
  assertEquals(isAttachmentAnalysisBlocking(errored), true);
  assertEquals(isAttachmentAnalysisBlocking(reimport), true);
});

// ─── 5. Idempotence : gap déjà ouvert → pas de doublon (noop) ────────
Deno.test("5 - Idempotence: probleme + gap ouvert -> noop", () => {
  assertEquals(decideDecisiveAttachmentGapAction(2, true), "noop");
  // problème + pas de gap ouvert → create
  assertEquals(decideDecisiveAttachmentGapAction(2, false), "create");
});

// ─── 6. Résolution : plus de problème + gap ouvert → resolve ─────────
Deno.test("6 - Resolution: plus de probleme + gap ouvert -> resolve", () => {
  assertEquals(decideDecisiveAttachmentGapAction(0, true), "resolve");
  // plus de problème + pas de gap → noop
  assertEquals(decideDecisiveAttachmentGapAction(0, false), "noop");
});
