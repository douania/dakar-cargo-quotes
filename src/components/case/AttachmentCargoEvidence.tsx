import { documentCargoEvidence } from "../../../supabase/functions/_shared/cargo-source-evidence";

const labels = { FOB: "FOB déclaré", freight: "Fret déclaré", insurance: "Assurance déclarée", total: "Total facture" };

/** Read-only source evidence. Never adopts a fact or invokes pricing. */
export function AttachmentCargoEvidence({ extractedData }: { extractedData: unknown }) {
  const evidence = documentCargoEvidence(extractedData);
  if (!evidence.money.length && !evidence.hsDeclared && evidence.cartons === null && evidence.grossKg === null && !evidence.groups.length) return null;
  return <details className="mt-1 text-xs font-normal text-muted-foreground">
    <summary className="cursor-pointer">Données déclarées dans le document</summary>
    <div className="mt-2 space-y-1 whitespace-normal [overflow-wrap:anywhere]">
      <p>Extraction à vérifier{evidence.confidence === null ? " — confiance non précisée" : ` — confiance ${Math.round(evidence.confidence * 100)} %`}</p>
      {evidence.cartons !== null && <p>{evidence.cartons} cartons déclarés</p>}
      {evidence.grossKg !== null && <p>Poids brut déclaré : {evidence.grossKg} kg</p>}
      {evidence.netKg !== null && <p>Poids net déclaré : {evidence.netKg} kg</p>}
      {evidence.money.map((m, i) => <p key={`${m.kind}-${i}`}>{labels[m.kind]} : {m.amount.toLocaleString("fr-FR")} {m.currency ?? "(devise non précisée)"}</p>)}
      {evidence.nonCommercial && <p className="font-medium text-warning">Facture non commerciale{evidence.paymentTerms ? ` — ${evidence.paymentTerms}` : ""}. Cette extraction ne valide pas la valeur douanière.</p>}
      {evidence.hsDeclared && <p>HS déclaré : {evidence.hsDeclared} ({evidence.hsDeclared.replace(/\D/g, "").length} chiffres). La classification douanière reste à confirmer.</p>}
      {evidence.groups.map((g, i) => <p key={i}>{g.count ?? "Nombre non précisé"} carton(s) : {g.length} × {g.width} × {g.height} {g.unit}</p>)}
      {!!evidence.groups.length && <p>Dimensions par carton ; aucun volume total calculé ici.</p>}
    </div>
  </details>;
}
