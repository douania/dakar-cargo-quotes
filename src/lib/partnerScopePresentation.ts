const REASON_PRESENTATIONS: ReadonlyArray<[RegExp, string]> = [
  [/^\S+ explicitement hors périmètre$/, "Explicitement hors périmètre du devis"],
  [/^\S+ confirmé \(scope \+ facts\)$/, "Confirmé : périmètre et données présents"],
  [/^\S+ dans le scope mais facts insuffisants$/, "Dans le périmètre, mais données insuffisantes"],
  [/^\S+ : signal scope absent$/, "Aucun signal de périmètre dans le dossier"],
];

export function presentPartnerScopeReason(reason: string): string {
  return REASON_PRESENTATIONS.find(([pattern]) => pattern.test(reason))?.[1] ?? reason;
}

export function getPartnerScopeExplanation(qualification: string, isDapDdp: boolean, explanation: string) {
  return qualification === "out_of_scope" && isDapDdp
    ? "Hors périmètre DAP de ce devis. À solliciter seulement si le client demande le fret."
    : presentPartnerScopeReason(explanation);
}