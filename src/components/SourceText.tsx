import type { ReactNode } from "react";
import { sourcePresentation } from "@/lib/sourcePresentation";

/** Keep the original source available without exposing machine identifiers by default. */
export function SourceText({ text, label, className = "text-sm" }: {
  text: string; label?: string; className?: string;
}) {
  const presentation = sourcePresentation(text);
  return <div className={`min-w-0 [overflow-wrap:anywhere] ${className}`}>
    <p>{label && `${label} : `}{presentation.text}</p>
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
