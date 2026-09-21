import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { emptyTransportEstimateBasis } from "@/lib/scenarioAssumptions";
import { RoadDistanceProposal } from "./RoadDistanceProposal";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { proposeTransportGroups } from "@/lib/transportGroupProposal";
const blankGroup = () => ({ unit_ref: "", equipment_code: "", quantity: null, weight_per_container_kg: null,
  max_payload_kg: null, ordinary_transport: false, standard_estimate_only: false, qualification_source: "" });

/** Edits only the existing assumption draft. No database/pricing side effects. */
export function LocalTransportEstimateFields({ value, onChange, caseId }: { value: string | boolean; onChange: (v: string) => void; caseId?: string }) {
  const current = useRef({ value, caseId }); current.current = { value, caseId };
  const [loading, setLoading] = useState(false);
  const [proposalMessage, setProposalMessage] = useState('');
  async function proposeGroups() {
    const initial = { value, caseId };
    setLoading(true); setProposalMessage('');
    try {
      const selection = await supabase.from('quote_scenario_selections').select('scenario_id')
        .eq('case_id', caseId!).is('released_at', null).maybeSingle();
      if (selection.error || !selection.data) throw new Error('Sélectionnez un scénario avant de proposer ses lots.');
      const result = await supabase.from('quote_scenarios').select('id,scope_hash,scope_snapshot')
        .eq('case_id', caseId!).eq('id', selection.data.scenario_id).single();
      if (result.error || !result.data) throw new Error('Les lots du scénario ne sont pas accessibles.');
      if (current.current.value !== initial.value || current.current.caseId !== initial.caseId) {
        setProposalMessage('Le formulaire a changé : relancez la proposition.'); return;
      }
      const proposal = proposeTransportGroups(result.data.scope_snapshot);
      const draft = JSON.parse(String(initial.value));
      if (Array.isArray(draft.groups) && draft.groups.length) throw new Error('Les lots déjà saisis sont conservés : retirez-les avant une nouvelle proposition.');
      onChange(JSON.stringify({ ...draft, groups: proposal.groups,
        scenario_source: { id: result.data.id, scope_hash: result.data.scope_hash } }));
      const provisional = proposal.groups.filter(group => group.standard_estimate_only === true).length;
      setProposalMessage(`${proposal.groups.length} lot(s) proposé(s), dont ${provisional} avec estimation standard provisoire. ${proposal.excluded.join(' ')}`);
    } catch (error) { setProposalMessage(error instanceof Error ? error.message : 'Proposition indisponible. Saisie manuelle possible.'); }
    finally { setLoading(false); }
  }
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
    {caseId && <Button type="button" variant="outline" size="sm" disabled={loading || groups.length > 0} onClick={proposeGroups}>
      {loading ? 'Lecture des lots…' : 'Proposer les lots depuis le scénario sélectionné'}
    </Button>}
    {proposalMessage && <p role="status">{proposalMessage}</p>}
    {groups.map((raw, i) => {
      const g = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const update = (p: Record<string, unknown>) => change({ groups: groups.map((row, n) => n === i ? { ...row, ...p } : row) });
      return <fieldset key={i} className="border rounded p-2 space-y-2">
        <legend>Lot à estimer {i + 1}</legend>
        {g !== raw && <p role="alert">Lot malformé : corriger les données avant enregistrement.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {field("Référence du lot dans le scénario", "unit_ref", g, update)}
          {field("Code équipement exact (ex. 20GP)", "equipment_code", g, update)}
          {field("Nombre de conteneurs", "quantity", g, update, "number")}
          {field("Poids marchandise par conteneur (kg)", "weight_per_container_kg", g, update, "number")}
          {g.standard_estimate_only !== true && field("Charge marchandise admissible vérifiée (kg)", "max_payload_kg", g, update, "number")}
          {g.standard_estimate_only !== true && field("Source capacité conteneur ET véhicule / conditions de transport", "qualification_source", g, update)}
        </div>
        {g.standard_estimate_only === true ? <div className="space-y-2 rounded border border-amber-500/40 bg-amber-500/5 p-2">
          <p><strong>Estimation standard provisoire.</strong> Ce lot peut être chiffré sans attendre les limites par essieu. Le véhicule, sa tare, sa répartition par essieu et son affectation restent à confirmer ; le seuil interne de 18&nbsp;000 kg n’est pas une limite réglementaire.</p>
          <p className="text-muted-foreground">Base : {String(g.qualification_source)}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => update({ standard_estimate_only: false,
            qualification_source: '', unknown_danger_base_only: false })}>Passer en qualification véhicule vérifiée</Button>
        </div> : <label className="flex items-start gap-2">
          <Checkbox checked={g.ordinary_transport === true} onCheckedChange={v => update({ ordinary_transport: v === true })} />
          <span>J’atteste un transport ordinaire sans hors-gabarit, véhicule spécial ni contrainte particulière ; la charge admissible respecte le conteneur et le véhicule routier. Le moteur vérifiera aussi le poids, le type et le statut dangereux du lot.</span>
        </label>}
        <label className="flex items-start gap-2">
          <Checkbox checked={g.unknown_danger_base_only === true} onCheckedChange={v => update({ unknown_danger_base_only: v === true })} />
          <span>Si le danger est inconnu, retenir uniquement une base estimative hors supplément IMO, avec réserve visible. Cela ne confirme pas une marchandise non dangereuse ni l’acceptation du transporteur.</span>
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={() => change({ groups: groups.filter((_, n) => n !== i) })}>Retirer ce lot</Button>
      </fieldset>;
    })}
    <Button type="button" variant="outline" size="sm" disabled={groups.length >= 12} onClick={() => change({ groups: [...groups, blankGroup()] })}>Ajouter un lot</Button>
    <p className="text-muted-foreground">Les TC standards jusqu’à 18&nbsp;000 kg peuvent recevoir une estimation provisoire ; cela ne confirme ni le véhicule ni les limites par essieu. Lots connus dangereux, spéciaux, de poids inconnu ou plus lourds : qualification séparée. Danger inconnu : base seule avec réserve visible, jamais un supplément nul. Retour vide et autres prestations restent distincts.</p>
  </fieldset>;
}
