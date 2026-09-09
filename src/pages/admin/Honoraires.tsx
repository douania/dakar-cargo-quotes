import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Receipt,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  ShieldAlert,
  Building2,
  CalendarClock,
  FlaskConical,
  Loader2,
} from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from '@/components/ui/accordion';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// ── H2-d1 : écran d'administration des honoraires internes ─────────────
// Modèle H2-a (fee_lines / fee_rules / clients), résolveur H2-b, lecture
// H2-c/H2-c2 par price-service-lines et run-pricing. Écriture réservée au
// rôle tariff_admin (RLS) ; lecture ouverte à tout utilisateur authentifié.
// Reste à H2-d2 : nouvelle version d'une règle par date d'effet, simulation
// sur un dossier, et garde-fou BASE DE DONNÉES sur les codes réservés (le
// garde-fou ci-dessous n'est qu'un filtre d'écran, contournable en SQL direct).

// Codes de service déjà utilisés par le moteur (quotation-engine) et par
// price-service-lines : une ligne d'honoraires portant l'un de ces codes
// serait facturée deux fois (ligne structurelle + ligne d'honoraires) ou
// disparaîtrait silencieusement à la déduplication. Source : VALID_SERVICE_KEYS
// et SERVICE_KEY_LABELS (supabase/functions/price-service-lines/index.ts,
// supabase/functions/run-pricing/index.ts), clés structurelles des couches
// d'enrichissement et groupes de DEDUP_GROUP_MAP.
//
// AGENCY et CUSTOMS_DAKAR sont volontairement ABSENTS : ce sont les deux
// honoraires internes que ce modèle sert depuis H2-c (INTERNAL_FEE_SERVICE_KEYS),
// ils existent déjà comme lignes et doivent rester modifiables.
//
// Miroir de public.fee_line_code_is_reserved() (migration H2-d2,
// 20260909170000), qui est le garde-fou effectif : la base refuse aussi les
// clés dynamiques <compagnie>_<code de charge> des templates compagnie actifs,
// que cet écran ne peut pas connaître sans requête supplémentaire.
const RESERVED_SERVICE_KEYS = new Set([
  'DTHC', 'ON_CARRIAGE', 'EMPTY_RETURN', 'DISCHARGE',
  'PORT_CHARGES', 'TRUCKING', 'CUSTOMS', 'PORT_DAKAR_HANDLING',
  'CUSTOMS_EXPORT', 'BORDER_FEES',
  'SURVEY', 'CUSTOMS_BAMAKO', 'TRANSIT_DOCS',
  'AIR_HANDLING', 'AIR_FREIGHT',
  'PICKUP_ORIGIN', 'PRE_CARRIAGE', 'SEA_FREIGHT',
  'THC_EXPORT', 'DOCUMENTATION_BL', 'VGM_WEIGHING',
  'STUFFING_FACTORY', 'STUFFING_CFS', 'EMPTY_REPO',
  'PAD_DROIT_PASSAGE', 'CMA_CGM_COMM', 'TERMINAL_STORAGE_PROVISION_ESTIMATE',
  'TERMINAL_HANDLING', 'TERMINAL_STORAGE',
  'SUIVI_OPERATIONNEL', 'OUVERTURE_DOSSIER', 'FRAIS_DOCUMENTATION', 'DEDOUANEMENT',
]);

const ANY = '__any__';

// ── Types ────────────────────────────────────────────────────────────

interface FeeLine {
  id: string;
  code: string;
  label_fr: string;
  description: string | null;
  vat_applicable: boolean;
  missing_rule_behavior: string;
  display_order: number;
  is_active: boolean;
}

interface FeeRule {
  id: string;
  fee_line_id: string;
  label: string | null;
  transport_mode: string | null;
  direction: string | null;
  shipment_type: string | null;
  customs_regime_code: string | null;
  container_family: string | null;
  dangerous_goods: boolean | null;
  weight_min_kg: number | null;
  weight_max_kg: number | null;
  value_min: number | null;
  value_max: number | null;
  client_code: string | null;
  method: string;
  amount: number | null;
  amount_20: number | null;
  amount_40: number | null;
  percent: number | null;
  value_basis: string | null;
  min_amount: number | null;
  max_amount: number | null;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  source_reference: string | null;
  notes: string | null;
}

interface ClientRow {
  code: string;
  legal_name: string;
  ninea: string | null;
  country_code: string | null;
  is_active: boolean;
}

interface LineFormData {
  code: string;
  label_fr: string;
  description: string;
  vat_applicable: boolean;
  missing_rule_behavior: string;
  display_order: number;
  is_active: boolean;
}

const EMPTY_LINE_FORM: LineFormData = {
  code: '',
  label_fr: '',
  description: '',
  vat_applicable: true,
  missing_rule_behavior: 'TO_CONFIRM',
  display_order: 100,
  is_active: true,
};

interface RuleFormData {
  label: string;
  transport_mode: string; // ANY | SEA | AIR | ROAD
  direction: string; // ANY | IMPORT | EXPORT | TRANSIT
  shipment_type: string; // ANY | FCL | LCL | BREAKBULK | RORO | AIR
  customs_regime_code: string;
  container_family: string; // ANY | DRY | REEFER | SPECIAL
  dangerous_goods: string; // ANY | 'true' | 'false'
  weight_min_kg: string;
  weight_max_kg: string;
  value_min: string;
  value_max: string;
  client_code: string; // ANY = générique
  method: string;
  amount: string;
  amount_20: string;
  amount_40: string;
  percent: string;
  value_basis: string; // ANY | CAF | CARGO_VALUE
  min_amount: string;
  max_amount: string;
  effective_from: string;
  effective_to: string;
  is_active: boolean;
  source_reference: string;
  notes: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const EMPTY_RULE_FORM: RuleFormData = {
  label: '',
  transport_mode: ANY,
  direction: ANY,
  shipment_type: ANY,
  customs_regime_code: '',
  container_family: ANY,
  dangerous_goods: ANY,
  weight_min_kg: '',
  weight_max_kg: '',
  value_min: '',
  value_max: '',
  client_code: ANY,
  method: 'FIXED',
  amount: '',
  amount_20: '',
  amount_40: '',
  percent: '',
  value_basis: ANY,
  min_amount: '',
  max_amount: '',
  effective_from: todayIso(),
  effective_to: '',
  is_active: true,
  source_reference: '',
  notes: '',
};

interface ClientFormData {
  code: string;
  legal_name: string;
  ninea: string;
  country_code: string;
}

const EMPTY_CLIENT_FORM: ClientFormData = { code: '', legal_name: '', ninea: '', country_code: '' };

/** Résolution d'une ligne renvoyée par la fonction simulate-fee-lines. */
interface FeeLineResolution {
  lineCode: string;
  label: string;
  status: 'RESOLVED' | 'TO_CONFIRM' | 'SKIPPED';
  amount: number | null;
  currency: string;
  ruleLabel: string | null;
  clientSpecific: boolean;
  reason: string | null;
  message: string;
  detail: string;
}

interface SimulationResult {
  case_id: string;
  as_of_date: string;
  context: Record<string, unknown>;
  lines: FeeLineResolution[];
  firm_total_xof: number;
  scope_note: string | null;
}

interface CaseOption {
  id: string;
  request_type: string | null;
  status: string | null;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const fmtAmount = (n: number, currency = 'XOF') => new Intl.NumberFormat('fr-FR').format(n) + ' ' + currency;

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/** Veille d'une date ISO (AAAA-MM-JJ), pour clôturer la règle remplacée. */
function previousDayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Lendemain d'une date ISO (AAAA-MM-JJ). */
function nextDayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function summarizeConditions(r: FeeRule): string {
  const parts: string[] = [];
  if (r.direction) parts.push(r.direction);
  if (r.transport_mode) parts.push(r.transport_mode);
  if (r.shipment_type) parts.push(r.shipment_type);
  if (r.container_family) parts.push(`conteneur ${r.container_family}`);
  if (r.dangerous_goods === true) parts.push('marchandise dangereuse');
  if (r.dangerous_goods === false) parts.push('non dangereuse');
  if (r.customs_regime_code) parts.push(`régime ${r.customs_regime_code}`);
  if (r.weight_min_kg != null || r.weight_max_kg != null) {
    parts.push(`poids [${r.weight_min_kg ?? '0'}, ${r.weight_max_kg ?? '∞'}[ kg`);
  }
  if (r.value_min != null || r.value_max != null) {
    parts.push(`valeur [${r.value_min ?? '0'}, ${r.value_max ?? '∞'}[`);
  }
  return parts.length ? parts.join(' · ') : 'toutes conditions (générique)';
}

function summarizeMethod(r: FeeRule): string {
  switch (r.method) {
    case 'FIXED':
      return `Forfait ${fmtAmount(r.amount ?? 0, r.currency)}`;
    case 'PER_TONNE':
      return `${fmtAmount(r.amount ?? 0, r.currency)} / tonne entamée`;
    case 'PER_CONTAINER':
      return `20' ${fmtAmount(r.amount_20 ?? 0, r.currency)} · 40'/45' ${fmtAmount(r.amount_40 ?? 0, r.currency)}`;
    case 'PERCENT_OF_VALUE':
      return `${r.percent ?? 0} % de ${r.value_basis === 'CAF' ? 'la CAF' : 'la valeur marchandise'}`;
    default:
      return r.method;
  }
}

// ── Composant ────────────────────────────────────────────────────────

export default function Honoraires() {
  const queryClient = useQueryClient();

  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<FeeLine | null>(null);
  const [lineForm, setLineForm] = useState<LineFormData>(EMPTY_LINE_FORM);

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [ruleTargetLineId, setRuleTargetLineId] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<FeeRule | null>(null);
  // Règle dont on crée une nouvelle version à date d'effet (H2-d2) : elle sera
  // clôturée la veille et référencée par supersedes_rule_id.
  const [supersededRule, setSupersededRule] = useState<FeeRule | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleFormData>(EMPTY_RULE_FORM);

  const [simCaseId, setSimCaseId] = useState('');
  const [simDate, setSimDate] = useState(todayIso());
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [clientForm, setClientForm] = useState<ClientFormData>(EMPTY_CLIENT_FORM);

  // ── Rôle ─────────────────────────────────────────────────────────

  const { data: isTariffAdmin = false } = useQuery({
    queryKey: ['has-tariff-admin-role'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('has_tariff_admin_role');
      if (error) throw error;
      return !!data;
    },
  });

  // ── Requêtes ─────────────────────────────────────────────────────

  const { data: feeLines = [], isLoading: linesLoading } = useQuery({
    queryKey: ['fee-lines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fee_lines')
        .select('*')
        .order('display_order')
        .order('code');
      if (error) throw error;
      return data as FeeLine[];
    },
  });

  const { data: feeRules = [] } = useQuery({
    queryKey: ['fee-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fee_rules')
        .select('*')
        .order('effective_from', { ascending: false });
      if (error) throw error;
      return data as FeeRule[];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['fee-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('code, legal_name, ninea, country_code, is_active')
        .order('code');
      if (error) throw error;
      return data as ClientRow[];
    },
  });

  const { data: recentCases = [] } = useQuery({
    queryKey: ['fee-simulation-cases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_cases')
        .select('id, request_type, status, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as CaseOption[];
    },
  });

  const rulesByLine = useMemo(() => {
    const map = new Map<string, FeeRule[]>();
    for (const r of feeRules) {
      const list = map.get(r.fee_line_id) ?? [];
      list.push(r);
      map.set(r.fee_line_id, list);
    }
    return map;
  }, [feeRules]);

  // ── Mutations : lignes ─────────────────────────────────────────

  const saveLineMutation = useMutation({
    mutationFn: async (data: LineFormData & { id?: string }) => {
      const payload = {
        code: data.code.trim().toUpperCase(),
        label_fr: data.label_fr.trim(),
        description: data.description.trim() || null,
        vat_applicable: data.vat_applicable,
        missing_rule_behavior: data.missing_rule_behavior,
        display_order: data.display_order,
        is_active: data.is_active,
      };
      if (data.id) {
        const { error } = await supabase.from('fee_lines').update(payload).eq('id', data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('fee_lines').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fee-lines'] });
      toast.success(editingLine ? 'Ligne mise à jour' : 'Ligne créée');
      setLineDialogOpen(false);
      setEditingLine(null);
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  const toggleLineActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('fee_lines').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fee-lines'] });
      toast.success('Statut mis à jour');
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fee_lines').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fee-lines'] });
      queryClient.invalidateQueries({ queryKey: ['fee-rules'] });
      toast.success('Ligne supprimée (avec ses règles)');
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  // ── Mutations : règles ─────────────────────────────────────────

  const saveRuleMutation = useMutation({
    mutationFn: async (data: RuleFormData & { id?: string; fee_line_id: string }) => {
      const payload = {
        fee_line_id: data.fee_line_id,
        label: data.label.trim() || null,
        transport_mode: data.transport_mode === ANY ? null : data.transport_mode,
        direction: data.direction === ANY ? null : data.direction,
        shipment_type: data.shipment_type === ANY ? null : data.shipment_type,
        customs_regime_code: data.customs_regime_code.trim() || null,
        container_family: data.container_family === ANY ? null : data.container_family,
        dangerous_goods: data.dangerous_goods === ANY ? null : data.dangerous_goods === 'true',
        weight_min_kg: num(data.weight_min_kg),
        weight_max_kg: num(data.weight_max_kg),
        value_min: num(data.value_min),
        value_max: num(data.value_max),
        client_code: data.client_code === ANY ? null : data.client_code,
        method: data.method,
        amount: data.method === 'FIXED' || data.method === 'PER_TONNE' ? num(data.amount) : null,
        amount_20: data.method === 'PER_CONTAINER' ? num(data.amount_20) : null,
        amount_40: data.method === 'PER_CONTAINER' ? num(data.amount_40) : null,
        percent: data.method === 'PERCENT_OF_VALUE' ? num(data.percent) : null,
        value_basis: data.method === 'PERCENT_OF_VALUE' && data.value_basis !== ANY ? data.value_basis : null,
        min_amount: num(data.min_amount),
        max_amount: num(data.max_amount),
        effective_from: data.effective_from,
        effective_to: data.effective_to.trim() || null,
        is_active: data.is_active,
        source_reference: data.source_reference.trim() || null,
        notes: data.notes.trim() || null,
      };
      if (data.id) {
        const { error } = await supabase.from('fee_rules').update(payload).eq('id', data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('fee_rules').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fee-rules'] });
      toast.success(editingRule ? 'Règle mise à jour' : 'Règle créée');
      setRuleDialogOpen(false);
      setEditingRule(null);
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  // H2-d2 : nouvelle version d'une règle à une date d'effet. La règle
  // remplacée est d'abord clôturée la veille — sans quoi le trigger
  // anti-chevauchement (H2-a) refuserait la nouvelle règle — puis la nouvelle
  // est créée en la référençant. Si la création échoue, la clôture est annulée
  // pour ne pas laisser la ligne sans règle après la date d'effet.
  const supersedeRuleMutation = useMutation({
    mutationFn: async (data: RuleFormData & { fee_line_id: string; superseded: FeeRule }) => {
      const { superseded } = data;
      const closingDate = previousDayIso(data.effective_from);
      const previousEffectiveTo = superseded.effective_to;

      const { error: closeError } = await supabase
        .from('fee_rules')
        .update({ effective_to: closingDate })
        .eq('id', superseded.id);
      if (closeError) throw closeError;

      const payload = {
        fee_line_id: data.fee_line_id,
        label: data.label.trim() || null,
        transport_mode: data.transport_mode === ANY ? null : data.transport_mode,
        direction: data.direction === ANY ? null : data.direction,
        shipment_type: data.shipment_type === ANY ? null : data.shipment_type,
        customs_regime_code: data.customs_regime_code.trim() || null,
        container_family: data.container_family === ANY ? null : data.container_family,
        dangerous_goods: data.dangerous_goods === ANY ? null : data.dangerous_goods === 'true',
        weight_min_kg: num(data.weight_min_kg),
        weight_max_kg: num(data.weight_max_kg),
        value_min: num(data.value_min),
        value_max: num(data.value_max),
        client_code: data.client_code === ANY ? null : data.client_code,
        method: data.method,
        amount: data.method === 'FIXED' || data.method === 'PER_TONNE' ? num(data.amount) : null,
        amount_20: data.method === 'PER_CONTAINER' ? num(data.amount_20) : null,
        amount_40: data.method === 'PER_CONTAINER' ? num(data.amount_40) : null,
        percent: data.method === 'PERCENT_OF_VALUE' ? num(data.percent) : null,
        value_basis: data.method === 'PERCENT_OF_VALUE' && data.value_basis !== ANY ? data.value_basis : null,
        min_amount: num(data.min_amount),
        max_amount: num(data.max_amount),
        effective_from: data.effective_from,
        effective_to: data.effective_to.trim() || null,
        is_active: data.is_active,
        source_reference: data.source_reference.trim() || null,
        notes: data.notes.trim() || null,
        supersedes_rule_id: superseded.id,
      };

      const { error: insertError } = await supabase.from('fee_rules').insert(payload);
      if (insertError) {
        // Rétablir la validité d'origine : mieux vaut l'ancien tarif qu'un trou.
        await supabase
          .from('fee_rules')
          .update({ effective_to: previousEffectiveTo })
          .eq('id', superseded.id);
        throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fee-rules'] });
      toast.success('Nouvelle version créée, règle précédente clôturée');
      setRuleDialogOpen(false);
      setSupersededRule(null);
      setEditingRule(null);
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  const simulateMutation = useMutation({
    mutationFn: async ({ caseId, asOfDate }: { caseId: string; asOfDate: string }) => {
      const { data, error } = await supabase.functions.invoke('simulate-fee-lines', {
        body: { case_id: caseId, as_of_date: asOfDate },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error?.message || 'Simulation refusée');
      return data.data as SimulationResult;
    },
    onSuccess: (result) => setSimResult(result),
    onError: (e) => {
      setSimResult(null);
      toast.error(`Simulation impossible : ${e.message}`);
    },
  });

  const toggleRuleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('fee_rules').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fee-rules'] });
      toast.success('Statut mis à jour');
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fee_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fee-rules'] });
      toast.success('Règle supprimée');
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  // ── Mutations : clients ────────────────────────────────────────

  const saveClientMutation = useMutation({
    mutationFn: async (data: ClientFormData) => {
      const payload = {
        code: data.code.trim().toUpperCase(),
        legal_name: data.legal_name.trim(),
        ninea: data.ninea.trim() || null,
        country_code: data.country_code.trim().toUpperCase() || null,
      };
      const { error } = await supabase.from('clients').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fee-clients'] });
      toast.success('Client créé');
      setClientDialogOpen(false);
      setClientForm(EMPTY_CLIENT_FORM);
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  // ── Dialog : ligne ─────────────────────────────────────────────

  const openLineDialog = (line?: FeeLine) => {
    if (line) {
      setEditingLine(line);
      setLineForm({
        code: line.code,
        label_fr: line.label_fr,
        description: line.description || '',
        vat_applicable: line.vat_applicable,
        missing_rule_behavior: line.missing_rule_behavior,
        display_order: line.display_order,
        is_active: line.is_active,
      });
    } else {
      setEditingLine(null);
      setLineForm(EMPTY_LINE_FORM);
    }
    setLineDialogOpen(true);
  };

  const validateLine = (): string | null => {
    const code = lineForm.code.trim().toUpperCase();
    // Le code n'est modifiable qu'à la création (champ désactivé en édition) :
    // ne le valider qu'à ce moment, sinon toute modification d'une ligne
    // existante serait bloquée par un contrôle qui ne la concerne pas.
    if (!editingLine) {
      if (!/^[A-Z0-9_]{2,40}$/.test(code)) {
        return "Le code doit être en majuscules, chiffres et tirets bas (2 à 40 caractères).";
      }
      if (RESERVED_SERVICE_KEYS.has(code)) {
        return `Le code « ${code} » est déjà une clé de service du moteur de chiffrage. Choisissez un autre code.`;
      }
    }
    if (!lineForm.label_fr.trim()) return 'Le libellé est requis.';
    return null;
  };

  const submitLine = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateLine();
    if (err) { toast.error(err); return; }
    saveLineMutation.mutate({ ...lineForm, id: editingLine?.id });
  };

  // ── Dialog : règle ─────────────────────────────────────────────

  const openRuleDialog = (lineId: string, rule?: FeeRule, mode: 'edit' | 'supersede' = 'edit') => {
    setRuleTargetLineId(lineId);
    if (rule && mode === 'supersede') {
      // Nouvelle version : mêmes conditions et mêmes montants, à réviser, avec
      // une date d'effet au lendemain de ce qui est déjà couvert.
      setEditingRule(null);
      setSupersededRule(rule);
    } else {
      setSupersededRule(null);
    }
    if (rule) {
      if (mode === 'edit') setEditingRule(rule);
      setRuleForm({
        label: rule.label || '',
        transport_mode: rule.transport_mode || ANY,
        direction: rule.direction || ANY,
        shipment_type: rule.shipment_type || ANY,
        customs_regime_code: rule.customs_regime_code || '',
        container_family: rule.container_family || ANY,
        dangerous_goods: rule.dangerous_goods === null ? ANY : String(rule.dangerous_goods),
        weight_min_kg: rule.weight_min_kg?.toString() ?? '',
        weight_max_kg: rule.weight_max_kg?.toString() ?? '',
        value_min: rule.value_min?.toString() ?? '',
        value_max: rule.value_max?.toString() ?? '',
        client_code: rule.client_code || ANY,
        method: rule.method,
        amount: rule.amount?.toString() ?? '',
        amount_20: rule.amount_20?.toString() ?? '',
        amount_40: rule.amount_40?.toString() ?? '',
        percent: rule.percent?.toString() ?? '',
        value_basis: rule.value_basis || ANY,
        min_amount: rule.min_amount?.toString() ?? '',
        max_amount: rule.max_amount?.toString() ?? '',
        // Nouvelle version : elle prend effet aujourd'hui, ou au lendemain de
        // la prise d'effet de la règle remplacée si celle-ci est plus récente
        // (la veille de la nouvelle date sert à clôturer l'ancienne, elle ne
        // peut donc pas précéder sa propre date d'effet).
        effective_from:
          mode === 'supersede'
            ? (todayIso() > rule.effective_from ? todayIso() : nextDayIso(rule.effective_from))
            : rule.effective_from,
        effective_to: mode === 'supersede' ? '' : (rule.effective_to || ''),
        is_active: mode === 'supersede' ? true : rule.is_active,
        source_reference: rule.source_reference || '',
        notes: rule.notes || '',
      });
    } else {
      setEditingRule(null);
      setRuleForm(EMPTY_RULE_FORM);
    }
    setRuleDialogOpen(true);
  };

  const validateRule = (): string | null => {
    if (ruleForm.method === 'FIXED' || ruleForm.method === 'PER_TONNE') {
      if (num(ruleForm.amount) == null) return 'Le montant est requis pour ce mode de calcul.';
    }
    if (ruleForm.method === 'PER_CONTAINER') {
      if (num(ruleForm.amount_20) == null || num(ruleForm.amount_40) == null) {
        return "Les montants 20' et 40' sont tous les deux requis.";
      }
    }
    if (ruleForm.method === 'PERCENT_OF_VALUE') {
      if (num(ruleForm.percent) == null) return 'Le pourcentage est requis.';
      if (ruleForm.value_basis === ANY) return "L'assiette (CAF ou valeur marchandise) est requise.";
    }
    const wMin = num(ruleForm.weight_min_kg);
    const wMax = num(ruleForm.weight_max_kg);
    if (wMin != null && wMax != null && wMax <= wMin) return 'Le poids maximum doit être supérieur au poids minimum.';
    const vMin = num(ruleForm.value_min);
    const vMax = num(ruleForm.value_max);
    if (vMin != null && vMax != null && vMax <= vMin) return 'La valeur maximum doit être supérieure à la valeur minimum.';
    if (ruleForm.effective_to && ruleForm.effective_to < ruleForm.effective_from) {
      return "La date de fin doit être postérieure à la date d'effet.";
    }
    if (supersededRule && ruleForm.effective_from <= supersededRule.effective_from) {
      return `La nouvelle version doit prendre effet après le ${supersededRule.effective_from}, date d'effet de la règle remplacée.`;
    }
    return null;
  };

  const submitRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleTargetLineId) return;
    const err = validateRule();
    if (err) { toast.error(err); return; }
    if (supersededRule) {
      supersedeRuleMutation.mutate({
        ...ruleForm,
        fee_line_id: ruleTargetLineId,
        superseded: supersededRule,
      });
      return;
    }
    saveRuleMutation.mutate({ ...ruleForm, id: editingRule?.id, fee_line_id: ruleTargetLineId });
  };

  const runSimulation = () => {
    if (!simCaseId) { toast.error('Choisissez un dossier à simuler.'); return; }
    simulateMutation.mutate({ caseId: simCaseId, asOfDate: simDate });
  };

  // ── Dialog : client ────────────────────────────────────────────

  const submitClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientForm.code.trim() || !clientForm.legal_name.trim()) {
      toast.error('Le code et la raison sociale sont requis.');
      return;
    }
    saveClientMutation.mutate(clientForm);
  };

  // ── Rendu ────────────────────────────────────────────────────────

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Receipt className="h-6 w-6" /> Honoraires internes
            </h1>
            <p className="text-sm text-muted-foreground">
              Source unique paramétrable des honoraires SODATRA (AGENCY, CUSTOMS_DAKAR et toute ligne
              créée librement) — lue par le moteur de chiffrage (H2-c / H2-c2).
            </p>
          </div>
          {!isTariffAdmin && (
            <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300 dark:text-amber-400">
              <ShieldAlert className="h-3.5 w-3.5" /> Lecture seule (rôle tariff_admin requis pour écrire)
            </Badge>
          )}
        </div>

        {/* ── Registre clients ─────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2"><Building2 className="h-5 w-5" /> Registre clients</CardTitle>
              <CardDescription>Référencé par les règles d'honoraires client et les faits client.code.</CardDescription>
            </div>
            <Button size="sm" disabled={!isTariffAdmin} onClick={() => setClientDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nouveau client
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Raison sociale</TableHead>
                  <TableHead>NINEA</TableHead>
                  <TableHead>Pays</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell className="font-mono">{c.code}</TableCell>
                    <TableCell>{c.legal_name}</TableCell>
                    <TableCell>{c.ninea || '—'}</TableCell>
                    <TableCell>{c.country_code || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={c.is_active ? 'default' : 'secondary'}>{c.is_active ? 'Actif' : 'Inactif'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {clients.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Aucun client.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── Lignes et règles d'honoraires ────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Lignes d'honoraires</CardTitle>
              <CardDescription>Chaque ligne active entre d'elle-même dans le devis (bloc honoraires).</CardDescription>
            </div>
            <Button size="sm" disabled={!isTariffAdmin} onClick={() => openLineDialog()}>
              <Plus className="h-4 w-4 mr-1" /> Nouvelle ligne
            </Button>
          </CardHeader>
          <CardContent>
            {linesLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <Accordion type="multiple" className="space-y-2">
                {feeLines.map((line) => {
                  const rules = rulesByLine.get(line.id) ?? [];
                  return (
                    <AccordionItem key={line.id} value={line.id} className="border rounded-md px-3">
                      <div className="flex items-center gap-2">
                        <AccordionTrigger className="flex-1 py-3">
                          <div className="flex items-center gap-2 text-left">
                            <span className="font-mono text-sm">{line.code}</span>
                            <span className="font-medium">{line.label_fr}</span>
                            <Badge variant={line.is_active ? 'default' : 'secondary'}>{line.is_active ? 'Active' : 'Inactive'}</Badge>
                            <Badge variant="outline">{line.missing_rule_behavior === 'SKIP' ? 'Conditionnelle' : 'Attendue'}</Badge>
                            <Badge variant="outline">{line.vat_applicable ? 'TVA' : 'Hors TVA'}</Badge>
                            <span className="text-xs text-muted-foreground">{rules.length} règle{rules.length > 1 ? 's' : ''}</span>
                          </div>
                        </AccordionTrigger>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" disabled={!isTariffAdmin} onClick={() => openLineDialog(line)} title="Modifier la ligne">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" disabled={!isTariffAdmin}
                            onClick={() => toggleLineActiveMutation.mutate({ id: line.id, is_active: !line.is_active })}
                            title={line.is_active ? 'Désactiver' : 'Activer'}
                          >
                            {line.is_active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost" size="icon" disabled={!isTariffAdmin}
                            onClick={() => {
                              if (confirm(`Supprimer la ligne « ${line.label_fr} » et ses ${rules.length} règle(s) ?`)) {
                                deleteLineMutation.mutate(line.id);
                              }
                            }}
                            title="Supprimer la ligne"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <AccordionContent>
                        <div className="flex justify-end mb-2">
                          <Button size="sm" variant="outline" disabled={!isTariffAdmin} onClick={() => openRuleDialog(line.id)}>
                            <Plus className="h-4 w-4 mr-1" /> Nouvelle règle
                          </Button>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Libellé</TableHead>
                              <TableHead>Conditions</TableHead>
                              <TableHead>Calcul</TableHead>
                              <TableHead>Client</TableHead>
                              <TableHead>Validité</TableHead>
                              <TableHead>Statut</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rules.map((r) => (
                              <TableRow key={r.id}>
                                <TableCell>{r.label || '—'}</TableCell>
                                <TableCell className="text-xs">{summarizeConditions(r)}</TableCell>
                                <TableCell className="text-xs">{summarizeMethod(r)}</TableCell>
                                <TableCell>{r.client_code ? <Badge variant="outline">{r.client_code}</Badge> : <span className="text-muted-foreground text-xs">générique</span>}</TableCell>
                                <TableCell className="text-xs">{r.effective_from} → {r.effective_to || '∞'}</TableCell>
                                <TableCell><Badge variant={r.is_active ? 'default' : 'secondary'}>{r.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                                <TableCell className="text-right">
                                  <Button variant="ghost" size="icon" disabled={!isTariffAdmin} onClick={() => openRuleDialog(line.id, r)} title="Modifier">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="icon" disabled={!isTariffAdmin}
                                    onClick={() => openRuleDialog(line.id, r, 'supersede')}
                                    title="Nouvelle version à une date d'effet (clôture celle-ci la veille)"
                                  >
                                    <CalendarClock className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="icon" disabled={!isTariffAdmin}
                                    onClick={() => toggleRuleActiveMutation.mutate({ id: r.id, is_active: !r.is_active })}
                                    title={r.is_active ? 'Désactiver' : 'Activer'}
                                  >
                                    {r.is_active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                                  </Button>
                                  <Button
                                    variant="ghost" size="icon" disabled={!isTariffAdmin}
                                    onClick={() => { if (confirm('Supprimer cette règle ?')) deleteRuleMutation.mutate(r.id); }}
                                    title="Supprimer"
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                            {rules.length === 0 && (
                              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground text-xs">Aucune règle — la ligne sera « à confirmer » ou absente selon son comportement par défaut.</TableCell></TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
                {feeLines.length === 0 && <p className="text-sm text-muted-foreground">Aucune ligne d'honoraires.</p>}
              </Accordion>
            )}
          </CardContent>
        </Card>

        {/* ── Simulation sur un dossier ────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><FlaskConical className="h-5 w-5" /> Simulation sur un dossier</CardTitle>
            <CardDescription>
              Applique le paramétrage courant aux faits d'un dossier réel, sans rien écrire ni relancer le
              chiffrage. Même code que le calcul réel : ce qui s'affiche ici est ce que produirait un chiffrage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Dossier</Label>
                <Select value={simCaseId} onValueChange={setSimCaseId}>
                  <SelectTrigger><SelectValue placeholder="Choisir un dossier récent…" /></SelectTrigger>
                  <SelectContent>
                    {recentCases.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.request_type || 'Type inconnu'} · {new Date(c.created_at).toLocaleDateString('fr-FR')} · {c.id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date d'évaluation</Label>
                <Input type="date" value={simDate} onChange={(e) => setSimDate(e.target.value)} />
              </div>
            </div>
            <Button size="sm" onClick={runSimulation} disabled={simulateMutation.isPending}>
              {simulateMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Simulation…</>
                : <><FlaskConical className="h-4 w-4 mr-1" /> Simuler</>}
            </Button>

            {simResult && (
              <div className="space-y-3">
                {simResult.scope_note && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 border-l-2 border-amber-400 pl-2">
                    {simResult.scope_note}
                  </p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ligne</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead>Explication</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {simResult.lines.map((l) => (
                      <TableRow key={l.lineCode}>
                        <TableCell>
                          <span className="font-mono text-xs">{l.lineCode}</span>
                          <div>{l.label}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={l.status === 'RESOLVED' ? 'default' : l.status === 'SKIPPED' ? 'secondary' : 'outline'}>
                            {l.status === 'RESOLVED' ? 'Chiffrée' : l.status === 'SKIPPED' ? 'Absente' : 'À confirmer'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {typeof l.amount === 'number' ? fmtAmount(l.amount, l.currency) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {l.message}
                          {l.clientSpecific && <Badge variant="outline" className="ml-2">tarif client</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {simResult.lines.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Aucune ligne d'honoraires active.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                <p className="text-sm">
                  Total ferme des honoraires (hors lignes à confirmer) :{' '}
                  <span className="font-semibold">{fmtAmount(simResult.firm_total_xof)}</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Dialog ligne ─────────────────────────────────────── */}
        <Dialog open={lineDialogOpen} onOpenChange={setLineDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editingLine ? 'Modifier la ligne' : 'Nouvelle ligne d\'honoraires'}</DialogTitle></DialogHeader>
            <form onSubmit={submitLine} className="space-y-4">
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input
                  value={lineForm.code}
                  disabled={!!editingLine}
                  onChange={(e) => setLineForm({ ...lineForm, code: e.target.value.toUpperCase() })}
                  placeholder="EX: HANDLING_SPECIAL"
                />
              </div>
              <div className="space-y-2">
                <Label>Libellé *</Label>
                <Input value={lineForm.label_fr} onChange={(e) => setLineForm({ ...lineForm, label_fr: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea rows={2} value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Si aucune règle ne s'applique</Label>
                  <Select value={lineForm.missing_rule_behavior} onValueChange={(v) => setLineForm({ ...lineForm, missing_rule_behavior: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TO_CONFIRM">À confirmer (ligne attendue)</SelectItem>
                      <SelectItem value="SKIP">Absente du devis (conditionnelle)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ordre d'affichage</Label>
                  <Input type="number" value={lineForm.display_order} onChange={(e) => setLineForm({ ...lineForm, display_order: Number(e.target.value) })} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Soumise à la TVA SODATRA</Label>
                <Switch checked={lineForm.vat_applicable} onCheckedChange={(v) => setLineForm({ ...lineForm, vat_applicable: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={lineForm.is_active} onCheckedChange={(v) => setLineForm({ ...lineForm, is_active: v })} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setLineDialogOpen(false)}>Annuler</Button>
                <Button type="submit" disabled={saveLineMutation.isPending}>{editingLine ? 'Enregistrer' : 'Créer'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── Dialog règle ─────────────────────────────────────── */}
        <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {supersededRule ? 'Nouvelle version de la règle' : editingRule ? 'Modifier la règle' : 'Nouvelle règle'}
              </DialogTitle>
            </DialogHeader>
            {supersededRule && (
              <p className="text-xs text-muted-foreground border-l-2 border-amber-400 pl-2">
                La règle en vigueur depuis le {supersededRule.effective_from} sera clôturée la veille de la date
                d'effet choisie ci-dessous. Les devis déjà établis ne sont pas modifiés.
              </p>
            )}
            <form onSubmit={submitRule} className="space-y-4">
              <div className="space-y-2">
                <Label>Libellé (repère interne)</Label>
                <Input value={ruleForm.label} onChange={(e) => setRuleForm({ ...ruleForm, label: e.target.value })} placeholder="Ex: Forfait 2026, grille LCL, supplément DG…" />
              </div>

              <p className="text-xs text-muted-foreground uppercase tracking-wide">Conditions (indifférent si non renseigné — toutes cumulatives)</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Sens</Label>
                  <Select value={ruleForm.direction} onValueChange={(v) => setRuleForm({ ...ruleForm, direction: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Indifférent</SelectItem>
                      <SelectItem value="IMPORT">Import</SelectItem>
                      <SelectItem value="EXPORT">Export</SelectItem>
                      <SelectItem value="TRANSIT">Transit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Mode de transport</Label>
                  <Select value={ruleForm.transport_mode} onValueChange={(v) => setRuleForm({ ...ruleForm, transport_mode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Indifférent</SelectItem>
                      <SelectItem value="SEA">Maritime</SelectItem>
                      <SelectItem value="AIR">Aérien</SelectItem>
                      <SelectItem value="ROAD">Routier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Type d'expédition</Label>
                  <Select value={ruleForm.shipment_type} onValueChange={(v) => setRuleForm({ ...ruleForm, shipment_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Indifférent</SelectItem>
                      <SelectItem value="FCL">FCL</SelectItem>
                      <SelectItem value="LCL">LCL (groupage)</SelectItem>
                      <SelectItem value="BREAKBULK">Breakbulk</SelectItem>
                      <SelectItem value="RORO">RoRo</SelectItem>
                      <SelectItem value="AIR">Aérien</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Famille conteneur</Label>
                  <Select value={ruleForm.container_family} onValueChange={(v) => setRuleForm({ ...ruleForm, container_family: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Indifférent</SelectItem>
                      <SelectItem value="DRY">Sec</SelectItem>
                      <SelectItem value="REEFER">Frigorifique</SelectItem>
                      <SelectItem value="SPECIAL">Spécial (flat rack, open top…)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Marchandise dangereuse</Label>
                  <Select value={ruleForm.dangerous_goods} onValueChange={(v) => setRuleForm({ ...ruleForm, dangerous_goods: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Indifférent</SelectItem>
                      <SelectItem value="true">Oui</SelectItem>
                      <SelectItem value="false">Non</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Fait DG-1 non encore alimenté : restera « à confirmer » tant que le dossier n'indique pas ce statut.</p>
                </div>
                <div className="space-y-2">
                  <Label>Régime douanier</Label>
                  <Input value={ruleForm.customs_regime_code} onChange={(e) => setRuleForm({ ...ruleForm, customs_regime_code: e.target.value })} placeholder="Code régime (optionnel)" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Poids min (kg)</Label>
                  <Input type="number" value={ruleForm.weight_min_kg} onChange={(e) => setRuleForm({ ...ruleForm, weight_min_kg: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Poids max exclusif (kg)</Label>
                  <Input type="number" value={ruleForm.weight_max_kg} onChange={(e) => setRuleForm({ ...ruleForm, weight_max_kg: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Valeur min</Label>
                  <Input type="number" value={ruleForm.value_min} onChange={(e) => setRuleForm({ ...ruleForm, value_min: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Valeur max exclusive</Label>
                  <Input type="number" value={ruleForm.value_max} onChange={(e) => setRuleForm({ ...ruleForm, value_max: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Client (laisser « générique » pour tous)</Label>
                <Select value={ruleForm.client_code} onValueChange={(v) => setRuleForm({ ...ruleForm, client_code: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Générique (tous clients)</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.code} — {c.legal_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="text-xs text-muted-foreground uppercase tracking-wide">Calcul</p>
              <div className="space-y-2">
                <Label>Méthode *</Label>
                <Select value={ruleForm.method} onValueChange={(v) => setRuleForm({ ...ruleForm, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">Forfait</SelectItem>
                    <SelectItem value="PER_CONTAINER">Par conteneur (20' / 40')</SelectItem>
                    <SelectItem value="PER_TONNE">Par tonne entamée</SelectItem>
                    <SelectItem value="PERCENT_OF_VALUE">Pourcentage de la valeur</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(ruleForm.method === 'FIXED' || ruleForm.method === 'PER_TONNE') && (
                <div className="space-y-2">
                  <Label>Montant (XOF) *</Label>
                  <Input type="number" value={ruleForm.amount} onChange={(e) => setRuleForm({ ...ruleForm, amount: e.target.value })} />
                </div>
              )}
              {ruleForm.method === 'PER_CONTAINER' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Montant 20' (XOF) *</Label>
                    <Input type="number" value={ruleForm.amount_20} onChange={(e) => setRuleForm({ ...ruleForm, amount_20: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Montant 40'/45' (XOF) *</Label>
                    <Input type="number" value={ruleForm.amount_40} onChange={(e) => setRuleForm({ ...ruleForm, amount_40: e.target.value })} />
                  </div>
                </div>
              )}
              {ruleForm.method === 'PERCENT_OF_VALUE' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pourcentage *</Label>
                    <Input type="number" step="0.01" value={ruleForm.percent} onChange={(e) => setRuleForm({ ...ruleForm, percent: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Assiette *</Label>
                    <Select value={ruleForm.value_basis} onValueChange={(v) => setRuleForm({ ...ruleForm, value_basis: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>—</SelectItem>
                        <SelectItem value="CAF">Valeur CAF</SelectItem>
                        <SelectItem value="CARGO_VALUE">Valeur marchandise</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Minimum (XOF, optionnel)</Label>
                  <Input type="number" value={ruleForm.min_amount} onChange={(e) => setRuleForm({ ...ruleForm, min_amount: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Maximum (XOF, optionnel)</Label>
                  <Input type="number" value={ruleForm.max_amount} onChange={(e) => setRuleForm({ ...ruleForm, max_amount: e.target.value })} />
                </div>
              </div>

              <p className="text-xs text-muted-foreground uppercase tracking-wide">Validité</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date d'effet *</Label>
                  <Input type="date" value={ruleForm.effective_from} onChange={(e) => setRuleForm({ ...ruleForm, effective_from: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Date de fin (optionnelle)</Label>
                  <Input type="date" value={ruleForm.effective_to} onChange={(e) => setRuleForm({ ...ruleForm, effective_to: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Référence source</Label>
                <Input value={ruleForm.source_reference} onChange={(e) => setRuleForm({ ...ruleForm, source_reference: e.target.value })} placeholder="Ex: contrat client 2026, barème interne…" />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea rows={2} value={ruleForm.notes} onChange={(e) => setRuleForm({ ...ruleForm, notes: e.target.value })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={ruleForm.is_active} onCheckedChange={(v) => setRuleForm({ ...ruleForm, is_active: v })} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRuleDialogOpen(false)}>Annuler</Button>
                <Button type="submit" disabled={saveRuleMutation.isPending || supersedeRuleMutation.isPending}>
                  {supersededRule ? 'Créer la nouvelle version' : editingRule ? 'Enregistrer' : 'Créer'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── Dialog client ────────────────────────────────────── */}
        <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Nouveau client</DialogTitle></DialogHeader>
            <form onSubmit={submitClient} className="space-y-4">
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input value={clientForm.code} onChange={(e) => setClientForm({ ...clientForm, code: e.target.value.toUpperCase() })} placeholder="EX: SENELEC" />
              </div>
              <div className="space-y-2">
                <Label>Raison sociale *</Label>
                <Input value={clientForm.legal_name} onChange={(e) => setClientForm({ ...clientForm, legal_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>NINEA</Label>
                <Input value={clientForm.ninea} onChange={(e) => setClientForm({ ...clientForm, ninea: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Pays (code ISO 2)</Label>
                <Input value={clientForm.country_code} maxLength={2} onChange={(e) => setClientForm({ ...clientForm, country_code: e.target.value.toUpperCase() })} placeholder="SN" />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setClientDialogOpen(false)}>Annuler</Button>
                <Button type="submit" disabled={saveClientMutation.isPending}>Créer</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
