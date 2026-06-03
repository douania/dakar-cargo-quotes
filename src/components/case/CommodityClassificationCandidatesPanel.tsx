/**
 * MAP-5A + MAP-5B + MAP-6 — Panneau UI "Candidats de classification".
 *
 * Lecture (MAP-5A) : `get-commodity-classification-candidates`.
 * Actions opérateur (MAP-5B) : Accepter / Rejeter via `update-commodity-classification-candidate`.
 * Propagation (MAP-6) : "Propager au dossier" via Edge Function
 *   `propagate-classification-candidate-to-facts` UNIQUEMENT.
 *
 * - Aucune écriture DB directe (toutes les mutations passent par une Edge Function dédiée).
 * - Aucun appel direct au wrapper RPC `propagate_classification_candidate_to_fact`.
 * - Aucun appel direct à `public.supersede_fact`.
 * - Aucun set-case-fact, aucun run-pricing automatique. Rollback manuel.
 * - Aucune écriture quote_facts / case_facts / cargo.* depuis le frontend.
 * - Aucun moteur de suggestion automatique.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  ListChecks,
  Loader2,
  RefreshCw,
  Send,
  X,
} from "lucide-react";

/* ---------- Types locaux (pas d'import depuis types.ts) ---------- */

type CandidateKind =
  | "cn8"
  | "hs6"
  | "hs10_uemoa"
  | "nhm"
  | "nst2007"
  | "nstr"
  | "pad_label"
  | "pad_category";

type CandidateStatus = "suggested" | "accepted" | "rejected" | "superseded";

type CommodityClassificationCandidate = {
  id: string;
  case_id: string;
  article_id: string | null;
  candidate_kind: string;
  candidate_value: string | null;
  designation_normalized: string | null;
  pad_category: string | null;
  confidence: number | null;
  status: string;
  source: string;
  is_current: boolean;
  rank: number | null;
  created_at: string;
  [k: string]: unknown;
};

type GetCandidatesResponse = {
  case_id: string;
  count: number;
  candidates: CommodityClassificationCandidate[];
};

type UpdateResponse = {
  ok?: boolean;
  idempotent?: boolean;
  candidate?: CommodityClassificationCandidate;
  error?: string;
  reason?: string;
  current_status?: string;
  details?: unknown;
};

type CreatePadV5CandidateResponse = {
  ok?: boolean;
  idempotent?: boolean;
  candidate?: CommodityClassificationCandidate | unknown;
  candidate_id?: string;
  error?: string;
  reason?: string;
  decision?: string;
  details?: unknown;
};

/* PAD-V5 shadow — suggestion UI read-only */
type PadV5ShadowSuggestion = {
  id: string;
  row_key: string;
  cn2008_code: string | null;
  cn2008_label: string | null;
  cpa2008_code: string | null;
  cpa2008_label: string | null;
  nst2007_code: string | null;
  nst2007_label: string | null;
  nstr3_code: string | null;
  nstr_label: string | null;
  v5_pad_category: string | null;
  v5_decision: string;
  v5_confidence: number;
  v5_note: string | null;
  v5_requires_operator: boolean;
  v5_category_source: string;
  source_version: string;
  source_hash: string;
  matched_source_codes: string[];
};

type PadIndicativeTariff = {
  amount: number;
  unit: string | null;
};

type PropagateErrorCode =
  | "VALIDATION_FAILED"
  | "FORBIDDEN_OWNER"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_NOT_ACCEPTED"
  | "CANDIDATE_NOT_CURRENT"
  | "IDEMPOTENCY_CONFLICT"
  | "PAD_LABEL_FORBIDDEN"
  | "KIND_NOT_WHITELISTED"
  | "INTERNAL_ERROR";

type PropagateResponse = {
  ok?: boolean;
  fact_id?: string;
  candidate_id?: string;
  fact_key?: string;
  idempotent?: boolean;
  replay_source?: "evidence" | "quote_facts";
  correlation_id?: string;
  error?: { code?: string; message?: string; details?: unknown };
};

/* MAP-6 — lecture défensive du champ evidence (ne jamais inventer fact_key) */
function getEvidence(c: CommodityClassificationCandidate): Record<string, unknown> {
  const ev = (c as { evidence?: unknown }).evidence;
  return ev && typeof ev === "object" ? (ev as Record<string, unknown>) : {};
}
function getPropagatedFactId(c: CommodityClassificationCandidate): string | null {
  const v = getEvidence(c).propagated_fact_id;
  return typeof v === "string" && v.length > 0 ? v : null;
}
function getPropagatedAt(c: CommodityClassificationCandidate): string | null {
  const v = getEvidence(c).propagated_at;
  return typeof v === "string" && v.length > 0 ? v : null;
}
function getPropagatedFactKey(c: CommodityClassificationCandidate): string | null {
  const v = getEvidence(c).fact_key;
  return typeof v === "string" && v.length > 0 ? v : null;
}
function canPropagate(c: CommodityClassificationCandidate): boolean {
  return c.status === "accepted" && c.is_current === true && getPropagatedFactId(c) === null;
}

type FetchState = "idle" | "loading" | "success" | "empty" | "error";

interface Props {
  caseId: string;
}

const CANDIDATE_KIND_OPTIONS: Array<{ value: CandidateKind; label: string }> = [
  { value: "cn8", label: "CN8" },
  { value: "hs6", label: "HS6" },
  { value: "hs10_uemoa", label: "HS10 UEMOA" },
  { value: "nhm", label: "NHM" },
  { value: "nst2007", label: "NST 2007" },
  { value: "nstr", label: "NSTR" },
  { value: "pad_label", label: "PAD label" },
  { value: "pad_category", label: "PAD category" },
];

const STATUS_OPTIONS: Array<{ value: CandidateStatus; label: string }> = [
  { value: "suggested", label: "Suggéré" },
  { value: "accepted", label: "Accepté" },
  { value: "rejected", label: "Rejeté" },
  { value: "superseded", label: "Superseded" },
];

const ALL = "__all__";
const CREATE_PAD_V5_ERROR_TITLES: Record<string, string> = {
  unauthorized: "Session expirée",
  forbidden: "Accès refusé",
  invalid_input: "Requête invalide",
  shadow_not_found: "Suggestion V5 obsolète",
  shadow_inactive: "Suggestion V5 obsolète",
  v5_decision_blocked: "Suggestion V5 non éligible",
  v5_category_missing: "Catégorie PAD absente",
  state_conflict: "Un candidat courant existe déjà",
  internal_error: "Création du candidat impossible",
};
const PAD_V5_SELECT_COLUMNS = [
  "id",
  "row_key",
  "cn2008_code",
  "cn2008_label",
  "cpa2008_code",
  "cpa2008_label",
  "nst2007_code",
  "nst2007_label",
  "nstr3_code",
  "nstr_label",
  "v5_pad_category",
  "v5_decision",
  "v5_confidence",
  "v5_note",
  "v5_requires_operator",
  "v5_category_source",
  "source_version",
  "source_hash",
].join(", ");
const PAD_V5_MAX_RESULTS = 12;

function normalizeV5CandidateCode(value: string | null): string | null {
  const normalized = (value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return normalized.length > 0 ? normalized : null;
}

function isSafeNstr3Code(value: string): boolean {
  return /^\d{3}$/.test(value);
}

function formatConfidence(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const percent = value > 1 ? value : value * 100;
  return `${Math.round(percent)}%`;
}

function formatFcfa(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
}

function shortHash(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

function isFirmPadV5Decision(value: string): boolean {
  return value === "AUTO_SAFE";
}

function isPadV5CccCreationEligible(suggestion: PadV5ShadowSuggestion): boolean {
  const category = suggestion.v5_pad_category?.trim();
  return (suggestion.v5_decision === "AUTO_SAFE" || suggestion.v5_decision === "AUTO_SAFE_CANDIDATE")
    && Boolean(category);
}

function confidenceTierClass(c: number | null): string {
  if (c == null) return "bg-muted text-muted-foreground border-border";
  if (c >= 0.8) return "bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-300";
  if (c >= 0.5) return "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-300";
  return "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300";
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function CommodityClassificationCandidatesPanel({ caseId }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>("idle");
  const [candidates, setCandidates] = useState<CommodityClassificationCandidate[]>([]);
  const [count, setCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [padV5State, setPadV5State] = useState<FetchState>("idle");
  const [padV5Suggestions, setPadV5Suggestions] = useState<PadV5ShadowSuggestion[]>([]);
  const [padV5ErrorMsg, setPadV5ErrorMsg] = useState<string | null>(null);
  const [padIndicativeTariffs, setPadIndicativeTariffs] = useState<Record<string, PadIndicativeTariff>>({});
  const [creatingPadV5Id, setCreatingPadV5Id] = useState<string | null>(null);

  // Filtres locaux (n'écrivent rien)
  const [kindFilter, setKindFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [isCurrent, setIsCurrent] = useState<boolean>(true);

  // MAP-5B — état actions
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CommodityClassificationCandidate | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("");
  // MAP-6 — état propagation
  const [propagateTarget, setPropagateTarget] = useState<CommodityClassificationCandidate | null>(null);
  // idempotency_key par scope (ex: candidate.id pour MAP-5B, `propagate:${candidate.id}` pour MAP-6),
  // persistée tant que la tentative n'est pas confirmée OK.
  const idempotencyKeysRef = useRef<Map<string, string>>(new Map());

  const getOrCreateIdempotencyKey = (candidateId: string): string => {
    const existing = idempotencyKeysRef.current.get(candidateId);
    if (existing) return existing;
    const key = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    idempotencyKeysRef.current.set(candidateId, key);
    return key;
  };

  const fetchCandidates = useCallback(async (overrides?: {
    kindFilter?: string;
    statusFilter?: string;
    isCurrent?: boolean;
  }) => {
    setState("loading");
    setErrorMsg(null);
    try {
      const effectiveKindFilter = overrides?.kindFilter ?? kindFilter;
      const effectiveStatusFilter = overrides?.statusFilter ?? statusFilter;
      const effectiveIsCurrent = overrides?.isCurrent ?? isCurrent;
      const body: Record<string, unknown> = {
        case_id: caseId,
        limit: 100,
        offset: 0,
        filters: { is_current: effectiveIsCurrent } as Record<string, unknown>,
      };
      if (effectiveKindFilter !== ALL) {
        (body.filters as Record<string, unknown>).candidate_kind = effectiveKindFilter;
      }
      if (effectiveStatusFilter !== ALL) {
        (body.filters as Record<string, unknown>).status = effectiveStatusFilter;
      }

      const { data, error } = await supabase.functions.invoke<GetCandidatesResponse>(
        "get-commodity-classification-candidates",
        { body },
      );
      if (error) throw error;
      const list = (data?.candidates ?? []) as CommodityClassificationCandidate[];
      setCandidates(list);
      setCount(data?.count ?? list.length);
      setState(list.length === 0 ? "empty" : "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setErrorMsg(msg);
      setCandidates([]);
      setCount(0);
      setState("error");
    }
  }, [caseId, kindFilter, statusFilter, isCurrent]);

  useEffect(() => {
    if (!open) return;
    fetchCandidates();
  }, [open, fetchCandidates]);

  useEffect(() => {
    if (!open || candidates.length === 0) {
      setPadV5State("idle");
      setPadV5Suggestions([]);
      setPadIndicativeTariffs({});
      setPadV5ErrorMsg(null);
      return;
    }

    const cn8Codes = new Set<string>();
    const nst2007Codes = new Set<string>();
    const nstr3Codes = new Set<string>();
    const sourceLabelsByCode = new Map<string, Set<string>>();

    for (const candidate of candidates) {
      const normalized = normalizeV5CandidateCode(candidate.candidate_value);
      if (!normalized) continue;

      if (candidate.candidate_kind === "cn8") {
        cn8Codes.add(normalized);
        const key = `cn2008_code:${normalized}`;
        if (!sourceLabelsByCode.has(key)) sourceLabelsByCode.set(key, new Set());
        sourceLabelsByCode.get(key)!.add(`CN8 ${normalized}`);
      } else if (candidate.candidate_kind === "nst2007") {
        nst2007Codes.add(normalized);
        const key = `nst2007_code:${normalized}`;
        if (!sourceLabelsByCode.has(key)) sourceLabelsByCode.set(key, new Set());
        sourceLabelsByCode.get(key)!.add(`NST2007 ${normalized}`);
      } else if (candidate.candidate_kind === "nstr" && isSafeNstr3Code(normalized)) {
        nstr3Codes.add(normalized);
        const key = `nstr3_code:${normalized}`;
        if (!sourceLabelsByCode.has(key)) sourceLabelsByCode.set(key, new Set());
        sourceLabelsByCode.get(key)!.add(`NSTR3 ${normalized}`);
      }
    }

    if (cn8Codes.size === 0 && nst2007Codes.size === 0 && nstr3Codes.size === 0) {
      setPadV5State("empty");
      setPadV5Suggestions([]);
      setPadIndicativeTariffs({});
      setPadV5ErrorMsg(null);
      return;
    }

    let cancelled = false;
    const fetchPadV5Suggestions = async () => {
      setPadV5State("loading");
      setPadV5ErrorMsg(null);
      try {
        const queries = [];
        if (cn8Codes.size > 0) {
          queries.push(
            supabase
              .from("pad_cn2008_mapping_v5_shadow")
              .select(PAD_V5_SELECT_COLUMNS)
              .eq("is_active", true)
              .in("cn2008_code", Array.from(cn8Codes))
              .order("v5_confidence", { ascending: false })
              .order("row_key", { ascending: true })
              .limit(PAD_V5_MAX_RESULTS),
          );
        }
        if (nst2007Codes.size > 0) {
          queries.push(
            supabase
              .from("pad_cn2008_mapping_v5_shadow")
              .select(PAD_V5_SELECT_COLUMNS)
              .eq("is_active", true)
              .in("nst2007_code", Array.from(nst2007Codes))
              .order("v5_confidence", { ascending: false })
              .order("row_key", { ascending: true })
              .limit(PAD_V5_MAX_RESULTS),
          );
        }
        if (nstr3Codes.size > 0) {
          queries.push(
            supabase
              .from("pad_cn2008_mapping_v5_shadow")
              .select(PAD_V5_SELECT_COLUMNS)
              .eq("is_active", true)
              .in("nstr3_code", Array.from(nstr3Codes))
              .order("v5_confidence", { ascending: false })
              .order("row_key", { ascending: true })
              .limit(PAD_V5_MAX_RESULTS),
          );
        }

        const responses = await Promise.all(queries);
        const byRowKey = new Map<string, PadV5ShadowSuggestion>();
        for (const response of responses) {
          if (response.error) throw response.error;
          for (const row of response.data ?? []) {
            const sourceCodes = new Set<string>();
            if (row.cn2008_code) {
              sourceLabelsByCode.get(`cn2008_code:${row.cn2008_code}`)?.forEach((label) => sourceCodes.add(label));
            }
            if (row.nst2007_code) {
              sourceLabelsByCode.get(`nst2007_code:${row.nst2007_code}`)?.forEach((label) => sourceCodes.add(label));
            }
            if (row.nstr3_code) {
              sourceLabelsByCode.get(`nstr3_code:${row.nstr3_code}`)?.forEach((label) => sourceCodes.add(label));
            }
            const existing = byRowKey.get(row.row_key);
            if (existing) {
              existing.matched_source_codes = Array.from(new Set([...existing.matched_source_codes, ...sourceCodes]));
            } else {
              byRowKey.set(row.row_key, { ...row, matched_source_codes: Array.from(sourceCodes) });
            }
          }
        }

        const suggestions = Array.from(byRowKey.values()).slice(0, PAD_V5_MAX_RESULTS);
        const categories = Array.from(new Set(
          suggestions
            .map((row) => row.v5_pad_category?.trim().toUpperCase())
            .filter((category): category is string => Boolean(category)),
        ));

        let tariffs: Record<string, PadIndicativeTariff> = {};
        if (categories.length > 0) {
          const { data: tariffRows, error: tariffError } = await supabase
            .from("port_tariffs")
            .select("classification, amount, unit")
            .eq("provider", "PAD")
            .eq("category", "DROIT_PASSAGE")
            .eq("operation_type", "IMPORT")
            .eq("is_active", true)
            .in("classification", categories)
            .limit(categories.length);
          if (tariffError) throw tariffError;
          tariffs = (tariffRows ?? []).reduce<Record<string, PadIndicativeTariff>>((acc, row) => {
            acc[row.classification] = { amount: row.amount, unit: row.unit };
            return acc;
          }, {});
        }

        if (cancelled) return;
        setPadV5Suggestions(suggestions);
        setPadIndicativeTariffs(tariffs);
        setPadV5State(suggestions.length === 0 ? "empty" : "success");
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        setPadV5ErrorMsg(msg);
        setPadV5Suggestions([]);
        setPadIndicativeTariffs({});
        setPadV5State("error");
      }
    };

    void fetchPadV5Suggestions();
    return () => {
      cancelled = true;
    };
  }, [open, candidates]);

  const performAction = useCallback(async (
    candidate: CommodityClassificationCandidate,
    action: "accept" | "reject",
    reason?: string,
  ) => {
    setPendingId(candidate.id);
    const idempotency_key = getOrCreateIdempotencyKey(candidate.id);
    try {
      const body: Record<string, unknown> = {
        candidate_id: candidate.id,
        case_id: candidate.case_id,
        action,
        idempotency_key,
      };
      if (action === "reject") body.rejection_reason = reason ?? "";

      const { data, error } = await supabase.functions.invoke<UpdateResponse>(
        "update-commodity-classification-candidate",
        { body },
      );
      // supabase.functions.invoke ne throw pas sur 4xx mais expose data avec error key.
      const payload = (data ?? {}) as UpdateResponse;

      if (error) {
        // Erreur réseau / invocation
        toast({
          title: "Action impossible",
          description: error.message ?? "Erreur réseau",
          variant: "destructive",
        });
        return;
      }

      if (payload.error) {
        if (payload.error === "forbidden") {
          toast({
            title: "Accès refusé",
            description: "Vous n'avez pas les droits sur ce dossier.",
            variant: "destructive",
          });
          return;
        }
        if (payload.error === "state_conflict") {
          toast({
            title: "Conflit d'état",
            description: payload.reason
              ? `${payload.reason} (statut actuel: ${payload.current_status ?? "?"})`
              : `Statut actuel: ${payload.current_status ?? "?"}`,
          });
          await fetchCandidates();
          return;
        }
        if (payload.error === "candidate_not_found") {
          toast({ title: "Candidat introuvable", variant: "destructive" });
          await fetchCandidates();
          return;
        }
        toast({
          title: "Échec",
          description: payload.error,
          variant: "destructive",
        });
        return;
      }

      // Succès
      idempotencyKeysRef.current.delete(candidate.id);
      toast({
        title: action === "accept" ? "Candidat accepté" : "Candidat rejeté",
        description: payload.idempotent ? "Aucun changement (idempotent)." : undefined,
      });
      await fetchCandidates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      toast({ title: "Action impossible", description: msg, variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  }, [fetchCandidates]);

  const handleAccept = (candidate: CommodityClassificationCandidate) => {
    if (!window.confirm(`Accepter ce candidat (${candidate.candidate_kind} / ${candidate.candidate_value ?? "—"}) ?`)) {
      return;
    }
    void performAction(candidate, "accept");
  };

  const openRejectDialog = (candidate: CommodityClassificationCandidate) => {
    setRejectTarget(candidate);
    setRejectReason("");
  };
  const closeRejectDialog = () => {
    setRejectTarget(null);
    setRejectReason("");
  };
  const confirmReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) return;
    const target = rejectTarget;
    closeRejectDialog();
    await performAction(target, "reject", reason);
  };

  /* ---------- MAP-6 — Propagation au dossier (Edge Function uniquement) ---------- */

  const PROPAGATE_ERROR_TOASTS: Record<string, { title: string; description?: string; variant?: "destructive" | "default"; refetch?: boolean; keepKey?: boolean }> = {
    VALIDATION_FAILED:      { title: "Validation échouée", description: "Requête invalide.", variant: "destructive" },
    FORBIDDEN_OWNER:        { title: "Accès refusé", description: "Vous n'êtes pas owner ou assigné de ce dossier.", variant: "destructive" },
    CANDIDATE_NOT_FOUND:    { title: "Candidat introuvable", description: "Rafraîchissement nécessaire.", variant: "destructive", refetch: true },
    CANDIDATE_NOT_ACCEPTED: { title: "Candidat non accepté", description: "Le candidat n'est plus à l'état accepté.", refetch: true },
    CANDIDATE_NOT_CURRENT:  { title: "Candidat non courant", description: "Le candidat n'est plus is_current.", refetch: true },
    IDEMPOTENCY_CONFLICT:   { title: "Conflit d'idempotence", description: "Une autre opération a utilisé la même clé.", variant: "destructive", refetch: true, keepKey: true },
    PAD_LABEL_FORBIDDEN:    { title: "pad_label non propageable", description: "Type interdit pour la propagation.", variant: "destructive" },
    KIND_NOT_WHITELISTED:   { title: "Type non propageable", description: "candidate_kind non autorisé.", variant: "destructive" },
    INTERNAL_ERROR:         { title: "Erreur serveur", description: "Réessayer ultérieurement.", variant: "destructive", keepKey: true },
  };

  const readErrorPayload = async (err: unknown): Promise<PropagateResponse | null> => {
    try {
      const ctx = (err as { context?: { json?: () => Promise<unknown>; text?: () => Promise<string> } } | null)?.context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j && typeof j === "object") return j as PropagateResponse;
      }
      if (ctx && typeof ctx.text === "function") {
        const t = await ctx.text();
        try { return JSON.parse(t) as PropagateResponse; } catch { /* not json */ }
      }
    } catch { /* ignore */ }
    return null;
  };

  const readCreatePadV5ErrorPayload = async (err: unknown): Promise<CreatePadV5CandidateResponse | null> => {
    try {
      const ctx = (err as { context?: { json?: () => Promise<unknown>; text?: () => Promise<string> } } | null)?.context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j && typeof j === "object") return j as CreatePadV5CandidateResponse;
      }
      if (ctx && typeof ctx.text === "function") {
        const t = await ctx.text();
        try { return JSON.parse(t) as CreatePadV5CandidateResponse; } catch { /* not json */ }
      }
    } catch { /* ignore */ }
    return null;
  };

  const createPadV5Candidate = useCallback(async (suggestion: PadV5ShadowSuggestion) => {
    if (!isPadV5CccCreationEligible(suggestion)) {
      toast({
        title: suggestion.v5_pad_category?.trim() ? "Suggestion V5 non éligible" : "Catégorie PAD absente",
        variant: "destructive",
      });
      return;
    }

    setCreatingPadV5Id(suggestion.id);
    try {
      const body = {
        case_id: caseId,
        shadow_id: suggestion.id,
        article_id: null,
      };
      const { data, error } = await supabase.functions.invoke<CreatePadV5CandidateResponse>(
        "create-pad-v5-classification-candidate",
        { body },
      );

      let payload = (data ?? null) as CreatePadV5CandidateResponse | null;
      if (error) {
        const fromErr = await readCreatePadV5ErrorPayload(error);
        if (fromErr) payload = fromErr;
      }

      if (error || !payload || payload.error || payload.ok !== true) {
        const code = payload?.error ?? "internal_error";
        toast({
          title: CREATE_PAD_V5_ERROR_TITLES[code] ?? "Création du candidat impossible",
          description: payload?.reason ?? payload?.decision ?? (error instanceof Error ? error.message : undefined),
          variant: "destructive",
        });
        if (code === "shadow_not_found" || code === "shadow_inactive" || code === "state_conflict") {
          await fetchCandidates();
        }
        return;
      }

      toast({
        title: payload.idempotent ? "Candidat CCC déjà existant" : "Candidat CCC créé à valider",
      });
      setKindFilter(ALL);
      setStatusFilter(ALL);
      setIsCurrent(true);
      await fetchCandidates({ kindFilter: ALL, statusFilter: ALL, isCurrent: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      toast({ title: "Création du candidat impossible", description: msg, variant: "destructive" });
    } finally {
      setCreatingPadV5Id(null);
    }
  }, [caseId, fetchCandidates]);

  const performPropagate = useCallback(async (candidate: CommodityClassificationCandidate) => {
    setPendingId(candidate.id);
    const idemKey = `propagate:${candidate.id}`;
    const idempotency_key = getOrCreateIdempotencyKey(idemKey);
    try {
      const { data, error } = await supabase.functions.invoke<PropagateResponse>(
        "propagate-classification-candidate-to-facts",
        { body: { candidate_id: candidate.id, idempotency_key } },
      );

      let payload: PropagateResponse | null = (data ?? null) as PropagateResponse | null;
      if (error) {
        const fromErr = await readErrorPayload(error);
        if (fromErr) payload = fromErr;
      }

      const code = payload?.error?.code;
      if (code && PROPAGATE_ERROR_TOASTS[code]) {
        const cfg = PROPAGATE_ERROR_TOASTS[code];
        toast({ title: cfg.title, description: payload?.error?.message ?? cfg.description, variant: cfg.variant });
        if (!cfg.keepKey) idempotencyKeysRef.current.delete(idemKey);
        if (cfg.refetch) await fetchCandidates();
        return;
      }

      if (error || !payload || payload.ok === false) {
        const msg = (error instanceof Error ? error.message : null) ?? payload?.error?.message ?? "Erreur réseau";
        toast({ title: "Propagation impossible", description: msg, variant: "destructive" });
        return;
      }

      idempotencyKeysRef.current.delete(idemKey);
      toast({
        title: "Candidat propagé au dossier",
        description: payload.idempotent ? "Aucun changement (idempotent)." : "Aucun run-pricing automatique. Rollback manuel.",
      });
      await fetchCandidates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      toast({ title: "Propagation impossible", description: msg, variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  }, [fetchCandidates]);

  const openPropagateDialog = (candidate: CommodityClassificationCandidate) => {
    setPropagateTarget(candidate);
  };
  const closePropagateDialog = () => {
    setPropagateTarget(null);
  };
  const confirmPropagate = async () => {
    if (!propagateTarget) return;
    const target = propagateTarget;
    closePropagateDialog();
    await performPropagate(target);
  };


  return (
    <Card className="mb-6">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Candidats de classification</CardTitle>
              <Badge variant="outline" className="text-[10px]">MAP-5B</Badge>
              {state === "success" || state === "empty" ? (
                <Badge variant="secondary" className="text-[10px]">{count} candidat(s)</Badge>
              ) : null}
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                <span className="ml-1">{open ? "Fermer" : "Ouvrir"}</span>
              </Button>
            </CollapsibleTrigger>
          </div>
          <CardDescription className="text-xs">
            Validation opérateur des candidats. Aucun déclenchement de pricing automatique.
          </CardDescription>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Filtres */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={kindFilter} onValueChange={setKindFilter}>
                  <SelectTrigger className="h-8 w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Tous</SelectItem>
                    {CANDIDATE_KIND_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Statut</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Tous</SelectItem>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Switch id="ccc-is-current" checked={isCurrent} onCheckedChange={setIsCurrent} />
                <Label htmlFor="ccc-is-current" className="text-xs">is_current uniquement</Label>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={fetchCandidates}
                disabled={state === "loading"}
                className="ml-auto"
              >
                {state === "loading" ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-3 w-3" />
                )}
                Rafraîchir
              </Button>
            </div>

            {/* États */}
            {state === "loading" && (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
              </div>
            )}

            {state === "error" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Impossible de récupérer les candidats</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p className="text-xs">{errorMsg}</p>
                  <Button size="sm" variant="outline" onClick={fetchCandidates}>
                    Réessayer
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {state === "empty" && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Aucun candidat pour ce dossier avec les filtres actuels.
                </AlertDescription>
              </Alert>
            )}

            {state === "success" && (
              <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium">Suggestion PAD V5 shadow</h3>
                  </div>
                  <Badge variant="outline" className="text-[10px]">SOURCE READ ONLY</Badge>
                </div>
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Lecture seule — non utilisé pour le pricing sans validation opérateur.
                    {" "}Cette action crée seulement un candidat à valider. Elle ne modifie pas le dossier et ne lance aucun pricing.
                  </AlertDescription>
                </Alert>

                {padV5State === "loading" ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-2/3" />
                  </div>
                ) : null}

                {padV5State === "error" ? (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Suggestion V5 indisponible</AlertTitle>
                    <AlertDescription className="text-xs">{padV5ErrorMsg}</AlertDescription>
                  </Alert>
                ) : null}

                {padV5State === "empty" ? (
                  <p className="text-xs text-muted-foreground">
                    Aucune correspondance V5 shadow pour les candidats CN8, NST2007 ou NSTR3 sûrs chargés.
                  </p>
                ) : null}

                {padV5State === "success" ? (
                  <div className="space-y-2">
                    {padV5Suggestions.map((suggestion) => {
                      const category = suggestion.v5_pad_category?.trim().toUpperCase() ?? null;
                      const tariff = category ? padIndicativeTariffs[category] : undefined;
                      const firmDecision = isFirmPadV5Decision(suggestion.v5_decision);
                      const canCreateCcc = isPadV5CccCreationEligible(suggestion);
                      const isCreating = creatingPadV5Id === suggestion.id;
                      const disabledReason = category ? "Décision non éligible" : "Catégorie PAD absente";
                      return (
                        <div key={suggestion.row_key} className="rounded-md border bg-background p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="secondary" className="text-[10px]">{suggestion.v5_decision}</Badge>
                              {category && firmDecision ? (
                                <Badge variant="outline" className="font-mono text-[10px]">{category}</Badge>
                              ) : category ? (
                                <Badge variant="outline" className="font-mono text-[10px]">non ferme: {category}</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px]">catégorie non ferme</Badge>
                              )}
                              <Badge variant="outline" className={`text-[10px] ${confidenceTierClass(suggestion.v5_confidence)}`}>
                                {formatConfidence(suggestion.v5_confidence)}
                              </Badge>
                              {suggestion.v5_requires_operator ? (
                                <Badge variant="outline" className="text-[10px]">validation opérateur requise</Badge>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap justify-end">
                              <span className="font-mono text-[10px] text-muted-foreground">{suggestion.row_key}</span>
                              {canCreateCcc ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  disabled={creatingPadV5Id !== null}
                                  onClick={() => void createPadV5Candidate(suggestion)}
                                >
                                  {isCreating ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Check className="h-3 w-3" />
                                  )}
                                  <span className="ml-1 text-[11px]">
                                    {isCreating ? "Création…" : "Créer candidat à valider"}
                                  </span>
                                </Button>
                              ) : (
                                <Badge variant="outline" className="text-[10px]">
                                  {disabledReason}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="grid gap-2 text-xs md:grid-cols-2">
                            <div>
                              <span className="text-muted-foreground">Code source utilisé : </span>
                              <span className="font-mono">{suggestion.matched_source_codes.join(", ") || "—"}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Source : </span>
                              <span>{suggestion.source_version}</span>
                              <span className="text-muted-foreground"> / hash </span>
                              <span className="font-mono">{shortHash(suggestion.source_hash)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">CN2008 : </span>
                              <span className="font-mono">{suggestion.cn2008_code ?? "—"}</span>
                              {suggestion.cn2008_label ? <span> — {suggestion.cn2008_label}</span> : null}
                            </div>
                            <div>
                              <span className="text-muted-foreground">NST/NSTR : </span>
                              <span className="font-mono">{suggestion.nst2007_code ?? suggestion.nstr3_code ?? "—"}</span>
                              {(suggestion.nst2007_label || suggestion.nstr_label) ? (
                                <span> — {suggestion.nst2007_label ?? suggestion.nstr_label}</span>
                              ) : null}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Catégorie source : </span>
                              <span>{suggestion.v5_category_source}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Tarif PAD indicatif : </span>
                              {tariff ? (
                                <span>{formatFcfa(tariff.amount)} FCFA{tariff.unit ? ` / ${tariff.unit}` : ""} — indicatif — source port_tariffs</span>
                              ) : (
                                <span className="text-muted-foreground">non trouvé</span>
                              )}
                            </div>
                          </div>

                          {suggestion.v5_note ? (
                            <p className="text-xs text-muted-foreground">{suggestion.v5_note}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            )}

            {state === "success" && (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Valeur</TableHead>
                      <TableHead className="text-xs">Désignation</TableHead>
                      <TableHead className="text-xs">PAD</TableHead>
                      <TableHead className="text-xs">Confiance</TableHead>
                      <TableHead className="text-xs">Statut</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                      <TableHead className="text-xs">Rang</TableHead>
                      <TableHead className="text-xs">Créé</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((c) => {
                      const isPending = pendingId === c.id;
                      const canAct = c.status === "suggested";
                      const propagated = getPropagatedFactId(c);
                      const propagatedAt = getPropagatedAt(c);
                      const propagatedFactKey = getPropagatedFactKey(c);
                      const showPropagate = canPropagate(c);
                      const propagatedTooltip = propagated
                        ? [
                            propagatedFactKey ? `fact_key: ${propagatedFactKey}` : `fact_id: ${propagated}`,
                            propagatedAt ? `propagé le ${formatDate(propagatedAt)}` : null,
                          ].filter(Boolean).join(" — ")
                        : "";
                      return (
                        <TableRow key={c.id}>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-[10px]">{c.candidate_kind}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{c.candidate_value ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[280px] truncate" title={c.designation_normalized ?? ""}>
                            {c.designation_normalized || "—"}
                          </TableCell>
                          <TableCell>
                            {c.pad_category ? (
                              <Badge variant="outline" className="font-mono text-[10px]">{c.pad_category}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${confidenceTierClass(c.confidence)}`}>
                              {c.confidence != null ? `${(c.confidence * 100).toFixed(0)}%` : "—"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 flex-wrap">
                              <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>
                              {propagated ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-green-300 bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                                  title={propagatedTooltip}
                                >
                                  PROPAGÉ
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{c.source}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{c.rank ?? "—"}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{formatDate(c.created_at)}</TableCell>
                          <TableCell className="text-right">
                            {canAct ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  disabled={isPending}
                                  onClick={() => handleAccept(c)}
                                >
                                  {isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Check className="h-3 w-3" />
                                  )}
                                  <span className="ml-1 text-[11px]">Accepter</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  disabled={isPending}
                                  onClick={() => openRejectDialog(c)}
                                >
                                  <X className="h-3 w-3" />
                                  <span className="ml-1 text-[11px]">Rejeter</span>
                                </Button>
                              </div>
                            ) : showPropagate ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  disabled={isPending}
                                  onClick={() => openPropagateDialog(c)}
                                >
                                  {isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Send className="h-3 w-3" />
                                  )}
                                  <span className="ml-1 text-[11px]">Propager au dossier</span>
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      {/* Dialog rejet */}
      <Dialog open={rejectTarget !== null} onOpenChange={(o) => { if (!o) closeRejectDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeter ce candidat</DialogTitle>
            <DialogDescription>
              Indiquez un motif (3 à 500 caractères). Le rejet est tracé et conservé.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value.slice(0, 500))}
              placeholder="Motif du rejet…"
              rows={4}
            />
            <div className="text-[10px] text-muted-foreground text-right">
              {rejectReason.trim().length}/500
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRejectDialog}>Annuler</Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={rejectReason.trim().length < 3 || pendingId !== null}
            >
              {pendingId !== null ? (
                <Loader2 className="h-3 w-3 animate-spin mr-2" />
              ) : null}
              Confirmer le rejet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MAP-6 — Dialog confirmation propagation */}
      <Dialog open={propagateTarget !== null} onOpenChange={(o) => { if (!o) closePropagateDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propager ce candidat au dossier ?</DialogTitle>
            <DialogDescription>
              Cette action va écrire un fait dans le dossier. Aucun run-pricing ne sera lancé
              automatiquement. Le rollback est manuel.
            </DialogDescription>
          </DialogHeader>
          {propagateTarget ? (
            <div className="text-xs space-y-1">
              <div>
                <span className="text-muted-foreground">Type : </span>
                <span className="font-mono">{propagateTarget.candidate_kind}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Valeur : </span>
                <span className="font-mono">{propagateTarget.candidate_value ?? "—"}</span>
              </div>
              {propagateTarget.pad_category ? (
                <div>
                  <span className="text-muted-foreground">PAD : </span>
                  <span className="font-mono">{propagateTarget.pad_category}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closePropagateDialog}>Annuler</Button>
            <Button
              onClick={confirmPropagate}
              disabled={pendingId !== null}
            >
              {pendingId !== null ? (
                <Loader2 className="h-3 w-3 animate-spin mr-2" />
              ) : (
                <Send className="h-3 w-3 mr-2" />
              )}
              Confirmer la propagation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
