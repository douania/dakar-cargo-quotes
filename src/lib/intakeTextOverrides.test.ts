/**
 * DCQ-P0-E — Parsing texte de l'intake.
 *
 * Tests purs : aucun mock Supabase, aucun appel réseau, aucun DOM.
 * Couvre la régression runtime observée (dossier mixte 20'/40' + livraison
 * inland masquée par le port de destination) et verrouille les formats
 * documentés existants.
 */

import { describe, expect, it } from "vitest";
import {
  describeContainerPlan,
  parseTextOverrides,
  resolveContainerPlan,
  toCanonicalContainers,
} from "./intakeTextOverrides";

/** Texte de régression runtime, reproduit à l'identique. */
const P0E_TEXT =
  "TEST SANDBOX P0-E — NE PAS ENVOYER. Demande entièrement fictive pour recette interne. " +
  "Cotation import maritime FCL en DAP. Port d'origine : Le Havre. Port de destination : Dakar. " +
  "Livraison finale : Mbour, Sénégal. Marchandise générale non dangereuse : pièces mécaniques. " +
  "Conteneurs : 1 x 20 pieds Dry et 1 x 40 pieds Dry. Poids brut total : 10 000 kg. " +
  "Valeur marchandise : 10 000 000 XOF. Fret maritime : 1 000 000 XOF.";

/** Texte documenté DCQ-P0-WHATSAPP-RFQ-INTAKE-GAPS — RFQ KAS0032026. */
const KAS_TEXT = [
  "From Pune To Nhava Sheva port, to Dakar (Senegal) and further to Kaolack City",
  "Port of Discharge: Dakar Port, Senegal",
  "Final Place of Discharge of Containers: Kaolack Site, Senegal",
  "20 x 40' HC to be delivered on site",
].join("\n");

/**
 * Texte de régression : extraction Excel structurée "champ;valeur", reproduite
 * à l'identique. Le "1" est la VALEUR de container_count ; le mot "container"
 * de la ligne suivante n'est qu'un LIBELLÉ de champ.
 */
const EXCEL_STRUCTURED_TEXT = ["container_count;1", "container_type;20' Dry Van (20 DV)"].join("\n");

/** Analyse document fiable associée à cette extraction. */
const EXCEL_ANALYSIS = { container_count: 1, container_type: "20' Dry Van (20 DV)" };

/** Texte de régression PHNX, reproduit à l'identique. */
const PHNX_TEXT =
  "50 tonnes de sel en sacs de 25 kg, conditionnées dans deux conteneurs de 20 pieds.";

/** Texte de régression INT Nordic, reproduit à l'identique. */
const INT_NORDIC_TEXT = "1 pallet, 200 kgs / 80x60x75 cm / Non stackable, general cargo.";

describe("parseTextOverrides — régression P0-E (dossier mixte 20'/40')", () => {
  const overrides = parseTextOverrides(P0E_TEXT);

  it("publie les deux groupes conteneurs fidèlement", () => {
    expect(overrides.containers).toEqual([
      { count: 1, type: "20' Dry" },
      { count: 1, type: "40' Dry" },
    ]);
  });

  it("compte 2 conteneurs au total (et non 1)", () => {
    expect(overrides.container_count).toBe(2);
  });

  it("ne publie AUCUN type legacy unique pour un dossier mixte", () => {
    expect(overrides.container_type).toBeUndefined();
  });

  it("extrait Mbour comme destination finale — jamais Dakar", () => {
    expect(overrides.destination).toBe("Mbour");
    expect(overrides.destination).not.toBe("Dakar");
  });

  it("classe Dakar comme port de déchargement et Le Havre comme port d'origine", () => {
    expect(overrides.pod).toBe("Dakar");
    expect(overrides.origin_port).toBe("Le Havre");
  });

  it("signale une livraison finale inland requise", () => {
    expect(overrides.requires_final_destination).toBe(true);
  });

  it("ne confond pas les montants XOF / le poids avec des conteneurs", () => {
    expect(overrides.container_count).toBe(2);
    expect(overrides.containers).toHaveLength(2);
  });
});

describe("resolveContainerPlan — P0-E", () => {
  const plan = resolveContainerPlan(parseTextOverrides(P0E_TEXT), {});

  it("produit le JSON cargo.containers attendu", () => {
    expect(toCanonicalContainers(plan)).toEqual([
      { type: "20' Dry", quantity: 1 },
      { type: "40' Dry", quantity: 1 },
    ]);
  });

  it("totalise 2 conteneurs et reste FCL maritime", () => {
    expect(plan.totalCount).toBe(2);
    expect(plan.isFcl).toBe(true);
    expect(plan.ambiguous).toBe(false);
  });

  it("n'expose pas de type legacy mensonger", () => {
    expect(plan.legacyType).toBeNull();
  });

  it("décrit les deux groupes pour l'opérateur", () => {
    expect(describeContainerPlan(plan)).toBe("1 × 20' Dry, 1 × 40' Dry");
  });
});

describe("parseTextOverrides — régression PHNX (deux conteneurs de 20 pieds)", () => {
  const overrides = parseTextOverrides(PHNX_TEXT);

  it("reconnaît honnêtement 2 conteneurs de 20 pieds", () => {
    expect(overrides.containers).toEqual([{ count: 2, type: "20'" }]);
    expect(overrides.container_count).toBe(2);
    expect(overrides.container_type).toBe("20'");
    expect(overrides.containers_ambiguous).toBeUndefined();
  });

  it("produit un payload canonique typé, accepté par set-case-fact", () => {
    const plan = resolveContainerPlan(overrides, {});
    expect(plan.totalCount).toBe(2);
    expect(plan.legacyType).toBe("20'");
    expect(plan.isFcl).toBe(true);
    expect(plan.ambiguous).toBe(false);

    const canonical = toCanonicalContainers(plan);
    expect(canonical).toEqual([{ type: "20'", quantity: 2 }]);
    // Contrat set-case-fact : type toujours chaîne non vide ≤ 32, jamais null.
    for (const c of canonical) {
      expect(typeof c.type).toBe("string");
      expect((c.type as string).length).toBeGreaterThan(0);
      expect((c.type as string).length).toBeLessThanOrEqual(32);
    }
  });

  it('variante chiffrée "2 conteneurs de 20 pieds" — même lecture', () => {
    const o = parseTextOverrides("Cotation pour 2 conteneurs de 20 pieds au départ de Dakar.");
    expect(o.containers).toEqual([{ count: 2, type: "20'" }]);
    expect(o.container_count).toBe(2);
    expect(o.container_type).toBe("20'");
  });

  it('"un conteneur de 40 tonnes" : un poids ne devient jamais une taille', () => {
    const o = parseTextOverrides("Prévoir un conteneur de 40 tonnes de riz.");
    expect(o.container_count).toBe(1);
    expect(o.container_type).toBeUndefined();
    expect(o.containers).toBeUndefined();
  });
});

describe("parseTextOverrides — régression INT Nordic (dimensions de palette)", () => {
  const overrides = parseTextOverrides(INT_NORDIC_TEXT);

  it("80x60x75 cm est une dimension de palette — aucun conteneur inventé", () => {
    expect(overrides.containers).toBeUndefined();
    expect(overrides.container_count).toBeUndefined();
    expect(overrides.container_type).toBeUndefined();
    expect(overrides.containers_ambiguous).toBeUndefined();
  });

  it("aucune donnée conteneur n'atteint le plan ni le payload canonique", () => {
    const plan = resolveContainerPlan(overrides, {});
    expect(plan.totalCount).toBe(0);
    expect(plan.groups).toEqual([]);
    expect(plan.isFcl).toBe(false);
    expect(plan.ambiguous).toBe(false);
    expect(toCanonicalContainers(plan)).toEqual([]);
  });

  it("n'exige pas de destination finale inland sur ce texte", () => {
    expect(overrides.requires_final_destination).toBe(false);
  });

  it("une chaîne de dimensions contenant une taille conteneur reste une dimension", () => {
    const o = parseTextOverrides("Colis de 100x40x60 cm sur 1 pallet.");
    expect(o.containers).toBeUndefined();
    expect(o.container_count).toBeUndefined();
  });

  it("une mesure suivie d'une unité de longueur n'est pas un conteneur", () => {
    const o = parseTextOverrides("Caisse : 2 x 45 cm de large.");
    expect(o.container_count).toBeUndefined();
    expect(o.containers).toBeUndefined();
  });

  it('"1 x 20 tonnes" est un poids, pas un conteneur 20 pieds', () => {
    const o = parseTextOverrides("Merci de coter 1 x 20 tonnes de sel en sacs.");
    expect(o.containers).toBeUndefined();
    expect(o.container_count).toBeUndefined();
  });
});

describe("toCanonicalContainers — jamais de type null dans le payload", () => {
  it("un compte sans taille publie la quantité SANS clé type (contrat set-case-fact)", () => {
    const plan = resolveContainerPlan(parseTextOverrides("Nous avons 3 conteneurs."), {});
    const canonical = toCanonicalContainers(plan);
    expect(canonical).toEqual([{ quantity: 3 }]);
    expect("type" in canonical[0]).toBe(false);
  });

  it("un compte issu de l'analyse document sans type est lui aussi émis sans clé type", () => {
    const plan = resolveContainerPlan({}, { container_count: 4 });
    const canonical = toCanonicalContainers(plan);
    expect(canonical).toEqual([{ quantity: 4 }]);
    expect("type" in canonical[0]).toBe(false);
  });
});

describe("parseTextOverrides — formats conteneurs documentés (non-régression)", () => {
  it('"1 conteneur 40\'" → 1 × 40\'', () => {
    const o = parseTextOverrides("Merci de coter 1 conteneur 40' au départ de Dakar.");
    expect(o.container_count).toBe(1);
    expect(o.container_type).toBe("40'");
    expect(o.containers).toEqual([{ count: 1, type: "40'" }]);
  });

  it('"1 x 40HC" → 1 × 40\' HC', () => {
    const o = parseTextOverrides("Besoin urgent : 1 x 40HC.");
    expect(o.container_count).toBe(1);
    expect(o.container_type).toBe("40' HC");
    expect(o.containers).toEqual([{ count: 1, type: "40' HC" }]);
  });

  it('recette live : "1 x conteneur 20 pieds Dry" conserve le type', () => {
    const o = parseTextOverrides("Demande DAP pour 1 x conteneur 20 pieds Dry.");
    expect(o.container_count).toBe(1);
    expect(o.container_type).toBe("20' Dry");
    expect(o.containers).toEqual([{ count: 1, type: "20' Dry" }]);
  });

  it('"1x40HC" collé → 1 × 40\' HC', () => {
    const o = parseTextOverrides("Sea quote: Port of Discharge: Dakar Port. 1x40HC.");
    expect(o.container_count).toBe(1);
    expect(o.container_type).toBe("40' HC");
  });

  it('"20 x 40\' HC" (apostrophe droite) → 20 × 40\' HC', () => {
    const o = parseTextOverrides("20 x 40' HC ex Nhava Sheva.");
    expect(o.container_count).toBe(20);
    expect(o.container_type).toBe("40' HC");
    expect(o.containers).toEqual([{ count: 20, type: "40' HC" }]);
  });

  it("apostrophe typographique ’ traitée comme une apostrophe droite", () => {
    const o = parseTextOverrides("20 x 40’ HC ex Nhava Sheva.");
    expect(o.container_count).toBe(20);
    expect(o.container_type).toBe("40' HC");
  });

  it('nombres en toutes lettres : "un des huit conteneurs 40\'"', () => {
    const o = parseTextOverrides("Nous devons dédouaner un des huit conteneurs 40' du lot.");
    expect(o.container_count).toBe(1);
    expect(o.container_type).toBe("40'");
  });

  it("quantité sans taille : compte publié, aucun type inventé", () => {
    const o = parseTextOverrides("Nous avons 3 conteneurs à dédouaner.");
    expect(o.container_count).toBe(3);
    expect(o.container_type).toBeUndefined();
  });

  it('"2 x conteneurs" : le connecteur x devant le mot métier reste reconnu', () => {
    const o = parseTextOverrides("Prévoir 2 x conteneurs pour ce lot.");
    expect(o.container_count).toBe(2);
    expect(o.container_type).toBeUndefined();
    expect(o.containers).toBeUndefined();
  });

  it('"1 conteneur" / "1 container" nus restent reconnus', () => {
    const fr = parseTextOverrides("Merci de coter 1 conteneur au départ de Dakar.");
    expect(fr.container_count).toBe(1);
    expect(fr.container_type).toBeUndefined();

    const en = parseTextOverrides("Please quote 1 container ex Dakar.");
    expect(en.container_count).toBe(1);
    expect(en.container_type).toBeUndefined();
  });

  it('"1 x 20" sans unité → 1 × 20\'', () => {
    const o = parseTextOverrides("Cotation pour 1 x 20 au départ de Dakar.");
    expect(o.container_count).toBe(1);
    expect(o.container_type).toBe("20'");
    expect(o.containers).toEqual([{ count: 1, type: "20'" }]);
  });

  it("CRLF Windows/WhatsApp sans effet sur l'extraction", () => {
    const o = parseTextOverrides("Conteneurs :\r\n1 x 20 pieds Dry et 1 x 40 pieds Dry.\r\n");
    expect(o.containers).toEqual([
      { count: 1, type: "20' Dry" },
      { count: 1, type: "40' Dry" },
    ]);
    expect(o.container_count).toBe(2);
  });
});

describe("parseTextOverrides — libellés structurés (extraction Excel champ;valeur)", () => {
  const overrides = parseTextOverrides(EXCEL_STRUCTURED_TEXT);

  it("ne prend pas le libellé container_type pour le mot métier container", () => {
    expect(overrides.container_count).toBeUndefined();
    expect(overrides.container_type).toBeUndefined();
    expect(overrides.containers).toBeUndefined();
    expect(overrides.containers_ambiguous).toBeUndefined();
  });

  it("laisse l'analyse document publier un conteneur TYPÉ — jamais type null", () => {
    const plan = resolveContainerPlan(overrides, EXCEL_ANALYSIS);
    expect(plan.groups).toEqual([{ count: 1, type: "20' Dry Van (20 DV)" }]);
    expect(plan.totalCount).toBe(1);
    expect(plan.legacyType).toBe("20' Dry Van (20 DV)");
    expect(plan.isFcl).toBe(true);
    expect(plan.ambiguous).toBe(false);
  });

  it("produit un payload canonique acceptable par set-case-fact", () => {
    const canonical = toCanonicalContainers(resolveContainerPlan(overrides, EXCEL_ANALYSIS));
    expect(canonical).toEqual([{ type: "20' Dry Van (20 DV)", quantity: 1 }]);
    expect(canonical.every((c) => c.type !== null)).toBe(true);
  });

  it("même immunité en CRLF Windows", () => {
    const o = parseTextOverrides("container_count;1\r\ncontainer_type;20' Dry Van (20 DV)\r\n");
    expect(o.container_count).toBeUndefined();
    expect(o.containers).toBeUndefined();
  });

  it("immunité étendue aux autres libellés de champ conteneurs", () => {
    const o = parseTextOverrides("containers_total;2\nconteneur_type;40 HC");
    expect(o.container_count).toBeUndefined();
    expect(o.containers).toBeUndefined();
    expect(o.containers_ambiguous).toBeUndefined();
  });
});

describe("parseTextOverrides — routage documenté (non-régression)", () => {
  it("RFQ KAS0032026 : Kaolack l'emporte sur Dakar", () => {
    const o = parseTextOverrides(KAS_TEXT);
    expect(o.origin).toBe("Pune");
    expect(o.origin_port).toBe("Nhava Sheva");
    expect(o.pod).toBe("Dakar Port, Senegal");
    expect(o.destination).toBe("Kaolack Site, Senegal");
    expect(o.container_count).toBe(20);
    expect(o.container_type).toBe("40' HC");
    expect(o.requires_final_destination).toBe(true);
  });

  it("port-to-port pur : aucune destination inland exigée", () => {
    const o = parseTextOverrides("Sea quote: Port of Discharge: Dakar Port. 1x40HC.");
    expect(o.pod).toBe("Dakar Port");
    expect(o.destination).toBeUndefined();
    expect(o.requires_final_destination).toBe(false);
  });

  it("inland sans extraction : le gap route.destinations reste ouvert", () => {
    const o = parseTextOverrides("Door delivery required. Port of Discharge: Dakar Port.");
    expect(o.pod).toBe("Dakar Port");
    expect(o.destination).toBeUndefined();
    expect(o.requires_final_destination).toBe(true);
  });

  it("un port déclaré n'est jamais promu destination finale", () => {
    const o = parseTextOverrides("Port de destination : Dakar. Livraison sur site à Mbour.");
    expect(o.pod).toBe("Dakar");
    expect(o.destination).toBe("Mbour");
  });

  it("sans lieu de livraison, le port de destination ne devient pas une ville", () => {
    const o = parseTextOverrides("Cotation port à port. Port de destination : Dakar.");
    expect(o.pod).toBe("Dakar");
    expect(o.destination).toBeUndefined();
  });

  it('"Transport de chargement" n\'est pas confondu avec un port déclaré', () => {
    const o = parseTextOverrides("Transport de chargement lourd. Livraison finale : Thiès.");
    expect(o.destination).toBe("Thiès");
  });
});

describe("parseTextOverrides — fail-closed sur déclarations ambiguës", () => {
  it("un même type déclaré deux fois ne publie aucun conteneur", () => {
    const o = parseTextOverrides("2 x 40' HC au départ. Confirmation : 3 x 40' HC.");
    expect(o.containers_ambiguous).toBe(true);
    expect(o.containers).toBeUndefined();
    expect(o.container_count).toBeUndefined();
    expect(o.container_type).toBeUndefined();
  });

  it("l'ambiguïté neutralise aussi la valeur issue du document", () => {
    const o = parseTextOverrides("2 x 40' HC au départ. Confirmation : 3 x 40' HC.");
    const plan = resolveContainerPlan(o, { container_count: 2, container_type: "40' HC" });
    expect(plan.ambiguous).toBe(true);
    expect(plan.totalCount).toBe(0);
    expect(plan.groups).toEqual([]);
    expect(plan.legacyType).toBeNull();
    expect(plan.isFcl).toBe(false);
  });

  it("un volume annoncé contredisant le détail ne publie aucun conteneur", () => {
    const o = parseTextOverrides("Nous avons 2 conteneurs, dont 1 x 40HC.");
    expect(o.containers_ambiguous).toBe(true);
    expect(o.container_count).toBeUndefined();
  });

  it("un volume annoncé cohérent avec le détail est accepté", () => {
    const o = parseTextOverrides("Nous avons 2 conteneurs : 1 x 20 pieds Dry et 1 x 40 pieds Dry.");
    expect(o.containers_ambiguous).toBeUndefined();
    expect(o.container_count).toBe(2);
    expect(o.containers).toEqual([
      { count: 1, type: "20' Dry" },
      { count: 1, type: "40' Dry" },
    ]);
  });

  it("détail multi-groupes sans total annoncé : pas de faux conflit", () => {
    const o = parseTextOverrides("2 conteneurs 40' et 3 x 20 pieds Dry.");
    expect(o.containers_ambiguous).toBeUndefined();
    expect(o.container_count).toBe(5);
    expect(o.containers).toEqual([
      { count: 2, type: "40'" },
      { count: 3, type: "20' Dry" },
    ]);
  });

  it("aucune mention conteneur : rien n'est inventé", () => {
    const o = parseTextOverrides("Merci de coter 12 palettes de riz vers Bamako.");
    expect(o.containers).toBeUndefined();
    expect(o.container_count).toBeUndefined();
    const plan = resolveContainerPlan(o, {});
    expect(plan.totalCount).toBe(0);
    expect(plan.isFcl).toBe(false);
    expect(plan.ambiguous).toBe(false);
  });
});

describe("resolveContainerPlan — fusion overrides / analyse document", () => {
  it("mono-type : conserve le type legacy", () => {
    const plan = resolveContainerPlan(parseTextOverrides("20 x 40' HC"), {});
    expect(plan.totalCount).toBe(20);
    expect(plan.legacyType).toBe("40' HC");
    expect(plan.isFcl).toBe(true);
  });

  it("retombe sur l'analyse document quand le texte est muet", () => {
    const plan = resolveContainerPlan({}, { container_count: 4, container_type: "40' HC" });
    expect(plan.totalCount).toBe(4);
    expect(plan.legacyType).toBe("40' HC");
    expect(plan.groups).toEqual([{ count: 4, type: "40' HC" }]);
    expect(plan.isFcl).toBe(true);
  });

  it("compte sans type : ni type legacy ni bascule FCL", () => {
    const plan = resolveContainerPlan(parseTextOverrides("Nous avons 3 conteneurs."), {});
    expect(plan.totalCount).toBe(3);
    expect(plan.legacyType).toBeNull();
    expect(plan.groups).toEqual([{ count: 3, type: null }]);
    expect(plan.isFcl).toBe(false);
  });
});
