import type { ReactNode } from "react";
import { sourcePresentation } from "@/lib/sourcePresentation";
import { readableReservationText, shortenText } from "@/lib/reservationPresentation";

const foldSummaryClass = "cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Keep the original source available without exposing machine identifiers by default.
 * Known codes are translated and long texts open on their first sentence; the complete readable
 * text and the exact recorded original stay one click away. Display only.
 */
export function SourceText({ text, label, className = "text-sm", unfolded = false }: {
  text: string; label?: string; className?: string;
  /** Show the whole readable text at once (dialogs where every word must be read before acting). */
  unfolded?: boolean;
}) {
  // Runtime rows may carry null in fields typed as text: render nothing rather than crash the panel.
  if (typeof text !== "string" || !text.trim()) return null;
  const presentation = sourcePresentation(readableReservationText(text));
  const { summary, truncated } = unfolded ? { summary: presentation.text, truncated: false } : shortenText(presentation.text);
  return <div className={`min-w-0 [overflow-wrap:anywhere] ${className}`}>
    <p>{label && `${label} : `}{summary}</p>
    {truncated && <details className="mt-1">
      <summary className={foldSummaryClass}>Lire la suite</summary>
      <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{presentation.text}</p>
    </details>}
    {presentation.technical && <details className="mt-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Détails techniques de la source</summary>
      <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
    </details>}
  </div>;
}

/** The original field and its handlers stay mounted; its value is never rewritten. */
export function SourceNoteEditor({ value, children }: { value: string; children: ReactNode }) {
  const presentation = sourcePresentation(value);
  return <div className="min-w-0 space-y-2">
    {presentation.technical && <p className="text-sm [overflow-wrap:anywhere]">{presentation.text}</p>}
    <details open={!presentation.technical || undefined} className="min-w-0">
      <summary className={presentation.technical ? "cursor-pointer text-sm rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "hidden"}>Modifier la justification et ses références</summary>
      {children}
    </details>
  </div>;
}
