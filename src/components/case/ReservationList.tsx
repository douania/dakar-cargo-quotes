import { SourceText } from "@/components/SourceText";
import { prioritizeReservations, readableReservations } from "@/lib/reservationPresentation";

/**
 * Display only: every recorded reservation stays reachable; the same reservation repeated per lot
 * is shown once, unknown/excluded/to-confirm points come first, and only the first ones are open.
 * Long texts fold inside SourceText.
 */
export function ReservationList({ texts, title, visible = 3, noun = ["réserve", "réserves"] }: {
  texts: string[]; title?: string; visible?: number; noun?: [string, string];
}) {
  const items = prioritizeReservations(readableReservations(texts));
  if (items.length === 0) return null;
  const shown = items.slice(0, visible);
  const rest = items.slice(visible);
  const list = (entries: typeof items) => <ul className="list-disc space-y-2 pl-5 text-sm [overflow-wrap:anywhere]">
    {entries.map(item => <li key={item.key}><SourceText text={item.text} /></li>)}
  </ul>;
  return <section aria-label={title} className="space-y-2">
    {title && <p className="text-sm font-medium">{title} ({items.length})</p>}
    {list(shown)}
    {rest.length > 0 && <details>
      <summary className="cursor-pointer rounded-sm text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Voir {rest.length > 1 ? `les ${rest.length} autres ${noun[1]}` : `l’autre ${noun[0]}`}
      </summary>
      <div className="mt-2">{list(rest)}</div>
    </details>}
  </section>;
}
