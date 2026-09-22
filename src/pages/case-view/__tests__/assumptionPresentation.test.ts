import { describe, expect, it } from "vitest";
import {
  presentAssumptionValue,
  technicalAssumptionValue,
} from "../assumptionPresentation";

describe("présentation des hypothèses", () => {
  it("présente le transport sans modifier l'entrée", () => {
    const value = {
      schema_version: 1,
      origin: "Dakar Port",
      destination: "Ndioum",
      distance_km: 468,
      distance_source: "Itinéraire vérifié",
      verified_on: "2026-09-21",
      groups: [{ unit_ref: "lot-a", equipment_code: "20GP", quantity: 1,
        weight_per_container_kg: 10000, max_payload_kg: null, ordinary_transport: false,
        qualification_source: "Décision opérateur" }],
    };
    const before = JSON.stringify(value);
    const result = presentAssumptionValue({ scopeKey: "case", assumptionType: "other",
      assumedFactKey: "routing.local_transport_estimate", valueType: "json", value });
    expect(result.scopeLabel).toBe("Dossier");
    expect(result.typeLabel).toBe("Estimation du transport local");
    expect(result.groups.flatMap(group => group.rows)).toEqual(expect.arrayContaining([
      { label: "Destination", value: "Ndioum" },
      { label: "Distance", value: "468 km" },
      { label: "Équipement", value: "20GP" },
      { label: "Poids par conteneur", value: "10 000 kg" },
    ]));
    expect(JSON.stringify(value)).toBe(before);
  });

  it("présente le séjour et réserve le JSON inconnu au détail technique", () => {
    const stay = presentAssumptionValue({ scopeKey: "lot:2", assumptionType: "other",
      assumedFactKey: "pricing.container_stay_estimate", valueType: "json", value: {
        source: "Instruction opérateur", verified_on: "2026-09-21",
        groups: [{ unit_ref: "lot-b", equipment_code: "40HC", quantity: 2,
          ownership: "COC", provider: "DPW", storage_days: 12, demurrage_days: 15,
          storage_p1_code: "412" }],
      } });
    expect(stay.scopeLabel).toBe("Lot 2");
    expect(stay.groups.flatMap(group => group.rows)).toEqual(expect.arrayContaining([
      { label: "Opérateur terminal", value: "DPW" },
      { label: "Durée de magasinage", value: "12 jours" },
      { label: "Désignation magasinage", value: "412" },
    ]));

    const unknown = { unexpected: { raw: true } };
    const fallback = presentAssumptionValue({ scopeKey: "case", assumptionType: "other",
      assumedFactKey: "future.structured_key", valueType: "json", value: unknown });
    expect(fallback.groups[0].rows[0].value).toBe("Données structurées à consulter");
    expect(fallback.groups[0].rows[0].value).not.toContain("unexpected");
    expect(technicalAssumptionValue(unknown)).toContain('"unexpected"');
  });
});