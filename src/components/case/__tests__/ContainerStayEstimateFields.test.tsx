import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContainerStayEstimateFields } from "../ContainerStayEstimateFields";
import { stayBasisError, CONTAINER_STAY_KEY } from "../../../../supabase/functions/_shared/container-stay-estimate";
import { buildAssumptionRequestBody, type AssumptionDraft } from "@/lib/scenarioAssumptions";
afterEach(cleanup);
it("guided independent durations; no default duration, ownership or terminal, existing assumption API", () => {
  let raw = "";
  function Form() { const [value, set] = useState(JSON.stringify({ schema_version: 1, source: "", verified_on: "", groups: [] })); raw = value;
    return <ContainerStayEstimateFields value={value} onChange={set} />; }
  render(<Form />);
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fill("Source et convention de décompte du séjour", "Planning test ; terminal et armateur distincts"); fill("Date de vérification", "2026-09-16");
  fireEvent.click(screen.getByText("Ajouter un lot de séjour"));
  expect(JSON.parse(raw).groups[0]).toMatchObject({ storage_days: null, demurrage_days: null, ownership: "", provider: "UNKNOWN" });
  fill("Référence du lot dans le scénario", "lot-1"); fill("Code équipement exact", "40HQ"); fill("Nombre de conteneurs", "3"); fill("Propriété", "COC");
  fill("Jours magasinage terminal, franchise comprise", "8"); fill("Jours surestaries armateur, franchise comprise", "12");
  expect(stayBasisError(JSON.parse(raw))).toBeNull();
  expect(JSON.parse(raw).groups[0].storage_p1_code).toBeUndefined();
  fill("Code magasinage retenu sous hypothèse", "412");
  expect(JSON.parse(raw).groups[0].storage_p1_code).toBe("412");
  expect(stayBasisError(JSON.parse(raw))).toBeNull();
  const draft: AssumptionDraft = { statement: "Séjour estimé", basis: "Planning", assumptionType: "other", valueType: "json", valueInput: raw,
    scopeKey: "case", assumedFactKey: CONTAINER_STAY_KEY, gapKey: "", sourceType: "operator_guidance", riskLevel: "medium", clientVisible: true };
  const body = buildAssumptionRequestBody("11111111-1111-4111-8111-111111111111", "create", "stay-test-001", draft);
  expect(body.ok).toBe(true); expect(body.body?.assumed_value).toEqual(JSON.parse(raw));
  fill("Jours surestaries armateur, franchise comprise", ""); expect(JSON.parse(raw).groups[0].demurrage_days).toBeNull();
  expect(JSON.parse(raw).groups[0].storage_days).toBe(8);
  fireEvent.click(screen.getByText("Retirer ce lot")); expect(stayBasisError(JSON.parse(raw))).not.toBeNull();
});
it("malformed rows render without mutation and remain invalid", () => {
  const value = JSON.stringify({ schema_version: 1, source: "x", verified_on: "2026-09-16", groups: [null] });
  render(<ContainerStayEstimateFields value={value} onChange={() => { throw new Error("unexpected write"); }} />);
  expect(screen.getByRole("alert").textContent).toContain("Lot malformé"); expect(stayBasisError(JSON.parse(value))).not.toBeNull();
});
