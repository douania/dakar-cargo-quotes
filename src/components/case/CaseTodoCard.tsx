import { Button } from "@/components/ui/button";
import { ReservationList } from "@/components/case/ReservationList";
import { readableReservationText } from "@/lib/reservationPresentation";
import { SourceText } from "@/components/SourceText";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatScenarioPricingAmount } from "@/lib/scenarioPricing";
import type { QuotationPreparationSummary } from "@/components/puzzle/SendQuotationPanel";
import { guidedActionLabel, guidedSituation, type GuidedQuoteSummary, type PilotageAction } from "@/pages/case-view/presentation";

interface Props {
  status: string;
  action: PilotageAction | null;
  quote: GuidedQuoteSummary | null;
  loading: boolean;
  error: boolean;
  missingItems: Array<{ id: string; label: string }>;
  missingLoading: boolean;
  missingError: boolean;
  preparation: QuotationPreparationSummary | null;
  onAction: (action: PilotageAction) => void;
  onOpen: (section: string) => void;
}

export function CaseTodoCard({ status, action, quote, loading, error, missingItems, missingLoading, missingError, preparation, onAction, onOpen }: Props) {
  const showMissing = missingError || missingLoading || missingItems.length > 0;
  const reviewBeforeSending = action?.kind === "mark_sent" && quote && quote.qualificationLevel !== "firm";
  const reviewLabel = quote?.qualificationLevel === "unknown"
    ? "Vérifier la qualification du devis" : "Relire le devis et ses réserves";
  return <section aria-label="À faire dans le dossier" className="space-y-4">
    <div className="space-y-1 text-sm font-medium" role="status">
      <p>{error ? "Le suivi du dossier n’a pas pu être actualisé."
        : loading ? "Actualisation du suivi…" : guidedSituation(status, action)}</p>
      {!loading && !error && quote && <p className={quote.qualificationLevel === "firm" ? "text-muted-foreground" : "text-primary"}>
        Version v{quote.versionNumber} · {quote.qualification}
      </p>}
    </div>
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-lg">Prochaine action conseillée</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error || loading ? <p className="text-sm text-muted-foreground">Les rubriques restent accessibles. Leurs contrôles vérifieront les données avant toute action.</p>
          : action ? <>
            <p className="text-sm text-muted-foreground">{reviewBeforeSending
              ? quote.qualificationLevel === "unknown"
                ? "La qualification de cette version reste à vérifier avant de la partager."
                : "Relisez les réserves avec le montant avant de partager cette version. Un PDF et un brouillon préparés ne lèvent pas les réserves."
              : action.kind === "blocking_gap"
              ? "Une ou plusieurs informations nécessitent votre attention avant le calcul."
              : action.blocker.replace(/pricing/gi, "calcul du devis").replace(/scope/gi, "périmètre")}</p>
            <Button onClick={() => onAction(action)} className="h-auto min-h-11 max-w-full whitespace-normal text-left">{reviewBeforeSending ? reviewLabel : guidedActionLabel(action)}</Button>
          </> : <p className="text-sm">{["SENT", "ACCEPTED", "REJECTED", "ARCHIVED"].includes(status)
            ? "Consultez la version et les échanges du dossier."
            : status === "PRICING_RUNNING" ? "Le résultat apparaîtra à la fin du calcul."
            : "Aucune action automatique proposée. Consultez les informations et documents pour vérifier la suite du dossier."}</p>}
      </CardContent>
    </Card>
    {!loading && !error && <div className="grid items-start gap-4 lg:grid-cols-2">
    {showMissing ? <section aria-label="Informations à compléter" className="min-w-0 space-y-3 rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="text-lg font-semibold">À vérifier avant le calcul</h2>
      {missingError ? <p className="text-sm" role="status">Impossible d’actualiser les informations manquantes. Ouvrez les contrôles du dossier.</p>
        : missingLoading ? <p className="text-sm" role="status">Actualisation des informations manquantes…</p>
        : <>
          <ul className="space-y-2">{missingItems.slice(0, 3).map(item => <li key={item.id}>
            <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-left justify-start [overflow-wrap:anywhere]" onClick={() => onOpen(`gap:${item.id}`)}>{item.label}</Button>
          </li>)}</ul>
          {missingItems.length > 3 && <p className="text-sm text-muted-foreground">Et {missingItems.length - 3} autre(s) information(s) à vérifier.</p>}
        </>}
      <Button variant="link" className="h-auto min-h-11 max-w-full whitespace-normal px-0 text-left" onClick={() => onOpen("controls")}>Voir tous les contrôles et leurs sources</Button>
    </section> : quote && <section aria-label="Vérifications avant partage" className="min-w-0 space-y-3 rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{quote.qualificationLevel === "firm" ? "Dernière vérification" : "Avant de partager le devis"}</h2>
      <p className="text-sm">{quote.qualificationLevel === "partial"
        ? "Des postes restent à confirmer et sont exclus du total affiché. Vérifiez leur périmètre dans la version sélectionnée."
        : quote.qualificationLevel === "provisional"
          ? "Cette version comporte des réserves. Elles doivent rester visibles dans le PDF et dans le message client."
          : quote.qualificationLevel === "unknown"
            ? "La qualification de cette version n’est pas disponible. Consultez ses bases avant de la partager."
            : "Vérifiez que le PDF, le destinataire et le message correspondent à la version sélectionnée."}</p>
      <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => onOpen("devis")}>Consulter les bases du devis</Button>
      <p className="text-sm text-muted-foreground">L’envoi reste manuel hors application. Le marquage comme envoyé se fait après l’envoi effectif.</p>
    </section>}
    <section className={`min-w-0 space-y-3 rounded-lg border bg-card p-4 sm:p-6${!showMissing && !quote ? " lg:col-span-2" : ""}`} aria-label="Document destiné au client">
      <h2 className="text-lg font-semibold">Ce que le client recevra</h2>
      <p className="text-sm font-medium">{quote ? `Version v${quote.versionNumber} destinée au client` : "Aucune version client sélectionnée"}</p>
      {quote ? <>
        <p className={`text-sm font-medium${quote.qualificationLevel === "firm" ? "" : " text-primary"}`}>{quote.qualification}</p>
        <p className="text-2xl font-semibold [overflow-wrap:anywhere]">{quote.amount
          ? formatScenarioPricingAmount(quote.amount.amount, quote.amount.currency) : "Montant non disponible"}</p>
        {quote.projection?.totalNote && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{quote.projection.totalNote}</p>}
        {quote.pendingItems.length > 0 && <div className="space-y-1">
          <p className="text-sm font-medium">Postes à confirmer, exclus du total ({quote.pendingItems.length})</p>
          <ul className="list-disc space-y-1 pl-5 text-sm [overflow-wrap:anywhere]">
            {Array.from(quote.pendingItems.map(readableReservationText).reduce((counts, text) => counts.set(text, (counts.get(text) ?? 0) + 1), new Map<string, number>()))
              .map(([text, count]) => <li key={text}>{text}{count > 1 ? ` (×${count})` : ""}</li>)}
          </ul>
        </div>}
        {quote.projection ? <>
          {quote.projection.bases.length > 0 && <div className="space-y-1">
            <p className="text-sm font-medium">Bases de cotation</p>
            <ul className="list-disc space-y-1 pl-5 text-sm [overflow-wrap:anywhere]">{quote.projection.bases.map(base => <li key={base}><SourceText text={base} /></li>)}</ul>
          </div>}
          {/* The pending list above already names the uncosted items. */}
          <ReservationList title="Conditions particulières" noun={["condition", "conditions"]} visible={4}
            texts={quote.projection.conditions.filter(condition => !condition.startsWith("Postes non chiffrés"))} />
          {quote.projection.general.length > 0 && <details className="text-sm">
            <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Conditions générales ({quote.projection.general.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">{quote.projection.general.map(text => <li key={text}>{text}</li>)}</ul>
          </details>}
          {quote.reservations.length > 0 && <details className="text-sm">
            <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Détail opérateur : réserves enregistrées ({quote.reservations.length})</summary>
            <div className="mt-2"><ReservationList texts={quote.reservations} visible={Number.POSITIVE_INFINITY} /></div>
          </details>}
        </> : <ReservationList title="Réserves de cette version" texts={quote.reservations} />}
        <p className="text-sm text-muted-foreground">Vérifiez la version, le PDF, le destinataire et le message avant l’envoi manuel.</p>
        <section aria-label="Préparation de la version sélectionnée" className="space-y-2 border-t pt-3 text-sm [overflow-wrap:anywhere]">
          {!preparation ? <p role="status">Éléments de cette version à vérifier dans « Devis ».</p>
            : preparation.error ? <p role="status">Les éléments d’envoi n’ont pas pu être actualisés. Vérifiez-les dans le panneau d’envoi.</p>
            : preparation.loading ? <p role="status">Actualisation des éléments de cette version…</p>
            : <>
              <p>PDF client : {preparation.hasPdf ? "disponible, à relire" : "non disponible dans cette vue — à vérifier"}.</p>
              <p>Destinataire enregistré : {preparation.recipient.trim() || "à renseigner"}</p>
              <p>Objet enregistré : {preparation.subject.trim() || "à renseigner"}</p>
              <p>Message : {preparation.hasMessage ? "enregistré, à relire" : preparation.hasDraft ? "à compléter" : "brouillon à préparer"}.</p>
              {preparation.unsaved && <p role="status" className="font-medium">Modifications non enregistrées : le résumé ci-dessus montre la dernière sauvegarde.</p>}
            </>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => onOpen("pdf")}>Vérifier le PDF client</Button>
            <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => onOpen("send")}>Relire le destinataire et le message</Button>
          </div>
        </section>
      </> : <p className="text-sm text-muted-foreground">Les estimations et calculs éventuels sont consultables dans « Devis ». Ils ne constituent pas une version client sélectionnée.</p>}

    </section>
    </div>}

  </section>;
}
