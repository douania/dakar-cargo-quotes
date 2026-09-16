import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocalTransportEstimateFields } from "../LocalTransportEstimateFields";
import { buildAssumptionRequestBody, emptyTransportEstimateBasis, type AssumptionDraft } from "@/lib/scenarioAssumptions";
import { LOCAL_TRANSPORT_ESTIMATE_KEY, transportEstimateBasisError } from "../../../../supabase/functions/_shared/local-transport-estimate";
import { QuoteScenarioAssumptionsPanel } from "../QuoteScenarioAssumptionsPanel";
import { scenarioPricingCodeMessage } from "@/lib/scenarioPricing";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}), useQuery: () => ({ data: [], isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }) }));

afterEach(cleanup);
it("une distance retouchée manuellement ne garde pas une provenance TomTom", () => {
  const change = vi.fn();
  render(<LocalTransportEstimateFields value={JSON.stringify({ ...emptyTransportEstimateBasis(), destination: 'Ville', distance_km: 300,
    distance_source: 'TomTom', verified_on: '2026-09-16' })} onChange={change} />);
  fireEvent.change(screen.getByLabelText('Distance routière depuis Dakar Port (km)'), { target: { value: '350' } });
  expect(JSON.parse(change.mock.calls[0][0])).toMatchObject({ distance_km: 350, distance_source: '', verified_on: '' });
});
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
it("saisie guidée sans qualification automatique, payload hypothèse existant et contrôles partagés", () => {
  let raw = "";
  function Form() {
    const [value, setValue] = useState(JSON.stringify(emptyTransportEstimateBasis())); raw = value;
    return <LocalTransportEstimateFields value={value} onChange={setValue} />;
  }
  render(<Form />);
  expect(transportEstimateBasisError(JSON.parse(raw))).not.toBeNull();
  fill("Destination exacte", "Ville test");
  fill("Distance routière depuis Dakar Port (km)", "300");
  fill("Source de la distance et itinéraire vérifié", "Carte routière test");
  fill("Date de vérification", "2026-09-16");
  fireEvent.click(screen.getByText("Ajouter un lot admissible"));
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  fill("Référence du lot dans le scénario", "lot-1");
  fill("Code équipement exact (ex. 20GP)", "20GP");
  fill("Nombre de conteneurs", "2");
  fill("Poids marchandise par conteneur (kg)", "10000");
  fill("Charge marchandise admissible vérifiée (kg)", "20000");
  fill("Source capacité conteneur ET véhicule / conditions de transport", "Fiche transporteur + plaque TC test");
  expect(transportEstimateBasisError(JSON.parse(raw))).not.toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(transportEstimateBasisError(JSON.parse(raw))).toBeNull();
  const draft: AssumptionDraft = { statement: "Transport ordinaire estimé", basis: "Source opérateur", assumptionType: "other",
    valueType: "json", valueInput: raw, scopeKey: "case", assumedFactKey: LOCAL_TRANSPORT_ESTIMATE_KEY, gapKey: "",
    sourceType: "operator_guidance", riskLevel: "medium", clientVisible: true };
  const result = buildAssumptionRequestBody("11111111-1111-4111-8111-111111111111", "create", "test-km-0001", draft);
  expect(result.ok).toBe(true);
  expect(result.body?.assumed_value).toEqual(JSON.parse(raw));
  expect(result.body?.assumed_fact_key).toBe(LOCAL_TRANSPORT_ESTIMATE_KEY);
  fill("Poids marchandise par conteneur (kg)", "55000");
  expect(buildAssumptionRequestBody("11111111-1111-4111-8111-111111111111", "create", "test-km-0002", { ...draft, valueInput: raw }).ok).toBe(false);
  fireEvent.click(screen.getByText("Retirer ce lot"));
  expect(JSON.parse(raw).groups).toEqual([]);
});
it("une hypothèse malformée reste révisable sans être silencieusement validée", () => {
  const raw = JSON.stringify({ ...emptyTransportEstimateBasis(), groups: [null] });
  render(<LocalTransportEstimateFields value={raw} onChange={() => { throw new Error("Mutation au rendu interdite"); }} />);
  expect(screen.getByRole("alert").textContent).toContain("Lot malformé");
  expect(transportEstimateBasisError(JSON.parse(raw))).not.toBeNull();
});
it("le raccourci ouvre les champs guidés sans JSON, sans qualifier ni enregistrer automatiquement", () => {
  render(<QuoteScenarioAssumptionsPanel caseId="11111111-1111-4111-8111-111111111111" />);
  fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
  fireEvent.click(screen.getByText("Préparer une estimation transport hors barème"));
  expect(screen.getByLabelText("Destination exacte")).toBeTruthy();
  expect(screen.queryByLabelText("Valeur supposée")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getByText(/Enregistrer cette hypothèse, puis la lier/)).toBeTruthy();
  expect(scenarioPricingCodeMessage("SCENARIO_TRANSPORT_KM_ESTIMATE")).toContain("indicatif");
});
