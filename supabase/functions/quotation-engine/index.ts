import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase.ts";
import { logRuntimeEvent, getCorrelationId } from "../_shared/runtime.ts";
import {
  INCOTERMS_MATRIX,
  EVP_CONVERSION,
  DELIVERY_ZONES,
  identifyZone,
  getEVPMultiplier,
  checkExceptionalTransport,
  calculateCAF,
  calculateSodatraFees,
  calculateHistoricalMatchScore,
  SOURCE_CONFIDENCE,
  type IncotermRule,
  type ZoneConfig,
  type DataSourceType,
  type QuotationLineSource,
  type SodatraFeeParams,
} from "../_shared/quotation-rules.ts";

// Provider aliases — centralised to avoid hardcoded mismatches (DPW vs DP_WORLD)
const DPW_PROVIDERS = ['DPW', 'DP_WORLD'];

// Zone mapping: common city names → tariff zone labels in local_transport_rates
const ZONE_MAPPING: Record<string, string> = {
  'dakar': 'FORFAIT ZONE 1',
  'plateau': 'FORFAIT ZONE 1',
  'medina': 'FORFAIT ZONE 1',
  'almadies': 'FORFAIT ZONE 1',
  'pikine': 'FORFAIT ZONE 1',
  'guediawaye': 'FORFAIT ZONE 1',
  'rufisque': 'FORFAIT ZONE 1',
  'keur massar': 'FORFAIT ZONE 1',
  'parcelles': 'FORFAIT ZONE 1',
  'diamniadio': 'FORFAIT ZONE 1',
  'pout': 'FORFAIT ZONE 2',
  'seikhotane': 'FORFAIT ZONE 2',
  'sebikhotane': 'FORFAIT ZONE 2',
};

// Container type mapping: size prefix → exact DB value in local_transport_rates
const CONTAINER_TYPE_MAPPING: Record<string, string> = {
  '20': "20' Dry",
  '40': "40' Dry",
};

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();

// =====================================================
// DB-BACKED LOADERS (M1.3 — replace hardcoded rules)
// =====================================================

/** Load incoterms from DB, fallback to hardcoded INCOTERMS_MATRIX */
async function loadIncotermsFromDB(supabase: any): Promise<Record<string, IncotermRule>> {
  try {
    const { data, error } = await supabase
      .from('incoterms_reference')
      .select('*')
      .order('code');
    
    if (error || !data || data.length === 0) {
      console.log('[M1.3] incoterms_reference query failed or empty, using hardcoded fallback');
      return INCOTERMS_MATRIX;
    }
    
    const matrix: Record<string, IncotermRule> = {};
    for (const row of data) {
      const cafMethod = (row.caf_calculation_method || '').toUpperCase();
      const isFobBased = cafMethod.includes('FOB') || cafMethod.includes('F&I');
      
      matrix[row.code] = {
        code: row.code,
        group: row.group_name as 'E' | 'F' | 'C' | 'D',
        sellerPays: {
          origin: row.seller_pays_export_customs ?? true,
          freight: row.seller_pays_transport ?? false,
          insurance: row.seller_pays_insurance ?? false,
          import: !row.buyer_pays_import_customs,
          destination: row.seller_pays_unloading ?? false,
        },
        cafMethod: isFobBased ? 'FOB_PLUS_FREIGHT' : 'INVOICE_VALUE',
        description: row.name_fr || row.name_en,
      };
    }
    
    console.log(`[M1.3] Loaded ${Object.keys(matrix).length} incoterms from DB`);
    return matrix;
  } catch (e) {
    console.error('[M1.3] Error loading incoterms from DB:', e);
    return INCOTERMS_MATRIX;
  }
}

/** Load delivery zones from DB, fallback to hardcoded DELIVERY_ZONES */
async function loadDeliveryZonesFromDB(supabase: any): Promise<Record<string, ZoneConfig>> {
  try {
    const { data, error } = await supabase
      .from('delivery_zones')
      .select('*')
      .eq('is_active', true);
    
    if (error || !data || data.length === 0) {
      console.log('[M1.3] delivery_zones query failed or empty, using hardcoded fallback');
      return DELIVERY_ZONES;
    }
    
    const zones: Record<string, ZoneConfig> = {};
    for (const row of data) {
      zones[row.zone_code] = {
        code: row.zone_code,
        name: row.zone_name,
        multiplier: parseFloat(row.multiplier),
        distanceKm: row.distance_from_port_km,
        additionalDays: row.additional_days || 0,
        requiresSpecialPermit: row.requires_special_permit || false,
        examples: row.example_cities || [],
      };
    }
    
    console.log(`[M1.3] Loaded ${Object.keys(zones).length} delivery zones from DB`);
    return zones;
  } catch (e) {
    console.error('[M1.3] Error loading delivery zones from DB:', e);
    return DELIVERY_ZONES;
  }
}

/** Identify zone using DB-loaded zones, with same matching logic as hardcoded version */
function identifyZoneFromDB(destination: string, zones: Record<string, ZoneConfig>): ZoneConfig {
  const destinationLower = destination.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  for (const [_code, zone] of Object.entries(zones)) {
    if (destinationLower.includes(zone.name.toLowerCase())) {
      return zone;
    }
    for (const example of zone.examples) {
      if (destinationLower.includes(example.toLowerCase())) {
        return zone;
      }
    }
  }
  
  return zones['THIES_REGION'] || Object.values(zones)[0];
}

/** Load SODATRA fee rules from DB, compute fees */
interface SodatraFeeFromDB {
  dedouanement: number;
  suivi: number;
  ouvertureDossier: number;
  documentation: number;
  commission: number;
  total: number;
  complexity: { factor: number; reasons: string[] };
  fromDB: boolean;
}

async function calculateSodatraFeesFromDB(
  supabase: any,
  params: SodatraFeeParams,
  zone: ZoneConfig
): Promise<SodatraFeeFromDB> {
  try {
    const { data: rules, error } = await supabase
      .from('sodatra_fee_rules')
      .select('*')
      .eq('is_active', true)
      .or(`transport_mode.eq.ALL,transport_mode.eq.${params.transportMode}`);
    
    if (error || !rules || rules.length === 0) {
      console.log('[M1.3] sodatra_fee_rules empty, using hardcoded fallback');
      const fallback = calculateSodatraFees(params);
      return { ...fallback, fromDB: false };
    }
    
    // Calculate complexity factor from DB rules
    let complexityFactor = 1.0;
    const complexityReasons: string[] = [];
    
    // Get complexity_factors from the DEDOUANEMENT rule (which has them)
    const dedouanementRule = rules.find((r: any) => r.fee_code === 'DEDOUANEMENT');
    if (dedouanementRule?.complexity_factors) {
      const cf = dedouanementRule.complexity_factors;
      if (params.isIMO && cf.imo) { complexityFactor += cf.imo; complexityReasons.push('Marchandise IMO'); }
      if (params.isOOG && cf.oog) { complexityFactor += cf.oog; complexityReasons.push('Hors gabarit'); }
      if (params.isTransit && cf.transit) { complexityFactor += cf.transit; complexityReasons.push('Transit'); }
      if (params.isReefer && cf.reefer) { complexityFactor += cf.reefer; complexityReasons.push('Conteneur réfrigéré'); }
    }
    
    if (zone.multiplier > 1.5) {
      complexityFactor += (zone.multiplier - 1) * 0.3;
      complexityReasons.push(`Zone éloignée: ${zone.name}`);
    }
    
    const roundTo5k = (n: number) => Math.round(n / 5000) * 5000;
    
    // DEDOUANEMENT
    let dedouanement = 75000;
    if (dedouanementRule) {
      const ratePercent = parseFloat(dedouanementRule.rate_percent) || 0.004;
      const valueFactor = parseFloat(dedouanementRule.value_factor) || 0.6;
      const minAmt = parseFloat(dedouanementRule.min_amount) || 75000;
      const maxAmt = parseFloat(dedouanementRule.max_amount) || 500000;
      
      const valueBased = Math.min(Math.max(params.cargoValue * ratePercent, 100000), maxAmt);
      dedouanement = Math.max(roundTo5k(valueBased * valueFactor * complexityFactor), minAmt);
    }
    
    // SUIVI
    let suivi = 35000;
    const suiviRule = rules.find((r: any) => 
      r.fee_code === 'SUIVI' || (r.fee_code === 'SUIVI_TONNE' && params.containerCount === 0)
    );
    if (suiviRule) {
      if (suiviRule.calculation_method === 'PER_CONTAINER' && params.containerCount > 0) {
        suivi = Math.max(roundTo5k(parseFloat(suiviRule.base_amount) * params.containerCount * complexityFactor), parseFloat(suiviRule.min_amount) || 35000);
      } else if (suiviRule.calculation_method === 'PER_TONNE') {
        suivi = Math.max(roundTo5k(parseFloat(suiviRule.base_amount) * params.weightTonnes * complexityFactor), parseFloat(suiviRule.min_amount) || 35000);
      }
    }
    
    // OUVERTURE_DOSSIER
    let ouvertureDossier = 25000;
    const dossierRule = rules.find((r: any) => r.fee_code === 'OUVERTURE_DOSSIER' && (r.transport_mode === params.transportMode || r.transport_mode === 'ALL'));
    if (dossierRule) {
      ouvertureDossier = parseFloat(dossierRule.base_amount);
    }
    
    // DOCUMENTATION
    let documentation = 15000;
    const docRule = rules.find((r: any) => r.fee_code === 'DOCUMENTATION');
    if (docRule) {
      documentation = parseFloat(docRule.base_amount);
    }
    
    // COMMISSION (calculated later in main flow from débours total)
    const commission = 0;
    
    const total = dedouanement + suivi + ouvertureDossier + documentation;
    
    console.log(`[M1.3] SODATRA fees from DB: dedouanement=${dedouanement}, suivi=${suivi}, dossier=${ouvertureDossier}, docs=${documentation}`);
    
    return {
      dedouanement,
      suivi,
      ouvertureDossier,
      documentation,
      commission,
      total,
      complexity: { factor: complexityFactor, reasons: complexityReasons },
      fromDB: true,
    };
  } catch (e) {
    console.error('[M1.3] Error loading sodatra_fee_rules:', e);
    const fallback = calculateSodatraFees(params);
    return { ...fallback, fromDB: false };
  }
}

/** Fetch operational costs for exceptional transport (M1.3.4) */
async function fetchExceptionalTransportCosts(
  supabase: any,
  exceptionalReasons: string[]
): Promise<QuotationLine[]> {
  const lines: QuotationLine[] = [];
  
  try {
    const { data: costs } = await supabase
      .from('operational_costs_senegal')
      .select('*')
      .eq('is_active', true)
      .in('cost_type', ['fee', 'tax']);
    
    if (!costs || costs.length === 0) return lines;
    
    // Check if weight exceeded → escort + authorization
    const hasWeightIssue = exceptionalReasons.some(r => r.toLowerCase().includes('poids'));
    const hasSizeIssue = exceptionalReasons.some(r => r.toLowerCase().includes('largeur') || r.toLowerCase().includes('longueur') || r.toLowerCase().includes('hauteur'));
    
    if (hasWeightIssue || hasSizeIssue) {
      // Find escort costs (FEE002-004)
      const escortCosts = costs.filter((c: any) => c.cost_id.startsWith('FEE00') && c.cost_id !== 'FEE001' && c.cost_id !== 'FEE005');
      if (escortCosts.length > 0) {
        // Use 1st category by default
        const escort = escortCosts[0];
        lines.push({
          id: `exceptional_escort_${lines.length}`,
          bloc: 'operationnel',
          category: 'Transport Exceptionnel',
          description: escort.name_fr,
          amount: null,
          currency: 'FCFA',
          source: {
            type: 'TO_CONFIRM',
            reference: escort.source || 'operational_costs_senegal',
            confidence: 0.7,
          },
          notes: `Fourchette: ${escort.min_amount?.toLocaleString() || '?'} - ${escort.max_amount?.toLocaleString() || '?'} FCFA. ${escort.condition_text || ''}`,
          isEditable: true,
        });
      }
      
      // Authorization
      const authCost = costs.find((c: any) => c.cost_id === 'FEE005');
      if (authCost) {
        lines.push({
          id: `exceptional_auth_${lines.length}`,
          bloc: 'operationnel',
          category: 'Transport Exceptionnel',
          description: authCost.name_fr,
          amount: null,
          currency: 'FCFA',
          source: {
            type: 'TO_CONFIRM',
            reference: authCost.source || 'operational_costs_senegal',
            confidence: 0.7,
          },
          notes: `Fourchette: ${authCost.min_amount?.toLocaleString() || '?'} - ${authCost.max_amount?.toLocaleString() || '?'} FCFA. ${authCost.condition_text || ''}`,
          isEditable: true,
        });
      }
    }
  } catch (e) {
    console.error('[M1.3] Error fetching exceptional transport costs:', e);
  }
  
  return lines;
}

// =====================================================
// M3.1 — HISTORICAL SUGGESTIONS (consultative only)
// =====================================================

const HISTORICAL_TIMEOUT_MS = 2000;
const FN_NAME = 'quotation-engine';

interface HistoricalSuggestions {
  suggested_lines: Array<{
    bloc: string;
    category: string;
    description: string;
    suggested_amount: number;
    currency: string;
    confidence: number;
    based_on: number;
  }>;
  based_on_quotations: number;
}

const EMPTY_SUGGESTIONS: HistoricalSuggestions = { suggested_lines: [], based_on_quotations: 0 };

async function fetchHistoricalSuggestions(
  supabaseUrl: string,
  serviceKey: string,
  request: QuotationRequest,
  correlationId: string,
  serviceClient: any,
): Promise<HistoricalSuggestions> {
  const startMs = Date.now();
  try {
    const transitCountry = detectTransitCountry(request.finalDestination);

    const historicalInput = {
      destination_country: transitCountry || "SN",
      final_destination: request.finalDestination,
      incoterm: request.incoterm,
      transport_mode: request.transportMode,
      cargo_description: request.cargoDescription,
      total_weight_kg: (request.cargoWeight || 0) * 1000,
      hs_code: request.hsCode,
      carrier: request.carrier || request.shippingLine,
      container_types: request.containers?.map(c => c.type) || (request.containerType ? [request.containerType] : undefined),
      limit: 3,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HISTORICAL_TIMEOUT_MS);

    const resp = await fetch(`${supabaseUrl}/functions/v1/suggest-historical-lines`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(historicalInput),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const json = await resp.json();
    const result: HistoricalSuggestions = json.data ?? json ?? EMPTY_SUGGESTIONS;

    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FN_NAME,
      op: 'historical_suggestions',
      status: 'ok',
      httpStatus: 200,
      durationMs: Date.now() - startMs,
      meta: {
        suggestions_count: result.suggested_lines?.length ?? 0,
        based_on_quotations: result.based_on_quotations ?? 0,
      },
    });

    return result;
  } catch (err) {
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FN_NAME,
      op: 'historical_suggestions',
      status: 'retryable_error',
      errorCode: 'UPSTREAM_DB_ERROR',
      httpStatus: 0,
      durationMs: Date.now() - startMs,
      meta: { error: String(err).substring(0, 200) },
    });
    return EMPTY_SUGGESTIONS;
  }
}

// corsHeaders imported from _shared/cors.ts

// =====================================================
// EXCHANGE RATE RESOLVER (centralized, cached per invocation)
// =====================================================
const _rateCache = new Map<string, number>();

async function resolveExchangeRate(
  supabase: any, currency: string
): Promise<number> {
  const cur = currency.trim().toUpperCase();
  if (_rateCache.has(cur)) return _rateCache.get(cur)!;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('exchange_rates')
    .select('rate_to_xof')
    .eq('currency_code', cur)
    .lte('valid_from', now)
    .gte('valid_until', now)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || error) {
    throw new Error(`Exchange rate for ${cur} expired or missing`);
  }
  const rate = Number(data.rate_to_xof);
  _rateCache.set(cur, rate);
  return rate;
}

// =====================================================
// TYPES
// =====================================================
interface ContainerInfo {
  type: string;
  quantity: number;
  cocSoc?: 'COC' | 'SOC';
  weight?: number;
  notes?: string;
}

interface QuotationRequest {
  // Paramètres de la demande
  originPort?: string;
  destinationPort?: string;
  finalDestination: string;
  transportMode: 'maritime' | 'aerien' | 'routier';
  incoterm: string;
  
  // Cargo
  cargoType: string;
  cargoDescription?: string;
  cargoValue: number;
  cargoCurrency?: string;
  cargoWeight?: number; // en tonnes
  
  // Conteneurs - Support multi-conteneurs
  containers?: ContainerInfo[];
  containerType?: string; // Legacy
  containerCount?: number; // Legacy
  
  // Carrier / Shipping Line
  carrier?: string;
  shippingLine?: string;
  
  // Breakbulk / Conventionnel
  weightTonnes?: number;
  volumeM3?: number;
  pieces?: number;
  
  // Dimensions (pour OOG)
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
  };
  
  // Options spéciales
  isIMO?: boolean;
  imoClass?: string;
  isReefer?: boolean;
  reeferTemp?: number;
  isHazmat?: boolean;
  isTransit?: boolean;
  
  // Code HS pour calcul droits
  hsCode?: string;
  
  // Régime douanier pour exonérations conditionnelles
  regimeCode?: string;
  
  // P0 CAF strict: fret réel
  freightAmount?: number;
  freightCurrency?: string;
  
  // Detail articles avec valeurs EXW pour répartition proportionnelle CAF
  articlesDetail?: Array<{
    hs_code: string;
    value: number;
    currency: string;
    description?: string;
  }>;
  
  // Client info
  clientCompany?: string;
  
  // Services demandés
  includeCustomsClearance?: boolean;
  includeLocalTransport?: boolean;
  includeInsurance?: boolean;
}

interface QuotationLine {
  id: string;
  bloc: 'operationnel' | 'honoraires' | 'debours' | 'border' | 'terminal';
  category: string;
  description: string;
  amount: number | null;
  currency: string;
  unit?: string;
  quantity?: number;
  source: QuotationLineSource;
  notes?: string;
  isEditable: boolean;
  containerType?: string;
}

interface QuotationResult {
  success: boolean;
  lines: QuotationLine[];
  totals: {
    operationnel: number;
    honoraires: number;
    debours: number;
    border: number;
    terminal: number;
    dap: number;
    ddp: number;
  };
  metadata: {
    incoterm: IncotermInfo;
    zone: ZoneInfo;
    exceptional: ExceptionalInfo;
    caf: CAFInfo;
    isTransit: boolean;
    transitCountry?: string;
  };
  warnings: string[];
}

interface IncotermInfo {
  code: string;
  group: string;
  description: string;
  sellerPays: Record<string, boolean>;
}

interface ZoneInfo {
  code: string;
  name: string;
  multiplier: number;
  distanceKm: number;
  country?: string;
}

interface ExceptionalInfo {
  isExceptional: boolean;
  reasons: string[];
}

interface CAFInfo {
  value: number;
  method: string;
}

// =====================================================
// TRANSIT DESTINATION DETECTION
// =====================================================
const TRANSIT_COUNTRIES = ['MALI', 'MAURITANIE', 'GUINEE', 'BURKINA', 'NIGER', 'GAMBIE'];

// Mali cities for detection
const MALI_CITIES = [
  'BAMAKO', 'SIKASSO', 'KAYES', 'KATI', 'KOULIKORO', 'SIRAKORO', 'TIAKADOUGOU',
  'SEGOU', 'SÉGOU', 'MOPTI', 'GAO', 'TOMBOUCTOU', 'TIMBUKTU', 'KIDAL', 
  'KOUTIALA', 'NIONO', 'DJENNE', 'DJENNÉ', 'KENIEBA', 'KÉNIÉBA', 'KITA'
];

function detectTransitCountry(destination: string): string | null {
  const destUpper = destination.toUpperCase();
  for (const country of TRANSIT_COUNTRIES) {
    if (destUpper.includes(country)) {
      return country;
    }
  }
  // Check Mali cities specifically
  for (const city of MALI_CITIES) {
    if (destUpper.includes(city)) {
      return 'MALI';
    }
  }
  return null;
}

function isTransitDestination(destination: string): boolean {
  return detectTransitCountry(destination) !== null;
}

// =====================================================
// MALI INTELLIGENT TRANSPORT CALCULATION
// =====================================================

interface MaliTransportCalculation {
  baseAmount: number;
  fuelSurcharge: number;
  securitySurcharge: number;
  totalAmount: number;
  distanceKm: number;
  transitDays: number;
  securityLevel: string;
  alerts: Array<{ title: string; level: string }>;
  breakdown: Array<{ description: string; calculation: string }>;
  zone: any;
}

async function fetchMaliZone(
  supabase: any,
  destination: string
): Promise<any | null> {
  // Try exact match first
  const { data: exactMatch } = await supabase
    .from('mali_transport_zones')
    .select('*')
    .ilike('zone_name', destination.trim())
    .eq('is_accessible', true)
    .limit(1);
  
  if (exactMatch && exactMatch.length > 0) {
    return exactMatch[0];
  }
  
  // Try partial match
  const destParts = destination.toUpperCase().split(/[\s,\-]+/);
  for (const part of destParts) {
    if (part.length < 3) continue;
    const { data } = await supabase
      .from('mali_transport_zones')
      .select('*')
      .ilike('zone_name', `%${part}%`)
      .eq('is_accessible', true)
      .limit(1);
    
    if (data && data.length > 0) {
      return data[0];
    }
  }
  
  return null;
}

async function fetchTransportFormula(
  supabase: any,
  corridor: string,
  containerType: string
): Promise<any | null> {
  // Normalize container type (40HC -> 40HC, 40'HC -> 40HC)
  const normalizedType = containerType.replace(/['\s]/g, '').toUpperCase().slice(0, 4);
  
  const { data } = await supabase
    .from('transport_rate_formula')
    .select('*')
    .eq('corridor', corridor)
    .eq('is_active', true)
    .or(`container_type.eq.${normalizedType},container_type.eq.${normalizedType.slice(0, 2)}DV,container_type.eq.${normalizedType.slice(0, 2)}HC`);
  
  if (data && data.length > 0) {
    // Prefer exact match
    const exact = data.find((d: any) => d.container_type === normalizedType);
    return exact || data[0];
  }
  
  return null;
}

async function fetchLatestFuelPrice(
  supabase: any,
  country: string
): Promise<number> {
  const { data } = await supabase
    .from('fuel_price_tracking')
    .select('price_per_liter')
    .eq('country', country.toUpperCase())
    .eq('fuel_type', 'DIESEL')
    .order('recorded_date', { ascending: false })
    .limit(1);
  
  if (data && data.length > 0) {
    return parseFloat(data[0].price_per_liter);
  }
  
  // Default prices
  return country.toUpperCase() === 'MALI' ? 820 : 760;
}

async function fetchActiveSecurityAlerts(
  supabase: any,
  country: string,
  zoneName: string
): Promise<Array<{ title: string; level: string; action: string }>> {
  const { data } = await supabase
    .from('security_alerts')
    .select('title, alert_level, recommended_action')
    .eq('country', country.toUpperCase())
    .eq('is_active', true)
    .or(`affected_zones.cs.{"${zoneName}"},affected_zones.is.null`);
  
  if (data && data.length > 0) {
    return data.map((a: any) => ({
      title: a.title,
      level: a.alert_level,
      action: a.recommended_action
    }));
  }
  
  return [];
}

async function calculateMaliTransport(
  supabase: any,
  destination: string,
  containerType: string,
  quantity: number = 1
): Promise<MaliTransportCalculation | null> {
  console.log(`[Mali Transport] Calculating for ${destination}, ${containerType} x${quantity}`);
  
  // 1. Find the zone
  const zone = await fetchMaliZone(supabase, destination);
  if (!zone) {
    console.log(`[Mali Transport] Zone not found for ${destination}`);
    return null;
  }
  
  console.log(`[Mali Transport] Found zone: ${zone.zone_name}, ${zone.distance_from_dakar_km}km, security=${zone.security_level}`);
  
  // 2. Get transport formula
  const formula = await fetchTransportFormula(supabase, 'DAKAR_MALI', containerType);
  if (!formula) {
    console.log(`[Mali Transport] No formula found for ${containerType}`);
    return null;
  }
  
  console.log(`[Mali Transport] Formula: ${formula.base_rate_per_km}/km + ${formula.fixed_costs} fixed`);
  
  // 3. Calculate base amount
  const baseAmount = (zone.distance_from_dakar_km * parseFloat(formula.base_rate_per_km)) + parseFloat(formula.fixed_costs || 0);
  
  // 4. Calculate fuel surcharge if current price > reference
  const refFuelPrice = parseFloat(formula.fuel_reference_price) || 755;
  const currentFuelPrice = await fetchLatestFuelPrice(supabase, 'MALI');
  const fuelDelta = (currentFuelPrice - refFuelPrice) / refFuelPrice;
  // Fuel represents ~40% of transport cost
  const fuelSurcharge = fuelDelta > 0 ? Math.round(baseAmount * fuelDelta * 0.4) : 0;
  
  // 5. Calculate security surcharge
  const securityPercent = zone.security_surcharge_percent || 0;
  const securitySurcharge = Math.round(baseAmount * (securityPercent / 100));
  
  // 6. Get active alerts
  const alerts = await fetchActiveSecurityAlerts(supabase, 'MALI', zone.zone_name);
  
  // 7. Total per container
  const totalPerContainer = baseAmount + fuelSurcharge + securitySurcharge;
  const totalAmount = Math.round(totalPerContainer * quantity);
  
  console.log(`[Mali Transport] Result: base=${baseAmount}, fuel=${fuelSurcharge}, security=${securitySurcharge}, total=${totalAmount}`);
  
  return {
    baseAmount: Math.round(baseAmount * quantity),
    fuelSurcharge: fuelSurcharge * quantity,
    securitySurcharge: securitySurcharge * quantity,
    totalAmount,
    distanceKm: zone.distance_from_dakar_km,
    transitDays: parseFloat(zone.estimated_transit_days) || 3,
    securityLevel: zone.security_level,
    alerts: alerts.map(a => ({ title: a.title, level: a.level })),
    zone,
    breakdown: [
      { 
        description: 'Transport base', 
        calculation: `${zone.distance_from_dakar_km}km × ${formula.base_rate_per_km} + ${formula.fixed_costs} fixe` 
      },
      { 
        description: 'Surcharge carburant', 
        calculation: fuelSurcharge > 0 ? `+${(fuelDelta * 100).toFixed(0)}% (${currentFuelPrice} vs ${refFuelPrice} ref)` : 'N/A' 
      },
      { 
        description: 'Surcharge sécurité', 
        calculation: securityPercent > 0 ? `+${securityPercent}% (niveau ${zone.security_level})` : 'N/A' 
      }
    ]
  };
}

async function findSimilarHistoricalMaliTransport(
  supabase: any,
  destination: string,
  containerType: string
): Promise<{ amount: number; source: string; date: string; destination: string } | null> {
  // Search learned_knowledge for similar Mali transport
  const { data } = await supabase
    .from('learned_knowledge')
    .select('*')
    .eq('category', 'tarif')
    .eq('is_validated', true)
    .or('name.ilike.%Transport%Mali%,name.ilike.%Inland%Mali%,description.ilike.%Mali%')
    .order('created_at', { ascending: false })
    .limit(20);
  
  if (!data || data.length === 0) return null;
  
  const destUpper = destination.toUpperCase();
  const containerPrefix = containerType.replace(/['\s]/g, '').slice(0, 2);
  
  for (const entry of data) {
    const entryData = entry.data || {};
    const entryDest = (entryData.destination || entry.description || '').toUpperCase();
    const entryContainer = (entryData.container_type || entryData.containerType || '').toUpperCase();
    
    // Check if destination is similar (same city or nearby)
    const destWords = destUpper.split(/[\s,\-]+/);
    const entryWords = entryDest.split(/[\s,\-]+/);
    const hasDestMatch = destWords.some((w: string) => entryWords.some((ew: string) => 
      w.length > 3 && ew.length > 3 && (w.includes(ew) || ew.includes(w))
    ));
    
    // Check container type match
    const hasContainerMatch = entryContainer.includes(containerPrefix);
    
    if (hasDestMatch && hasContainerMatch) {
      const amount = entryData.montant || entryData.amount || entryData.total;
      if (amount && amount > 0) {
        // Increment usage count
        try {
          await supabase
            .from('learned_knowledge')
            .update({ 
              usage_count: (entry.usage_count || 0) + 1,
              last_used_at: new Date().toISOString()
            })
            .eq('id', entry.id);
        } catch (e) {
          console.error('Failed to increment usage_count:', e);
        }
        
        return {
          amount,
          source: entry.name,
          date: entry.created_at,
          destination: entryData.destination || entry.description
        };
      }
    }
  }
  
  return null;
}

// =====================================================
// THD CATEGORY DETERMINATION (M1.4.3 — DB-backed)
// =====================================================
interface TariffCategoryRule {
  category_code: string;
  category_name: string;
  match_patterns: string[];
  priority: number;
  carrier: string;
}

async function loadTariffCategoryRules(supabase: any): Promise<TariffCategoryRule[]> {
  const { data, error } = await supabase
    .from('tariff_category_rules')
    .select('category_code, category_name, match_patterns, priority, carrier')
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (error || !data || data.length === 0) {
    console.warn('tariff_category_rules: DB vide ou erreur, fallback regex');
    return [];
  }
  return data;
}

function determineTariffCategory(
  cargoDescription: string,
  rules: TariffCategoryRule[]
): string {
  // DB-backed matching (M1.4.3)
  if (rules.length > 0) {
    const desc = cargoDescription.toLowerCase();
    for (const rule of rules) {
      if (rule.match_patterns.length === 0) continue; // default rule (T02)
      const matched = rule.match_patterns.some(p => desc.includes(p.toLowerCase()));
      if (matched) return rule.category_code;
    }
    // Return default rule if exists
    const defaultRule = rules.find(r => r.match_patterns.length === 0);
    if (defaultRule) return defaultRule.category_code;
  }

  // @deprecated M1.4.3 — fallback regex (graceful degradation)
  const desc = cargoDescription.toLowerCase();
  if (desc.match(/power plant|generator|transformer|vehicle|truck|tractor|machine|equipment|genset|engine/)) return 'T09';
  if (desc.match(/drink|beverage|chemical|accessory|part|pump|valve/)) return 'T01';
  if (desc.match(/cereal|wheat|rice|cement|fertilizer|flour/)) return 'T05';
  if (desc.match(/steel|iron|metal|metallurg|pipe|tube|beam/)) return 'T14';
  if (desc.match(/textile|fabric|building material|cotton|tile|brick/)) return 'T07';
  if (desc.match(/mixed|general|various|divers/)) return 'T12';
  return 'T02';
}

// =====================================================
// FONCTIONS PRINCIPALES
// =====================================================

async function fetchOfficialTariffs(
  supabase: any,
  params: {
    provider?: string;
    providers?: string[];
    category?: string;
    operationType?: string;
    classification?: string;
    cargoType?: string;
  }
): Promise<any[]> {
  let query = supabase
    .from('port_tariffs')
    .select('*')
    .eq('is_active', true);
  
  if (params.providers && params.providers.length > 0) {
    query = query.in('provider', params.providers);
  } else if (params.provider) {
    query = query.eq('provider', params.provider);
  }
  if (params.category) query = query.eq('category', params.category);
  if (params.operationType) query = query.eq('operation_type', params.operationType);
  if (params.classification) query = query.ilike('classification', `%${params.classification}%`);
  if (params.cargoType) query = query.eq('cargo_type', params.cargoType);
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Erreur fetch tarifs officiels:', error);
    return [];
  }
  
  return data || [];
}

async function fetchCarrierCharges(
  supabase: any,
  carrier?: string,
  operationType: 'IMPORT' | 'EXPORT' | 'TRANSIT' = 'IMPORT'
): Promise<any[]> {
  let query = supabase
    .from('carrier_billing_templates')
    .select('*')
    .eq('is_active', true)
    .eq('operation_type', operationType);
  
  if (carrier) {
    // Fetch both specific carrier and GENERIC templates
    query = query.or(`carrier.eq.${carrier.toUpperCase()},carrier.eq.GENERIC`);
  } else {
    query = query.eq('carrier', 'GENERIC');
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Erreur fetch carrier charges:', error);
    return [];
  }
  
  return data || [];
}

async function fetchBorderClearingRates(
  supabase: any,
  country: string,
  corridor?: string
): Promise<any[]> {
  let query = supabase
    .from('border_clearing_rates')
    .select('*')
    .eq('country', country.toUpperCase())
    .eq('is_active', true);
  
  if (corridor) {
    query = query.eq('corridor', corridor);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Erreur fetch border clearing rates:', error);
    return [];
  }
  
  return data || [];
}

async function fetchDestinationTerminalRates(
  supabase: any,
  country: string,
  terminal?: string
): Promise<any[]> {
  let query = supabase
    .from('destination_terminal_rates')
    .select('*')
    .eq('country', country.toUpperCase())
    .eq('is_active', true);
  
  if (terminal) {
    query = query.eq('terminal_name', terminal);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Erreur fetch destination terminal rates:', error);
    return [];
  }
  
  return data || [];
}

async function fetchCarrierTHD(
  supabase: any,
  carrier: string,
  tariffCategory: string,
  operationType: 'IMPORT' | 'EXPORT' | 'TRANSIT'
): Promise<{ rate: number; classification: string } | null> {
  const { data } = await supabase
    .from('port_tariffs')
    .select('amount, classification')
    .eq('provider', carrier.toUpperCase())
    .eq('category', operationType === 'EXPORT' ? 'THO' : 'THD')
    .eq('operation_type', operationType === 'TRANSIT' ? 'IMPORT' : operationType)
    .ilike('classification', `${tariffCategory}%`)
    .limit(1);
  
  if (data && data.length > 0) {
    return { rate: data[0].amount, classification: data[0].classification };
  }
  return null;
}

async function fetchHistoricalTariffs(
  supabase: any,
  criteria: {
    destination: string;
    cargoType: string;
    transportMode?: string;
    maxAgeDays?: number;
  }
): Promise<any[]> {
  const maxAge = criteria.maxAgeDays || 180;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAge);
  
  const { data, error } = await supabase
    .from('learned_knowledge')
    .select('*')
    .eq('category', 'tarif')
    .eq('is_validated', true)
    .gte('created_at', cutoffDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (error) {
    console.error('Erreur fetch tarifs historiques:', error);
    return [];
  }
  
  return data || [];
}

async function fetchSecuritySurcharge(
  supabase: any,
  destination: string
): Promise<{ amount20ft: number; amount40ft: number } | null> {
  const { data } = await supabase
    .from('learned_knowledge')
    .select('data')
    .eq('category', 'surcharge')
    .eq('is_validated', true)
    .ilike('name', '%Sécurité%Mali%')
    .limit(1);
  
  if (data && data.length > 0 && data[0].data) {
    return {
      amount20ft: data[0].data.montant_20ft || 0,
      amount40ft: data[0].data.montant_40ft || 0
    };
  }
  return null;
}

async function fetchQuotationHistory(
  supabase: any,
  criteria: {
    destination: string;
    cargoType: string;
    limit?: number;
  }
): Promise<any[]> {
  const { data, error } = await supabase
    .from('quotation_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(criteria.limit || 20);
  
  if (error) {
    console.error('Erreur fetch quotation history:', error);
    return [];
  }
  
  // Filtrer et scorer les résultats
  return (data || []).filter((q: any) => {
    const destMatch = q.route_destination?.toLowerCase().includes(criteria.destination.toLowerCase()) ||
                      criteria.destination.toLowerCase().includes(q.route_destination?.toLowerCase() || '');
    const cargoMatch = q.cargo_type?.toLowerCase().includes(criteria.cargoType.toLowerCase());
    return destMatch || cargoMatch;
  });
}

async function matchHistoricalTariff(
  supabase: any,
  historicalTariffs: any[],
  criteria: {
    destination: string;
    cargoType: string;
    transportMode: string;
    serviceName: string;
  }
): Promise<{ tariff: any; score: number; warnings: string[] } | null> {
  let bestMatch: { tariff: any; score: number; warnings: string[] } | null = null;
  
  for (const tariff of historicalTariffs) {
    const data = tariff.data || {};
    
    // Vérifier si le service correspond
    const tariffService = data.service?.toLowerCase() || tariff.name?.toLowerCase() || '';
    if (!tariffService.includes(criteria.serviceName.toLowerCase()) &&
        !criteria.serviceName.toLowerCase().includes(tariffService)) {
      continue;
    }
    
    // Calculer le score
    const matchResult = calculateHistoricalMatchScore(
      {
        destination: criteria.destination,
        cargoType: criteria.cargoType,
        transportMode: criteria.transportMode,
        maxAgeDays: 180
      },
      {
        destination: data.destination || tariff.description || '',
        cargoType: data.cargo_type || 'general',
        transportMode: data.transport_mode,
        createdAt: tariff.created_at
      }
    );
    
    if (matchResult.isValidMatch && (!bestMatch || matchResult.totalScore > bestMatch.score)) {
      bestMatch = {
        tariff: { ...tariff, matchedAmount: data.montant || data.amount },
        score: matchResult.totalScore,
        warnings: matchResult.warnings
      };
    }
  }
  
  // Incrémenter usage_count si un match est trouvé
  if (bestMatch) {
    try {
      await supabase
        .from('learned_knowledge')
        .update({ 
          usage_count: (bestMatch.tariff.usage_count || 0) + 1,
          last_used_at: new Date().toISOString()
        })
        .eq('id', bestMatch.tariff.id);
      
      console.log(`Incremented usage_count for learned_knowledge ${bestMatch.tariff.id}`);
    } catch (updateError) {
      console.error('Failed to increment usage_count:', updateError);
    }
  }
  
  return bestMatch;
}

// =====================================================
// MAIN QUOTATION LINE GENERATION
// =====================================================

async function generateQuotationLines(
  supabase: any,
  request: QuotationRequest
): Promise<{ lines: QuotationLine[]; warnings: string[] }> {
  const lines: QuotationLine[] = [];
  const warnings: string[] = [];
  
  // =====================================================
  // 0. LOAD DB-BACKED RULES (M1.3)
  // =====================================================
  const [dbIncoterms, dbZones, tariffCategoryRules] = await Promise.all([
    loadIncotermsFromDB(supabase),
    loadDeliveryZonesFromDB(supabase),
    loadTariffCategoryRules(supabase),
  ]);
  
  // =====================================================
  // 1. DETERMINE CONTEXT
  // =====================================================
  
  const transitCountry = detectTransitCountry(request.finalDestination);
  const isTransit = request.isTransit || transitCountry !== null;
  const effectiveOperationType = isTransit ? 'TRANSIT' : 'IMPORT';
  const zone = identifyZoneFromDB(request.finalDestination, dbZones);
  
  console.log(`Quotation context: isTransit=${isTransit}, transitCountry=${transitCountry}, operationType=${effectiveOperationType}`);
  
  // Build containers array from legacy or new format
  // LCL fix: never create phantom containers when none are specified
  const containers: ContainerInfo[] = request.containers?.length 
    ? request.containers 
    : request.containerType 
      ? [{ type: request.containerType, quantity: request.containerCount || 1 }]
      : [];
  
  // Total weight from request
  const totalWeightTonnes = request.cargoWeight || request.weightTonnes || 0;
  
  // Carrier detection
  const carrier = request.carrier || request.shippingLine;
  
  // =====================================================
  // 2. FETCH ALL NECESSARY DATA
  // =====================================================
  
  // THC Tariffs - with correct operation type
  const thcTariffs = await fetchOfficialTariffs(supabase, {
    providers: DPW_PROVIDERS,
    category: 'THC',
    operationType: effectiveOperationType
  });
  
  // PAD Tariffs (Redevances)
  const padTariffs = await fetchOfficialTariffs(supabase, {
    provider: 'PAD',
    operationType: effectiveOperationType
  });
  
  // DPW additional tariffs (Relevage, etc.)
  const dpwAdditionalTariffs = await fetchOfficialTariffs(supabase, {
    providers: DPW_PROVIDERS,
    operationType: effectiveOperationType
  });
  
  // Carrier charges (for transit)
  const carrierCharges = await fetchCarrierCharges(supabase, carrier, effectiveOperationType as any);
  
  // Historical tariffs for transport
  const historicalTariffs = await fetchHistoricalTariffs(supabase, {
    destination: request.finalDestination,
    cargoType: request.cargoType,
    transportMode: request.transportMode
  });
  
  // Border and terminal rates for transit destinations
  let borderRates: any[] = [];
  let terminalRates: any[] = [];
  
  if (transitCountry === 'MALI') {
    borderRates = await fetchBorderClearingRates(supabase, 'MALI', 'KIDIRA_DIBOLI');
    terminalRates = await fetchDestinationTerminalRates(supabase, 'MALI');
  }
  
  // Security surcharge for Mali
  let securitySurcharge: { amount20ft: number; amount40ft: number } | null = null;
  if (transitCountry === 'MALI') {
    securitySurcharge = await fetchSecuritySurcharge(supabase, request.finalDestination);
  }
  
  // =====================================================
  // 3. BLOC OPÉRATIONNEL - THC PER CONTAINER TYPE
  // =====================================================
  
  for (const container of containers) {
    const is40 = container.type.toUpperCase().includes('40');
    const evpMultiplier = getEVPMultiplier(container.type);
    const cargoType = is40 ? 'CONTENEUR_40' : 'CONTENEUR_20';
    
    // Find THC tariff for this container
    const thcTariff = thcTariffs.find(t => 
      t.cargo_type === cargoType || 
      t.classification?.includes(container.type.slice(0, 2))
    );
    
    if (thcTariff) {
      lines.push({
        id: `thc_${container.type.toLowerCase()}_${lines.length}`,
        bloc: 'operationnel',
        category: 'Terminal (DPW)',
        description: `THC ${effectiveOperationType} ${container.type}`,
        amount: thcTariff.amount * evpMultiplier * container.quantity,
        currency: 'FCFA',
        unit: 'EVP',
        quantity: evpMultiplier * container.quantity,
        containerType: container.type,
        source: {
          type: 'OFFICIAL',
          reference: thcTariff.source_document || 'DP World Dakar 2025',
          confidence: 1.0,
          validUntil: thcTariff.expiry_date
        },
        isEditable: false
      });
    } else {
      // No normative THC found — flag for human confirmation
      lines.push({
        id: `thc_${container.type.toLowerCase()}_${lines.length}`,
        bloc: 'operationnel',
        category: 'Terminal (DPW)',
        description: `THC ${effectiveOperationType} ${container.type}`,
        amount: null,
        currency: 'FCFA',
        containerType: container.type,
        source: {
          type: 'TO_CONFIRM',
          reference: 'THC non trouvé en base — aucune donnée normative',
          confidence: 0
        },
        notes: 'Aucune donnée normative — confirmation humaine requise. Vérifier avec DPW.',
        isEditable: true
      });
      warnings.push(`THC ${container.type} non trouvé en base — à confirmer avec DPW`);
    }
    
    // Relevage for transit
    if (isTransit) {
      const relevageTariff = dpwAdditionalTariffs.find(t => 
        t.category === 'RELEVAGE' && t.cargo_type === cargoType
      );
      if (relevageTariff) {
        lines.push({
          id: `relevage_${container.type.toLowerCase()}_${lines.length}`,
          bloc: 'operationnel',
          category: 'Terminal (DPW)',
          description: `Relevage ${container.type}`,
          amount: relevageTariff.amount * container.quantity,
          currency: 'FCFA',
          containerType: container.type,
          source: {
            type: 'OFFICIAL',
            reference: relevageTariff.source_document || 'DPW Transit Tariff',
            confidence: 0.95
          },
          isEditable: false
        });
      }
    }
    
    // PAD Redevance Variable
    const redevanceTariff = padTariffs.find(t => 
      t.category === 'REDEVANCE_VARIABLE' && t.cargo_type === cargoType
    );
    if (redevanceTariff) {
      lines.push({
        id: `redevance_${container.type.toLowerCase()}_${lines.length}`,
        bloc: 'operationnel',
        category: 'Port (PAD)',
        description: `Redevance Variable ${container.type}`,
        amount: redevanceTariff.amount * container.quantity,
        currency: 'FCFA',
        containerType: container.type,
        source: {
          type: 'OFFICIAL',
          reference: redevanceTariff.source_document || 'PAD Tariff',
          confidence: 0.95
        },
        isEditable: false
      });
    }
    
    // Port Tax
    const portTaxTariff = padTariffs.find(t => 
      t.category === 'PORT_TAX' && t.cargo_type === cargoType
    );
    if (portTaxTariff) {
      lines.push({
        id: `port_tax_${container.type.toLowerCase()}_${lines.length}`,
        bloc: 'operationnel',
        category: 'Port (PAD)',
        description: `Port Tax ${container.type}`,
        amount: portTaxTariff.amount * container.quantity,
        currency: 'FCFA',
        containerType: container.type,
        source: {
          type: 'OFFICIAL',
          reference: portTaxTariff.source_document || 'PAD Tariff',
          confidence: 0.95
        },
        isEditable: false
      });
    }
  }
  
  // =====================================================
  // 4. CARRIER CHARGES (For Transit)
  // =====================================================
  
  if (isTransit && carrierCharges.length > 0) {
    for (const charge of carrierCharges) {
      let amount = 0;
      
      // Calculate based on method
      switch (charge.calculation_method) {
        case 'PER_CNT':
          // Handle 20ft vs 40ft specific charges
          if (charge.charge_code.includes('_20') || charge.charge_code.includes('20')) {
            const cnt20 = containers.filter(c => !c.type.includes('40')).reduce((s, c) => s + c.quantity, 0);
            amount = charge.default_amount * cnt20;
          } else if (charge.charge_code.includes('_40') || charge.charge_code.includes('40')) {
            const cnt40 = containers.filter(c => c.type.includes('40')).reduce((s, c) => s + c.quantity, 0);
            amount = charge.default_amount * cnt40;
          } else {
            const totalCnt = containers.reduce((s, c) => s + c.quantity, 0);
            amount = charge.default_amount * totalCnt;
          }
          break;
        case 'PER_TEU':
          const totalEVP = containers.reduce((s, c) => s + (getEVPMultiplier(c.type) * c.quantity), 0);
          amount = charge.default_amount * totalEVP;
          break;
        case 'PER_BL':
          amount = charge.default_amount; // Assume 1 BL
          break;
        default:
          amount = charge.default_amount;
      }
      
      if (amount > 0) {
        lines.push({
          id: `carrier_${charge.charge_code.toLowerCase()}_${lines.length}`,
          bloc: 'operationnel',
          category: 'Compagnie Maritime',
          description: charge.charge_name,
          amount: amount,
          currency: charge.currency || 'XOF',
          source: {
            type: 'OFFICIAL',
            reference: `${charge.carrier} - ${charge.notes || 'Carrier Billing Template'}`,
            confidence: 0.9
          },
          isEditable: false
        });
      }
    }
  }
  
  // =====================================================
  // 5. TRANSPORT LOCAL (with Mali intelligent calculation)
  // =====================================================
  
  if (request.includeLocalTransport !== false) {
    // ===== MALI INTELLIGENT TRANSPORT =====
    if (transitCountry === 'MALI') {
      for (const container of containers) {
        // Try intelligent Mali calculation first
        const maliTransport = await calculateMaliTransport(
          supabase,
          request.finalDestination,
          container.type,
          container.quantity
        );
        
        if (maliTransport) {
          // Main transport line
          lines.push({
            id: `transport_mali_${container.type.toLowerCase()}_${lines.length}`,
            bloc: 'operationnel',
            category: 'Transport Mali',
            description: `Transport ${container.type} Dakar → ${request.finalDestination} (${maliTransport.distanceKm}km)`,
            amount: maliTransport.baseAmount,
            currency: 'FCFA',
            containerType: container.type,
            source: {
              type: 'CALCULATED',
              reference: `Formule: ${maliTransport.distanceKm}km × tarif/km + fixe`,
              confidence: 0.9
            },
            notes: `Transit ~${maliTransport.transitDays}j | A/R inclus`,
            isEditable: true
          });
          
          // Fuel surcharge if applicable
          if (maliTransport.fuelSurcharge > 0) {
            lines.push({
              id: `fuel_surcharge_mali_${container.type.toLowerCase()}_${lines.length}`,
              bloc: 'operationnel',
              category: 'Transport Mali',
              description: `Surcharge Carburant Mali ${container.type}`,
              amount: maliTransport.fuelSurcharge,
              currency: 'FCFA',
              containerType: container.type,
              source: {
                type: 'CALCULATED',
                reference: maliTransport.breakdown.find(b => b.description.includes('carburant'))?.calculation || 'Prix carburant actuel',
                confidence: 0.85
              },
              notes: 'Ajustement prix carburant Mali',
              isEditable: true
            });
          }
          
          // Security surcharge based on zone level
          if (maliTransport.securitySurcharge > 0) {
            lines.push({
              id: `security_surcharge_mali_${container.type.toLowerCase()}_${lines.length}`,
              bloc: 'operationnel',
              category: 'Transport Mali',
              description: `Surcharge Sécurité Mali ${container.type} (${maliTransport.securityLevel})`,
              amount: maliTransport.securitySurcharge,
              currency: 'FCFA',
              containerType: container.type,
              source: {
                type: 'CALCULATED',
                reference: `Zone ${maliTransport.zone.zone_name} - Niveau ${maliTransport.securityLevel}`,
                confidence: 0.85
              },
              notes: maliTransport.alerts.length > 0 
                ? `⚠️ ${maliTransport.alerts[0].title}` 
                : 'Situation sécuritaire à surveiller',
              isEditable: true
            });
          }
          
          // Add warning if critical security
          if (maliTransport.securityLevel === 'CRITICAL') {
            warnings.push(`⚠️ ATTENTION: ${request.finalDestination} est en zone CRITIQUE - Transport déconseillé ou très risqué`);
          } else if (maliTransport.securityLevel === 'HIGH') {
            warnings.push(`⚠️ Vigilance: ${request.finalDestination} en zone HIGH - Prévoir mesures de sécurité`);
          }
          
          // Add active alerts to warnings
          for (const alert of maliTransport.alerts) {
            if (alert.level === 'CRITICAL') {
              warnings.push(`🚨 ${alert.title}`);
            }
          }
          
        } else {
          // Fallback: try historical match for Mali
          const historicalMali = await findSimilarHistoricalMaliTransport(
            supabase,
            request.finalDestination,
            container.type
          );
          
          if (historicalMali) {
            lines.push({
              id: `transport_mali_hist_${container.type.toLowerCase()}_${lines.length}`,
              bloc: 'operationnel',
              category: 'Transport Mali',
              description: `Transport ${container.type} → ${request.finalDestination}`,
              amount: historicalMali.amount * container.quantity,
              currency: 'FCFA',
              containerType: container.type,
              source: {
                type: 'HISTORICAL',
                reference: `${historicalMali.source} (${new Date(historicalMali.date).toLocaleDateString('fr-FR')})`,
                confidence: 0.75,
                historicalMatch: {
                  originalDate: historicalMali.date,
                  originalRoute: historicalMali.destination,
                  similarityScore: 75
                }
              },
              notes: `Basé sur tarif historique ${historicalMali.destination}`,
              isEditable: true
            });
            warnings.push(`Transport Mali basé sur historique ${historicalMali.destination} - À confirmer`);
          } else {
            // No normative data — flag for human confirmation (no invented amount)
            lines.push({
              id: `transport_mali_est_${container.type.toLowerCase()}_${lines.length}`,
              bloc: 'operationnel',
              category: 'Transport Mali',
              description: `Transport ${container.type} → ${request.finalDestination}`,
              amount: null,
              currency: 'FCFA',
              containerType: container.type,
              source: {
                type: 'TO_CONFIRM',
                reference: 'Aucune donnée normative — zone non référencée',
                confidence: 0
              },
              notes: 'Aucune donnée normative — confirmation humaine requise. Contacter transporteur.',
              isEditable: true
            });
            warnings.push(`Transport Mali: aucune donnée normative pour ${request.finalDestination} — à confirmer`);
          }
        }
      }
      
    } else {
      // ===== NON-MALI TRANSPORT =====
      for (const container of containers) {
        // Search historical tariffs for this destination
        const transportMatch = await matchHistoricalTariff(supabase, historicalTariffs, {
          destination: request.finalDestination,
          cargoType: request.cargoType,
          transportMode: 'routier',
          serviceName: 'transport'
        });
        
        if (transportMatch) {
          lines.push({
            id: `transport_${container.type.toLowerCase()}_${lines.length}`,
            bloc: 'operationnel',
            category: 'Transport',
            description: `Transport ${container.type} → ${request.finalDestination}`,
            amount: transportMatch.tariff.matchedAmount * container.quantity,
            currency: 'FCFA',
            containerType: container.type,
            source: {
              type: 'HISTORICAL',
              reference: `Historique ${new Date(transportMatch.tariff.created_at).toLocaleDateString('fr-FR')}`,
              confidence: transportMatch.score / 100,
              historicalMatch: {
                originalDate: transportMatch.tariff.created_at,
                originalRoute: transportMatch.tariff.data?.destination || request.finalDestination,
                similarityScore: transportMatch.score
              }
            },
            notes: transportMatch.warnings.join('. ') || undefined,
            isEditable: true
          });
        } else {
          // Zone mapping: resolve destination to tariff zone via includes()
          const destKey = normalize(request.finalDestination || '');
          const mappedZone = Object.entries(ZONE_MAPPING)
            .sort((a, b) => b[0].length - a[0].length)
            .find(([key]) => destKey.includes(key))?.[1];
          const searchTerm = mappedZone || normalize(request.finalDestination?.split(' ')[0] || '');

          // Container type mapping: strict .eq() match
          const sizePrefix = container.type?.slice(0, 2) || ''; // "20" or "40"
          const mappedContainerType = CONTAINER_TYPE_MAPPING[sizePrefix];

          let rateQuery = supabase
            .from('local_transport_rates')
            .select('*')
            .eq('is_active', true)
            .ilike('destination', `%${searchTerm}%`);

          if (mappedContainerType) {
            rateQuery = rateQuery.eq('container_type', mappedContainerType);
          }

          const { data: localRates } = await rateQuery.limit(1);
          
          if (localRates && localRates.length > 0) {
            const rate = localRates[0];
            lines.push({
              id: `transport_${container.type.toLowerCase()}_${lines.length}`,
              bloc: 'operationnel',
              category: 'Transport',
              description: `Transport ${container.type} → ${rate.destination}`,
              amount: rate.rate_amount * container.quantity,
              currency: rate.rate_currency || 'FCFA',
              containerType: container.type,
              source: {
                type: 'OFFICIAL',
                reference: rate.source_document || 'Grille transport local',
                confidence: 0.95
              },
              isEditable: true
            });
          } else {
            // No normative data — flag for human confirmation (no invented amount)
            lines.push({
              id: `transport_${container.type.toLowerCase()}_${lines.length}`,
              bloc: 'operationnel',
              category: 'Transport',
              description: `Transport ${container.type} → ${request.finalDestination}`,
              amount: null,
              currency: 'FCFA',
              containerType: container.type,
              source: {
                type: 'TO_CONFIRM',
                reference: 'Aucune donnée normative — tarif non trouvé en base',
                confidence: 0
              },
              notes: 'Aucune donnée normative — confirmation humaine requise. Contacter transporteur.',
              isEditable: true
            });
            warnings.push(`Transport ${container.type}: aucune donnée normative pour ${request.finalDestination} — à confirmer`);
          }
        }
      }
    }
  }
  
  // =====================================================
  // 6. BORDER CLEARING (Mali)
  // =====================================================
  
  if (transitCountry === 'MALI' && borderRates.length > 0) {
    for (const rate of borderRates) {
      let amount = 0;
      
      for (const container of containers) {
        const is40 = container.type.toUpperCase().includes('40');
        const rateAmount = is40 ? (rate.amount_40ft || rate.amount_20ft) : rate.amount_20ft;
        amount += rateAmount * container.quantity;
      }
      
      if (amount > 0) {
        lines.push({
          id: `border_${rate.charge_code.toLowerCase()}_${lines.length}`,
          bloc: 'border',
          category: 'Frontière Mali',
          description: rate.charge_name,
          amount: amount,
          currency: rate.currency || 'XOF',
          source: {
            type: 'OFFICIAL',
            reference: rate.source_document || 'Border Clearing Rates',
            confidence: 0.9
          },
          notes: rate.notes,
          isEditable: true
        });
      }
    }
  }
  
  // =====================================================
  // 7. DESTINATION TERMINAL (Mali - Kati/CMC/EMASE)
  // =====================================================
  
  if (transitCountry === 'MALI' && terminalRates.length > 0) {
    for (const rate of terminalRates) {
      let amount = 0;
      
      switch (rate.calculation_method) {
        case 'PER_TONNE':
          if (rate.rate_per_tonne && totalWeightTonnes > 0) {
            amount = rate.rate_per_tonne * totalWeightTonnes;
          }
          break;
        case 'PER_TRUCK':
          if (rate.rate_per_truck) {
            const truckCount = containers.reduce((s, c) => s + c.quantity, 0);
            amount = rate.rate_per_truck * truckCount;
          }
          break;
        case 'FIXED':
          if (rate.rate_fixed) {
            amount = rate.rate_fixed;
          }
          break;
        case 'PER_CNT':
          if (rate.rate_per_cnt) {
            const totalCnt = containers.reduce((s, c) => s + c.quantity, 0);
            amount = rate.rate_per_cnt * totalCnt;
          }
          break;
      }
      
      if (amount > 0) {
        lines.push({
          id: `terminal_${rate.charge_code.toLowerCase()}_${lines.length}`,
          bloc: 'terminal',
          category: 'Terminal Mali',
          description: rate.charge_name,
          amount: Math.round(amount),
          currency: rate.currency || 'XOF',
          source: {
            type: 'OFFICIAL',
            reference: rate.source_document || 'Destination Terminal Rates',
            confidence: 0.85
          },
          notes: rate.notes,
          isEditable: true
        });
      }
    }
  }
  
  // =====================================================
  // 8. BLOC HONORAIRES - SODATRA FEES (M1.3: from sodatra_fee_rules DB)
  // =====================================================
  
  // Don't include SODATRA fees for transit/tender contexts
  const shouldIncludeSodatraFees = !isTransit || request.includeCustomsClearance;
  
  if (shouldIncludeSodatraFees) {
    const sodatraParams: SodatraFeeParams = {
      transportMode: request.transportMode,
      cargoValue: request.cargoValue,
      weightTonnes: totalWeightTonnes,
      volumeM3: request.volumeM3 || 0,
      containerCount: containers.reduce((s, c) => s + c.quantity, 0),
      containerTypes: containers.map(c => c.type),
      destinationZone: zone.code,
      isIMO: request.isIMO || false,
      isOOG: request.dimensions ? checkExceptionalTransport(request.dimensions).isExceptional : false,
      isTransit: isTransit,
      isReefer: request.isReefer || false
    };
    
    const sodatraFees = await calculateSodatraFeesFromDB(supabase, sodatraParams, zone);
    const feeSourceRef = sodatraFees.fromDB ? 'sodatra_fee_rules (DB)' : 'Grille SODATRA (fallback)';
    
    lines.push({
      id: 'fee_clearance',
      bloc: 'honoraires',
      category: 'Dédouanement',
      description: isTransit ? 'Honoraires transit SN' : 'Honoraires de dédouanement',
      amount: sodatraFees.dedouanement,
      currency: 'FCFA',
      source: {
        type: 'CALCULATED',
        reference: feeSourceRef,
        confidence: 0.9
      },
      notes: sodatraFees.complexity.reasons.length > 0 
        ? `Facteur complexité: ${sodatraFees.complexity.factor.toFixed(2)} (${sodatraFees.complexity.reasons.join(', ')})`
        : undefined,
      isEditable: true
    });
    
    lines.push({
      id: 'fee_follow_up',
      bloc: 'honoraires',
      category: 'Suivi',
      description: 'Suivi opérationnel',
      amount: sodatraFees.suivi,
      currency: 'FCFA',
      source: {
        type: 'CALCULATED',
        reference: feeSourceRef,
        confidence: 0.9
      },
      isEditable: true
    });
    
    lines.push({
      id: 'fee_file',
      bloc: 'honoraires',
      category: 'Administratif',
      description: 'Ouverture de dossier',
      amount: sodatraFees.ouvertureDossier,
      currency: 'FCFA',
      source: {
        type: 'CALCULATED',
        reference: feeSourceRef,
        confidence: 1.0
      },
      isEditable: false
    });
    
    lines.push({
      id: 'fee_docs',
      bloc: 'honoraires',
      category: 'Administratif',
      description: 'Frais de documentation',
      amount: sodatraFees.documentation,
      currency: 'FCFA',
      source: {
        type: 'CALCULATED',
        reference: feeSourceRef,
        confidence: 1.0
      },
      isEditable: false
    });
  }
  
  // =====================================================
  // 8d. TRANSPORT EXCEPTIONNEL (M1.3.4: from operational_costs_senegal)
  // =====================================================
  
  {
    const exceptional = request.dimensions ? checkExceptionalTransport(request.dimensions) : { isExceptional: false, reasons: [] };
    if (exceptional.isExceptional) {
      const exceptionalLines = await fetchExceptionalTransportCosts(supabase, exceptional.reasons);
      lines.push(...exceptionalLines);
      for (const reason of exceptional.reasons) {
        warnings.push(`⚠️ Transport exceptionnel: ${reason}`);
      }
    }
  }
  
  // =====================================================
  // 8b. FRANCHISE MAGASINAGE (warehouse_franchise + holidays_pad)
  // =====================================================
  
  {
    // Determine cargo_type for franchise lookup based on actual DB values (FCL, BREAKBULK, VEHICLE_*, etc.)
    const cargoTypeUpper = (request.cargoType || '').toUpperCase();
    let franchiseCargoType = 'FCL'; // default for containers
    if (cargoTypeUpper.includes('VEHIC') || cargoTypeUpper.includes('RORO')) {
      franchiseCargoType = 'VEHICLE';
    } else if (cargoTypeUpper.includes('BREAK') || cargoTypeUpper.includes('CONVENT')) {
      franchiseCargoType = 'BREAKBULK';
    } else if (cargoTypeUpper.includes('VRAC') || cargoTypeUpper.includes('EMPTY')) {
      franchiseCargoType = 'EMPTY';
    }
    
    const containerTypeForFranchise = containers.length > 0 ? containers[0].type : null;
    
    let franchiseQuery = supabase
      .from('warehouse_franchise')
      .select('*')
      .eq('is_active', true)
      .ilike('cargo_type', `%${franchiseCargoType}%`);
    
    if (containerTypeForFranchise) {
      const is40 = containerTypeForFranchise.toUpperCase().includes('40');
      franchiseQuery = franchiseQuery.or(`container_type.is.null,container_type.ilike.%${is40 ? '40' : '20'}%`);
    }
    
    const { data: franchiseData } = await franchiseQuery.limit(1);
    
    // Fetch holidays in the next 30 days
    const today = new Date();
    const in30Days = new Date(today);
    in30Days.setDate(in30Days.getDate() + 30);
    
    const { data: holidays } = await supabase
      .from('holidays_pad')
      .select('holiday_date, name_fr')
      .or(`holiday_date.gte.${today.toISOString().split('T')[0]},is_recurring.eq.true`)
      .lte('holiday_date', in30Days.toISOString().split('T')[0]);
    
    const holidayCount = holidays?.length || 0;
    const holidayNote = holidayCount > 0 
      ? ` | ${holidayCount} jour(s) férié(s) PAD dans les 30j — franchise effective peut être réduite`
      : '';
    
    if (franchiseData && franchiseData.length > 0) {
      const franchise = franchiseData[0];
      lines.push({
        id: 'warehouse_franchise',
        bloc: 'operationnel',
        category: 'Magasinage',
        description: `Franchise magasinage: ${franchise.free_days} jours (tarif: ${franchise.rate_per_day} ${franchise.rate_unit} après franchise)`,
        amount: 0,
        currency: 'FCFA',
        source: {
          type: 'OFFICIAL',
          reference: franchise.source_document || `${franchise.provider} — Franchise ${franchiseCargoType}`,
          confidence: 1.0
        },
        notes: `Franchise ${franchise.free_days}j ${franchise.cargo_type} — zone ${franchise.storage_zone || 'ordinaire'}${holidayNote}`,
        isEditable: false
      });
    } else {
      lines.push({
        id: 'warehouse_franchise',
        bloc: 'operationnel',
        category: 'Magasinage',
        description: 'Franchise magasinage',
        amount: null,
        currency: 'FCFA',
        source: {
          type: 'TO_CONFIRM',
          reference: 'Aucune donnée de franchise en base',
          confidence: 0
        },
        notes: `Aucune règle de franchise trouvée pour ${franchiseCargoType} — confirmation requise${holidayNote}`,
        isEditable: true
      });
    }
  }
  
  // =====================================================
  // 8c. SURESTARIES (demurrage_rates)
  // =====================================================
  
  if (request.cargoType?.toLowerCase().includes('conteneur') || containers.length > 0) {
    const detectedCarrier = carrier?.toUpperCase() || null;
    const containerTypeForDemurrage = containers.length > 0 ? containers[0].type : '20DV';
    const is40Dem = containerTypeForDemurrage.toUpperCase().includes('40');
    const demContainerFilter = is40Dem ? '40' : '20';
    
    let demurrageQuery = supabase
      .from('demurrage_rates')
      .select('*')
      .eq('is_active', true)
      .ilike('container_type', `%${demContainerFilter}%`);
    
    if (detectedCarrier) {
      demurrageQuery = demurrageQuery.or(`carrier.ilike.%${detectedCarrier}%,carrier.eq.GENERIC`);
    }
    
    const { data: demurrageData } = await demurrageQuery.order('carrier', { ascending: true }).limit(3);
    
    if (demurrageData && demurrageData.length > 0) {
      // Prefer carrier-specific over GENERIC
      const bestMatch = demurrageData.find(d => detectedCarrier && d.carrier.toUpperCase().includes(detectedCarrier)) || demurrageData[0];
      
      const paliers = [
        `Jours 1-7: ${bestMatch.day_1_7_rate} ${bestMatch.currency}/jour`,
        `Jours 8-14: ${bestMatch.day_8_14_rate} ${bestMatch.currency}/jour`,
        `Jour 15+: ${bestMatch.day_15_plus_rate} ${bestMatch.currency}/jour`
      ].join(' | ');
      
      lines.push({
        id: 'demurrage_estimate',
        bloc: 'operationnel',
        category: 'Surestaries',
        description: `Surestaries ${bestMatch.carrier} (franchise ${isTransit ? bestMatch.free_days_import : bestMatch.free_days_import}j, puis ${bestMatch.day_1_7_rate} ${bestMatch.currency}/jour)`,
        amount: null,
        currency: bestMatch.currency || 'USD',
        source: {
          type: 'TO_CONFIRM',
          reference: bestMatch.source_document || `${bestMatch.carrier} Demurrage Schedule`,
          confidence: 0.8
        },
        notes: `Toujours à confirmer (dépend du temps réel). Paliers: ${paliers}`,
        isEditable: true
      });
    } else {
      lines.push({
        id: 'demurrage_estimate',
        bloc: 'operationnel',
        category: 'Surestaries',
        description: 'Surestaries armateur',
        amount: null,
        currency: 'USD',
        source: {
          type: 'TO_CONFIRM',
          reference: 'Aucune donnée de surestaries en base',
          confidence: 0
        },
        notes: 'Aucune donnée normative — contacter armateur pour grille de surestaries.',
        isEditable: true
      });
    }
  }
  
  // =====================================================
  // 9. BLOC DÉBOURS - DROITS ET TAXES (Only for non-transit)
  // =====================================================
  // Duty breakdown array — note de détail par article
  const dutyBreakdown: any[] = [];
  let cargoValueFCFA: number = 0;

  if (!isTransit) {
    // Conversion devise sécurisée (EUR uniquement — parité fixe BCEAO)
    const rawCurrency = (request.cargoCurrency || 'XOF').toUpperCase();

    if (rawCurrency === 'XOF' || rawCurrency === 'FCFA' || rawCurrency === 'CFA') {
      cargoValueFCFA = request.cargoValue;
    } else {
      const rate = await resolveExchangeRate(supabase, rawCurrency);
      cargoValueFCFA = request.cargoValue * rate;
    }

    // P0 CAF strict: conversion fret réel en FCFA (si fourni)
    let freightFCFA: number | undefined = undefined;
    if (request.freightAmount && request.freightAmount > 0) {
      const freightCur = String(request.freightCurrency ?? 'XOF').trim().toUpperCase();
      if (freightCur === 'XOF' || freightCur === 'FCFA' || freightCur === 'CFA') {
        freightFCFA = request.freightAmount;
      } else {
        const rate = await resolveExchangeRate(supabase, freightCur);
        freightFCFA = request.freightAmount * rate;
      }
    }

    // Calcul CAF
    const incotermRule = dbIncoterms[request.incoterm?.toUpperCase() || 'CIF'];
    const caf = calculateCAF({
      incoterm: request.incoterm || 'CIF',
      invoiceValue: cargoValueFCFA,
      freightAmount: freightFCFA,
      insuranceRate: 0.005
    });


    // Si code HS fourni, calculer les droits
    if (request.hsCode) {
      // Support multiple HS codes
      const hsCodes = request.hsCode.split(/[,;]/).map((c: string) => c.trim()).filter(Boolean);
      
      // --- Proportional CAF distribution based on articlesDetail EXW values ---
      // M3.4.1: Currency conversion helper
      async function convertArticleValueToFCFA(value: number, currency: string): Promise<number> {
        const cur = (currency || 'XOF').trim().toUpperCase();
        if (cur === 'XOF' || cur === 'FCFA' || cur === 'CFA') return value;
        const rate = await resolveExchangeRate(supabase, cur);
        return value * rate;
      }

      let cafDistribution: number[] = [];
      let distributionMethod: 'proportional' | 'equal' = 'equal';
      
      if (request.articlesDetail && request.articlesDetail.length >= 2) {
        // Build a map of HS code → EXW value from articlesDetail (M3.4.1: converted to FCFA)
        const detailMap = new Map<string, number>();
        for (const art of request.articlesDetail) {
          const normKey = art.hs_code.replace(/\D/g, '');
          const valueFCFA = await convertArticleValueToFCFA(art.value, art.currency);
          detailMap.set(normKey, (detailMap.get(normKey) || 0) + valueFCFA);
        }
        
        // M3.4.1: totalEXW from converted detailMap, not raw request
        const totalEXW = Array.from(detailMap.values()).reduce((sum, v) => sum + v, 0);
        
        if (totalEXW > 0) {
          // M3.4.1: Coverage guard — check how many HS are covered
          const coveredCount = hsCodes.filter(h => {
            const hsNorm = h.replace(/\D/g, '');
            return (detailMap.get(hsNorm) || 0) > 0;
          }).length;

          if (coveredCount !== hsCodes.length) {
            // Incomplete coverage → fallback equal
            console.log(`[Engine] Incomplete coverage: ${coveredCount}/${hsCodes.length} — equal distribution`);
            cafDistribution = hsCodes.map(() => caf.cafValue / hsCodes.length);
            distributionMethod = 'equal';
          } else {
            // Proportional distribution
            let distributedSum = 0;
            for (let i = 0; i < hsCodes.length; i++) {
              const hsNorm = hsCodes[i].replace(/\D/g, '');
              const exwValue = detailMap.get(hsNorm) || 0;
              if (i === hsCodes.length - 1) {
                cafDistribution.push(caf.cafValue - distributedSum);
              } else {
                const ratio = exwValue / totalEXW;
                const cafArticle = Math.round(caf.cafValue * ratio);
                cafDistribution.push(cafArticle);
                distributedSum += cafArticle;
              }
            }
            distributionMethod = 'proportional';
            console.log(`[Engine] Proportional CAF: totalEXW=${totalEXW}, distribution=${cafDistribution.join(',')}`);
          }
        }
      }
      
      // Fallback: equal distribution if nothing was computed
      if (cafDistribution.length === 0 || cafDistribution.length !== hsCodes.length) {
        cafDistribution = hsCodes.map(() => caf.cafValue / hsCodes.length);
        distributionMethod = 'equal';
      }

      let totalAllDuties = 0;
      const missingCodes: string[] = [];

      // --- Regime flags: load from customs_regimes if regimeCode provided ---
      let regimeFlags = { dd:true, stx:true, rs:true, tin:true, tva:true, cosec:true, pcs:true, pcc:true, tpast:true, ta:true };
      let regimeName: string | null = null;
      let regimeUnknown = false;

      if (request.regimeCode) {
        const { data: regime, error: regimeErr } = await supabase
          .from("customs_regimes")
          .select("code,name,dd,stx,rs,tin,tva,cosec,pcs,pcc,tpast,ta,is_active")
          .eq("code", request.regimeCode)
          .eq("is_active", true)
          .maybeSingle();

        if (regimeErr) console.error("[regime] load failed:", regimeErr.message);

        if (regime) {
          regimeFlags = {
            dd: regime.dd ?? true, stx: regime.stx ?? true, rs: regime.rs ?? true,
            tin: regime.tin ?? true, tva: regime.tva ?? true, cosec: regime.cosec ?? true,
            pcs: regime.pcs ?? true, pcc: regime.pcc ?? true, tpast: regime.tpast ?? true,
            ta: regime.ta ?? true,
          };
          regimeName = regime.name || null;
          console.log(`[regime] Loaded ${request.regimeCode}: ${regimeName}, flags=`, regimeFlags);
        } else {
          regimeUnknown = true;
          console.warn(`[regime] Code "${request.regimeCode}" not found or inactive — no exoneration applied`);
        }
      }

      // PROMAD rate — loaded once before article loop
      let promadRate = 0;
      {
        const { data: promadRow } = await supabase
          .from('tax_rates')
          .select('rate')
          .eq('code', 'PROMAD')
          .eq('is_active', true)
          .maybeSingle();
        if (promadRow) promadRate = parseFloat(promadRow.rate) || 0;
      }

      for (const [idx, currentHsCode] of hsCodes.entries()) {
        const cafForArticle = cafDistribution[idx];
        const hsNormalized = currentHsCode.replace(/\D/g, '');
        const { data: hsData } = await supabase
          .from('hs_codes')
          .select('*')
          .or(`code.eq.${currentHsCode},code_normalized.eq.${hsNormalized}`)
          .limit(1);

        if (hsData && hsData.length > 0) {
          const hs = hsData[0];
          // Calculate all taxes with original formulas (untouched)
          let ddAmount = cafForArticle * ((hs.dd || 0) / 100);
          let rsAmount = cafForArticle * ((hs.rs || 0) / 100);
          let surtaxeAmount = cafForArticle * ((hs.surtaxe || 0) / 100);
          let tinAmount = cafForArticle * ((hs.tin || 0) / 100);
          const tciAmount = cafForArticle * ((hs.t_conj || 0) / 100);
          let pcsAmount = cafForArticle * ((hs.pcs || 0) / 100);
          let pccAmount = cafForArticle * ((hs.pcc || 0) / 100);
          let cosecAmount = cafForArticle * ((hs.cosec || 0) / 100);

          // PROMAD — exemptions produit (riz, blé, orge, pharma)
          const isPromadExempt =
            hsNormalized.startsWith('1006') ||
            hsNormalized.startsWith('1001') ||
            hsNormalized.startsWith('1003') ||
            hsNormalized.startsWith('30');
          const promadAmount = Math.round(
            isPromadExempt ? 0 : cafForArticle * (promadRate / 100)
          );

          // Apply regime flags AFTER calculation (CTO: never rewrite formulas)
          if (!regimeFlags.dd) ddAmount = 0;
          if (!regimeFlags.rs) rsAmount = 0;
          if (!regimeFlags.stx) surtaxeAmount = 0;
          if (!regimeFlags.tin) tinAmount = 0;
          if (!regimeFlags.pcs) pcsAmount = 0;
          if (!regimeFlags.pcc) pccAmount = 0;
          if (!regimeFlags.cosec) cosecAmount = 0;

          const baseVAT = cafForArticle + ddAmount + surtaxeAmount + rsAmount + tinAmount + tciAmount;
          // PROMAD excluded from VAT base intentionally (parafiscal, same as COSEC/PCS)
          let tvaAmount = baseVAT * ((hs.tva || 0) / 100);
          if (!regimeFlags.tva) tvaAmount = 0;

          const articleDuties = ddAmount + rsAmount + surtaxeAmount + tinAmount + tciAmount + pcsAmount + pccAmount + cosecAmount + promadAmount + tvaAmount;
          totalAllDuties += articleDuties;

          // Find description from articlesDetail if available
          const articleDesc = request.articlesDetail?.find(a => a.hs_code.replace(/\D/g, '') === hsNormalized)?.description;

          const regimeNote = request.regimeCode && !regimeUnknown
            ? `Régime ${request.regimeCode}` : undefined;

          dutyBreakdown.push({
            article_index: idx + 1,
            hs_code: currentHsCode,
            description: articleDesc || undefined,
            caf: Math.round(cafForArticle),
            dd_rate: hs.dd || 0, dd_amount: Math.round(ddAmount),
            surtaxe_rate: hs.surtaxe || 0, surtaxe_amount: Math.round(surtaxeAmount),
            rs_rate: hs.rs || 0, rs_amount: Math.round(rsAmount),
            tin_rate: hs.tin || 0, tin_amount: Math.round(tinAmount),
            tci_rate: hs.t_conj || 0, tci_amount: Math.round(tciAmount),
            pcs_rate: hs.pcs || 0, pcs_amount: Math.round(pcsAmount),
            pcc_rate: hs.pcc || 0, pcc_amount: Math.round(pccAmount),
            cosec_rate: hs.cosec || 0, cosec_amount: Math.round(cosecAmount),
            promad_rate: promadRate, promad_amount: promadAmount,
            base_tva: Math.round(baseVAT),
            tva_rate: hs.tva || 0, tva_amount: Math.round(tvaAmount),
            total_duties: Math.round(articleDuties),
            regime_applied: request.regimeCode || null,
            regime_note: regimeNote,
            dd_exonerated: !regimeFlags.dd,
            rs_exonerated: !regimeFlags.rs,
            tva_exonerated: !regimeFlags.tva,
          });
        } else {
          missingCodes.push(currentHsCode);
          warnings.push(`Code HS ${currentHsCode} non trouvé (article ${idx + 1}) - Droits à calculer manuellement`);
        }
      }

      // Push single duties_total line with cumulated amount
      if (dutyBreakdown.length > 0) {
        const cafNote = distributionMethod === 'proportional'
          ? `Répartition proportionnelle aux valeurs EXW (${hsCodes.length} articles, total CAF: ${Math.round(caf.cafValue).toLocaleString()} FCFA, devise source: ${rawCurrency})`
          : hsCodes.length > 1
            ? `Répartition équitable CAF/${hsCodes.length} (valeurs EXW non disponibles, total: ${Math.round(caf.cafValue).toLocaleString()} FCFA, devise source: ${rawCurrency})`
            : `Base CAF: ${Math.round(caf.cafValue).toLocaleString()} FCFA (devise source: ${rawCurrency})`;

        lines.push({
          id: 'duties_total',
          bloc: 'debours',
          category: 'Droits & Taxes',
          description: `Droits et taxes (${hsCodes.length} article${hsCodes.length > 1 ? 's' : ''}: ${hsCodes.join(', ')})`,
          amount: Math.round(totalAllDuties),
          currency: 'FCFA',
          source: {
            type: 'CALCULATED',
            reference: `TEC UEMOA — ${hsCodes.length} code(s) HS traité(s)${missingCodes.length > 0 ? `, ${missingCodes.length} non trouvé(s)` : ''}`,
            confidence: missingCodes.length > 0 ? 0.7 : 0.95
          },
          notes: cafNote,
          isEditable: true
        });
      } else {
        // All HS codes were missing
        lines.push({
          id: 'duties_total',
          bloc: 'debours',
          category: 'Droits & Taxes',
          description: 'Droits et taxes douaniers',
          amount: null,
          currency: 'FCFA',
          source: {
            type: 'TO_CONFIRM',
            reference: `Code(s) HS ${request.hsCode} non trouvé(s)`,
            confidence: 0
          },
          notes: 'Code(s) HS à vérifier pour calcul des droits',
          isEditable: true
        });
      }
    } else {
      // No HS code — no invented estimate, flag for human confirmation
      lines.push({
        id: 'duties_estimate',
        bloc: 'debours',
        category: 'Droits & Taxes',
        description: 'Droits et taxes douaniers',
        amount: null,
        currency: 'FCFA',
        source: {
          type: 'TO_CONFIRM',
          reference: 'Aucune donnée normative — code HS requis',
          confidence: 0
        },
        notes: 'Aucune donnée normative — fournir le code HS pour calcul exact des droits.',
        isEditable: true
      });
    }
  } // end if (!isTransit)
  
  return { lines, warnings, dutyBreakdown, cargoValueFCFA };
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const supabase = createSupabaseClient();
    _rateCache.clear();
    const body = await req.json();
    
    const { action, params } = body;
    
    switch (action) {
      case 'generate': {
        const request = params as QuotationRequest;
        const earlyWarnings: string[] = [];
        
        // Validation minimale
        if (!request.finalDestination) {
          return new Response(
            JSON.stringify({ success: false, error: 'Destination finale requise' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          );
        }
        
        if (!request.cargoValue || request.cargoValue <= 0) {
          request.cargoValue = 1;
          earlyWarnings.push('Valeur marchandise non spécifiée — calculs CAF/assurance approximatifs');
        }
        
        // Générer les lignes de cotation
        const { lines, warnings: engineWarnings, dutyBreakdown, cargoValueFCFA } = await generateQuotationLines(supabase, request);
        const warnings = [...earlyWarnings, ...engineWarnings];
        
        // M3.1 — Fetch historical suggestions (non-blocking, consultative)
        const correlationId = getCorrelationId(req);
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const historicalSuggestions = await fetchHistoricalSuggestions(
          supabaseUrl, serviceKey, request, correlationId, supabase
        );

        // Calculer les totaux
        const totals = {
          operationnel: lines.filter(l => l.bloc === 'operationnel' && l.amount).reduce((s, l) => s + (l.amount || 0), 0),
          honoraires: lines.filter(l => l.bloc === 'honoraires' && l.amount).reduce((s, l) => s + (l.amount || 0), 0),
          debours: lines.filter(l => l.bloc === 'debours' && l.amount).reduce((s, l) => s + (l.amount || 0), 0),
          border: lines.filter(l => l.bloc === 'border' && l.amount).reduce((s, l) => s + (l.amount || 0), 0),
          terminal: lines.filter(l => l.bloc === 'terminal' && l.amount).reduce((s, l) => s + (l.amount || 0), 0),
          dap: 0,
          ddp: 0
        };
        
        totals.dap = totals.operationnel + totals.honoraires + totals.border + totals.terminal;
        totals.ddp = totals.dap + totals.debours;
        
        // Métadonnées — use DB-backed rules for consistency
        const dbIncotermsMeta = await loadIncotermsFromDB(supabase);
        const dbZonesMeta = await loadDeliveryZonesFromDB(supabase);
        const incotermRule = dbIncotermsMeta[request.incoterm?.toUpperCase() || 'CIF'];
        const zone = identifyZoneFromDB(request.finalDestination, dbZonesMeta);
        const transitCountry = detectTransitCountry(request.finalDestination);
        const exceptional = request.dimensions ? checkExceptionalTransport(request.dimensions) : { isExceptional: false, reasons: [] };
        // P0 CAF strict: recalcul freightFCFA pour metadata (resolution DB centralisee)
        let freightFCFA: number | undefined = undefined;
        if (request.freightAmount && request.freightAmount > 0) {
          const freightCur = String(request.freightCurrency ?? 'XOF').trim().toUpperCase();
          if (freightCur === 'XOF' || freightCur === 'FCFA' || freightCur === 'CFA') {
            freightFCFA = request.freightAmount;
          } else {
            const rate = await resolveExchangeRate(supabase, freightCur);
            freightFCFA = request.freightAmount * rate;
          }
        }
        const caf = calculateCAF({
          incoterm: request.incoterm || 'CIF',
          invoiceValue: cargoValueFCFA || request.cargoValue,
          freightAmount: freightFCFA,
        });
        
        // P0 fix: recalcul regimeName pour metadata via requête ciblée (pas de dépendance à generateQuotationLines)
        let regimeMeta: { name: string | null } | null = null;
        if (request.regimeCode) {
          const { data: regime } = await supabase
            .from("customs_regimes")
            .select("code,name")
            .eq("code", request.regimeCode)
            .maybeSingle();
          regimeMeta = regime ? { name: regime.name || null } : null;
        }

        const result = {
          success: true,
          lines,
          totals,
          duty_breakdown: dutyBreakdown,
          metadata: {
            incoterm: {
              code: incotermRule?.code || request.incoterm || 'N/A',
              group: incotermRule?.group || 'N/A',
              description: incotermRule?.description || '',
              sellerPays: incotermRule?.sellerPays || {}
            },
            zone: {
              code: zone.code,
              name: zone.name,
              multiplier: zone.multiplier,
              distanceKm: zone.distanceKm,
              country: transitCountry || undefined
            },
            exceptional,
            caf: {
              value: caf.cafValue,
              method: caf.method
            },
            isTransit: transitCountry !== null,
            transitCountry: transitCountry || undefined,
            regime_applied: request.regimeCode || null,
            regime_name: regimeMeta?.name || null,
            regime_unknown: regimeMeta === null && !!request.regimeCode,
          },
          warnings,
          historical_suggestions: historicalSuggestions,
        };
        
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      case 'get_rules': {
        // Retourner les règles métier pour affichage/debug
        return new Response(
          JSON.stringify({
            success: true,
            rules: {
              incoterms: Object.keys(INCOTERMS_MATRIX),
              evpConversion: EVP_CONVERSION,
              zones: Object.keys(DELIVERY_ZONES).map(k => ({
                code: k,
                name: DELIVERY_ZONES[k].name,
                multiplier: DELIVERY_ZONES[k].multiplier
              })),
              transitCountries: TRANSIT_COUNTRIES
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      case 'validate_request': {
        const request = params as Partial<QuotationRequest>;
        const issues: string[] = [];
        
        if (!request.finalDestination) issues.push('Destination finale manquante');
        if (!request.cargoValue || request.cargoValue <= 0) issues.push('Valeur marchandise invalide');
        if (!request.incoterm) issues.push('Incoterm non spécifié');
        if (!request.transportMode) issues.push('Mode de transport non spécifié');
        
        if (request.containerType && !EVP_CONVERSION[request.containerType.toUpperCase()]) {
          issues.push(`Type conteneur inconnu: ${request.containerType}`);
        }
        
        if (request.incoterm && !INCOTERMS_MATRIX[request.incoterm.toUpperCase()]) {
          issues.push(`Incoterm inconnu: ${request.incoterm}`);
        }
        
        return new Response(
          JSON.stringify({
            success: issues.length === 0,
            isValid: issues.length === 0,
            issues,
            isTransit: request.finalDestination ? isTransitDestination(request.finalDestination) : false,
            transitCountry: request.finalDestination ? detectTransitCountry(request.finalDestination) : null
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      default:
        return new Response(
          JSON.stringify({ success: false, error: `Action inconnue: ${action}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
    }
  } catch (error) {
    console.error('Quotation engine error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur interne' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
