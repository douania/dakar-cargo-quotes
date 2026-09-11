/**
 * DG-1 — Tests du fait canonique « marchandise dangereuse ».
 *
 * Enjeu : ce fait décide de l'application de règles d'honoraires et, demain, de
 * franchises de séjour. Une valeur devinée produirait un montant faux ; les cas
 * ci-dessous verrouillent le caractère fail-closed et l'unidirectionnalité du
 * repli depuis la famille tarifaire DP World.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DANGEROUS_GOODS_FACT_KEY,
  isDangerousForEngine,
  normalizeDangerousGoodsFactValue,
  resolveDangerousGoods,
} from "./dangerous-goods.ts";

Deno.test("clé du fait : préfixe cargo, donc catégorie cargo côté set-case-fact", () => {
  assertEquals(DANGEROUS_GOODS_FACT_KEY, "cargo.dangerous_goods");
  assertEquals(DANGEROUS_GOODS_FACT_KEY.split(".")[0], "cargo");
});

Deno.test("normalisation : formes acceptées pour oui", () => {
  for (const raw of ["YES", "yes", " Oui ", "OUI", "true", "TRUE", "1"]) {
    assertEquals(normalizeDangerousGoodsFactValue(raw), "YES", `valeur refusée : ${raw}`);
  }
});

Deno.test("normalisation : formes acceptées pour non", () => {
  for (const raw of ["NO", "no", "Non", "NON", "false", "FALSE", "0"]) {
    assertEquals(normalizeDangerousGoodsFactValue(raw), "NO", `valeur refusée : ${raw}`);
  }
});

Deno.test("normalisation : tout le reste est refusé, jamais interprété", () => {
  for (const raw of ["", "   ", "peut-être", "IMDG", "classe 3", "Y", "N", "vrai", 1, 0, true, false, null, undefined, {}]) {
    assertEquals(
      normalizeDangerousGoodsFactValue(raw),
      null,
      `valeur acceptée à tort : ${JSON.stringify(raw)}`,
    );
  }
});

Deno.test("fait explicite oui : dangereux, origine le fait", () => {
  const r = resolveDangerousGoods("YES");
  assertEquals(r.dangerous, true);
  assertEquals(r.origin, "FACT");
});

Deno.test("fait explicite non : non dangereux, origine le fait", () => {
  const r = resolveDangerousGoods("NON");
  assertEquals(r.dangerous, false);
  assertEquals(r.origin, "FACT");
});

Deno.test("fait absent : inconnu, jamais « non dangereux »", () => {
  const r = resolveDangerousGoods(null);
  assertEquals(r.dangerous, null);
  assertEquals(r.origin, "UNKNOWN");
});

Deno.test("fait illisible : inconnu, jamais deviné", () => {
  const r = resolveDangerousGoods("à confirmer");
  assertEquals(r.dangerous, null);
  assertEquals(r.origin, "UNKNOWN");
});

Deno.test("repli : famille DP World DANGEROUS vaut déclaration de danger", () => {
  const r = resolveDangerousGoods(null, "DANGEROUS");
  assertEquals(r.dangerous, true);
  assertEquals(r.origin, "DTHC_FAMILY");
});

Deno.test("repli unidirectionnel : une autre famille ne prouve PAS l'absence de danger", () => {
  for (const family of ["STANDARD", "BASIC", "REEFER", "SPECIAL"]) {
    const r = resolveDangerousGoods(null, family);
    assertEquals(r.dangerous, null, `famille ${family} a conclu à tort`);
    assertEquals(r.origin, "UNKNOWN");
  }
});

Deno.test("le fait explicite prime sur la famille tarifaire, dans les deux sens", () => {
  const contredit = resolveDangerousGoods("NO", "DANGEROUS");
  assertEquals(contredit.dangerous, false);
  assertEquals(contredit.origin, "FACT");

  const confirme = resolveDangerousGoods("YES", "STANDARD");
  assertEquals(confirme.dangerous, true);
  assertEquals(confirme.origin, "FACT");
});

Deno.test("famille illisible : ignorée, le dossier reste inconnu", () => {
  for (const family of ["", "DANGER", "IMDG", 42, null, undefined]) {
    assertEquals(resolveDangerousGoods(null, family).dangerous, null);
  }
});

Deno.test("repli : une classe IMDG déclarée classe la marchandise comme dangereuse", () => {
  for (const cls of ["1.4", "3", "6.1", "classe 8", "IMDG 2.3"]) {
    const r = resolveDangerousGoods(null, null, cls);
    assertEquals(r.dangerous, true, `classe ${cls} n'a pas conclu`);
    assertEquals(r.origin, "IMO_CLASS");
  }
});

Deno.test("repli classe : une classe illisible ne conclut rien", () => {
  for (const cls of ["", "4", "10", "dangereux", null, undefined]) {
    assertEquals(resolveDangerousGoods(null, null, cls).dangerous, null);
  }
});

Deno.test("le fait explicite prime sur la classe IMDG, y compris pour dire non", () => {
  const r = resolveDangerousGoods("NO", null, "3");
  assertEquals(r.dangerous, false);
  assertEquals(r.origin, "FACT");
});

Deno.test("la classe IMDG prime sur la famille tarifaire pour l'explication", () => {
  const r = resolveDangerousGoods(null, "DANGEROUS", "6.1");
  assertEquals(r.dangerous, true);
  assertEquals(r.origin, "IMO_CLASS");
});

Deno.test("chaque réponse porte une explication française non vide", () => {
  for (const r of [
    resolveDangerousGoods("YES"),
    resolveDangerousGoods("NO"),
    resolveDangerousGoods(null),
    resolveDangerousGoods(null, "DANGEROUS"),
  ]) {
    assertEquals(typeof r.message, "string");
    assertEquals(r.message.trim().length > 0, true);
  }
});

/* ------------------------------------------------------------------------- *
 * DTHC-4-A — réponse booléenne transmise au moteur sous `isIMO`.
 *
 * Enjeu direct : c'est ce booléen qui déclenche le supplément de 50 % lié au
 * caractère dangereux (arrêté n° 035532 du 28/11/2023), et qui lève la mise en
 * « à confirmer » des frais armateur DG. Un `true` de trop sur-facture, un
 * `false` de trop sous-facture.
 * ------------------------------------------------------------------------- */

Deno.test("moteur : le fait déclaré commande, dans les deux sens", () => {
  assertEquals(isDangerousForEngine("YES"), true);
  assertEquals(isDangerousForEngine("OUI"), true);
  assertEquals(isDangerousForEngine("NO"), false);
  assertEquals(isDangerousForEngine("NON"), false);
});

Deno.test("moteur : caractère dangereux inconnu vaut false, jamais true", () => {
  for (const raw of [undefined, null, "", "   ", "peut-être", 1, {}, []]) {
    assertEquals(
      isDangerousForEngine(raw),
      false,
      `valeur inexploitable rendue dangereuse : ${JSON.stringify(raw)}`,
    );
  }
});

Deno.test("moteur : un fait déclaré NON prime sur les replis", () => {
  // Le dossier dit explicitement « non dangereux » : ni la classe IMDG ni la
  // famille tarifaire ne doivent le contredire en silence.
  assertEquals(isDangerousForEngine("NO", "DANGEROUS", "3"), false);
});

Deno.test("moteur : les replis du résolveur s'appliquent bien", () => {
  // Classe IMDG déclarée, fait absent.
  assertEquals(isDangerousForEngine(null, undefined, "9"), true);
  assertEquals(isDangerousForEngine(null, undefined, "1.4"), true);
  // Famille tarifaire DANGEROUS, fait et classe absents.
  assertEquals(isDangerousForEngine(null, "DANGEROUS"), true);
  // Une autre famille ne dit rien du danger.
  for (const family of ["STANDARD", "BASIC", "REEFER", "SPECIAL", "n'importe quoi"]) {
    assertEquals(isDangerousForEngine(null, family), false, `famille ${family}`);
  }
});

Deno.test("moteur : le booléen suit exactement le résolveur", () => {
  // Aucune divergence possible entre l'explication rendue à l'opérateur et le
  // montant facturé.
  for (
    const args of [
      ["YES", undefined, undefined],
      ["NO", "DANGEROUS", "3"],
      [null, undefined, "9"],
      [null, "DANGEROUS", undefined],
      [null, undefined, undefined],
      ["n'importe quoi", "STANDARD", "pas une classe"],
    ] as Array<[unknown, unknown, unknown]>
  ) {
    assertEquals(
      isDangerousForEngine(args[0], args[1], args[2]),
      resolveDangerousGoods(args[0], args[1], args[2]).dangerous === true,
      `divergence sur ${JSON.stringify(args)}`,
    );
  }
});
