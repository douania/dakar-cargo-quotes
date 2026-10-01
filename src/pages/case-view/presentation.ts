import type { CockpitState } from "@/hooks/useCockpitState";
import {
  TERMINAL_STATUSES,
  statusAtLeast,
  statusBelow,
} from "@/lib/cockpitStatusConstants";
import { PAD_REVIEW_GAP_KEY, PAD_REVIEW_FR, PAD_WEIGHT_REVIEW_FR, PAD_REVIEW_TITLE, PAD_WEIGHT_REVIEW_TITLE } from "@/lib/padGapReview";
import {
  type SeaFreightPartnerActionKind,
  type SeaFreightPartnerActionSpec,
} from "@/lib/seaFreightPartnerAction";
import { FACT_LABELS, STATUS_LABELS } from "./constants";
import { scenarioPricingCodeMessage } from "@/lib/scenarioPricing";

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
    targetId: "section-data",
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
    kind: "unlock_pricing", label: "Autoriser le calcul du devis",
    blocker: "Choix validés. Confirmez pour autoriser le calcul.", tone: "emerald", targetId: "section-pricing",
  };
  if (state.status === "ACK_READY_FOR_PRICING") {
    return hasCriticalUnconfirmed
      ? { kind: "confirm_scope", label: "Confirmer le périmètre du dossier", blocker: "Des prestations du dossier restent à préciser", tone: "amber", targetId: "section-data" }
      : { kind: "launch_pricing", label: "Calculer le devis", blocker: "Aucun blocage majeur", tone: "emerald", targetId: "section-pricing" };
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

function readConfirmedQuote(state: Pick<CockpitState, "selectedVersionNumber" | "selectedVersionSnapshot">): PilotageViewModel["confirmedQuote"] {
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

export const CASE_PRESENTATION_KEY = "case-presentation-v1";

// Display only. Keep the original control available; never infer its resolution
// or replace an unknown business question with a generic, reassuring summary.
export function presentGuidedGap(gap: { gap_key: string; question_fr?: string | null }) {
  const original = gap.question_fr?.trim() || "";
  if (gap.gap_key === "cargo.imo_goods_scope_confirmation") return {
    label: "Vérifier les informations de danger et les conteneurs concernés",
    guidance: "Pour chaque groupe, vérifiez le statut dangereux et son lien avec une source client actuelle. Un nombre de colis ne prouve pas le nombre de conteneurs. Le contrôle reste à résoudre avant le calcul du devis confirmé.",
    detail: original || gap.gap_key,
  };
  if (gap.gap_key === PAD_REVIEW_GAP_KEY) return {
    label: original === PAD_WEIGHT_REVIEW_FR ? "Rapprocher le poids extrait et le poids retenu pour le devis" : "Vérifier les catégories portuaires de la marchandise",
    guidance: original === PAD_WEIGHT_REVIEW_FR ? PAD_WEIGHT_REVIEW_FR : PAD_REVIEW_FR,
    detail: original || PAD_REVIEW_FR,
  };
  // Generic server wording "Information manquante: <fact key>" is shown with the known field name.
  const missingKey = /^Information manquante\s*:\s*([\w.]+)$/.exec(original)?.[1];
  if (missingKey && FACT_LABELS[missingKey]) return { label: `${FACT_LABELS[missingKey]} à préciser`, guidance: null, detail: original };
  return { label: original || FACT_LABELS[gap.gap_key] || "Information à préciser dans les contrôles", guidance: null, detail: original ? null : gap.gap_key };
}

// Navigation copy only: the existing action priority and mutation guards stay authoritative.
export function guidedActionLabel(action: PilotageAction): string {
  const labels: Partial<Record<PilotageActionKind, string>> = {
    blocking_gap: "Examiner les informations manquantes",
    pad_review: "Vérifier les bases de la marchandise",
    unlock_pricing: "Revoir les conditions du calcul",
    launch_pricing: "Préparer le calcul du devis",
    confirm_scope: "Vérifier les prestations demandées",
    create_version: "Relire le calcul avant de créer une version",
    export_pdf: "Préparer le PDF de la version sélectionnée",
    prepare_email: "Préparer le message client",
    mark_sent: "Relire les éléments et tracer l’envoi manuel",
  };
  return labels[action.kind] ?? action.label.replace(/fait\(s\)/g, "information(s)");
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export interface GuidedQuoteSummary {
  versionNumber: number;
  amount: PilotageAmount | null;
  qualification: string;
  qualificationLevel: "partial" | "provisional" | "firm" | "unknown";
  reservations: string[];
  pendingItems: string[];
}

// Read the selected snapshot, never a live estimate or a recomputed total.
// Missing qualification is explicitly unknown, never inferred as firm.
export function readGuidedQuote(state: Pick<CockpitState, "hasSelectedVersion" | "selectedVersionNumber" | "selectedVersionSnapshot">): GuidedQuoteSummary | null {
  if (!state.hasSelectedVersion || state.selectedVersionNumber == null) return null;
  const snapshot = record(state.selectedVersionSnapshot);
  const qualification = record(record(snapshot.meta).quoteQualification);
  const rawLines: unknown[] = Array.isArray(snapshot.raw_lines) ? snapshot.raw_lines : [];
  const pendingItems = rawLines.flatMap((value, index) => {
    const line = record(value);
    const source = typeof line.source === "string" ? line.source : record(line.source).type;
    if (String(source ?? "").trim().split(/[+:]/)[0].toUpperCase() !== "TO_CONFIRM") return [];
    const label = [line.description, line.charge_name, line.label, line.service_name].find(v => typeof v === "string" && v.trim());
    const lot = line.lot_index != null ? `Lot ${line.lot_index} · ` : "";
    const text = `${lot}${label ?? `Poste ${index + 1}`}`;
    return [/à confirmer\s*$/.test(text) ? text : `${text} — à confirmer`];
  });
  const reservations = (Array.isArray(qualification.reasons) ? qualification.reasons : [])
    .flatMap((value) => {
      const message = record(value).message;
      return typeof message === "string" && message.trim() ? [message] : [];
    });
  if (snapshot.operator_basis) {
    reservations.push("Devis établi sur des bases opérateur : consulter les bases et réserves de la version.");
    const basis = record(snapshot.operator_basis);
    const points: unknown[] = [
      ...(Array.isArray(basis.reservations) ? basis.reservations : []),
      ...(Array.isArray(basis.open_points) ? basis.open_points : []),
    ];
    for (const [index, value] of points.entries()) {
      const point = record(value);
      const message = typeof value === "string" ? scenarioPricingCodeMessage(value)
        : point.message ?? point.statement ?? point.reason ?? point.code;
      const scope = point.unit_ref ?? point.ref;
      reservations.push(`${scope ? `Périmètre ${scope} : ` : ""}${typeof message === "string" && message.trim()
        ? message : `Réserve opérateur ${index + 1} à examiner dans la version`}`);
    }
  }
  const partial = pendingItems.length > 0 || qualification.level === "partial"
    || qualification.firmTotalPolicy === "excludes_reserved_items";
  const qualificationLevel = partial ? "partial"
    : qualification.level === "provisional" || reservations.length > 0 ? "provisional"
    : qualification.level === "firm" ? "firm" : "unknown";
  const label = qualificationLevel === "partial" ? "Total partiel — hors postes réservés"
    : qualificationLevel === "provisional" ? "Montant provisoire — avec réserves"
    : qualificationLevel === "firm" ? "Montant de la version — qualification ferme"
    : "Montant de la version — qualification à vérifier";
  return {
    versionNumber: state.selectedVersionNumber,
    amount: readConfirmedQuote(state), qualification: label, qualificationLevel,
    reservations: [...new Set(reservations)], pendingItems,
  };
}

export function guidedSituation(status: string, action: PilotageAction | null): string {
  if (status === "PRICING_RUNNING") return "Calcul du devis en cours";
  if (status === "SENT") return "Envoi du devis enregistré";
  if (status === "ACCEPTED") return "Devis accepté par le client";
  if (status === "REJECTED") return "Devis refusé par le client";
  if (status === "ARCHIVED") return "Dossier archivé";
  if (action?.kind === "blocking_gap" || action?.kind === "pad_review") return "Informations du dossier à vérifier";
  if (action?.kind === "mark_sent") return "Éléments préparés — envoi manuel à vérifier";
  return STATUS_LABELS[status] ?? "Situation du dossier à vérifier";
}
