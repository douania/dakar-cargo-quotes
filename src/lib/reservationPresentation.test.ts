import { describe, expect, it } from "vitest";
import { isMachineReference, prioritizeReservations, readableReservations, readableReservationText, shortenText } from "./reservationPresentation";

// Synthetic excerpts shaped like the GoTrans home card; no customer data.
const recorded = [
  "Au moins un poste tarifaire est en attente de confirmation (TO_CONFIRM).",
  "commodity_classification_unknown",
  "Périmètre lot-1 : commodity_classification_unknown",
  "Périmètre lot-2 : commodity_classification_unknown",
  "Périmètre lot-3 : commodity_classification_unknown",
  "Périmètre destination : port_to_propose",
  "Périmètre origin : port_to_propose",
  "Périmètre lot-1 : Retour vide armateur — lot-1 (SOC) — exclu de l’estimation.",
  "Périmètre lot-2 : Retour vide armateur — lot-2 (SOC) — exclu de l’estimation.",
];

describe("readable reservations", () => {
  it("translates exact codes, merges the same reservation per lot and keeps different wording apart", () => {
    expect(readableReservations(recorded).map(item => item.text)).toEqual([
      "Au moins un poste tarifaire est en attente de confirmation.",
      "Classification marchandise inconnue",
      "Lot 1, lot 2, lot 3 : Classification marchandise inconnue",
      "Destination, origine : Lieu à proposer",
      "Lot 1 : Retour vide armateur — lot 1 (SOC) — exclu de l’estimation.",
      "Lot 2 : Retour vide armateur — lot 2 (SOC) — exclu de l’estimation.",
    ]);
  });

  it("removes repeated suffixes without touching amounts, URLs or unknown codes", () => {
    expect(readableReservationText("Magasinage — lot lot-2 — à confirmer — à confirmer"))
      .toBe("Magasinage — lot 2 — à confirmer");
    const source = "Source : https://www.hapag-lloyd.com/content/dam/website/downloads/detention_demurrage/SN.pdf ; 531 325 FCFA; RATE_X_CUSTOM";
    expect(readableReservationText(source)).toBe(source);
    expect(readableReservationText("Hypothèses à vérifier; poids haut; Qté conteneurs source..")).toBe("Hypothèses à vérifier; poids haut; Qté conteneurs source.");
  });

  it("writes lots one way, names unit bases and never repeats a scope already in the text", () => {
    expect(readableReservationText("Supplément IMO éventuel — lot-2 — à confirmer")).toBe("Supplément IMO éventuel — lot 2 — à confirmer");
    expect(readableReservationText("Surestaries armateur — lot COC lot-3")).toBe("Surestaries armateur — lot COC lot 3");
    expect(readableReservationText("poids 55000 kg (per_unit)")).toBe("poids 55000 kg (par unité)");
    expect(readableReservations([
      "Périmètre lot-1 : Lot lot-1 : hypothèse 39 × 20HQ SOC; poids 55000 kg (per_unit).",
      "Périmètre lot-2 : Lot lot-2 : danger inconnu.",
    ]).map(item => item.text)).toEqual([
      "Lot 1 : hypothèse 39 × 20HQ SOC; poids 55000 kg (par unité).",
      "Lot 2 : danger inconnu.",
    ]);
  });

  it("puts unknown, excluded or to-confirm points first and otherwise keeps the recorded order", () => {
    const ordered = prioritizeReservations([
      { text: "Cotation sur bases opérateur explicites et révisables." },
      { text: "Au moins un poste tarifaire est en attente de confirmation." },
      { text: "Lot 1, lot 2 : Classification marchandise inconnue" },
      { text: "Devis établi sur des bases opérateur : consulter les bases et réserves de la version." },
      { text: "Magasinage — lot 1 — à confirmer." },
      { text: "Droits et taxes douaniers et calcul CAF exclus." },
    ]).map(item => item.text);
    expect(ordered).toEqual([
      "Lot 1, lot 2 : Classification marchandise inconnue",
      "Magasinage — lot 1 — à confirmer.",
      "Droits et taxes douaniers et calcul CAF exclus.",
      "Cotation sur bases opérateur explicites et révisables.",
      "Au moins un poste tarifaire est en attente de confirmation.",
      "Devis établi sur des bases opérateur : consulter les bases et réserves de la version.",
    ]);
  });

  it("opens long texts on a complete first sentence, or a word-bounded excerpt", () => {
    expect(shortenText("Texte court.")).toEqual({ summary: "Texte court.", truncated: false });
    const sentence = `Statut dangereux inconnu : base de transport ordinaire uniquement. ${"Détail ".repeat(40)}`;
    expect(shortenText(sentence)).toEqual({ summary: "Statut dangereux inconnu : base de transport ordinaire uniquement.", truncated: true });
    const noStop = "mot ".repeat(80);
    const cut = shortenText(noStop);
    expect(cut.truncated).toBe(true);
    expect(cut.summary.endsWith(" …")).toBe(true);
    expect(cut.summary.length).toBeLessThanOrEqual(182);
  });

  it("recognises internal tariff keys but not regulatory prose", () => {
    for (const key of ["SN_NORMAL_CONTAINER_KM_V1", "fee_rules:référence interne", "STORAGE_P1_OPERATOR_1111_20260916"]) expect(isMachineReference(key)).toBe(true);
    for (const prose of ["Arrêté ministériel n° 035532 du 28/11/2023", "Hypothèse SOC : pas de restitution", "THC"]) expect(isMachineReference(prose)).toBe(false);
  });
});
