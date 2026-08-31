import { useState } from "react";
import { AlertTriangle, FileCheck2, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  addAssertion,
  type Assertion,
  ASSERTION_FIELD_KEYS,
  type AssertionFieldKey,
  type AssertionOperation,
  buildAssertion,
  describeAssertion,
  fieldRequiresLotScope,
  fieldValueKind,
  getEligibleSources,
  loadDraftFromRevisionAssertions,
  MAX_DRAFT_ASSERTIONS,
  type BuildAssertionContext,
  removeAssertion,
} from "@/lib/finalRequestAssertions";
import {
  type FinalRequestBaseInputSource,
  newFinalRequestKey,
} from "@/lib/finalRequestState";

interface Props {
  sources: FinalRequestBaseInputSource[];
  lotIds: string[];
  quotationVersionIds: string[];
  initialAssertions: unknown;
  busy: boolean;
  onCommit: (assertions: Assertion[], idempotencyKey: string) => void;
}

const OPERATION_LABELS: Record<AssertionOperation, string> = {
  set: "Définir ou modifier une information",
  remove: "Retirer une information",
  cancel_request: "Annuler la demande",
  resume_request: "Reprendre la demande",
  accept_quote: "Accepter une version de devis",
  reject_quote: "Refuser une version de devis",
  acknowledge: "Accusé de réception sans modification",
};

const FIELD_LABELS: Record<AssertionFieldKey, string> = {
  "cargo.description": "Description de la marchandise",
  "cargo.weight_kg": "Poids total (kg)",
  "cargo.volume_cbm": "Volume total (m³)",
  "cargo.pieces_count": "Nombre de pièces",
  "cargo.container_type": "Type de conteneur",
  "routing.origin_port": "Port d’origine",
  "routing.destination_port": "Port de destination",
  "routing.destination_city": "Destination finale",
  "routing.incoterm": "Incoterm",
  "transport.mode": "Mode de transport",
  "movement.direction": "Sens du mouvement",
  "terminal.operation_mode": "Opération terminale",
  "lot.in_scope": "Lot inclus dans la demande",
  "service.TRUCKING": "Transport terrestre demandé",
  "service.DTHC": "DTHC demandé",
  "service.CUSTOMS_DAKAR": "Dédouanement Dakar demandé",
  "service.SEA_FREIGHT": "Fret maritime demandé",
};

function sourceLabel(source: { kind: string; sentAt: string; id: string }) {
  return `${source.kind} du ${source.sentAt} — ${source.id.slice(0, 8)}`;
}

export function FinalRequestAssertionEditor({
  sources,
  lotIds,
  quotationVersionIds,
  initialAssertions,
  busy,
  onCommit,
}: Props) {
  const eligibleSources = getEligibleSources(sources);
  const context: BuildAssertionContext = {
    sources: eligibleSources,
    lotIds,
    quotationVersionIds,
  };
  const loaded = loadDraftFromRevisionAssertions(initialAssertions, context);
  const [draft, setDraft] = useState<Assertion[]>(() => loaded ?? []);
  const [loadError] = useState(() =>
    Array.isArray(initialAssertions) && loaded === null
      ? "La révision existante ne correspond pas à la capture courante. Rechargez la capture avant toute modification."
      : null
  );
  const [commitKey] = useState(() => newFinalRequestKey("commit"));
  const [sourceId, setSourceId] = useState(eligibleSources[0]?.id ?? "");
  const [operation, setOperation] = useState<AssertionOperation>("set");
  const [scopeKind, setScopeKind] = useState<"case" | "lot">("case");
  const [lotId, setLotId] = useState(lotIds[0] ?? "");
  const [field, setField] = useState<AssertionFieldKey>("cargo.description");
  const [rawValue, setRawValue] = useState("");
  const [quotationVersionId, setQuotationVersionId] = useState(
    quotationVersionIds[0] ?? "",
  );
  const [excerpt, setExcerpt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const selectedSource = eligibleSources.find((source) => source.id === sourceId);
  const visibleFieldKeys = lotIds.length === 0
    ? ASSERTION_FIELD_KEYS.filter((key) => key !== "lot.in_scope")
    : ASSERTION_FIELD_KEYS;
  const valueKind = fieldValueKind(field);
  const fieldOperation = operation === "set" || operation === "remove";
  const quoteOperation = operation === "accept_quote" ||
    operation === "reject_quote";
  const caseOnly = operation === "cancel_request" ||
    operation === "resume_request" || quoteOperation;

  function changeOperation(value: AssertionOperation) {
    setOperation(value);
    setFormError(null);
    if (
      value === "cancel_request" || value === "resume_request" ||
      value === "accept_quote" || value === "reject_quote"
    ) {
      setScopeKind("case");
    }
  }

  function addCurrentAssertion() {
    const built = buildAssertion({
      sourceId,
      operation,
      scopeKind,
      ...(scopeKind === "lot" ? { lotId } : {}),
      ...(fieldOperation ? { field } : {}),
      ...(operation === "set" ? { rawValue } : {}),
      ...(quoteOperation ? { quotationVersionId } : {}),
      excerpt,
    }, context);
    if (built.ok === false) {
      setFormError(built.error);
      return;
    }
    const added = addAssertion(draft, built.value);
    if (added.ok === false) {
      setFormError(added.error);
      return;
    }
    setDraft(added.value);
    setExcerpt("");
    setRawValue("");
    setFormError(null);
  }

  if (eligibleSources.length === 0) {
    return (
      <Alert className="border-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Aucune source client attestée exploitable</AlertTitle>
        <AlertDescription>
          Attestez une source comme client, contenu courant, avec une date et un
          texte complets, puis créez une nouvelle capture. Aucune instruction
          n’est déduite automatiquement.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="rounded border p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-medium flex items-center gap-2">
            <FileCheck2 className="h-4 w-4" /> Instructions client structurées
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            Saisie humaine contrôlée, sans extraction automatique ni pricing.
          </p>
        </div>
        <Badge variant="outline">
          {draft.length}/{MAX_DRAFT_ASSERTIONS} instruction(s)
        </Badge>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {formError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Source client attestée</Label>
          <Select
            value={sourceId}
            onValueChange={(value) => {
              setSourceId(value);
              setExcerpt("");
              setFormError(null);
            }}
          >
            <SelectTrigger aria-label="Source client attestée">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eligibleSources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {sourceLabel(source)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Action explicite du client</Label>
          <Select
            value={operation}
            onValueChange={(value) =>
              changeOperation(value as AssertionOperation)}
          >
            <SelectTrigger aria-label="Action explicite du client">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(OPERATION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedSource && (
        <blockquote className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 border-l-2 p-3 text-xs">
          {selectedSource.text}
        </blockquote>
      )}

      {!caseOnly && (
        <div className="space-y-1">
          <Label>Portée de l’instruction</Label>
          <Select
            value={scopeKind === "case" ? "case" : `lot:${lotId}`}
            onValueChange={(value) => {
              if (value === "case") {
                setScopeKind("case");
              } else {
                setScopeKind("lot");
                setLotId(value.slice(4));
              }
            }}
          >
            <SelectTrigger aria-label="Portée de l’instruction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="case">Dossier complet</SelectItem>
              {lotIds.map((id) => (
                <SelectItem key={id} value={`lot:${id}`}>Lot {id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {fieldOperation && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Information concernée</Label>
            <Select
              value={field}
              onValueChange={(value) => {
                const next = value as AssertionFieldKey;
                setField(next);
                setRawValue("");
                if (fieldRequiresLotScope(next) && lotIds.length > 0) {
                  setScopeKind("lot");
                  setLotId(lotIds[0]);
                }
              }}
            >
              <SelectTrigger aria-label="Information concernée">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {visibleFieldKeys.map((key) => (
                  <SelectItem key={key} value={key}>{FIELD_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {operation === "set" && (
            <div className="space-y-1">
              <Label>Valeur confirmée par le client</Label>
              {valueKind.kind === "enum" || valueKind.kind === "boolean"
                ? (
                  <Select value={rawValue} onValueChange={setRawValue}>
                    <SelectTrigger aria-label="Valeur confirmée par le client">
                      <SelectValue placeholder="Choisir" />
                    </SelectTrigger>
                    <SelectContent>
                      {valueKind.kind === "boolean"
                        ? (
                          <>
                            <SelectItem value="true">Oui</SelectItem>
                            <SelectItem value="false">Non</SelectItem>
                          </>
                        )
                        : valueKind.options.map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )
                : (
                  <Input
                    aria-label="Valeur confirmée par le client"
                    value={rawValue}
                    inputMode={valueKind.kind === "number" ||
                        valueKind.kind === "integer"
                      ? "decimal"
                      : "text"}
                    onChange={(event) => setRawValue(event.target.value)}
                    maxLength={500}
                  />
                )}
            </div>
          )}
        </div>
      )}

      {quoteOperation && (
        <div className="space-y-1">
          <Label>Version de devis citée par le client</Label>
          {quotationVersionIds.length === 0
            ? (
              <p className="text-xs text-destructive">
                Aucune version de devis canonique dans cette capture.
              </p>
            )
            : (
              <Select
                value={quotationVersionId}
                onValueChange={setQuotationVersionId}
              >
                <SelectTrigger aria-label="Version de devis citée par le client">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {quotationVersionIds.map((id) => (
                    <SelectItem key={id} value={id}>{id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="frs-assertion-excerpt">
          Extrait exact justifiant cette instruction
        </Label>
        <Textarea
          id="frs-assertion-excerpt"
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
          maxLength={2000}
          placeholder="Copiez ici les mots exacts visibles dans la source ci-dessus."
        />
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || Boolean(loadError) || !excerpt.trim()}
        onClick={addCurrentAssertion}
      >
        <Plus className="h-4 w-4 mr-1" /> Ajouter cette instruction
      </Button>

      {draft.length > 0 && (
        <div className="space-y-2">
          <h5 className="font-medium">Brouillon de révision</h5>
          {draft.map((assertion) => (
            <div
              key={assertion.id}
              className="rounded border p-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p>{describeAssertion(assertion)}</p>
                <p className="text-xs text-muted-foreground mt-1 break-words">
                  « {assertion.excerpt} »
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Retirer ${describeAssertion(assertion)}`}
                disabled={busy}
                onClick={() => setDraft(removeAssertion(draft, assertion.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            disabled={busy || Boolean(loadError)}
            onClick={() => onCommit(draft, commitKey)}
          >
            Enregistrer cette révision de travail
          </Button>
          <p className="text-xs text-muted-foreground">
            Cette révision reste une consolidation à revoir : elle ne lance ni
            pricing, devis, PDF ou email.
          </p>
        </div>
      )}
    </div>
  );
}
