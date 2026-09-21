import { DEMURRAGE_EXAMPLE_DAYS, demurrageReferenceExample, type DemurrageComparison } from "../../../supabase/functions/_shared/demurrage-reference-information";
import { formatStayAmount, stayRange } from "../../../supabase/functions/_shared/stay-information";

/** Reference-only presentation, independent of the line amount and quote total. */
export function DemurrageReferenceComparison({ comparison: c }: { comparison: DemurrageComparison }) {
  return <section aria-label="Comparaison indicative des armateurs" className="space-y-3">
    <p className="font-medium">Indicatif — armateur à confirmer</p>
    <p>Lot : {c.quantity} × {c.equipment}. Sources consultées le {c.consulted_on}.</p>
    {c.reservations.slice(0, 3).map((reservation, i) => <p key={i}>{reservation}</p>)}
    {c.references.map(reference => <div key={reference.carrier} className="space-y-1">
      <h6 className="font-medium">{reference.carrier} — franchise de référence : {reference.free_days} jours calendaires</h6>
      <p className="text-xs">Barème effectif le {reference.effective_date}, publié jusqu’à nouvel avis.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <caption className="sr-only">Tranches de référence {reference.carrier}</caption>
        <thead><tr><th className="text-left p-2">Période</th><th className="text-right p-2">Taux par conteneur et par jour</th></tr></thead>
        <tbody>{reference.tiers.map(tier => <tr className="border-t" key={tier.from}>
          <td className="p-2">{stayRange(tier.from, tier.to)}</td>
          <td className="p-2 text-right">{formatStayAmount(tier.rate, reference.currency)}
            {reference.currency !== "XOF" && <> ≈ {formatStayAmount(Math.round(tier.rate * reference.xof_per_currency), "XOF")}</>}
          </td>
        </tr>)}</tbody>
      </table></div>
      <a className="underline text-xs" href={reference.source_url} target="_blank" rel="noopener noreferrer">Source officielle {reference.carrier}</a>
    </div>)}
    <div className="rounded bg-muted p-2 space-y-2">
      <p className="font-medium">Exemples sur ce lot — séjours hypothétiques, franchise comprise</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <caption className="sr-only">Coûts illustratifs pour {c.quantity} conteneurs, hors totaux</caption>
        <thead><tr><th className="text-left p-2">Séjour</th>{c.references.map(r => <th className="text-right p-2" key={r.carrier}>{r.carrier}</th>)}<th className="text-right p-2">Fourchette des deux références</th></tr></thead>
        <tbody>{DEMURRAGE_EXAMPLE_DAYS.map(days => {
          const examples = c.references.map(r => demurrageReferenceExample(r, c.quantity, days));
          const amounts = examples.map(e => e.xof_amount);
          return <tr key={days} className="border-t">
            <td className="p-2 whitespace-nowrap">{days} jours</td>
            {examples.map((example, i) => <td key={c.references[i].carrier} className="p-2 text-right whitespace-nowrap">{formatStayAmount(example.xof_amount, "XOF")}</td>)}
            <td className="p-2 text-right">{formatStayAmount(Math.min(...amounts), "XOF")} à {formatStayAmount(Math.max(...amounts), "XOF")}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p>Détail pour 15 jours : 10 jours de franchise de référence, puis 5 jours facturables.</p>
      {c.references.map(r => <p key={r.carrier}>{r.carrier} : {c.quantity} conteneur(s) × 5 jours × {formatStayAmount(r.tiers[0].rate, r.currency)} = {formatStayAmount(demurrageReferenceExample(r, c.quantity, 15).native_amount, r.currency)}.</p>)}
      <p>Illustrations non ajoutées aux totaux ; aucune durée retenue ou franchise applicable déduite.</p>
    </div>
    <p className="text-xs">Conversion informative : 1 EUR = 655,957 FCFA ; arrondi du total de chaque exemple au franc, pas du taux journalier. <a className="underline" href={c.conversion_source} target="_blank" rel="noopener noreferrer">Source BCEAO</a></p>
    {c.reservations.slice(3).map((reservation, i) => <p key={i}>{reservation}</p>)}
  </section>;
}
