/**
 * UI-P1-SEA-FREIGHT-HELPER-EXTRACT-1 — Pure helper module.
 * Maps the real state of the freight_rate partner request(s) to the UI action
 * shown for the SEA_FREIGHT blocking gap.
 * Shared by NextActionBanner and ReadyActionsPanel to avoid label divergence.
 * Pure module, zero React dependency.
 */

export const EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY = "pricing.sea_freight_partner_quote_required";

export type SeaFreightPartnerActionKind =
  | "prepare"
  | "confirm_send"
  | "waiting"
  | "process_response"
  | "validate_facts"
  | "verify";

export interface FreightRateRequestLite {
  status: string | null;
  email_sent_at: string | null;
  purpose?: string | null;
}

export interface SeaFreightPartnerActionSpec {
  kind: SeaFreightPartnerActionKind;
  title: string;
  status: "to_prepare" | "ready_to_send" | "waiting_response" | "to_execute";
  nextStep: string;
  reason: string;
}

/* Most advanced state wins when several freight_rate requests exist. */
function freightRequestRank(r: FreightRateRequestLite): number {
  switch (r.status) {
    case "response_received":
    case "response_analyzed":
      return 6;
    case "partially_validated":
      return 5;
    case "sent":
      return r.email_sent_at ? 4 : 3;
    case "draft":
      return 2;
    case "facts_validated":
    case "closed":
      return 1;
    default:
      return 0;
  }
}

export function computeSeaFreightPartnerAction(
  requests: FreightRateRequestLite[],
): SeaFreightPartnerActionSpec {
  const freightRequests = requests.filter((r) =>
    r.purpose === undefined ? true : r.purpose === "freight_rate",
  );

  if (freightRequests.length === 0) {
    return {
      kind: "prepare",
      title: "Préparer la demande partenaire freight_rate",
      status: "to_prepare",
      nextStep: "Créer une demande freight_rate puis l'envoyer au partenaire",
      reason: "Gap bloquant : offre maritime partenaire requise",
    };
  }

  const best = freightRequests.reduce((a, b) =>
    freightRequestRank(b) > freightRequestRank(a) ? b : a,
  );
  const bestRank = freightRequestRank(best);

  // Unknown status only → prefer a verification action over "Préparer".
  if (bestRank === 0) {
    return {
      kind: "verify",
      title: "Vérifier la cohérence de l'offre partenaire freight_rate",
      status: "to_execute",
      nextStep: "Relancer l'analyse ou vérifier pourquoi le gap partenaire reste ouvert",
      reason: "Gap bloquant encore ouvert malgré une demande partenaire finalisée",
    };
  }

  switch (best.status) {
    case "draft":
      return {
        kind: "prepare",
        title: "Préparer la demande partenaire freight_rate",
        status: "to_prepare",
        nextStep: "Compléter puis confirmer l'envoi aux partenaires",
        reason: "Gap bloquant : offre maritime partenaire requise",
      };
    case "sent":
      return best.email_sent_at
        ? {
            kind: "waiting",
            title: "En attente de réponse partenaire freight_rate",
            status: "waiting_response",
            nextStep: "Attendre la réponse du partenaire",
            reason: "Demande freight_rate envoyée — réponse partenaire attendue",
          }
        : {
            kind: "confirm_send",
            title: "Confirmer l'envoi de la demande partenaire freight_rate",
            status: "ready_to_send",
            nextStep: "Confirmer l'envoi, puis attendre la réponse partenaire",
            reason: "Demande freight_rate préparée mais envoi non confirmé",
          };
    case "response_received":
    case "response_analyzed":
      return {
        kind: "process_response",
        title: "Traiter la réponse partenaire freight_rate",
        status: "to_execute",
        nextStep: "Analyser puis valider ou rejeter les faits proposés",
        reason: "Réponse partenaire reçue — faits à traiter",
      };
    case "partially_validated":
      return {
        kind: "validate_facts",
        title: "Valider les faits partenaire restants",
        status: "to_execute",
        nextStep: "Terminer la validation des faits partenaire",
        reason: "Faits partenaire partiellement validés",
      };
    case "facts_validated":
    case "closed":
    default:
      return {
        kind: "verify",
        title: "Vérifier la cohérence de l'offre partenaire freight_rate",
        status: "to_execute",
        nextStep: "Relancer l'analyse ou vérifier pourquoi le gap partenaire reste ouvert",
        reason: "Gap bloquant encore ouvert malgré une demande partenaire finalisée",
      };
  }
}
