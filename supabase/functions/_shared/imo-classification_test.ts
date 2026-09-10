/**
 * IMO-RULES-1 — tests de la classification IMDG et du numéro ONU.
 *
 * Ces faits conditionnent la documentation exigée par le terminal et, à terme,
 * le mode de séjour. Une classe mal normalisée entraînerait une déclaration
 * erronée ; les cas ci-dessous verrouillent le refus de tout ce qui n'est pas
 * une classe IMDG reconnue.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  IMDG_CLASSES,
  IMDG_CLASS_LABELS_FR,
  IMO_CLASS_FACT_KEY,
  UN_NUMBER_FACT_KEY,
  describeImdgClass,
  normalizeImdgClass,
  normalizeUnNumber,
} from "./imo-classification.ts";

Deno.test("clés des faits : préfixe cargo, donc catégorie cargo côté set-case-fact", () => {
  assertEquals(IMO_CLASS_FACT_KEY, "cargo.imo_class");
  assertEquals(UN_NUMBER_FACT_KEY, "cargo.un_number");
});

Deno.test("nomenclature complète : 20 classes et divisions IMDG, toutes libellées", () => {
  assertEquals(IMDG_CLASSES.length, 20);
  for (const cls of IMDG_CLASSES) {
    const label = IMDG_CLASS_LABELS_FR[cls];
    assertEquals(typeof label, "string", `libellé manquant pour ${cls}`);
    assertEquals(label.trim().length > 0, true, `libellé vide pour ${cls}`);
  }
});

Deno.test("toute classe de la nomenclature se normalise en elle-même", () => {
  for (const cls of IMDG_CLASSES) {
    assertEquals(normalizeImdgClass(cls), cls);
  }
});

Deno.test("écritures usuelles acceptées", () => {
  assertEquals(normalizeImdgClass(" 1.4 "), "1.4");
  assertEquals(normalizeImdgClass("classe 3"), "3");
  assertEquals(normalizeImdgClass("CLASSE 6.1"), "6.1");
  assertEquals(normalizeImdgClass("IMDG 2.3"), "2.3");
  assertEquals(normalizeImdgClass("imo 5.2"), "5.2");
  assertEquals(normalizeImdgClass("6,1"), "6.1");
  assertEquals(normalizeImdgClass("class 8"), "8");
});

Deno.test("une classe à divisions saisie sans division est refusée", () => {
  // « 4 » ne désigne aucune classe utilisable : il faut 4.1, 4.2 ou 4.3.
  for (const raw of ["1", "2", "4", "5", "6"]) {
    assertEquals(normalizeImdgClass(raw), null, `classe ${raw} acceptée à tort`);
  }
});

Deno.test("classes inexistantes et saisies libres refusées, jamais interprétées", () => {
  for (
    const raw of [
      "",
      "   ",
      "10",
      "0",
      "1.7",
      "2.4",
      "3.1",
      "7.1",
      "9.1",
      "dangereux",
      "inflammable",
      "UN1203",
      3,
      null,
      undefined,
      {},
    ]
  ) {
    assertEquals(
      normalizeImdgClass(raw),
      null,
      `valeur acceptée à tort : ${JSON.stringify(raw)}`,
    );
  }
});

Deno.test("libellé français rendu pour une classe reconnue, null sinon", () => {
  assertEquals(describeImdgClass("3"), "Liquides inflammables");
  assertEquals(describeImdgClass("classe 7"), "Matières radioactives");
  assertEquals(describeImdgClass("4"), null);
  assertEquals(describeImdgClass("n'importe quoi"), null);
});

Deno.test("numéro ONU : formes acceptées, toujours ramenées à la forme canonique", () => {
  assertEquals(normalizeUnNumber("UN1203"), "UN1203");
  assertEquals(normalizeUnNumber("un1203"), "UN1203");
  assertEquals(normalizeUnNumber("UN 1203"), "UN1203");
  assertEquals(normalizeUnNumber(" 1203 "), "UN1203");
  assertEquals(normalizeUnNumber(1203), "UN1203");
  assertEquals(normalizeUnNumber("0004"), "UN0004");
});

Deno.test("numéro ONU : les espaces internes d'une saisie sont tolérés", () => {
  // « 1 203 » est le numéro 1203 mal espacé, au même titre que « UN 1203 ».
  assertEquals(normalizeUnNumber("1 203"), "UN1203");
  assertEquals(normalizeUnNumber("UN 12 03"), "UN1203");
});

Deno.test("numéro ONU : tout ce qui n'a pas quatre chiffres est refusé", () => {
  for (const raw of ["", "UN", "123", "12345", "UN12A3", "ONU1203", null, undefined, {}]) {
    assertEquals(
      normalizeUnNumber(raw),
      null,
      `valeur acceptée à tort : ${JSON.stringify(raw)}`,
    );
  }
});

Deno.test("numéro ONU : 0000 refusé, il n'est attribué à aucune matière", () => {
  assertEquals(normalizeUnNumber("UN0000"), null);
  assertEquals(normalizeUnNumber("0000"), null);
});
