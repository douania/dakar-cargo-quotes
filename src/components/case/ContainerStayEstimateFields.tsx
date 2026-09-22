import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StorageDesignationProposal } from "./StorageDesignationProposal";
import { storageRateEstimate } from "../../../supabase/functions/_shared/storage-rate-estimate";
import { DPW_FRANCHISE_SOURCE } from "../../../supabase/functions/_shared/container-stay-estimate";

/** Draft only. No arbitrary default duration, tariff or carrier. */
export function ContainerStayEstimateFields({ value, onChange, caseId, onAdopt, proposalRevision }: { value: string | boolean; onChange: (v: string) => void;
  caseId?: string; proposalRevision?: string; onAdopt?: (value: string, evidence: string, unitRef: string) => void }) {
  let data: Record<string, unknown>;
  try { const parsed = JSON.parse(String(value)); data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { data = {}; }
  const groups: unknown[] = Array.isArray(data.groups) ? data.groups : [];
  const change = (patch: Record<string, unknown>) => onChange(JSON.stringify({ ...data, ...patch }));
  const field = (label: string, key: string, row: Record<string, unknown>, update: (p: Record<string, unknown>) => void, type = "text") =>
    <label className="block space-y-1" key={key}><span>{label}</span><Input type={type}
      value={typeof row[key] === "string" || typeof row[key] === "number" ? String(row[key]) : ""}
      onChange={e => update({ [key]: type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })} /></label>;
  return <fieldset className="space-y-3 rounded border p-3 text-xs"><legend>Séjour prévisionnel au terminal</legend>
    <p>Import Dakar/Sénégal uniquement. Deux durées distinctes, franchise comprise : décompte du terminal et décompte de l’armateur.
      Ne pas inclure la détention après sortie. Enregistrer puis lier cette hypothèse au scénario.
      L’armateur doit être renseigné séparément dans le dossier ou par une hypothèse liée.</p>
    <p>Vous pouvez enregistrer et relier une désignation magasinage DPW avant de connaître les durées.
      Laissez alors les deux durées vides : les taux sont informatifs, aucun coût de séjour n’est ajouté au total.</p>
    <p>Magasinage sec DPW : le code choisi permet une estimation à la tonne au-delà de la franchise.
      P1 = grille 2014 ×1,111 arrondi au franc ; 412 et 419 observés sur factures, autres codes à corroborer.
      P2/P3 restent ceux de la grille historique. Ce choix ne confirme ni la catégorie ni le tarif.
      Les surestaries en devise étrangère restent à confirmer. Aucun tarif ne se saisit ici.</p>
    {field("Source et convention de décompte du séjour", "source", data, change)}
    {field("Date de vérification", "verified_on", data, change, "date")}
    {groups.map((raw, i) => {
      const g = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const rate = g.provider === "DPW" && typeof g.storage_p1_code === "string" && /^41[0-9]$/.test(g.storage_p1_code)
        ? storageRateEstimate(g.storage_p1_code, "DPW") : null;
      const update = (p: Record<string, unknown>) => change({ groups: groups.map((row, n) => n === i ? { ...g, ...p } : row) });
      return <fieldset key={i} className="border rounded p-2 space-y-2"><legend>Lot {i + 1}</legend>
        {g !== raw && <p role="alert">Lot malformé : corriger avant enregistrement.</p>}
        {field("Référence du lot dans le scénario", "unit_ref", g, update)}
        {field("Code équipement exact", "equipment_code", g, update)}
        {field("Nombre de conteneurs", "quantity", g, update, "number")}
        {field("Jours magasinage terminal, franchise comprise", "storage_days", g, update, "number")}
        {caseId && onAdopt && <StorageDesignationProposal key={`${caseId}:${JSON.stringify(data)}:${proposalRevision ?? ""}`} caseId={caseId} group={g}
          onAdopt={(code, evidence) => onAdopt(JSON.stringify({ ...data, groups: groups.map((row, n) => n === i ? { ...g, storage_p1_code: code } : row) }), evidence, String(g.unit_ref))} />}
        <label className="block">Code magasinage retenu sous hypothèse<select aria-label="Code magasinage retenu sous hypothèse"
          value={String(g.storage_p1_code ?? "")} onChange={e => update({ storage_p1_code: e.target.value || null })}>
          <option value="">Non déterminé — ne pas chiffrer au-delà de la franchise</option>
          {Array.from({ length: 10 }, (_, n) => String(410 + n)).map(code => <option key={code} value={code}>
            {code} — {code === "412" ? "P1 observé DPW" : code === "419" ? "P1 observé TOM, application DPW sous hypothèse" : "P1 estimé, à corroborer"}
          </option>)}
        </select></label>
        {rate && <section aria-label={`Repères magasinage lot ${i + 1}`} className="rounded border p-2 space-y-1">
          <p>Franchise applicable : à confirmer pour ce lot. Référence DPW : 10 jours pour le sec en import local,
            sans validation ici des conditions IMO, température ou équipement.</p>
          <p>La grille Dakar Terminal indique 5 jours (10 pour le transit Mali) : cette franchise historique n’est pas substituée à celle de DPW.</p>
          <p>Aperçu du brouillon : code {rate.code} choisi sous hypothèse — estimation informative HT, à corroborer.
            Pour le retrouver dans une nouvelle estimation, enregistrer puis relier l’hypothèse et relancer le calcul isolé.</p>
          <ul className="list-disc pl-4">
            <li>Du 1er au 15e jour après franchise : {rate.p1} FCFA/tonne/jour.</li>
            <li>Du 16e au 30e jour après franchise : {rate.p2} FCFA/tonne/jour.</li>
            <li>À partir du 31e jour après franchise : {rate.p3} FCFA/tonne/jour.</li>
          </ul>
          <p>Si la franchise de 10 jours est applicable : J11–J25, J26–J40, puis J41 et suivants.
            Ce repère ne confirme ni une franchise ni une durée pour ce lot.</p>
          <p>P1 historique ×1,111 arrondi au franc ; P2/P3 historiques inchangés. Aucun tarif ferme.</p>
          {rate.observed_source && <p>P1 observé : {rate.observed_source}.
            {!rate.observed_for_provider && " Observation chez un autre opérateur, application DPW non corroborée."}</p>}
          {!rate.observed_source && <p>P1 estimé, à corroborer sur facture.</p>}
          <p>Sources : {rate.source} ; périodes et franchise historique p.4 ; {DPW_FRANCHISE_SOURCE}.</p>
        </section>}
        {field("Jours surestaries armateur, franchise comprise", "demurrage_days", g, update, "number")}
        <label className="block">Propriété<select aria-label="Propriété" value={String(g.ownership ?? "")} onChange={e => update({ ownership: e.target.value })}>
          <option value="">Choisir</option><option value="SOC">SOC</option><option value="COC">COC</option></select></label>
        <label className="block">Terminal retenu sous hypothèse<select aria-label="Terminal retenu sous hypothèse" value={String(g.provider ?? "UNKNOWN")} onChange={e => update({ provider: e.target.value })}>
          <option value="UNKNOWN">Non précisé / autre terminal</option><option value="DPW">DP World Dakar</option></select></label>
        <Button type="button" variant="ghost" onClick={() => change({ groups: groups.filter((_, n) => n !== i) })}>Retirer ce lot</Button>
      </fieldset>;
    })}
    <Button type="button" variant="outline" disabled={groups.length >= 12} onClick={() => change({ groups: [...groups,
      { unit_ref: "", equipment_code: "", quantity: null, ownership: "", storage_days: null, demurrage_days: null, provider: "UNKNOWN" }] })}>Ajouter un lot de séjour</Button>
  </fieldset>;
}
