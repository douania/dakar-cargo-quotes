import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { provisionalServicePrice as price } from "./provisional-service-price.ts";
import { isToConfirmLine } from "./quotation-line-status.ts";

Deno.test("provisional price: missing and invalid amounts remain null explicit reserves", () => {
  for (const rate of [null, undefined, NaN, Infinity, "0"]) {
    const result = price(rate, "no_match");
    assertEquals(result, { amount: null, sourceType: "TO_CONFIRM" });
    assertEquals(isToConfirmLine({ amount: result.amount, source: { type: result.sourceType } }), true);
  }
});
Deno.test("provisional price: explicit zero and finite tariff amounts stay known", () => {
  for (const rate of [0, 3740]) {
    const result = price(rate, "catalogue_sodatra");
    assertEquals(result, { amount: rate, sourceType: "catalogue_sodatra" });
    assertEquals(isToConfirmLine({ amount: result.amount, source: { type: result.sourceType } }), false);
  }
  assertEquals(price(0, undefined), { amount: 0, sourceType: "price-service-lines" });
});
