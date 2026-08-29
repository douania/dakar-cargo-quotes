/**
 * Phases P1-A2 à P1-A4 — périmètres et estimations isolées par scénario.
 *
 * Rend l'objet « scénario » OPÉRABLE : lister, créer, réviser (nouvelle
 * version), sélectionner, comparer et lancer une estimation isolée.
 *
 * Doctrine (docs/PROVISIONAL_SCENARIO_QUOTES.md) :
 *   - le périmètre reste immuable ; le résultat P1-A4 vit dans un ledger
 *     parallèle et n'écrit jamais dans quote_facts ni dans le pricing canonique ;
 *   - un scénario est IMMUABLE : réviser crée une nouvelle version et remplace
 *     l'ancienne, sans jamais la modifier ;
 *   - sélectionner est un acte SÉPARÉ du périmètre (table historisée) ;
 *   - RoRo et ConRo restent descriptifs et sont bloqués fail-closed tant que le
 *     moteur isolé ne sait pas les chiffrer ;
 *   - les points ouverts sont DÉRIVÉS du périmètre par la base, jamais déclarés.
 *
 * Garde-fous (UI) :
 *   - AUCUNE écriture directe : pas de .insert/.update/.upsert/.delete/.rpc.
 *     Le rôle `authenticated` n'a que SELECT sur ces tables (migration
 *     20260828200000) ; la seule mutation possible est l'invocation de l'Edge
 *     Function `manage-quote-scenario`.
 *   - créer/réviser/sélectionner passent par manage-quote-scenario ; estimer
 *     passe par run-scenario-pricing. Aucune promotion, finalisation,
 *     version/PDF/email ou suppression.
 *   - Les contrôles de saisie ne sont qu'un confort : l'autorité est la RPC
 *     service_role-only et les contraintes de la table.
 */

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  Check,
  GitCompare,
  Layers,
  Loader2,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import {
  ATTACHMENT_STATUS_LABELS,
  ATTACHMENT_STATUSES,
  BOOKING_STAGE_LABELS,
  BOOKING_STAGES,
  buildScenarioRequestBody,
  buildScopeSnapshot,
  canReviseScenario,
  canSelectScenario,
  CLASSIFICATION_STATUS_LABELS,
  CLASSIFICATION_STATUSES,
  compareOpenPoints,
  compareScenarioScopes,
  deriveScenarioOpenPoints,
  draftFromScenario,
  emptyCargoUnitDraft,
  emptyLinkDraft,
  emptyScenarioDraft,
  formatOpenPoint,
  LINKABLE_ASSUMPTION_STATUSES,
  LOCATION_KIND_LABELS,
  LOCATION_KINDS,
  LOCATION_STATUS_LABELS,
  LOCATION_STATUSES,
  MAX_CARGO_UNITS,
  MOVEMENT_DIRECTION_LABELS,
  MOVEMENT_DIRECTIONS,
  PACKAGING_LABELS,
  PACKAGING_VALUES,
  projectScopeFields,
  readStoredOpenPoints,
  REGIME_STATUS_LABELS,
  REGIME_STATUSES,
  RESERVE_CODE_LABELS,
  RESERVE_CODES,
  SCENARIO_STATUS_LABELS,
  scenarioMutationSignature,
  TERMINAL_MODE_UNSPECIFIED,
  TERMINAL_OPERATION_MODE_LABELS,
  TERMINAL_OPERATION_MODES,
  TRANSPORT_MODE_LABELS,
  TRANSPORT_MODES,
  UNIT_KIND_LABELS,
  UNIT_KINDS,
  type AttachmentStatus,
  type BookingStage,
  type CargoUnitDraft,
  type ClassificationStatus,
  type LocationKind,
  type LocationStatus,
  type MovementDirection,
  type PackagingValue,
  type PlaceDraft,
  type RegimeStatus,
  type ReserveCode,
  type ScenarioDraft,
  type ScenarioLinkDraft,
  type ScenarioOpenPoint,
  type ScenarioWritableStatus,
  type TransportMode,
  type UnitKind,
} from "@/lib/quoteScenarios";
import {
  countScenarioAssumptions,
  formatScenarioPricingAmount,
  latestScenarioPricingRuns,
  readScenarioPricingCodes,
  readScenarioPricingEdgeData,
  SCENARIO_PRICING_QUALIFICATION_LABELS,
  SCENARIO_PRICING_STATUS_LABELS,
  scenarioPricingMutationSignature,
  type ScenarioPricingRunSummary,
} from "@/lib/scenarioPricing";

type QuoteScenario = Database["public"]["Tables"]["quote_scenarios"]["Row"];
type QuoteScenarioLink = Database["public"]["Tables"]["quote_scenario_links"]["Row"];
type QuoteScenarioSelection =
  Database["public"]["Tables"]["quote_scenario_selections"]["Row"];

interface QuoteScenariosPanelProps {
  caseId: string;
}

const SCENARIO_COLUMNS =
  "id, case_id, root_scenario_id, revision_no, supersedes_scenario_id, " +
  "superseded_by_scenario_id, status, title, scope_snapshot, scope_hash, open_points, " +
  "blocked_reason, revision_reason, created_at, updated_at";

const LINK_COLUMNS = "id, scenario_id, assumption_id, reserve_code, open_point_key, created_at";

const SELECTION_COLUMNS =
  "id, scenario_id, selected_at, released_at, release_reason";

const SCENARIO_PRICING_COLUMNS =
  "id, scenario_id, run_seq, status, qualification, blockers, reservations, " +
  "assumptions_snapshot, firm_total_ht, firm_total_ttc, indicative_total_ht, " +
  "indicative_total_ttc, currency, completed_at";

interface ScenarioPricingSelectBuilder extends PromiseLike<{
  data: unknown[] | null;
  error: { message?: string } | null;
}> {
  select(columns: string): ScenarioPricingSelectBuilder;
  eq(column: string, value: string): ScenarioPricingSelectBuilder;
  order(column: string, options: { ascending: boolean }): ScenarioPricingSelectBuilder;
}

const scenarioPricingReader = supabase as unknown as {
  from(relation: string): ScenarioPricingSelectBuilder;
};

const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-800 border-slate-200",
  blocked: "bg-red-100 text-red-800 border-red-200",
  superseded: "bg-amber-100 text-amber-800 border-amber-200",
};

const PRICING_STATUS_CLASSES: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  blocked: "bg-amber-50 text-amber-900 border-amber-200",
  failed: "bg-red-50 text-red-800 border-red-200",
  superseded: "bg-slate-50 text-slate-700 border-slate-200",
};

function errorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === "string" ? m : null;
  }
  return null;
}

/** L'Edge Function renvoie l'enveloppe respondError() dans le corps HTTP. */
async function readEdgeErrorMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = (await (ctx as Response).json()) as { error?: { message?: string } };
      return body?.error?.message ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function formatLocalDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Formulaire STRUCTURÉ (jamais de JSON brut)
// ───────────────────────────────────────────────────────────────────────────

interface EnumFieldProps<T extends string> {
  label: string;
  value: string;
  options: readonly T[];
  labels: Record<string, string>;
  onChange: (value: T) => void;
}

function EnumField<T extends string>({ label, value, options, labels, onChange }: EnumFieldProps<T>) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option} className="text-xs">
              {labels[option] ?? option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  hint?: string;
}

function TextField({ label, value, onChange, placeholder, mono, hint }: TextFieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-8 text-xs ${mono ? "font-mono" : ""}`}
      />
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface SwitchFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function SwitchField({ label, checked, onChange }: SwitchFieldProps) {
  return (
    <div className="flex items-center gap-2 h-8">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

interface PlaceFieldsProps {
  title: string;
  place: PlaceDraft;
  onChange: (place: PlaceDraft) => void;
}

function PlaceFields({ title, place, onChange }: PlaceFieldsProps) {
  const set = <K extends keyof PlaceDraft>(key: K, value: PlaceDraft[K]) =>
    onChange({ ...place, [key]: value });

  return (
    <div className="space-y-2">
      <SectionTitle>{title}</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <EnumField
          label="Nature du lieu"
          value={place.locationKind}
          options={LOCATION_KINDS}
          labels={LOCATION_KIND_LABELS}
          onChange={(v: LocationKind) => set("locationKind", v)}
        />
        <EnumField
          label="Statut du lieu"
          value={place.locationStatus}
          options={LOCATION_STATUSES}
          labels={LOCATION_STATUS_LABELS}
          onChange={(v: LocationStatus) => set("locationStatus", v)}
        />
        <TextField
          label="Code du lieu (vide si non arrêté)"
          value={place.locationCode}
          onChange={(v) => set("locationCode", v)}
          placeholder="port-a"
          mono
        />
        <TextField
          label="Alternatives"
          value={place.alternatives}
          onChange={(v) => set("alternatives", v)}
          placeholder="inland-b, inland-c"
          mono
          hint="Références anonymes séparées par une virgule (8 max)."
        />
      </div>
    </div>
  );
}

interface CargoUnitFieldsProps {
  unit: CargoUnitDraft;
  position: number;
  removable: boolean;
  onChange: (unit: CargoUnitDraft) => void;
  onRemove: () => void;
}

function CargoUnitFields({ unit, position, removable, onChange, onRemove }: CargoUnitFieldsProps) {
  const set = <K extends keyof CargoUnitDraft>(key: K, value: CargoUnitDraft[K]) =>
    onChange({ ...unit, [key]: value });

  return (
    <div className="rounded-md border border-border/60 bg-background/60 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">Lot {position}</span>
        {removable ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px]"
            onClick={onRemove}
            type="button"
          >
            <X className="h-3 w-3 mr-1" />
            Retirer
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <TextField
          label="Référence du lot"
          value={unit.unitRef}
          onChange={(v) => set("unitRef", v)}
          placeholder="lot-1"
          mono
        />
        <EnumField
          label="Type de lot"
          value={unit.unitKind}
          options={UNIT_KINDS}
          labels={UNIT_KIND_LABELS}
          onChange={(v: UnitKind) => set("unitKind", v)}
        />
        <EnumField
          label="Emballage"
          value={unit.packaging}
          options={PACKAGING_VALUES}
          labels={PACKAGING_LABELS}
          onChange={(v: PackagingValue) => set("packaging", v)}
        />

        <div className="space-y-1">
          <SwitchField
            label={unit.equipmentKnown ? "Équipement connu" : "Équipement inconnu"}
            checked={unit.equipmentKnown}
            onChange={(checked) => set("equipmentKnown", checked)}
          />
          {unit.equipmentKnown ? (
            <Input
              value={unit.equipmentCode}
              onChange={(e) => set("equipmentCode", e.target.value)}
              placeholder="eq-40hc"
              className="h-8 text-xs font-mono"
            />
          ) : null}
        </div>

        <TextField
          label="Quantité"
          value={unit.quantity}
          onChange={(v) => set("quantity", v)}
          placeholder="1"
        />
        <TextField
          label="Destination du lot (vide si non affectée)"
          value={unit.destinationRef}
          onChange={(v) => set("destinationRef", v)}
          placeholder="dest-a"
          mono
        />

        <TextField
          label="Poids brut (kg, vide = inconnu)"
          value={unit.grossWeightKg}
          onChange={(v) => set("grossWeightKg", v)}
          placeholder="18000"
        />
        <TextField
          label="Poids taxable (kg, vide = inconnu)"
          value={unit.chargeableWeightKg}
          onChange={(v) => set("chargeableWeightKg", v)}
          placeholder="18000"
        />
        <TextField
          label="Volume (dm³, vide = inconnu)"
          value={unit.volumeDm3}
          onChange={(v) => set("volumeDm3", v)}
          placeholder="60000"
        />

        <div className="space-y-1">
          <SwitchField
            label="Température dirigée"
            checked={unit.temperatureControlRequired}
            onChange={(checked) => set("temperatureControlRequired", checked)}
          />
          {unit.temperatureControlRequired ? (
            <Input
              value={unit.temperatureSetpointCelsius}
              onChange={(e) => set("temperatureSetpointCelsius", e.target.value)}
              placeholder="-18 (entier, vide = non arrêtée)"
              className="h-8 text-xs"
            />
          ) : null}
        </div>

        <EnumField
          label="Classification marchandise"
          value={unit.classificationStatus}
          options={CLASSIFICATION_STATUSES}
          labels={CLASSIFICATION_STATUS_LABELS}
          onChange={(v: ClassificationStatus) => set("classificationStatus", v)}
        />
        <EnumField
          label="Pièce requise"
          value={unit.requiredAttachmentStatus}
          options={ATTACHMENT_STATUSES}
          labels={ATTACHMENT_STATUS_LABELS}
          onChange={(v: AttachmentStatus) => set("requiredAttachmentStatus", v)}
        />

        <SwitchField
          label="Marchandise dangereuse (contrainte connue)"
          checked={unit.dangerousGoods}
          onChange={(checked) => set("dangerousGoods", checked)}
        />
      </div>
    </div>
  );
}

interface LinkableAssumption {
  id: string;
  statement: string;
  status: string;
}

interface LinkFieldsProps {
  link: ScenarioLinkDraft;
  position: number;
  openPoints: ScenarioOpenPoint[];
  assumptions: LinkableAssumption[];
  onChange: (link: ScenarioLinkDraft) => void;
  onRemove: () => void;
}

const NO_OPEN_POINT = "__none__";

function LinkFields({
  link,
  position,
  openPoints,
  assumptions,
  onChange,
  onRemove,
}: LinkFieldsProps) {
  const set = <K extends keyof ScenarioLinkDraft>(key: K, value: ScenarioLinkDraft[K]) =>
    onChange({ ...link, [key]: value });

  return (
    <div className="rounded-md border border-border/60 bg-background/60 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">Lien {position}</span>
        <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onRemove} type="button">
          <X className="h-3 w-3 mr-1" />
          Retirer
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <EnumField
          label="Cible"
          value={link.target}
          options={["assumption", "reserve"] as const}
          labels={{ assumption: "Hypothèse", reserve: "Réserve" }}
          onChange={(v: "assumption" | "reserve") => set("target", v)}
        />

        {link.target === "assumption" ? (
          <div className="space-y-1">
            <Label className="text-[11px]">Hypothèse liée</Label>
            <Select value={link.assumptionId} onValueChange={(v) => set("assumptionId", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Choisir une hypothèse" />
              </SelectTrigger>
              <SelectContent>
                {assumptions.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    {a.statement.length > 70 ? `${a.statement.slice(0, 70)}…` : a.statement}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {assumptions.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">
                Aucune hypothèse active ou confirmée client à lier.
              </p>
            ) : null}
          </div>
        ) : (
          <EnumField
            label="Réserve"
            value={link.reserveCode}
            options={RESERVE_CODES}
            labels={RESERVE_CODE_LABELS}
            onChange={(v: ReserveCode) => set("reserveCode", v)}
          />
        )}

        <div className="space-y-1">
          <Label className="text-[11px]">Point ouvert couvert (optionnel)</Label>
          <Select
            value={link.openPointKey === "" ? NO_OPEN_POINT : link.openPointKey}
            onValueChange={(v) => set("openPointKey", v === NO_OPEN_POINT ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_OPEN_POINT} className="text-xs">
                Aucun
              </SelectItem>
              {openPoints.map((point) => (
                <SelectItem key={point.key} value={point.key} className="text-xs">
                  {formatOpenPoint(point)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

interface ScenarioFormProps {
  mode: "create" | "revise";
  draft: ScenarioDraft;
  openPoints: ScenarioOpenPoint[];
  snapshotError: string | null;
  assumptions: LinkableAssumption[];
  onChange: (draft: ScenarioDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
}

function ScenarioForm({
  mode,
  draft,
  openPoints,
  snapshotError,
  assumptions,
  onChange,
  onSubmit,
  onCancel,
  submitting,
}: ScenarioFormProps) {
  const set = <K extends keyof ScenarioDraft>(key: K, value: ScenarioDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const setUnit = (index: number, unit: CargoUnitDraft) => {
    const cargoUnits = draft.cargoUnits.map((u, i) => (i === index ? unit : u));
    onChange({ ...draft, cargoUnits });
  };

  const setLink = (index: number, link: ScenarioLinkDraft) => {
    const links = draft.links.map((l, i) => (i === index ? link : l));
    onChange({ ...draft, links });
  };

  return (
    <div className="rounded-md border border-sky-200 bg-background p-3 space-y-4 text-xs">
      <div className="space-y-2">
        <SectionTitle>Identification</SectionTitle>
        <div className="space-y-1">
          <Label className="text-[11px]">Titre du scénario</Label>
          <Input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Ex : périmètre import conteneurisé, port à confirmer"
            className="h-8 text-xs"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <EnumField
            label="Statut"
            value={draft.status}
            options={["draft", "blocked"] as const}
            labels={{ draft: "Brouillon", blocked: "Bloqué" }}
            onChange={(v: ScenarioWritableStatus) => set("status", v)}
          />
          {draft.status === "blocked" ? (
            <div className="space-y-1">
              <Label className="text-[11px]">Motif de blocage (obligatoire)</Label>
              <Textarea
                value={draft.blockedReason}
                onChange={(e) => set("blockedReason", e.target.value)}
                placeholder="Ex : attente de la position douanière du client"
                className="text-xs min-h-[44px]"
              />
            </div>
          ) : null}
        </div>

        {mode === "revise" ? (
          <div className="space-y-1">
            <Label className="text-[11px]">Motif de révision (obligatoire)</Label>
            <Textarea
              value={draft.revisionReason}
              onChange={(e) => set("revisionReason", e.target.value)}
              placeholder="Ex : le client a confirmé le port de livraison"
              className="text-xs min-h-[44px]"
            />
            <p className="text-[10px] text-muted-foreground">
              Réviser crée une NOUVELLE version. La version révisée reste intacte et devient
              « remplacée ».
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <SectionTitle>Acheminement</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <EnumField
            label="Mode de transport"
            value={draft.transportMode}
            options={TRANSPORT_MODES}
            labels={TRANSPORT_MODE_LABELS}
            onChange={(v: TransportMode) => set("transportMode", v)}
          />
          <EnumField
            label="Sens du mouvement"
            value={draft.movementDirection}
            options={MOVEMENT_DIRECTIONS}
            labels={MOVEMENT_DIRECTION_LABELS}
            onChange={(v: MovementDirection) => set("movementDirection", v)}
          />
          <EnumField
            label="Mode d'opération terminal"
            value={draft.terminalOperationMode}
            options={[TERMINAL_MODE_UNSPECIFIED, ...TERMINAL_OPERATION_MODES]}
            labels={{
              [TERMINAL_MODE_UNSPECIFIED]: "Non renseigné",
              ...TERMINAL_OPERATION_MODE_LABELS,
            }}
            onChange={(v) => set("terminalOperationMode", v as ScenarioDraft["terminalOperationMode"])}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          RoRo et ConRo sont des périmètres descriptifs légitimes : les décrire ici ne déclenche
          aucun calcul.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PlaceFields title="Origine" place={draft.origin} onChange={(v) => set("origin", v)} />
        <PlaceFields
          title="Destination"
          place={draft.destination}
          onChange={(v) => set("destination", v)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>Lots ({draft.cargoUnits.length}/{MAX_CARGO_UNITS})</SectionTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px]"
            type="button"
            disabled={draft.cargoUnits.length >= MAX_CARGO_UNITS}
            onClick={() =>
              onChange({
                ...draft,
                cargoUnits: [...draft.cargoUnits, emptyCargoUnitDraft(draft.cargoUnits.length + 1)],
              })
            }
          >
            <Plus className="h-3 w-3 mr-1" />
            Ajouter un lot
          </Button>
        </div>
        {draft.cargoUnits.map((unit, index) => (
          <CargoUnitFields
            key={index}
            unit={unit}
            position={index + 1}
            removable={draft.cargoUnits.length > 1}
            onChange={(next) => setUnit(index, next)}
            onRemove={() =>
              onChange({ ...draft, cargoUnits: draft.cargoUnits.filter((_, i) => i !== index) })
            }
          />
        ))}
      </div>

      <div className="space-y-2">
        <SectionTitle>Douane, booking, documents</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <EnumField
            label="Régime douanier"
            value={draft.customsRegimeStatus}
            options={REGIME_STATUSES}
            labels={REGIME_STATUS_LABELS}
            onChange={(v: RegimeStatus) => set("customsRegimeStatus", v)}
          />
          <TextField
            label="Code de régime (optionnel)"
            value={draft.customsRegimeCode}
            onChange={(v) => set("customsRegimeCode", v)}
            placeholder="reg-c400"
            mono
          />
          <SwitchField
            label="Déclarations scindées"
            checked={draft.customsSplitDeclarations}
            onChange={(v) => set("customsSplitDeclarations", v)}
          />
          <EnumField
            label="Étape de booking"
            value={draft.bookingStage}
            options={BOOKING_STAGES}
            labels={BOOKING_STAGE_LABELS}
            onChange={(v: BookingStage) => set("bookingStage", v)}
          />
          <TextField
            label="Référence transporteur (optionnel)"
            value={draft.bookingCarrierRef}
            onChange={(v) => set("bookingCarrierRef", v)}
            placeholder="carrier-x"
            mono
          />
          <TextField
            label="Nombre de jeux documentaires"
            value={draft.documentsSetsCount}
            onChange={(v) => set("documentsSetsCount", v)}
            placeholder="1"
          />
          <SwitchField
            label="Jeux documentaires séparés"
            checked={draft.documentsSplitRequired}
            onChange={(v) => set("documentsSplitRequired", v)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <SectionTitle>Parties et contraintes</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <SwitchField
            label="Payeur = chargeur"
            checked={draft.partiesPayerIsShipper}
            onChange={(v) => set("partiesPayerIsShipper", v)}
          />
          <TextField
            label="Référence payeur (optionnel)"
            value={draft.partiesPayerRef}
            onChange={(v) => set("partiesPayerRef", v)}
            placeholder="party-1"
            mono
          />
          <TextField
            label="Référence destinataire (optionnel)"
            value={draft.partiesConsigneeRef}
            onChange={(v) => set("partiesConsigneeRef", v)}
            placeholder="party-2"
            mono
          />
          <SwitchField
            label="Multi-destination"
            checked={draft.constraintsMultiDestination}
            onChange={(v) => set("constraintsMultiDestination", v)}
          />
          <TextField
            label="Pays de transit"
            value={draft.constraintsTransitCountryRefs}
            onChange={(v) => set("constraintsTransitCountryRefs", v)}
            placeholder="ctry-1, ctry-2"
            mono
            hint="Références anonymes séparées par une virgule (8 max)."
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Aucune donnée client réelle dans ces références : elles sont anonymes et n'entrent dans
          aucun calcul.
        </p>
      </div>

      <div className="space-y-2">
        <SectionTitle>Points ouverts prévus ({openPoints.length})</SectionTitle>
        {snapshotError ? (
          <p className="text-[11px] text-red-700">{snapshotError}</p>
        ) : openPoints.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Ce périmètre n'ouvre aucun point : rien n'y est ambigu ni manquant.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {openPoints.map((point) => (
              <Badge key={point.key} variant="outline" className="text-[10px]">
                {formatOpenPoint(point)}
              </Badge>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Aperçu : les points ouverts sont dérivés du périmètre par la base, jamais déclarés.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>Hypothèses et réserves liées ({draft.links.length})</SectionTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px]"
            type="button"
            onClick={() => onChange({ ...draft, links: [...draft.links, emptyLinkDraft()] })}
          >
            <Plus className="h-3 w-3 mr-1" />
            Ajouter un lien
          </Button>
        </div>
        {draft.links.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Aucun lien déclaré.</p>
        ) : null}
        {draft.links.map((link, index) => (
          <LinkFields
            key={index}
            link={link}
            position={index + 1}
            openPoints={openPoints}
            assumptions={assumptions}
            onChange={(next) => setLink(index, next)}
            onRemove={() =>
              onChange({ ...draft, links: draft.links.filter((_, i) => i !== index) })
            }
          />
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel} disabled={submitting}>
          Annuler
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={onSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          {mode === "create" ? "Enregistrer le scénario" : "Enregistrer la révision"}
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Comparaison
// ───────────────────────────────────────────────────────────────────────────

interface ComparisonBlockProps {
  left: QuoteScenario;
  right: QuoteScenario;
}

function ComparisonBlock({ left, right }: ComparisonBlockProps) {
  const comparison = useMemo(
    () => compareScenarioScopes(left.scope_snapshot, right.scope_snapshot),
    [left.scope_snapshot, right.scope_snapshot],
  );
  const openPointDelta = useMemo(
    () =>
      compareOpenPoints(
        readStoredOpenPoints(left.open_points),
        readStoredOpenPoints(right.open_points),
      ),
    [left.open_points, right.open_points],
  );

  return (
    <div className="rounded-md border border-border/60 bg-background/60 p-2.5 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge variant="outline" className="text-[10px]">
          A · rév. {left.revision_no} — {left.title}
        </Badge>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <Badge variant="outline" className="text-[10px]">
          B · rév. {right.revision_no} — {right.title}
        </Badge>
      </div>

      {comparison.identical ? (
        <p className="text-[11px] text-muted-foreground">
          Ces deux périmètres sont identiques champ à champ.
        </p>
      ) : (
        <div className="space-y-1">
          {comparison.differences.map((diff) => (
            <div
              key={diff.path}
              className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1 border-b border-border/40 pb-1 last:border-b-0"
            >
              <span className="font-medium">
                {diff.kind === "added" ? "+ " : diff.kind === "removed" ? "− " : ""}
                {diff.label}
              </span>
              <span className="text-muted-foreground">
                A : {diff.before ?? "absent"}
              </span>
              <span className="text-foreground">B : {diff.after ?? "absent"}</span>
            </div>
          ))}
        </div>
      )}

      {openPointDelta.resolved.length > 0 || openPointDelta.opened.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {openPointDelta.resolved.map((point) => (
            <Badge
              key={`resolved-${point.key}`}
              variant="outline"
              className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-200"
            >
              Levé en B : {formatOpenPoint(point)}
            </Badge>
          ))}
          {openPointDelta.opened.map((point) => (
            <Badge
              key={`opened-${point.key}`}
              variant="outline"
              className="text-[10px] bg-amber-50 text-amber-800 border-amber-200"
            >
              Ouvert en B : {formatOpenPoint(point)}
            </Badge>
          ))}
        </div>
      ) : null}

      <p className="text-[10px] text-muted-foreground">
        Les lots sont comparés par référence, jamais par position : permuter deux lots ne crée
        aucun écart.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Panneau
// ───────────────────────────────────────────────────────────────────────────

const NO_SCENARIO = "__none__";

export function QuoteScenariosPanel({ caseId }: QuoteScenariosPanelProps) {
  const queryClient = useQueryClient();
  // Une réponse réseau perdue ne doit jamais transformer un rejeu manuel en
  // nouvelle création/révision. La clé reste associée au contenu logique exact
  // jusqu'au succès ; modifier le formulaire produit une autre signature.
  const mutationKeys = useRef(new Map<string, string>());
  const pricingMutationKeys = useRef(new Map<string, string>());
  const [formMode, setFormMode] = useState<"none" | "create" | "revise">("none");
  const [reviseTargetId, setReviseTargetId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScenarioDraft>(emptyScenarioDraft);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingPricingId, setPendingPricingId] = useState<string | null>(null);
  const [compareLeftId, setCompareLeftId] = useState<string>(NO_SCENARIO);
  const [compareRightId, setCompareRightId] = useState<string>(NO_SCENARIO);

  const scenariosQuery = useQuery({
    queryKey: ["quote-scenarios", caseId],
    staleTime: 60_000,
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_scenarios")
        .select(SCENARIO_COLUMNS)
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QuoteScenario[];
    },
  });

  const linksQuery = useQuery({
    queryKey: ["quote-scenario-links", caseId],
    staleTime: 60_000,
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_scenario_links")
        .select(LINK_COLUMNS)
        .eq("case_id", caseId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as QuoteScenarioLink[];
    },
  });

  const selectionsQuery = useQuery({
    queryKey: ["quote-scenario-selections", caseId],
    staleTime: 60_000,
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_scenario_selections")
        .select(SELECTION_COLUMNS)
        .eq("case_id", caseId)
        .order("selected_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QuoteScenarioSelection[];
    },
  });

  const assumptionsQuery = useQuery({
    queryKey: ["quote-scenario-linkable-assumptions", caseId],
    staleTime: 60_000,
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_scenario_assumptions")
        .select("id, statement, status")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LinkableAssumption[];
    },
  });

  const pricingRunsQuery = useQuery({
    queryKey: ["quote-scenario-pricing-runs", caseId],
    staleTime: 30_000,
    enabled: !!caseId,
    queryFn: async () => {
      // La migration P1-A4 est locale dans ce lot ; les types Supabase générés
      // ne sont régénérés qu'après application canonique. Ce lecteur minimal
      // reste strictement SELECT et le résultat est validé par notre type local.
      const { data, error } = await scenarioPricingReader
        .from("quote_scenario_pricing_runs")
        .select(SCENARIO_PRICING_COLUMNS)
        .eq("case_id", caseId)
        .order("run_seq", { ascending: false });
      if (error) throw new Error(error.message ?? "Estimations de scénario indisponibles");
      return (data ?? []) as unknown as ScenarioPricingRunSummary[];
    },
  });

  const scenarios = useMemo(() => scenariosQuery.data ?? [], [scenariosQuery.data]);
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data]);
  const selections = useMemo(() => selectionsQuery.data ?? [], [selectionsQuery.data]);
  const assumptions = useMemo(() => assumptionsQuery.data ?? [], [assumptionsQuery.data]);
  const latestPricingByScenario = useMemo(
    () => latestScenarioPricingRuns(pricingRunsQuery.data ?? []),
    [pricingRunsQuery.data],
  );

  const linksByScenario = useMemo(() => {
    const map = new Map<string, QuoteScenarioLink[]>();
    for (const link of links) {
      const bucket = map.get(link.scenario_id) ?? [];
      bucket.push(link);
      map.set(link.scenario_id, bucket);
    }
    return map;
  }, [links]);

  const assumptionById = useMemo(
    () => new Map(assumptions.map((a) => [a.id, a])),
    [assumptions],
  );

  const linkableAssumptions = useMemo(
    () =>
      assumptions.filter((a) =>
        (LINKABLE_ASSUMPTION_STATUSES as readonly string[]).includes(a.status),
      ),
    [assumptions],
  );

  const openSelection = useMemo(
    () => selections.find((s) => s.released_at === null) ?? null,
    [selections],
  );

  const scenarioById = useMemo(() => new Map(scenarios.map((s) => [s.id, s])), [scenarios]);

  // Aperçu du périmètre en cours de saisie : les points ouverts affichés ici
  // sont une PROJECTION, la base reste seule à les dériver pour de bon.
  const snapshotPreview = useMemo(() => buildScopeSnapshot(draft), [draft]);
  const previewOpenPoints = useMemo(
    () => (snapshotPreview.ok ? deriveScenarioOpenPoints(snapshotPreview.snapshot) : []),
    [snapshotPreview],
  );

  const mutation = useMutation({
    mutationFn: async (input: {
      operation: "create" | "revise" | "select";
      draft: ScenarioDraft | null;
      scenarioId?: string;
      idempotencyKey: string;
      mutationSignature: string;
    }) => {
      // La clé appartient à la mutation LOGIQUE, pas à l'exécution de
      // mutationFn : un rejeu de transport conserve donc la même clé, et la RPC
      // distingue relance et collision sémantique.
      const built = buildScenarioRequestBody(
        caseId,
        input.operation,
        input.idempotencyKey,
        input.draft,
        input.scenarioId,
      );
      if (!built.ok) throw new Error(built.message);

      const { data, error } = await supabase.functions.invoke("manage-quote-scenario", {
        body: built.body,
      });
      if (error) {
        const detail = await readEdgeErrorMessage(error);
        throw new Error(detail ?? error.message ?? "Mutation refusée");
      }
      return data;
    },
    onSuccess: async (_data, variables) => {
      mutationKeys.current.delete(variables.mutationSignature);
      toast.success(
        variables.operation === "create"
          ? "Scénario enregistré."
          : variables.operation === "revise"
            ? "Nouvelle version du scénario enregistrée."
            : "Scénario sélectionné.",
      );
      if (variables.operation !== "select") {
        setFormMode("none");
        setReviseTargetId(null);
        setDraft(emptyScenarioDraft());
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["quote-scenarios", caseId] }),
        queryClient.invalidateQueries({ queryKey: ["quote-scenario-links", caseId] }),
        queryClient.invalidateQueries({ queryKey: ["quote-scenario-selections", caseId] }),
      ]);
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err) ?? "Mutation refusée");
    },
    onSettled: () => setPendingId(null),
  });

  const pricingMutation = useMutation({
    mutationFn: async (input: {
      scenarioId: string;
      scopeHash: string;
      idempotencyKey: string;
      mutationSignature: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("run-scenario-pricing", {
        body: {
          case_id: caseId,
          scenario_id: input.scenarioId,
          expected_scope_hash: input.scopeHash,
          idempotency_key: input.idempotencyKey,
        },
      });
      if (error) {
        const detail = await readEdgeErrorMessage(error);
        throw new Error(detail ?? error.message ?? "Estimation isolée refusée");
      }
      const parsed = readScenarioPricingEdgeData(data);
      if (!parsed) throw new Error("Réponse d'estimation isolée invalide");
      return parsed;
    },
    onSuccess: async (data, variables) => {
      pricingMutationKeys.current.delete(variables.mutationSignature);
      if (data.status === "success") {
        toast.success(
          data.qualification === "partial"
            ? "Estimation partielle enregistrée avec réserves."
            : "Estimation provisoire enregistrée.",
        );
      } else if (data.status === "blocked") {
        toast.warning("Estimation bloquée sans produire de montant.");
      } else {
        toast.error("Le moteur n'a pas produit d'estimation.");
      }
      await queryClient.invalidateQueries({
        queryKey: ["quote-scenario-pricing-runs", caseId],
      });
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err) ?? "Estimation isolée refusée");
    },
    onSettled: () => setPendingPricingId(null),
  });

  const submitting = mutation.isPending;

  const mutationIdentity = (
    operation: "create" | "revise" | "select",
    logicalDraft: ScenarioDraft | null,
    scenarioId?: string,
  ) => {
    const signature = scenarioMutationSignature(caseId, operation, logicalDraft, scenarioId);
    const previous = mutationKeys.current.get(signature);
    if (previous) return { signature, idempotencyKey: previous };

    const idempotencyKey = crypto.randomUUID();
    mutationKeys.current.set(signature, idempotencyKey);
    return { signature, idempotencyKey };
  };

  const startCreate = () => {
    setDraft(emptyScenarioDraft());
    setReviseTargetId(null);
    setFormMode("create");
  };

  const startRevise = (scenario: QuoteScenario) => {
    setDraft(
      draftFromScenario(
        scenario,
        (linksByScenario.get(scenario.id) ?? []).map((l) => ({
          assumption_id: l.assumption_id,
          reserve_code: l.reserve_code,
          open_point_key: l.open_point_key,
        })),
      ),
    );
    setReviseTargetId(scenario.id);
    setFormMode("revise");
  };

  const cancelForm = () => {
    setFormMode("none");
    setReviseTargetId(null);
    setDraft(emptyScenarioDraft());
  };

  const submitForm = () => {
    if (formMode === "create") {
      const identity = mutationIdentity("create", draft);
      mutation.mutate({
        operation: "create",
        draft,
        idempotencyKey: identity.idempotencyKey,
        mutationSignature: identity.signature,
      });
    } else if (formMode === "revise" && reviseTargetId) {
      setPendingId(reviseTargetId);
      const identity = mutationIdentity("revise", draft, reviseTargetId);
      mutation.mutate({
        operation: "revise",
        draft,
        scenarioId: reviseTargetId,
        idempotencyKey: identity.idempotencyKey,
        mutationSignature: identity.signature,
      });
    }
  };

  /** Sélectionner est un acte SÉPARÉ : il ne touche ni au périmètre ni au statut. */
  const runSelect = (scenarioId: string) => {
    setPendingId(scenarioId);
    const identity = mutationIdentity("select", null, scenarioId);
    mutation.mutate({
      operation: "select",
      draft: null,
      scenarioId,
      idempotencyKey: identity.idempotencyKey,
      mutationSignature: identity.signature,
    });
  };

  const runScenarioPricing = (scenario: QuoteScenario) => {
    const signature = scenarioPricingMutationSignature(caseId, scenario.id, scenario.scope_hash);
    let idempotencyKey = pricingMutationKeys.current.get(signature);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      pricingMutationKeys.current.set(signature, idempotencyKey);
    }
    setPendingPricingId(scenario.id);
    pricingMutation.mutate({
      scenarioId: scenario.id,
      scopeHash: scenario.scope_hash,
      idempotencyKey,
      mutationSignature: signature,
    });
  };

  const compareLeft = compareLeftId === NO_SCENARIO ? null : scenarioById.get(compareLeftId);
  const compareRight = compareRightId === NO_SCENARIO ? null : scenarioById.get(compareRightId);

  if (scenariosQuery.isLoading) {
    return (
      <Card className="mb-6 border-border/50">
        <CardContent className="py-3 px-4 text-xs text-muted-foreground">
          Chargement des scénarios…
        </CardContent>
      </Card>
    );
  }

  if (scenariosQuery.error) {
    const message = errorMessage(scenariosQuery.error);
    return (
      <Alert className="mb-6">
        <AlertDescription className="text-xs">
          <span className="font-medium">Scénarios indisponibles</span>
          {message ? <span className="text-muted-foreground"> — {message}</span> : null}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="mb-6 border-sky-200 bg-sky-50/30">
      <CardHeader className="py-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-600" />
              Scénarios de périmètre
              <Badge variant="secondary" className="text-[10px] ml-1">
                {scenarios.length}
              </Badge>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Un scénario décrit un périmètre. Son estimation reste provisoire, isolée du
              dossier canonique et ne constitue jamais une offre.
            </p>
          </div>
          {formMode === "none" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              onClick={startCreate}
            >
              <Plus className="h-3 w-3 mr-1" />
              Nouveau scénario
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="py-2 px-4 space-y-2">
        <Alert className="border-amber-200 bg-amber-50/60">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
          <AlertDescription className="text-[11px] text-amber-900">
            Les montants affichés sont des estimations internes provisoires. Ils ne modifient
            ni les faits, ni le pricing canonique et ne peuvent générer ni version, PDF ou email.
          </AlertDescription>
        </Alert>

        {pricingRunsQuery.error ? (
          <Alert className="border-red-200 bg-red-50/60">
            <AlertDescription className="text-[11px] text-red-800">
              Les estimations isolées sont indisponibles — {errorMessage(pricingRunsQuery.error)}
            </AlertDescription>
          </Alert>
        ) : null}

        {formMode !== "none" ? (
          <ScenarioForm
            mode={formMode}
            draft={draft}
            openPoints={previewOpenPoints}
            snapshotError={snapshotPreview.ok ? null : snapshotPreview.message}
            assumptions={linkableAssumptions}
            onChange={setDraft}
            onSubmit={submitForm}
            onCancel={cancelForm}
            submitting={submitting}
          />
        ) : null}

        {scenarios.length >= 2 ? (
          <div className="rounded-md border border-border/60 bg-background/60 p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <GitCompare className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium">Comparer deux scénarios</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  ["A", compareLeftId, setCompareLeftId],
                  ["B", compareRightId, setCompareRightId],
                ] as const
              ).map(([side, value, setter]) => (
                <div key={side} className="space-y-1">
                  <Label className="text-[11px]">Version {side}</Label>
                  <Select value={value} onValueChange={setter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SCENARIO} className="text-xs">
                        Aucune
                      </SelectItem>
                      {scenarios.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">
                          rév. {s.revision_no} — {s.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {compareLeft && compareRight && compareLeft.id !== compareRight.id ? (
              <ComparisonBlock left={compareLeft} right={compareRight} />
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Choisir deux versions distinctes pour voir les écarts de périmètre.
              </p>
            )}
          </div>
        ) : null}

        {scenarios.length === 0 && formMode === "none" ? (
          <p className="text-xs text-muted-foreground py-1">
            Aucun scénario enregistré pour ce dossier.
          </p>
        ) : null}

        {scenarios.map((scenario) => {
          const statusLabel = SCENARIO_STATUS_LABELS[scenario.status] ?? scenario.status;
          const statusClass = STATUS_CLASSES[scenario.status] ?? "bg-muted text-muted-foreground";
          const openPoints = readStoredOpenPoints(scenario.open_points);
          const scenarioLinks = linksByScenario.get(scenario.id) ?? [];
          const isSelected = openSelection?.scenario_id === scenario.id;
          const isPending = submitting && pendingId === scenario.id;
          const isPricingPending = pricingMutation.isPending && pendingPricingId === scenario.id;
          const revisable = canReviseScenario(scenario);
          const selectable = canSelectScenario(scenario);
          const latestPricing = latestPricingByScenario.get(scenario.id) ?? null;
          const canPriceScenario = isSelected &&
            !["blocked", "superseded", "promoted_to_final"].includes(scenario.status) &&
            !scenario.superseded_by_scenario_id;
          const fields = projectScopeFields(scenario.scope_snapshot);
          const headline = fields
            .filter((f) =>
              ["transport_mode", "movement_direction", "terminal_operation_mode"].includes(f.path),
            )
            .map((f) => f.value)
            .join(" · ");

          return (
            <div
              key={scenario.id}
              className="rounded-md border border-border/60 bg-background/60 p-2.5 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground">{scenario.title}</span>
                  <Badge variant="outline" className="text-[10px]">
                    rév. {scenario.revision_no}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                  <Badge variant="outline" className={`text-[10px] ${statusClass}`}>
                    {statusLabel}
                  </Badge>
                  {scenario.superseded_by_scenario_id ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-amber-50 text-amber-800 border-amber-200"
                      title="Une version plus récente remplace celle-ci."
                    >
                      Remplacé
                    </Badge>
                  ) : null}
                  {isSelected ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-200"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Sélectionné
                    </Badge>
                  ) : null}
                </div>
              </div>

              <p className="mt-1 text-muted-foreground">{headline}</p>

              {scenario.blocked_reason ? (
                <p className="mt-1 text-red-700">
                  <span className="font-medium">Blocage : </span>
                  {scenario.blocked_reason}
                </p>
              ) : null}

              {scenario.revision_reason ? (
                <p className="mt-1 text-muted-foreground">
                  <span className="font-medium">Motif de révision : </span>
                  {scenario.revision_reason}
                </p>
              ) : null}

              <div className="mt-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Points ouverts ({openPoints.length})
                </span>
                {openPoints.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground"> — aucun</span>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {openPoints.map((point) => (
                      <Badge key={point.key} variant="outline" className="text-[10px]">
                        {formatOpenPoint(point)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {scenarioLinks.length > 0 ? (
                <div className="mt-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Hypothèses et réserves ({scenarioLinks.length})
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {scenarioLinks.map((link) => {
                      const assumption = link.assumption_id
                        ? assumptionById.get(link.assumption_id)
                        : null;
                      const label = link.assumption_id
                        ? `Hypothèse : ${assumption?.statement ?? link.assumption_id}`
                        : `Réserve : ${
                            RESERVE_CODE_LABELS[link.reserve_code as ReserveCode] ??
                            link.reserve_code
                          }`;
                      return (
                        <Badge
                          key={link.id}
                          variant="outline"
                          className="text-[10px] max-w-full truncate"
                          title={link.open_point_key ?? undefined}
                        >
                          {label.length > 80 ? `${label.slice(0, 80)}…` : label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {latestPricing ? (
                <div className="mt-2 rounded-md border border-violet-200 bg-violet-50/40 p-2 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Calculator className="h-3.5 w-3.5 text-violet-700" />
                      <span className="text-[11px] font-medium text-violet-950">
                        Estimation isolée · exécution {latestPricing.run_seq}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${PRICING_STATUS_CLASSES[latestPricing.status] ?? ""}`}
                      >
                        {SCENARIO_PRICING_STATUS_LABELS[latestPricing.status]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {SCENARIO_PRICING_QUALIFICATION_LABELS[latestPricing.qualification]}
                      </Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {formatLocalDate(latestPricing.completed_at)}
                    </span>
                  </div>

                  {latestPricing.status === "success" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      <div className="rounded border border-emerald-200 bg-white/70 p-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Socle ferme démontré
                        </p>
                        <p className="font-medium text-emerald-800">
                          HT {formatScenarioPricingAmount(latestPricing.firm_total_ht, latestPricing.currency)}
                          {" · "}TTC {formatScenarioPricingAmount(latestPricing.firm_total_ttc, latestPricing.currency)}
                        </p>
                      </div>
                      <div className="rounded border border-violet-200 bg-white/70 p-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Total indicatif avec hypothèses
                        </p>
                        <p className="font-medium text-violet-900">
                          HT {formatScenarioPricingAmount(latestPricing.indicative_total_ht, latestPricing.currency)}
                          {" · "}TTC {formatScenarioPricingAmount(latestPricing.indicative_total_ttc, latestPricing.currency)}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {(() => {
                    const blockers = readScenarioPricingCodes(latestPricing.blockers);
                    const reservations = readScenarioPricingCodes(latestPricing.reservations);
                    const codes = Array.from(new Set([...blockers, ...reservations]));
                    return codes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {codes.map((code) => (
                          <Badge key={code} variant="outline" className="text-[10px] bg-white/70">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    ) : null;
                  })()}

                  <p className="text-[10px] text-muted-foreground">
                    {countScenarioAssumptions(latestPricing.assumptions_snapshot)} hypothèse(s) appliquée(s).
                    Résultat interne uniquement : aucune version, aucun PDF, aucun email.
                  </p>
                </div>
              ) : null}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>Créé le {formatLocalDate(scenario.created_at)}</span>
                {scenario.supersedes_scenario_id ? <span>Révision d'une version antérieure</span> : null}
                {isSelected && openSelection ? (
                  <span>Sélectionné le {formatLocalDate(openSelection.selected_at)}</span>
                ) : null}
                <span>
                  {latestPricing ? "Estimation isolée disponible" : "Aucune estimation isolée"}
                </span>
              </div>

              {formMode === "none" && (revisable || selectable || canPriceScenario) ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {revisable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px]"
                      disabled={submitting}
                      onClick={() => startRevise(scenario)}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Réviser
                    </Button>
                  ) : null}
                  {selectable && !isSelected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px]"
                      disabled={submitting}
                      onClick={() => runSelect(scenario.id)}
                    >
                      {isPending ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3 mr-1" />
                      )}
                      Sélectionner
                    </Button>
                  ) : null}
                  {canPriceScenario ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] border-violet-300 text-violet-800"
                      disabled={submitting || pricingMutation.isPending || pricingRunsQuery.isLoading}
                      onClick={() => runScenarioPricing(scenario)}
                    >
                      {isPricingPending ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Calculator className="h-3 w-3 mr-1" />
                      )}
                      Estimer isolément
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
