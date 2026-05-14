/**
 * MAP-5A + MAP-5B — Panneau UI "Candidats de classification".
 *
 * Lecture (MAP-5A) : `get-commodity-classification-candidates`.
 * Actions opérateur (MAP-5B) : Accepter / Rejeter via `update-commodity-classification-candidate`.
 *
 * - Aucune écriture DB directe (toutes les mutations passent par l'Edge Function dédiée).
 * - Aucun set-case-fact, aucun run-pricing.
 * - Aucune écriture quote_facts / case_facts / cargo.*.
 * - Action supersede réservée à MAP-5C.
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

  // Filtres locaux (n'écrivent rien)
  const [kindFilter, setKindFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [isCurrent, setIsCurrent] = useState<boolean>(true);

  // MAP-5B — état actions
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CommodityClassificationCandidate | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("");
  // idempotency_key par candidate, persistée tant que la tentative n'est pas confirmée OK.
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

  const fetchCandidates = useCallback(async () => {
    setState("loading");
    setErrorMsg(null);
    try {
      const body: Record<string, unknown> = {
        case_id: caseId,
        limit: 100,
        offset: 0,
        filters: { is_current: isCurrent } as Record<string, unknown>,
      };
      if (kindFilter !== ALL) {
        (body.filters as Record<string, unknown>).candidate_kind = kindFilter;
      }
      if (statusFilter !== ALL) {
        (body.filters as Record<string, unknown>).status = statusFilter;
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
                            <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>
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
    </Card>
  );
}
