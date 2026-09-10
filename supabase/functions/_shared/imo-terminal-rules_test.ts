/**
 * IMO-RULES-1 — Tests du résolveur des règles terminal IMO.
 *
 * Les cas reprennent les règles réelles de l'Annexe 1 v4.0, y compris ses deux
 * chevauchements. Enjeu : un régime de séjour erroné se traduit en surestaries
 * facturées ou omises.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveImoTerminalRule,
  type ImoTerminalRuleRow,
} from "./imo-terminal-rules.ts";

/** Extrait des règles telles qu'amorcées par la migration. */
const RULES: ImoTerminalRuleRow[] = [
  // Classe 1 — toute la classe, sous palan.
  {
    id: "r1", imdg_class: "1", un_scope: "ALL", un_numbers: [],
    pad_prior_approval: "YES", firefighter_supervision: true,
    storage_regime: "UNDER_TACKLE", storage_max_days: 0, transshipment_max_days: 0,
    loading_gate_in_hours_before_vessel: 12,
  },
  // Classe 3 — toute la classe, 3 jours.
  {
    id: "r3", imdg_class: "3", un_scope: "ALL", un_numbers: [],
    pad_prior_approval: "YES", firefighter_supervision: true,
    storage_regime: "MAX_3_DAYS", storage_max_days: 3, transshipment_max_days: 7,
  },
  // Classe 2.2 — régime non précisé au document.
  {
    id: "r22", imdg_class: "2.2", un_scope: "ALL", un_numbers: [],
    pad_prior_approval: "NO", firefighter_supervision: false,
    storage_regime: "NOT_SPECIFIED",
  },
  // Classe 4.1 — trois règles, dont le chevauchement 3231/3232.
  {
    id: "r41a", imdg_class: "4.1", un_scope: "LIST", un_numbers: [3221, 3222, 3231, 3232],
    pad_prior_approval: "YES", firefighter_supervision: false,
    storage_regime: "UNDER_TACKLE", storage_max_days: 0, transshipment_max_days: 0,
    loading_gate_in_hours_before_vessel: 12,
  },
  {
    id: "r41b", imdg_class: "4.1", un_scope: "LIST",
    un_numbers: [3231, 3232, 3233, 3234, 3235, 3236, 3237, 3238, 3239, 3240],
    pad_prior_approval: "YES", firefighter_supervision: true,
    storage_regime: "MAX_3_DAYS", storage_max_days: 3, transshipment_max_days: 7,
  },
  {
    id: "r41c", imdg_class: "4.1", un_scope: "OTHERS", un_numbers: [],
    pad_prior_approval: "NO", firefighter_supervision: null,
    storage_regime: "NOT_SPECIFIED",
  },
  // Classe 6.1 — liste sous palan, reste à 3 jours.
  {
    id: "r61a", imdg_class: "6.1", un_scope: "LIST",
    un_numbers: [1051, 1092, 1163, 1239, 1244, 1259, 1649, 2334, 1689],
    pad_prior_approval: "YES", firefighter_supervision: false,
    storage_regime: "UNDER_TACKLE", storage_max_days: 0, transshipment_max_days: 0,
    loading_gate_in_hours_before_vessel: 12,
  },
  {
    id: "r61b", imdg_class: "6.1", un_scope: "OTHERS", un_numbers: [],
    pad_prior_approval: "NO", firefighter_supervision: false,
    storage_regime: "MAX_3_DAYS", storage_max_days: 3, transshipment_max_days: 7,
  },
  // Classes interdites.
  {
    id: "r62", imdg_class: "6.2", un_scope: "ALL", un_numbers: [],
    pad_prior_approval: "FORBIDDEN", firefighter_supervision: null,
    storage_regime: "NOT_SPECIFIED",
  },
  {
    id: "r7", imdg_class: "7", un_scope: "ALL", un_numbers: [],
    pad_prior_approval: "FORBIDDEN", firefighter_supervision: null,
    storage_regime: "NOT_SPECIFIED",
  },
];

Deno.test("classe traitée d'un bloc : le numéro ONU n'est pas nécessaire", () => {
  // La procédure écrit la règle au niveau de la classe 1 ; le dossier porte une
  // division précise, ici 1.4 (explosifs à risque faible).
  const r = resolveImoTerminalRule(RULES, "1.4");

  assertEquals(r.status, "RESOLVED");
  assertEquals(r.storageRegime, "UNDER_TACKLE");
  assertEquals(r.storageMaxDays, 0);
  assertEquals(r.transshipmentMaxDays, 0);
  assertEquals(r.missing, []);
});

Deno.test("une règle écrite au niveau de la classe couvre toutes ses divisions", () => {
  for (const division of ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"]) {
    const r = resolveImoTerminalRule(RULES, division);
    assertEquals(r.rule?.id, "r1", `division ${division} n'a pas trouvé la règle de classe`);
  }
});

Deno.test("une règle de division ne déborde pas sur les divisions voisines", () => {
  // La règle 2.2 ne dit rien de 2.1 ni de 2.3.
  assertEquals(resolveImoTerminalRule(RULES, "2.1").rule, null);
  assertEquals(resolveImoTerminalRule(RULES, "2.3").rule, null);
  assertEquals(resolveImoTerminalRule(RULES, "2.2").rule?.id, "r22");
});

Deno.test("classe 3 : trois jours au terminal, sept en transbordement", () => {
  const r = resolveImoTerminalRule(RULES, "classe 3");

  assertEquals(r.status, "RESOLVED");
  assertEquals(r.storageMaxDays, 3);
  assertEquals(r.transshipmentMaxDays, 7);
  assertEquals(r.padPriorApproval, "YES");
});

Deno.test("le séjour standard de 15 jours n'est jamais retenu", () => {
  for (const cls of ["1.4", "3", "6.1"]) {
    const r = resolveImoTerminalRule(RULES, cls, "UN1051");
    if (r.storageMaxDays !== null) {
      assertEquals(r.storageMaxDays <= 3, true, `classe ${cls} a rendu ${r.storageMaxDays} jours`);
    }
  }
});

Deno.test("classe interdite : refus, quel que soit le numéro ONU", () => {
  for (const cls of ["6.2", "7"]) {
    const r = resolveImoTerminalRule(RULES, cls, "UN2814");
    assertEquals(r.status, "FORBIDDEN", `classe ${cls} n'a pas été refusée`);
    assertEquals(r.padPriorApproval, "FORBIDDEN");
  }
});

Deno.test("classe absente ou non reconnue : à confirmer, la donnée manquante est nommée", () => {
  for (const raw of [null, "", "4", "dangereux"]) {
    const r = resolveImoTerminalRule(RULES, raw);
    assertEquals(r.status, "TO_CONFIRM");
    assertEquals(r.missing, ["IMO_CLASS"]);
    assertEquals(r.rule, null);
  }
});

Deno.test("classe qui distingue ses numéros, numéro absent : à confirmer, jamais choisi au hasard", () => {
  const r = resolveImoTerminalRule(RULES, "4.1");

  assertEquals(r.status, "TO_CONFIRM");
  assertEquals(r.missing, ["UN_NUMBER"]);
  assertEquals(r.rule, null);
  assertEquals(r.storageMaxDays, null);
});

Deno.test("numéro visé par une seule règle : celle-ci s'applique", () => {
  const sousPalan = resolveImoTerminalRule(RULES, "4.1", "UN3221");
  assertEquals(sousPalan.rule?.id, "r41a");
  assertEquals(sousPalan.storageRegime, "UNDER_TACKLE");
  assertEquals(sousPalan.conflicting, false);

  const troisJours = resolveImoTerminalRule(RULES, "4.1", "UN3235");
  assertEquals(troisJours.rule?.id, "r41b");
  assertEquals(troisJours.storageMaxDays, 3);
});

Deno.test("chevauchement du document : la règle la plus restrictive gagne et le conflit est signalé", () => {
  for (const un of ["UN3231", "UN3232"]) {
    const r = resolveImoTerminalRule(RULES, "4.1", un);
    assertEquals(r.rule?.id, "r41a", `${un} n'a pas retenu la règle la plus restrictive`);
    assertEquals(r.storageRegime, "UNDER_TACKLE");
    assertEquals(r.conflicting, true);
    assertEquals(r.message.includes("deux régimes différents"), true);
  }
});

Deno.test("numéro hors des listes : la règle « les autres » s'applique", () => {
  const r = resolveImoTerminalRule(RULES, "6.1", "UN9999");

  assertEquals(r.rule?.id, "r61b");
  assertEquals(r.storageMaxDays, 3);
  assertEquals(r.conflicting, false);
});

Deno.test("numéro d'une liste : la liste prime sur « les autres »", () => {
  const r = resolveImoTerminalRule(RULES, "6.1", "1689");

  assertEquals(r.rule?.id, "r61a");
  assertEquals(r.storageRegime, "UNDER_TACKLE");
  assertEquals(r.storageMaxDays, 0);
});

Deno.test("régime non précisé au document : à confirmer, jamais un repli sur la franchise standard", () => {
  const r = resolveImoTerminalRule(RULES, "2.2");

  assertEquals(r.status, "TO_CONFIRM");
  assertEquals(r.storageRegime, "NOT_SPECIFIED");
  assertEquals(r.storageMaxDays, null);
  assertEquals(r.message.includes("non précisé"), true);
});

Deno.test("classe sans aucune règle connue : à confirmer", () => {
  const r = resolveImoTerminalRule([], "3");

  assertEquals(r.status, "TO_CONFIRM");
  assertEquals(r.rule, null);
});

Deno.test("chaque réponse porte une explication française non vide", () => {
  for (
    const r of [
      resolveImoTerminalRule(RULES, "1"),
      resolveImoTerminalRule(RULES, "4.1"),
      resolveImoTerminalRule(RULES, "4.1", "UN3231"),
      resolveImoTerminalRule(RULES, "6.2"),
      resolveImoTerminalRule(RULES, null),
    ]
  ) {
    assertEquals(typeof r.message, "string");
    assertEquals(r.message.trim().length > 0, true);
  }
});
