import type { CockpitState } from "@/hooks/useCockpitState";
import {
  TERMINAL_STATUSES,
  statusAtLeast,
  statusBelow,
} from "@/lib/cockpitStatusConstants";
import { PAD_REVIEW_TITLE, PAD_WEIGHT_REVIEW_TITLE } from "@/lib/padGapReview";
import {
  type SeaFreightPartnerActionKind,
  type SeaFreightPartnerActionSpec,
} from "@/lib/seaFreightPartnerAction";

export type PilotageActionKind =
  | "sea_freight"
  | "pad_review"
  | "blocking_gap"
  | "draft_partner"
  | "unsent_partner"
  | "pending_partner_fact"
  | "draft_client_gap"
  | "open_client_gap"
  | "select_partner"
  | "unlock_pricing"
  | "confirm_scope"
  | "launch_pricing"
  | "create_version"
  | "export_pdf"
  | "prepare_email"
  | "mark_sent";

export interface PilotageAction {
  kind: PilotageActionKind;
  label: string;
  blocker: string;
  tone: "amber" | "blue" | "emerald" | "red" | "muted";
  targetId: string;
  seaFreightKind?: SeaFreightPartnerActionKind;
}

export interface PilotageStep {
  key: "estimate" | "pricing" | "version" | "pdf" | "draft" | "sent";
  label: string;
  done: boolean;
  current: boolean;
}

export interface PilotageAmount {
  amount: number;
  currency: string;
}

export interface SelectedEstimatePresentation {
  status: string | null;
  totalTtc: number | null;
  currency: string | null;
}

export interface PilotageViewModel {
  steps: PilotageStep[];
  currentStepLabel: string | null;
  action: PilotageAction | null;
  confirmedQuote: (PilotageAmount & { versionNumber: number }) | null;
  estimate: PilotageAmount | null;
  variance: PilotageAmount | null;
  amountsComparable: boolean;
}

type ActionState = Pick<
  CockpitState,
  | "status"
  | "blockingGapsCount"
  | "padReviewCount"
  | "hasPadWeightReview"
  | "draftPartnerRequests"
  | "unsentPartnerRequests"
  | "pendingPartnerFacts"
  | "draftedClientGaps"
  | "openClientGaps"
  | "hasSelectedVersion"
  | "hasPdf"
  | "hasDraftEmail"
  | "hasSelectedPartner"
  | "hasExploitableRequests"
  | "totalPartnerRequests"
>;

export function selectPilotageAction(
  state: ActionState,
  hasCriticalUnconfirmed: boolean,
  seaFreightSpec: SeaFreightPartnerActionSpec | null,
): PilotageAction | null {
  if (TERMINAL_STATUSES.has(state.status)) return null;

  if (seaFreightSpec) {
    return {
      kind: "sea_freight",
      label: seaFreightSpec.title,
      blocker: seaFreightSpec.reason,
      tone: "amber",
      targetId: "section-external-requests",
      seaFreightKind: seaFreightSpec.kind,
    };
  }

  if (state.padReviewCount > 0 && state.padReviewCount === state.blockingGapsCount) {
    return {
      kind: "pad_review",
      label: state.hasPadWeightReview ? PAD_WEIGHT_REVIEW_TITLE : PAD_REVIEW_TITLE,
      blocker: state.hasPadWeightReview
        ? "Écart entre le poids extrait et la base de cotation ; les catégories déjà validées restent enregistrées."
        : "Validation PAD du devis confirmé, pas une attente automatique de réponse client.",
      tone: "amber",
      targetId: "section-scenarios",
    };
  }

  if (state.blockingGapsCount > 0) return {
    kind: "blocking_gap",
    label: `Résoudre ${state.blockingGapsCount} gap(s) bloquant(s)`,
    blocker: `${state.blockingGapsCount} gap(s) bloquant(s)`,
    tone: "red",
    targetId: "section-sources",
  };
  if (state.draftPartnerRequests > 0) return {
    kind: "draft_partner", label: `Préparer ${state.draftPartnerRequests} demande(s) partenaire(s)`,
    blocker: "Demandes non préparées", tone: "amber", targetId: "section-external-requests",
  };
  if (state.unsentPartnerRequests > 0) return {
    kind: "unsent_partner", label: `Confirmer l'envoi de ${state.unsentPartnerRequests} demande(s)`,
    blocker: "Envois non confirmés", tone: "amber", targetId: "section-external-requests",
  };
  if (state.pendingPartnerFacts > 0) return {
    kind: "pending_partner_fact", label: `Valider ${state.pendingPartnerFacts} fait(s) partenaire(s)`,
    blocker: "Faits partenaires à valider", tone: "amber", targetId: "section-external-requests",
  };
  if (state.draftedClientGaps > 0) return {
    kind: "draft_client_gap", label: `Envoyer ${state.draftedClientGaps} clarification(s) client`,
    blocker: "Clarifications non envoyées", tone: "blue", targetId: "section-reply-analysis",
  };
  if (state.openClientGaps > 0) return {
    kind: "open_client_gap", label: `Traiter ${state.openClientGaps} réponse(s) client`,
    blocker: "Réponses client à traiter", tone: "blue", targetId: "section-reply-analysis",
  };
  if (state.totalPartnerRequests > 0 && state.hasExploitableRequests && !state.hasSelectedPartner) return {
    kind: "select_partner", label: "Retenir une offre partenaire",
    blocker: "Sélection commerciale non faite", tone: "amber", targetId: "section-partner-detail",
  };
  if (state.status === "DECISIONS_COMPLETE") return {
    kind: "unlock_pricing", label: "Débloquer le pricing",
    blocker: "Décisions validées, confirmation pricing requise", tone: "emerald", targetId: "section-pricing",
  };
  if (state.status === "ACK_READY_FOR_PRICING") {
    return hasCriticalUnconfirmed
      ? { kind: "confirm_scope", label: "Confirmer le périmètre du dossier", blocker: "Des services dans le scope restent insuffisamment qualifiés", tone: "amber", targetId: "section-sources" }
      : { kind: "launch_pricing", label: "Lancer le pricing", blocker: "Aucun blocage majeur", tone: "emerald", targetId: "section-pricing" };
  }
  if (statusBelow(state.status, "PRICED_DRAFT")) return null;
  if (!state.hasSelectedVersion) return {
    kind: "create_version", label: "Créer la version du devis", blocker: "Version non créée", tone: "blue", targetId: "section-version",
  };
  if (!state.hasPdf) return {
    kind: "export_pdf", label: "Exporter le PDF", blocker: "PDF non généré", tone: "blue", targetId: "section-version",
  };
  if (!state.hasDraftEmail) return {
    kind: "prepare_email", label: "Préparer l'email client", blocker: "Brouillon non créé", tone: "blue", targetId: "section-version",
  };
  if (state.status !== "SENT") return {
    kind: "mark_sent", label: "Marquer l'envoi client", blocker: "Envoi non confirmé", tone: "emerald", targetId: "section-version",
  };
  return null;
}

function finiteAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readConfirmedQuote(state: CockpitState): PilotageViewModel["confirmedQuote"] {
  if (state.selectedVersionNumber === null || !state.selectedVersionSnapshot) return null;
  const totalsValue = state.selectedVersionSnapshot.totals;
  if (!totalsValue || typeof totalsValue !== "object" || Array.isArray(totalsValue)) return null;
  const totals = totalsValue as Record<string, unknown>;
  const amount = finiteAmount(totals.total_payable) ?? finiteAmount(totals.total_ttc);
  const currency = typeof totals.currency === "string" && totals.currency.trim() ? totals.currency.trim() : null;
  if (amount === null || currency === null) return null;
  return { versionNumber: state.selectedVersionNumber, amount, currency };
}

export function buildPilotageViewModel(input: {
  cockpit: CockpitState;
  hasCriticalUnconfirmed: boolean;
  selectedEstimate: SelectedEstimatePresentation | null;
}): PilotageViewModel {
  const { cockpit } = input;
  const confirmedQuote = readConfirmedQuote(cockpit);
  const estimateAmount = finiteAmount(input.selectedEstimate?.totalTtc);
  const estimateCurrency = typeof input.selectedEstimate?.currency === "string" && input.selectedEstimate.currency.trim()
    ? input.selectedEstimate.currency.trim()
    : null;
  const estimate = estimateAmount === null || estimateCurrency === null
    ? null
    : { amount: estimateAmount, currency: estimateCurrency };

  const done = [
    input.selectedEstimate?.status === "success",
    statusAtLeast(cockpit.status, "PRICED_DRAFT"),
    cockpit.hasSelectedVersion,
    cockpit.hasPdf,
    cockpit.hasDraftEmail,
    ["SENT", "ACCEPTED", "REJECTED"].includes(cockpit.status),
  ];
  const labels = ["Estimation", "Devis calculé", "Version", "PDF", "Brouillon", "Envoi client"] as const;
  const keys: PilotageStep["key"][] = ["estimate", "pricing", "version", "pdf", "draft", "sent"];
  const currentIndex = done.findIndex((value) => !value);
  const steps = labels.map((label, index) => ({ key: keys[index], label, done: done[index], current: index === currentIndex }));

  const amountsComparable = Boolean(
    confirmedQuote && estimate && confirmedQuote.currency.toUpperCase() === estimate.currency.toUpperCase(),
  );
  const variance = amountsComparable && confirmedQuote && estimate
    ? { amount: estimate.amount - confirmedQuote.amount, currency: confirmedQuote.currency }
    : null;

  return {
    steps,
    currentStepLabel: currentIndex >= 0 ? labels[currentIndex] : null,
    action: selectPilotageAction(cockpit, input.hasCriticalUnconfirmed, cockpit.seaFreightAction),
    confirmedQuote,
    estimate,
    variance,
    amountsComparable,
  };
}