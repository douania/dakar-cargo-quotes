import { formatScenarioPricingAmount, readScenarioPricingCodes, scenarioPricingCodeMessage, type ScenarioPricingRunSummary } from "@/lib/scenarioPricing";
export interface SelectedScenarioEstimate {
  caseId: string; title: string; run: ScenarioPricingRunSummary | null; pending: boolean; error: string | null;
}
export function ScenarioEstimateResult({ estimate }: { estimate: SelectedScenarioEstimate }) {
  const { run, pending, error } = estimate;
  const lines = Array.isArray(run?.tariff_lines) ? run.tariff_lines as Record<string, unknown>[] : [];
  return <section aria-label="Résultat de l’estimation sélectionnée" className="rounded border p-3 space-y-2">
    <h3 className="font-semibold">Estimation — {estimate.title}</h3>
    {pending && <p role="status">Calcul en cours. Le résultat précédent ci-dessous n’est pas le résultat de cette relance.</p>}
    {error && <p role="alert">Dernière tentative non aboutie : {error}. Aucun nouveau montant validé.</p>}
    {!run && !error && !pending && <p>Aucune estimation pour ce scénario. Lancez le calcul après vérification des hypothèses.</p>}
    {run && <>
      <p className="text-xs">{pending || error ? "Dernier résultat enregistré" : "Résultat enregistré"} · exécution {run.run_seq} · {new Date(run.completed_at).toLocaleString("fr-FR")}</p>
      {run.status === "success" ? <>
        <p className="font-semibold">{run.qualification === "partial" ? "Sous-total indicatif des postes chiffrés" : "Total indicatif avec hypothèses"} : HT {formatScenarioPricingAmount(run.indicative_total_ht, run.currency)} · TTC {formatScenarioPricingAmount(run.indicative_total_ttc, run.currency)}</p>
        <p className="text-xs">Estimation non ferme, distincte du devis confirmé. Les postes à confirmer ne sont pas gratuits.</p>
        {lines.length > 0 && <table className="w-full text-xs"><caption className="text-left">Détail des prestations de cette estimation</caption>
          <thead><tr><th className="text-left">Prestation / groupe</th><th className="text-right">Montant</th><th className="text-left">Source ou réserve</th></tr></thead>
          <tbody>{lines.map((line, i) => {
            const source = line.source && typeof line.source === "object" ? line.source as Record<string, unknown> : {};
            const priced = typeof line.amount === "number" && Number.isFinite(line.amount) && source.type !== "TO_CONFIRM";
            return <tr key={`${String(line.id ?? "line")}-${i}`}><td>{String(line.description ?? line.category ?? "Prestation")}</td>
              <td className="text-right">{priced ? formatScenarioPricingAmount(line.amount as number, String(line.currency ?? run.currency)) : "À confirmer"}</td>
              <td>{String(priced ? source.reference ?? "Source non renseignée" : line.notes ?? source.reference ?? "Données ou tarif à préciser")}</td></tr>;
          })}</tbody></table>}
      </> : <p role="alert">{run.status === "blocked" ? "Calcul bloqué : aucun montant retenu." : "Calcul non abouti : aucun montant retenu."}</p>}
      {readScenarioPricingCodes([...(Array.isArray(run.blockers) ? run.blockers : []), ...(Array.isArray(run.reservations) ? run.reservations : [])]).map(code => <p className="text-xs" key={code}>{scenarioPricingCodeMessage(code)}</p>)}
    </>}
  </section>;
}
