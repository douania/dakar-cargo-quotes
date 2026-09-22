export function getPartnerScopeExplanation(qualification: string, isDapDdp: boolean, explanation: string) {
  return qualification === "out_of_scope" && isDapDdp
    ? "Hors périmètre DAP de ce devis. À solliciter seulement si le client demande le fret."
    : explanation;
}