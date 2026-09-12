import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  IMO_GOODS_GAP, imoGoodsEvidenceId, imoGoodsQuestion, recognizeImoGoods, syncImoGoodsRecognition,
  type ImoGoodsAssessment, type ImoGoodsSource, type ImoGoodsStore,
} from "./imo-goods-recognition.ts";

// Synthetic cargo, no customer identifiers or copied client email fixture.
const cargo = "Inquiry:\n1.8 battery units: 25t/unit, 20HQ SOC, UN3536\n2.7 machines: 12t/unit, 20HQ SOC\n3.2 x 40HQ COC (components): 8t/container";
const src = (body = cargo, trustedClient = true, id = "synthetic-source"): ImoGoodsSource => ({ id, body, trustedClient });
const recognize = (body: string) => recognizeImoGoods([src(body)])!;

Deno.test("IMO goods: binds only the row explicitly declaring ONU, derives class separately", () => {
  const result = recognize(cargo);
  assertEquals(result.status, "BOUND");
  assertEquals(result.groups.length, 3);
  assertEquals(result.groups.map(g => g.unNumbers), [["UN3536"], [], []]);
  assertEquals(result.groups.map(g => g.binding), ["BOUND", "UNSPECIFIED", "UNSPECIFIED"]);
  assertEquals(result.groups.map(g => g.classification?.imdgClass ?? null), ["9", null, null]);
  assertEquals(result.groups[0].classification?.source?.amendment, "42-24");
  assertEquals(result.groups[0].excerpt, cargo.split("\n")[1]);
  assertEquals(result.groups[0].sourceEmailId, "synthetic-source");
  assert(result.pricingBlocked); // recognition alone never establishes container allocation
});

Deno.test("IMO goods: goods units do not become container quantities or separate quotes", () => {
  const groups = recognize(cargo).groups;
  assertEquals(groups.map(g => [g.declaredQuantity, g.quantityKind]), [[8, "goods"], [7, "goods"], [2, "containers"]]);
  assert(!("quote_request_lines" in recognize(cargo)));
});

for (const un of ["UN3536", "UN 3536", "ONU: 3536", "un-3536"]) {
  Deno.test(`IMO goods: normalizes explicit ${un}`, () => {
    assertEquals(recognize(cargo.replace("UN3536", un)).groups[0].classification?.imdgClass, "9");
  });
}
for (const header of ["From: Sender", "De : Expéditeur", "On Monday wrote:", "发件人：Sender", "åä»¶äººï¼Sender", "Best regards,\nSender\n-------"]) {
  Deno.test(`IMO goods: quoted history is never current evidence (${header.split(":")[0]})`, () => {
    const result = recognize(`Destination: Sample City.\n${header}\n${cargo}`);
    assertEquals(result.status, "REVIEW");
    assertEquals(result.groups[0].classification, null);
    assertEquals(result.groups[0].evidence, "quoted_or_unverified");
    assert(result.reasons.includes("NO_DIRECT_BINDING"));
  });
}
Deno.test("IMO goods: unknown sender cannot establish the client declaration", () => {
  const result = recognizeImoGoods([src(cargo, false)])!;
  assertEquals(result.status, "REVIEW");
  assertEquals(result.groups[0].classification, null);
});
Deno.test("IMO goods: truncated source cannot establish a direct binding", () => {
  const result = recognizeImoGoods([{ ...src(), complete: false }])!;
  assertEquals(result.status, "REVIEW");
  assert(result.reasons.includes("TRUNCATED_SOURCE"));
  assert(!result.groups.some(g => g.binding === "BOUND"));
});
Deno.test("IMO goods: unrelated destination follow-up retains directly sourced evidence", () => {
  const result = recognizeImoGoods([src(), src("Destination: Sample City", true, "followup")])!;
  assertEquals(result.status, "BOUND");
  assertEquals(result.groups[0].sourceEmailId, "synthetic-source");
});
Deno.test("IMO goods: exact quoted copy is evidence, not a second current list", () => {
  const result = recognizeImoGoods([src(), src(`Destination: Sample City\nFrom: Sender\n${cargo}`, true, "followup")])!;
  assertEquals(result.status, "BOUND");
  assertEquals(result.groups.filter(g => g.binding === "BOUND").length, 1);
});
for (const [label, body] of [
  ["two numbers", cargo.replace("UN3536", "UN3536 UN3480")],
  ["contradictory class", cargo.replace("UN3536", "UN3536 class 3")],
  ["unknown number", cargo.replace("UN3536", "UN9999")],
  ["division missing", cargo.replace("UN3536", "UN1950")],
  ["conditional", cargo.replace("UN3536", "possibly UN3536")],
  ["negative", cargo.replace("UN3536", "not UN3536")],
  ["different target row", cargo.replace("UN3536", "UN3536 for group 2")],
  ["malformed alongside valid ONU", cargo.replace("UN3536", "UN3536 UN12345")],
  ["ONU suffix", cargo.replace("UN3536", "UN3536A")],
  ["two goods in one row", cargo.replace("battery units", "batteries and machines")],
  ["dangling repeat of same number", `${cargo}\nMaybe UN3536 for other goods?`],
  ["revision", `${cargo}\nCorrection: replace the earlier shipment.`],
  ["duplicate ordinal", cargo.replace("2.7", "1.7")],
  ["missing ordinal", cargo.replace("2.7", "4.7")],
]) {
  Deno.test(`IMO goods: ${label} requires review`, () => {
    const result = recognize(body);
    assertEquals(result.status, "REVIEW");
    assert(!result.groups.some(g => g.binding === "BOUND"));
  });
}
Deno.test("IMO goods: different active cargo lists are not merged or silently superseded", () => {
  const result = recognizeImoGoods([src(), src(cargo.replace("1.8", "1.6"), true, "revision")])!;
  assert(result.reasons.includes("MULTIPLE_ACTIVE_CARGO_LISTS"));
  assertEquals(result.status, "REVIEW");
});
Deno.test("IMO goods: malformed ONU is not silently discarded", () => {
  assertEquals(recognize(cargo.replace("UN3536", "UN35368")).status, "REVIEW");
});
Deno.test("IMO goods: unstructured prose does not bind to the nearest item", () => {
  const result = recognize("Battery units and machines in 20HQ containers. UN3536.");
  assertEquals(result.groups, []);
  assertEquals(result.status, "REVIEW");
});
Deno.test("IMO goods: no ONU has no effect on existing pipeline", () => {
  assertEquals(recognizeImoGoods([src(cargo.replace(", UN3536", ""))]), null);
});
Deno.test("IMO goods integration: existing MIME decoder supplies direct base64 cargo rows", async () => {
  Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");
  const { extractPlainTextFromMime } = await import("../build-case-puzzle/index.ts");
  const decoded = extractPlainTextFromMime(btoa(`${cargo}\nThanks & regards,\nExample Sender`));
  assertEquals(recognize(decoded).groups.length, 3);
  assertEquals(recognize(decoded).groups[0].classification?.imdgClass, "9");
});
Deno.test("IMO goods integration: MIME decoding does not make quoted history authoritative", async () => {
  Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");
  const { extractPlainTextFromMime } = await import("../build-case-puzzle/index.ts");
  const decoded = extractPlainTextFromMime(btoa(`Destination: Sample City\nFrom: Example Sender\n${cargo}`));
  assertEquals(recognize(decoded).status, "REVIEW");
  assertEquals(recognize(decoded).groups[0].classification, null);
});
Deno.test("IMO goods: operator notice distinguishes missing danger and cites evidence", () => {
  const question = imoGoodsQuestion(recognize(cargo));
  assert(question.includes("ne signifie pas non dangereux"));
  assert(question.includes("synthetic-source"));
  assert(question.includes("classe dérivée 9"));
  assert(question.includes("correspondance prouvée avec les conteneurs"));
});

function fakeStore() {
  let last: ImoGoodsAssessment | null = null;
  const calls: string[] = [];
  const store: ImoGoodsStore = {
    readLast: () => Promise.resolve(last),
    ensureBlockingGap: () => { calls.push("gap"); return Promise.resolve(); },
    appendEvidence: assessment => { calls.push("evidence"); last = assessment; return Promise.resolve(); },
  };
  return { store, calls, last: () => last };
}
Deno.test("IMO goods orchestration: blocker before evidence, sequential replay creates no duplicate evidence", async () => {
  const fake = fakeStore();
  await syncImoGoodsRecognition(fake.store, [src()]);
  await syncImoGoodsRecognition(fake.store, [src()]);
  assertEquals(fake.calls, ["gap", "evidence", "gap"]);
});
Deno.test("IMO goods orchestration: read error propagates before any write", async () => {
  const fake = fakeStore();
  fake.store.readLast = () => Promise.reject(new Error("read failed"));
  await assertRejects(() => syncImoGoodsRecognition(fake.store, [src()]), Error, "read failed");
  assertEquals(fake.calls, []);
});
Deno.test("IMO goods orchestration: gap failure forbids evidence success", async () => {
  const fake = fakeStore();
  fake.store.ensureBlockingGap = () => Promise.reject(new Error("gap failed"));
  await assertRejects(() => syncImoGoodsRecognition(fake.store, [src()]), Error, "gap failed");
  assertEquals(fake.calls, []);
});
Deno.test("IMO goods orchestration: evidence failure cannot erase the blocking gap", async () => {
  const fake = fakeStore();
  fake.store.appendEvidence = () => Promise.reject(new Error("evidence failed"));
  await assertRejects(() => syncImoGoodsRecognition(fake.store, [src()]), Error, "evidence failed");
  assertEquals(fake.calls, ["gap"]);
});
Deno.test("IMO goods orchestration: missing source does not auto-resolve a previous guard", async () => {
  const fake = fakeStore();
  await syncImoGoodsRecognition(fake.store, [src()]);
  await syncImoGoodsRecognition(fake.store, []);
  assertEquals(fake.last()?.status, "REVIEW");
  assertEquals(fake.last()?.reasons, ["SOURCE_NO_LONGER_AVAILABLE"]);
  assert(!fake.last()?.groups.some(g => g.binding === "BOUND"));
});
Deno.test("IMO goods orchestration: unrelated source without prior assessment causes no writes", async () => {
  const fake = fakeStore();
  await syncImoGoodsRecognition(fake.store, [src("Other shipment")]);
  assertEquals(fake.calls, []);
});
Deno.test("IMO goods orchestration: JSONB key reordering cannot produce duplicate evidence", async () => {
  const fake = fakeStore();
  const assessment = recognize(cargo);
  const reordered = Object.fromEntries(Object.entries(assessment).reverse()) as unknown as ImoGoodsAssessment;
  fake.store.readLast = () => Promise.resolve(reordered);
  await syncImoGoodsRecognition(fake.store, [src()]);
  assertEquals(fake.calls, ["gap"]);
});
Deno.test("IMO goods: concurrent evidence identifiers agree, transitions and cases are isolated", async () => {
  const assessment = recognize(cargo);
  const [a, b] = await Promise.all([imoGoodsEvidenceId("case-A", null, assessment), imoGoodsEvidenceId("case-A", null, assessment)]);
  assertEquals(a, b);
  assert(/^[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(a));
  assert(a !== await imoGoodsEvidenceId("case-B", null, assessment));
  assert(a !== await imoGoodsEvidenceId("case-A", "previous-transition", assessment));
});
Deno.test("IMO goods wiring: recognized groups cannot enter legacy facts or multi-quote via this guard", () => {
  const code = Deno.readTextFileSync(new URL("../build-case-puzzle/index.ts", import.meta.url));
  const start = code.indexOf("const imoGoodsAssessment = await syncImoGoodsRecognition");
  const end = code.indexOf("const attachmentContext", start);
  const block = code.slice(start, end);
  assert(start > 0 && end > start);
  assert(!/supersede_fact|quote_request_lines|quote_facts/.test(block));
  assert(block.includes('throw new Error(`IMO goods'));
  assert(code.includes("IMO_GOODS_GAP, // recognition scope guard"));
  assert(code.includes("imo_goods_assessment: imoGoodsAssessment"));
  const pricing = Deno.readTextFileSync(new URL("../run-pricing/index.ts", import.meta.url));
  assert(pricing.includes('blockingGapsRows!.every((g: any) => g.gap_key === "cargo.value")'));
  assertEquals(["cargo.value"].includes(IMO_GOODS_GAP), false); // provisional pricing cannot bypass this guard
});
