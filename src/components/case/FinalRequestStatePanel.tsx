import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FinalRequestAssertionEditor } from "@/components/case/FinalRequestAssertionEditor";
import {
  attestedSentAtIso,
  FINAL_REQUEST_COMPLETENESS_OPTIONS,
  finalRequestErrorMessage,
  type FinalRequestCompleteness,
  type FinalRequestReviewTarget,
  type FinalRequestSource,
  type FinalRequestStateView,
  newFinalRequestKey,
  requiresAttestedSentAt,
  requiresCompletenessAttestation,
  targetLabel,
  unwrapFinalRequestResponse,
} from "@/lib/finalRequestState";

interface Props {
  caseId: string;
}
interface AttestationDraft {
  source: FinalRequestSource;
  key: string;
  authorRole: string;
  contentClass: string;
  // null tant que le reviewer n’a pas choisi : aucune valeur complete par défaut.
  completeness: FinalRequestCompleteness | null;
  // Saisie `datetime-local` brute, vide par défaut : aucune date n’est déduite.
  sentAt: string;
  reason: string;
}
interface ReviewDraft {
  decision:
    | "confirm_instruction"
    | "keep_protected_fact"
    | "request_clarification"
    | "review_capture"
    | "revoke_decision";
  targetId: string;
  candidateRef: string | null;
  previousEventId: string | null;
  key: string;
  reason: string;
}

function sourceLabel(source: FinalRequestSource): string {
  return source.fileName || source.author ||
    `${source.kind ?? "source"} ${source.id?.slice(0, 8) ?? ""}`;
}
function reviewTargetJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function FinalRequestStatePanel({ caseId }: Props) {
  const [view, setView] = useState<FinalRequestStateView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureKey, setCaptureKey] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<AttestationDraft | null>(null);
  const [review, setReview] = useState<ReviewDraft | null>(null);
  const requestEpoch = useRef(0);

  useEffect(() => {
    requestEpoch.current += 1;
    setView(null);
    setExpanded(false);
    setBusy(false);
    setError(null);
    setCaptureKey(null);
    setAttestation(null);
    setReview(null);
  }, [caseId]);

  async function invoke(
    body: Record<string, unknown>,
    epoch = requestEpoch.current,
  ) {
    const { data, error: invokeError } = await supabase.functions.invoke(
      "manage-final-request-state",
      { body },
    );
    if (epoch !== requestEpoch.current) return null;
    if (invokeError) {
      throw new Error(await finalRequestErrorMessage(invokeError));
    }
    return unwrapFinalRequestResponse(data);
  }

  async function load() {
    const epoch = requestEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const data = await invoke({ operation: "read", case_id: caseId }, epoch);
      if (data && epoch === requestEpoch.current) {
        setView(data as unknown as FinalRequestStateView);
      }
    } catch (e) {
      if (epoch === requestEpoch.current) {
        setError(e instanceof Error ? e.message : "Lecture impossible");
      }
    } finally {
      if (epoch === requestEpoch.current) setBusy(false);
    }
  }

  async function mutate(
    body: Record<string, unknown>,
    afterSuccess: () => void,
  ) {
    if (busy) return;
    const epoch = requestEpoch.current;
    setBusy(true);
    setError(null);
    try {
      await invoke(body, epoch);
      if (epoch !== requestEpoch.current) return;
      afterSuccess();
      const data = await invoke({ operation: "read", case_id: caseId }, epoch);
      if (data && epoch === requestEpoch.current) {
        setView(data as unknown as FinalRequestStateView);
      }
    } catch (e) {
      if (epoch === requestEpoch.current) {
        setError(e instanceof Error ? e.message : "Opération impossible");
      }
    } finally {
      if (epoch === requestEpoch.current) setBusy(false);
    }
  }

  const head = view?.head ??
    { generation: 0, revision_id: null, capture_id: null };
  const sources = view?.captureRecord?.inventory?.sources ?? [];
  const attestationRefs = view?.captureRecord?.sourceAttestationRefs ?? [];
  const limitations = view?.captureRecord?.capture?.limitations ?? [];
  // Pièce jointe ou document : la complétude doit être attestée explicitement.
  // Un email garde son contrat historique et n’expose aucun choix humain ici.
  const completenessRequired = attestation !== null &&
    requiresCompletenessAttestation(attestation.source);
  const completenessMissing = completenessRequired &&
    attestation?.completeness === null;
  // Un document autonome n’a aucune date en amont : sans date attestée il reste
  // SOURCE_DATE_UNKNOWN, donc invalidable, même déclaré complet.
  const sentAtRequired = attestation !== null &&
    requiresAttestedSentAt(attestation.source, attestation.completeness);
  const attestedSentAt = attestation && sentAtRequired
    ? attestedSentAtIso(attestation.sentAt)
    : null;
  const sentAtMissing = sentAtRequired && attestedSentAt === null;
  const capture = view?.captureRecord?.capture;
  const baseInput = capture?.baseInput;
  const revisionInput = view?.revision?.input;
  const revisionCaptureId = typeof view?.revision?.capture_id === "string"
    ? view.revision.capture_id
    : null;
  const revisionAssertions =
    view?.selectedRevisionMatchesHeadCapture &&
      revisionCaptureId === capture?.captureId &&
      revisionInput && typeof revisionInput === "object" &&
      !Array.isArray(revisionInput) &&
      Array.isArray((revisionInput as Record<string, unknown>).assertions)
      ? (revisionInput as Record<string, unknown>).assertions
      : [];
  const previousFor = (targetId: string): string | null => {
    const matching =
      view?.reviews.filter((item) =>
        reviewTargetJson(item.target) === targetId
      ) ?? [];
    return typeof matching.at(-1)?.id === "string"
      ? matching.at(-1)!.id as string
      : null;
  };
  const latestReviews = new Map<string, Record<string, unknown>>();
  for (const item of view?.reviews ?? []) {
    const key = reviewTargetJson(item.target);
    if (key) latestReviews.set(key, item);
  }
  const startReview = (
    decision: ReviewDraft["decision"],
    targetId: string,
    candidateRef: string | null,
  ) =>
    setReview({
      decision,
      targetId,
      candidateRef,
      previousEventId: previousFor(targetId),
      key: newFinalRequestKey("review"),
      reason: "",
    });

  if (!expanded) {
    return (
      <Card className="mb-6 border-slate-300">
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Demande client consolidée{" "}
              <Badge variant="outline">Sans pricing</Badge>
            </CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setExpanded(true);
                void load();
              }}
            >
              Ouvrir la revue
            </Button>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-slate-300">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Demande client consolidée{" "}
            <Badge variant="outline">Jamais prêt à coter</Badge>
          </CardTitle>
          <Button
            aria-label="Recharger la demande consolidée"
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={load}
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>État de travail uniquement</AlertTitle>
          <AlertDescription>
            Cette revue conserve les demandes et contradictions. Elle ne
            déclenche ni calcul, devis, fait canonique, puzzle ou email.
          </AlertDescription>
        </Alert>
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!view && busy && (
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />Chargement…
          </p>
        )}
        {view && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Génération {head.generation}</Badge>
              <Badge variant="secondary">
                {view.revision ? "Révision enregistrée" : "Aucune révision"}
              </Badge>
              <Badge variant="secondary">
                {view.history.length} version(s)
              </Badge>
            </div>
            {limitations.length > 0 && (
              <Alert className="border-amber-400">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Limites bloquantes</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {limitations.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Capture des sources</h4>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const key = captureKey ?? newFinalRequestKey("capture");
                    setCaptureKey(key);
                    void mutate({
                      operation: "capture",
                      case_id: caseId,
                      idempotency_key: key,
                      expected_revision_id: head.revision_id,
                      expected_generation: head.generation,
                    }, () => setCaptureKey(null));
                  }}
                >
                  Créer une nouvelle capture
                </Button>
              </div>
              {sources.length === 0
                ? (
                  <p className="text-muted-foreground">
                    Aucune source dans la capture courante.
                  </p>
                )
                : sources.map((source) => {
                  const ref = attestationRefs.find((item) =>
                    item.originKind === source.kind &&
                    item.originId === source.id
                  );
                  return (
                    <div
                      key={`${source.kind}:${source.id}`}
                      className="rounded border p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {sourceLabel(source)}
                        </span>
                        <Badge variant="outline">
                          {source.captureMode ?? source.kind}
                        </Badge>
                      </div>
                      {source.sentAt && (
                        <p className="text-xs text-muted-foreground">
                          Date source : {source.sentAt}
                        </p>
                      )}
                      {source.text && (
                        <blockquote className="text-xs border-l-2 pl-2 whitespace-pre-wrap break-words">
                          {source.text.slice(0, 800)}
                          {source.text.length > 800 ? "…" : ""}
                        </blockquote>
                      )}
                      {ref && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            setAttestation({
                              source,
                              key: newFinalRequestKey("attest"),
                              authorRole: "client",
                              contentClass: "current",
                              completeness: null,
                              sentAt: "",
                              reason: "",
                            })}
                        >
                          Attester cette source
                        </Button>
                      )}
                    </div>
                  );
                })}
            </div>
            {attestation && (
              <div className="rounded border bg-muted/20 p-3 space-y-3">
                <h4 className="font-medium">
                  Attestation — {sourceLabel(attestation.source)}
                </h4>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Rôle de l’auteur</Label>
                    <Select
                      value={attestation.authorRole}
                      onValueChange={(v) =>
                        setAttestation({ ...attestation, authorRole: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["client", "partner", "operator", "unknown"].map((
                          v,
                        ) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Classe du contenu</Label>
                    <Select
                      value={attestation.contentClass}
                      onValueChange={(v) =>
                        setAttestation({ ...attestation, contentClass: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["current", "quoted", "historical", "hypothesis"].map((
                          v,
                        ) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {completenessRequired && (
                  <div className="space-y-1">
                    <Label>Complétude du texte capturé</Label>
                    <Select
                      value={attestation.completeness ?? ""}
                      onValueChange={(v) =>
                        setAttestation({
                          ...attestation,
                          completeness: v as FinalRequestCompleteness,
                        })}
                    >
                      <SelectTrigger aria-label="Complétude du texte capturé">
                        <SelectValue placeholder="Choix obligatoire — aucune valeur par défaut" />
                      </SelectTrigger>
                      <SelectContent>
                        {FINAL_REQUEST_COMPLETENESS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      « Complet » signifie que vous avez ouvert le document
                      original et vérifié que le texte capturé reprend
                      intégralement les instructions utiles. « Partiel »
                      maintient le blocage de cette source. Aucune complétude
                      n’est déduite automatiquement.
                    </p>
                  </div>
                )}
                {sentAtRequired && (
                  <div className="space-y-1">
                    <Label htmlFor="frs-attest-sent-at">
                      Date et heure du document
                    </Label>
                    <Input
                      id="frs-attest-sent-at"
                      type="datetime-local"
                      value={attestation.sentAt}
                      onChange={(e) =>
                        setAttestation({
                          ...attestation,
                          sentAt: e.target.value,
                        })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Date et heure attestées par l’opérateur : ce document
                      autonome n’en fournit aucune, et sans elle la source reste
                      bloquante. Saisissez l’instant réel du document dans votre
                      fuseau ; aucune date n’est déduite.
                    </p>
                  </div>
                )}
                <Label htmlFor="frs-attest-reason">Justification</Label>
                <Textarea
                  id="frs-attest-reason"
                  value={attestation.reason}
                  onChange={(e) =>
                    setAttestation({ ...attestation, reason: e.target.value })}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || completenessMissing || sentAtMissing ||
                      attestation.reason.trim().length < 3}
                    onClick={() =>
                      void mutate({
                        operation: "attest_source",
                        case_id: caseId,
                        idempotency_key: attestation.key,
                        expected_revision_id: head.revision_id,
                        expected_generation: head.generation,
                        origin_kind: attestation.source.kind,
                        origin_id: attestation.source.id,
                        author_role: attestation.authorRole,
                        content_class: attestation.contentClass,
                        ...(completenessRequired && attestation.completeness
                          ? { completeness: attestation.completeness }
                          : {}),
                        ...(attestedSentAt ? { sent_at: attestedSentAt } : {}),
                        reason: attestation.reason.trim(),
                      }, () => setAttestation(null))}
                  >
                    Enregistrer l’attestation
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setAttestation(null)}
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            )}
            {capture?.captureId && baseInput
              ? (
                <FinalRequestAssertionEditor
                  key={`${caseId}:${capture.captureId}:${head.revision_id ?? "none"}`}
                  sources={baseInput.sources ?? []}
                  lotIds={baseInput.lotIds ?? []}
                  quotationVersionIds={baseInput.quotationVersionIds ?? []}
                  initialAssertions={revisionAssertions}
                  busy={busy}
                  onCommit={(assertions, idempotencyKey) =>
                    void mutate({
                      operation: "commit",
                      case_id: caseId,
                      idempotency_key: idempotencyKey,
                      expected_revision_id: head.revision_id,
                      expected_generation: head.generation,
                      capture_id: capture.captureId,
                      assertions,
                    }, () => {})}
                />
              )
              : (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Capture structurée nécessaire</AlertTitle>
                  <AlertDescription>
                    Créez une capture puis attestez les sources client. Aucune
                    instruction n’est inventée et aucun éditeur JSON libre
                    n’est proposé.
                  </AlertDescription>
                </Alert>
              )}
            {view.reviewTargets.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-medium">Contradictions à décider</h4>
                {view.reviewTargets.map((target: FinalRequestReviewTarget) => (
                  <div
                    key={target.targetId}
                    className="rounded border p-3 space-y-2"
                  >
                    <p className="font-medium">{targetLabel(target)}</p>
                    {target.candidates.map((candidate) => (
                      <div
                        key={candidate.assertionId}
                        className="flex flex-wrap gap-2 items-center"
                      >
                        <code className="text-xs">{candidate.assertionId}</code>
                        {candidate.actions.includes("confirm_instruction") && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              startReview(
                                "confirm_instruction",
                                target.targetId,
                                candidate.assertionId,
                              )}
                          >
                            Confirmer l’instruction
                          </Button>
                        )}
                      </div>
                    ))}
                    {target.kind === "field" && target.protectedFact && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          startReview(
                            "keep_protected_fact",
                            target.targetId,
                            target.protectedFact!.reference,
                          )}
                      >
                        Maintenir le fait protégé
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        startReview(
                          "request_clarification",
                          target.targetId,
                          null,
                        )}
                    >
                      Demander clarification
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {[...latestReviews.entries()].some(([, item]) =>
              item.action !== "revoke_decision"
            ) &&
              (
                <div className="space-y-2">
                  <h4 className="font-medium">Décisions actives</h4>
                  {[...latestReviews.entries()].filter(([, item]) =>
                    item.action !== "revoke_decision"
                  ).map(([targetId, item]) => (
                    <div
                      key={String(item.id)}
                      className="rounded border p-3 flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="text-xs">
                        {String(item.action)} —{" "}
                        {String(item.reason ?? "sans justification")}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          startReview("revoke_decision", targetId, null)}
                      >
                        Révoquer la décision
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            {view.revision && limitations.length === 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  startReview("review_capture", '["capture"]', null)}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />Valider cette capture
                identifiée
              </Button>
            )}
            {review && (
              <div className="rounded border bg-muted/20 p-3 space-y-2">
                <Label htmlFor="frs-review-reason">
                  Justification de la décision
                </Label>
                <Textarea
                  id="frs-review-reason"
                  value={review.reason}
                  onChange={(e) =>
                    setReview({ ...review, reason: e.target.value })}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || review.reason.trim().length < 3}
                    onClick={() =>
                      void mutate({
                        operation: "review",
                        case_id: caseId,
                        idempotency_key: review.key,
                        expected_revision_id: head.revision_id,
                        expected_generation: head.generation,
                        decision: review.decision,
                        target_id: review.targetId,
                        candidate_ref: review.candidateRef,
                        previous_event_id: review.previousEventId,
                        reason: review.reason.trim(),
                      }, () => setReview(null))}
                  >
                    Enregistrer la décision
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setReview(null)}
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            )}
            {view.history.length > 0 && (
              <details>
                <summary className="cursor-pointer flex gap-2 items-center">
                  <History className="h-4 w-4" />Historique immuable
                </summary>
                <ul className="mt-2 text-xs space-y-1">
                  {view.history.map((item, i) => (
                    <li key={String(item.id ?? i)}>
                      Révision {String(item.number ?? "?")} —{" "}
                      {String(item.createdAt ?? "date inconnue")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-xs text-muted-foreground">
              Autorisation de pricing : non.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
