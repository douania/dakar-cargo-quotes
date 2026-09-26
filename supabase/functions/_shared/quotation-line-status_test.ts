import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isToConfirmLine, lotSubtotalLabel, versionLineBreakdown } from "./quotation-line-status.ts";

const known = { category: "AGENCY", amount: 200000, source: { type: "fee_rule" } };
const unknown = { category: "SURVEY", amount: null, source: { type: "TO_CONFIRM", reference: "P5:TO_CONFIRM" } };
const trueZero = { category: "EMPTY_RETURN", amount: 0, source: { type: "business_rule" } };

Deno.test("LINE STATUS: a line to confirm is never read as a free line", () => {
  assertEquals([isToConfirmLine(known), isToConfirmLine(unknown), isToConfirmLine(trueZero)], [false, true, false]);
  // Same tolerance as run-pricing's totals; reserve lines of the DDP guard stay covered.
  for (const l of [{ source: "TO_CONFIRM" }, { source: { type: "to_confirm+note" } }, { source: { type: "TO_CONFIRM:x" } },
    { type: "provisional_reserve" }, { category: "customs_reserve" }]) assertEquals(isToConfirmLine(l), true, JSON.stringify(l));
  for (const l of [null, 1, "TO_CONFIRM", {}, { source: { type: "OFFICIAL" } }]) assertEquals(isToConfirmLine(l), false, JSON.stringify(l));
});

Deno.test("LINE STATUS: stored version lines keep the distinction in the existing breakdown field", () => {
  // The table stores 0 for both; only the line to confirm carries the marker.
  assertEquals(versionLineBreakdown({ ...unknown, amount: 0 }, null),
    { pricing_status: "to_confirm", amount_known: false, source: unknown.source });
  assertEquals(versionLineBreakdown(trueZero, null), null);
  assertEquals(versionLineBreakdown(known, null), null);
  // A priced line keeps its existing breakdown, whatever its shape.
  assertEquals(versionLineBreakdown(known, { detail: 1 }), { detail: 1 });
  assertEquals(versionLineBreakdown(trueZero, [{ step: "a" }]), [{ step: "a" }]);
  // A line to confirm keeps its existing breakdown and still carries the marker.
  assertEquals(versionLineBreakdown(unknown, { detail: 1 }), { detail: 1, pricing_status: "to_confirm", amount_known: false });
  assertEquals(versionLineBreakdown(unknown, [{ step: "a" }]),
    { pricing_status: "to_confirm", amount_known: false, source: unknown.source, details: [{ step: "a" }] });
});

Deno.test("LINE STATUS: a lot subtotal says when it excludes lines to confirm", () => {
  assertEquals(lotSubtotalLabel("200 000", "XOF", [known, trueZero]), "Sous-total: 200 000 XOF");
  assertEquals(lotSubtotalLabel("200 000", "XOF", [known, unknown, trueZero]), "Sous-total hors 1 poste à confirmer : 200 000 XOF");
  assertEquals(lotSubtotalLabel("200 000", "XOF", [unknown, { ...unknown }]), "Sous-total hors 2 postes à confirmer : 200 000 XOF");
});
