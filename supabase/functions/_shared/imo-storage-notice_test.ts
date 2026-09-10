/**
 * IMO-STORAGE-1 — Tests de la ligne d'information « séjour au terminal ».
 *
 * Enjeu : annoncer 15 jours à un client dont le conteneur doit sortir en 3 est
 * une faute coûteuse. Ces cas verrouillent le message rendu et l'absence de
 * tout montant inventé.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildImoStorageNotice, IMO_STORAGE_SERVICE_KEY } from "./imo-storage-notice.ts";
import type { ImoTerminalResolution } from "./imo-terminal-rules.ts";

function resolution(over: Partial<ImoTerminalResolution>): ImoTerminalResolution {
  return {
    status: "RESOLVED",
    rule: null,
    storageRegime: "MAX_3_DAYS",
    storageMaxDays: 3,
    transshipmentMaxDays: 7,
    padPriorApproval: "YES",
    firefighterSupervision: false,
    missing: [],
    conflicting: false,
    message: "Message du résolveur.",
    ...over,
  };
}

Deno.test("la ligne ne facture jamais rien", () => {
  for (
    const r of [
      resolution({}),
      resolution({ status: "TO_CONFIRM", storageRegime: "NOT_SPECIFIED", storageMaxDays: null }),
      resolution({ status: "FORBIDDEN" }),
      resolution({ storageRegime: "UNDER_TACKLE", storageMaxDays: 0, transshipmentMaxDays: 0 }),
    ]
  ) {
    const notice = buildImoStorageNotice(r);
    assertEquals(notice.amount, 0);
    assertEquals(notice.serviceKey, IMO_STORAGE_SERVICE_KEY);
  }
});

Deno.test("régime court : le nombre de jours réel est annoncé", () => {
  const notice = buildImoStorageNotice(resolution({}));

  assertEquals(notice.sourceType, "OFFICIAL");
  assertEquals(notice.label.includes("3 jours"), true);
  assertEquals(notice.blocking, false);
});

Deno.test("livraison sous palan : aucun séjour, transbordement signalé comme interdit", () => {
  const notice = buildImoStorageNotice(
    resolution({ storageRegime: "UNDER_TACKLE", storageMaxDays: 0, transshipmentMaxDays: 0 }),
  );

  assertEquals(notice.label.includes("aucun séjour"), true);
  assertEquals(notice.description.includes("transbordement"), true);
});

Deno.test("l'écart avec la franchise standard est explicité quand elle est connue", () => {
  const notice = buildImoStorageNotice(resolution({}), 15);

  assertEquals(notice.description.includes("15 jours"), true);
  assertEquals(notice.description.includes("ne s'applique PAS"), true);
});

Deno.test("aucune mention d'écart si la franchise standard n'est pas plus longue", () => {
  for (const standard of [3, 2, 0, null, undefined]) {
    const notice = buildImoStorageNotice(resolution({}), standard);
    assertEquals(
      notice.description.includes("ne s'applique PAS"),
      false,
      `écart annoncé à tort pour une franchise de ${standard}`,
    );
  }
});

Deno.test("classe interdite : ligne bloquante, sans montant ni chiffrage", () => {
  const notice = buildImoStorageNotice(
    resolution({ status: "FORBIDDEN", message: "Classe IMDG 7 interdite au terminal." }),
  );

  assertEquals(notice.blocking, true);
  assertEquals(notice.amount, 0);
  assertEquals(notice.sourceType, "OFFICIAL");
  assertEquals(notice.label.includes("interdite"), true);
});

Deno.test("numéro ONU manquant : la ligne réclame la donnée et met en garde", () => {
  const notice = buildImoStorageNotice(
    resolution({
      status: "TO_CONFIRM",
      storageRegime: null,
      storageMaxDays: null,
      missing: ["UN_NUMBER"],
      message: "La classe distingue ses numéros.",
    }),
  );

  assertEquals(notice.sourceType, "TO_CONFIRM");
  assertEquals(notice.description.includes("numéro ONU"), true);
  assertEquals(notice.notes.includes("ne s'applique pas"), true);
});

Deno.test("classe manquante : la ligne réclame la classe", () => {
  const notice = buildImoStorageNotice(
    resolution({
      status: "TO_CONFIRM",
      storageRegime: null,
      storageMaxDays: null,
      missing: ["IMO_CLASS"],
      message: "Classe absente.",
    }),
  );

  assertEquals(notice.description.includes("classe IMDG"), true);
});

Deno.test("les surestaries ne sont jamais présentées comme modifiées", () => {
  const notice = buildImoStorageNotice(resolution({}), 15);

  assertEquals(notice.notes.includes("barème de l'armateur"), true);
});

Deno.test("chaque ligne porte un libellé, une description et une source non vides", () => {
  for (
    const r of [
      resolution({}),
      resolution({ status: "TO_CONFIRM", missing: ["UN_NUMBER"] }),
      resolution({ status: "FORBIDDEN" }),
    ]
  ) {
    const notice = buildImoStorageNotice(r);
    for (const value of [notice.label, notice.description, notice.sourceReference, notice.notes]) {
      assertEquals(typeof value, "string");
      assertEquals(value.trim().length > 0, true);
    }
  }
});
