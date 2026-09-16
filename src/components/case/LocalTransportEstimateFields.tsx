import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { emptyTransportEstimateBasis } from "@/lib/scenarioAssumptions";
import { RoadDistanceProposal } from "./RoadDistanceProposal";
const blankGroup = () => ({ unit_ref: "", equipment_code: "", quantity: null, weight_per_container_kg: null,
  max_payload_kg: null, ordinary_transport: false, qualification_source: "" });

/** Edits only the existing assumption draft. No database/pricing side effects. */
export function LocalTransportEstimateFields({ value, onChange, caseId }: { value: string | boolean; onChange: (v: string) => void; caseId?: string }) {
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : emptyTransportEstimateBasis();
  } catch { data = emptyTransportEstimateBasis(); }
  const groups = (Array.isArray(data.groups) ? data.groups : []) as Record<string, unknown>[];
  const change = (patch: Record<string, unknown>) => onChange(JSON.stringify({ ...data,
    ...('destination' in patch ? { distance_km: null, distance_source: '', verified_on: '' } : {}),
    ...('distance_km' in patch ? { distance_source: '', verified_on: '' } : {}), ...patch }));
  const field = (label: string, key: string, row: Record<string, unknown>, update: (p: Record<string, unknown>) => void, type = "text") => (
    <label className="block space-y-1" key={key}>
      <span>{label}</span>
      <Input type={type} value={typeof row[key] === "string" || typeof row[key] === "number" ? String(row[key]) : ""}
        onChange={e => update({ [key]: type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })}
        className="h-8 text-xs" />
    </label>
  );
  return <fieldset className="space-y-3 rounded border p-3 text-xs">
    <legend>Transport ordinaire — destination hors barème</legend>
    <p>Estimation seulement, import au Sénégal depuis Dakar Port. Distance routière &gt; 58 km ; aucun tarif existant remplacé.
      Enregistrer cette hypothèse, puis la lier à la révision du scénario à calculer.</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {field("Destination exacte", "destination", data, change)}
      {field("Distance routière depuis Dakar Port (km)", "distance_km", data, change, "number")}
      {field("Source de la distance et itinéraire vérifié", "distance_source", data, change)}
      {field("Date de vérification", "verified_on", data, change, "date")}
    </div>
    {caseId && <RoadDistanceProposal caseId={caseId} value={value} onChange={onChange} />}
    {groups.map((raw, i) => {
      const g = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const update = (p: Record<string, unknown>) => change({ groups: groups.map((row, n) => n === i ? { ...row, ...p } : row) });
      return <fieldset key={i} className="border rounded p-2 space-y-2">
        <legend>Lot admissible {i + 1}</legend>
        {g !== raw && <p role="alert">Lot malformé : corriger les données avant enregistrement.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {field("Référence du lot dans le scénario", "unit_ref", g, update)}
          {field("Code équipement exact (ex. 20GP)", "equipment_code", g, update)}
          {field("Nombre de conteneurs", "quantity", g, update, "number")}
          {field("Poids marchandise par conteneur (kg)", "weight_per_container_kg", g, update, "number")}
          {field("Charge marchandise admissible vérifiée (kg)", "max_payload_kg", g, update, "number")}
          {field("Source capacité conteneur ET véhicule / conditions de transport", "qualification_source", g, update)}
        </div>
        <label className="flex items-start gap-2">
          <Checkbox checked={g.ordinary_transport === true} onCheckedChange={v => update({ ordinary_transport: v === true })} />
          <span>J’atteste un transport ordinaire sans hors-gabarit, véhicule spécial ni contrainte particulière ; la charge admissible respecte le conteneur et le véhicule routier. Le moteur vérifiera aussi le poids, le type et le statut dangereux du lot.</span>
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={() => change({ groups: groups.filter((_, n) => n !== i) })}>Retirer ce lot</Button>
      </fieldset>;
    })}
    <Button type="button" variant="outline" size="sm" disabled={groups.length >= 12} onClick={() => change({ groups: [...groups, blankGroup()] })}>Ajouter un lot admissible</Button>
    <p className="text-muted-foreground">Lots dangereux, spéciaux, de poids inconnu ou dépassant la charge justifiée : transport non chiffré par cette formule. Retour vide et autres prestations restent distincts.</p>
  </fieldset>;
}
