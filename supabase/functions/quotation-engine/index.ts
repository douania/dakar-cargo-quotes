import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createSupabaseClient } from "../_shared/supabase.ts";
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
  type DataSourceType,
  type QuotationLineSource,
  type SodatraFeeParams,
} from "../_shared/quotation-rules.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
// THD CATEGORY DETERMINATION
// =====================================================
function determineTariffCategory(cargoDescription: string): string {
  const desc = cargoDescription.toLowerCase();
  
  // T09 - Véhicules, Tracteurs, Machines, Équipements de transport
  if (desc.match(/power plant|generator|transformer|vehicle|truck|tractor|machine|equipment|genset|engine/)) {
    return 'T09';
  }
  // T01 - Boissons, Produits chimiques, Équipements
  if (desc.match(/drink|beverage|chemical|accessory|part|pump|valve/)) {
    return 'T01';
  }
  // T05 - Céréales, Ciment, Engrais
  if (desc.match(/cereal|wheat|rice|cement|fertilizer|flour/)) {
    return 'T05';
  }
  // T14 - Produits métallurgiques
  if (desc.match(/steel|iron|metal|metallurg|pipe|tube|beam/)) {
    return 'T14';
  }
  // T07 - Textiles, Matériaux de construction
  if (desc.match(/textile|fabric|building material|cotton|tile|brick/)) {
    return 'T07';
  }
  // T12 - Produits divers
  if (desc.match(/mixed|general|various|divers/)) {
    return 'T12';
  }
  
  // Défaut: T02 (catégorie générale moyenne)
  return 'T02';
}

// =====================================================
// FONCTIONS PRINCIPALES
// =====================================================

async function fetchOfficialTariffs(
  supabase: any,
  params: {
    provider?: string;
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
  
  if (params.provider) query = query.eq('provider', params.provider);
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
  // 1. DETERMINE CONTEXT
  // =====================================================
  
  const transitCountry = detectTransitCountry(request.finalDestination);
  const isTransit = request.isTransit || transitCountry !== null;
  const effectiveOperationType = isTransit ? 'TRANSIT' : 'IMPORT';
  const zone = identifyZone(request.finalDestination);
  
  console.log(`Quotation context: isTransit=${isTransit}, transitCountry=${transitCountry}, operationType=${effectiveOperationType}`);
  
  // Build containers array from legacy or new format
  const containers: ContainerInfo[] = request.containers?.length 
    ? request.containers 
    : request.containerType 
      ? [{ type: request.containerType, quantity: request.containerCount || 1 }]
      : [{ type: '40HC', quantity: 1 }];
  
  // Total weight from request
  const totalWeightTonnes = request.cargoWeight || request.weightTonnes || 0;
  
  // Carrier detection
  const carrier = request.carrier || request.shippingLine;
  
  // =====================================================
  // 2. FETCH ALL NECESSARY DATA
  // =====================================================
  
  // THC Tariffs - with correct operation type
  const thcTariffs = await fetchOfficialTariffs(supabase, {
    provider: 'DP_WORLD',
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
    provider: 'DP_WORLD',
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
      // Fallback to standard THC rate
      const standardRate = is40 ? 220000 : 110000;
      lines.push({
        id: `thc_${container.type.toLowerCase()}_${lines.length}`,
        bloc: 'operationnel',
        category: 'Terminal (DPW)',
        description: `THC ${effectiveOperationType} ${container.type}`,
        amount: standardRate * container.quantity,
        currency: 'FCFA',
        containerType: container.type,
        source: {
          type: 'CALCULATED',
          reference: 'Tarif standard DPW',
          confidence: 0.8
        },
        notes: 'Tarif standard appliqué - vérifier avec DPW',
        isEditable: true
      });
      warnings.push(`THC ${container.type} non trouvé - tarif standard appliqué`);
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
            // Ultimate fallback: estimate
            const estimatedRate = 2600000; // Base Bamako rate
            lines.push({
              id: `transport_mali_est_${container.type.toLowerCase()}_${lines.length}`,
              bloc: 'operationnel',
              category: 'Transport Mali',
              description: `Transport ${container.type} → ${request.finalDestination}`,
              amount: estimatedRate * container.quantity,
              currency: 'FCFA',
              containerType: container.type,
              source: {
                type: 'TO_CONFIRM',
                reference: 'Estimation Mali standard',
                confidence: 0.4
              },
              notes: `Estimation. Zone non trouvée dans la base. À confirmer avec transporteur.`,
              isEditable: true
            });
            warnings.push(`Transport Mali estimé pour ${request.finalDestination} - Zone non référencée`);
          }
        }
      }
      
    } else {
      // ===== NON-MALI TRANSPORT (original logic) =====
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
          // Try local_transport_rates table
          const { data: localRates } = await supabase
            .from('local_transport_rates')
            .select('*')
            .eq('is_active', true)
            .ilike('destination', `%${request.finalDestination.split(' ')[0]}%`)
            .limit(1);
          
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
            // Estimation based on zone
            const estimatedRate = 350000 * zone.multiplier;
            lines.push({
              id: `transport_${container.type.toLowerCase()}_${lines.length}`,
              bloc: 'operationnel',
              category: 'Transport',
              description: `Transport ${container.type} → ${request.finalDestination}`,
              amount: Math.round(estimatedRate / 10000) * 10000 * container.quantity,
              currency: 'FCFA',
              containerType: container.type,
              source: {
                type: 'TO_CONFIRM',
                reference: `Estimation zone ${zone.name}`,
                confidence: 0.3
              },
              notes: `Estimation basée sur distance ${zone.distanceKm}km. À confirmer avec transporteur.`,
              isEditable: true
            });
            warnings.push(`Transport ${container.type} estimé (zone ${zone.name}) - Tarif à confirmer`);
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
  // 8. BLOC HONORAIRES - SODATRA FEES
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
    
    const sodatraFees = calculateSodatraFees(sodatraParams);
    
    lines.push({
      id: 'fee_clearance',
      bloc: 'honoraires',
      category: 'Dédouanement',
      description: isTransit ? 'Honoraires transit SN' : 'Honoraires de dédouanement',
      amount: sodatraFees.dedouanement,
      currency: 'FCFA',
      source: {
        type: 'CALCULATED',
        reference: 'Grille SODATRA',
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
        reference: 'Grille SODATRA',
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
        reference: 'Grille SODATRA',
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
        reference: 'Grille SODATRA',
        confidence: 1.0
      },
      isEditable: false
    });
  }
  
  // =====================================================
  // 9. BLOC DÉBOURS - DROITS ET TAXES (Only for non-transit)
  // =====================================================
  
  if (!isTransit) {
    // Calcul CAF
    const incotermRule = INCOTERMS_MATRIX[request.incoterm?.toUpperCase() || 'CIF'];
    const caf = calculateCAF({
      incoterm: request.incoterm || 'CIF',
      invoiceValue: request.cargoValue,
      freightAmount: undefined,
      insuranceRate: 0.005
    });
    
    // Si code HS fourni, calculer les droits
    if (request.hsCode) {
      const { data: hsData } = await supabase
        .from('hs_codes')
        .select('*')
        .or(`code.eq.${request.hsCode},code_normalized.eq.${request.hsCode.replace(/\D/g, '')}`)
        .limit(1);
      
      if (hsData && hsData.length > 0) {
        const hs = hsData[0];
        const ddAmount = caf.cafValue * (hs.dd / 100);
        const rsAmount = caf.cafValue * (hs.rs / 100);
        const pcsAmount = caf.cafValue * (hs.pcs / 100);
        const pccAmount = caf.cafValue * (hs.pcc / 100);
        const cosecAmount = caf.cafValue * (hs.cosec / 100);
        const baseVAT = caf.cafValue + ddAmount + rsAmount;
        const tvaAmount = baseVAT * (hs.tva / 100);
        
        const totalDuties = ddAmount + rsAmount + pcsAmount + pccAmount + cosecAmount + tvaAmount;
        
        lines.push({
          id: 'duties_total',
          bloc: 'debours',
          category: 'Droits & Taxes',
          description: `Droits et taxes (HS ${request.hsCode})`,
          amount: Math.round(totalDuties),
          currency: 'FCFA',
          source: {
            type: 'CALCULATED',
            reference: `TEC UEMOA - DD ${hs.dd}% + RS ${hs.rs}% + TVA ${hs.tva}%`,
            confidence: 0.95
          },
          notes: `Base CAF: ${Math.round(caf.cafValue).toLocaleString()} FCFA`,
          isEditable: true
        });
      } else {
        lines.push({
          id: 'duties_total',
          bloc: 'debours',
          category: 'Droits & Taxes',
          description: 'Droits et taxes douaniers',
          amount: null,
          currency: 'FCFA',
          source: {
            type: 'TO_CONFIRM',
            reference: `Code HS ${request.hsCode} non trouvé`,
            confidence: 0
          },
          notes: 'Code HS à vérifier pour calcul des droits',
          isEditable: true
        });
        warnings.push(`Code HS ${request.hsCode} non trouvé - Droits à calculer manuellement`);
      }
    } else {
      // Estimation générale basée sur catégorie 3 (20% DD)
      const estimatedDuties = caf.cafValue * 0.45;
      
      lines.push({
        id: 'duties_estimate',
        bloc: 'debours',
        category: 'Droits & Taxes',
        description: 'Droits et taxes (estimation)',
        amount: Math.round(estimatedDuties),
        currency: 'FCFA',
        source: {
          type: 'TO_CONFIRM',
          reference: 'Estimation générale - Code HS requis',
          confidence: 0.4
        },
        notes: 'Estimation basée sur catégorie 3. Fournir code HS pour calcul exact.',
        isEditable: true
      });
      warnings.push('Code HS non fourni - Droits estimés à confirmer');
    }
    
    // Commission sur débours (5%)
    const deboursTotal = lines
      .filter(l => l.bloc === 'debours' && l.amount)
      .reduce((sum, l) => sum + (l.amount || 0), 0);
    
    if (deboursTotal > 0) {
      lines.push({
        id: 'commission_debours',
        bloc: 'honoraires',
        category: 'Commission',
        description: 'Commission sur débours (5%)',
        amount: Math.round(deboursTotal * 0.05),
        currency: 'FCFA',
        source: {
          type: 'CALCULATED',
          reference: 'Grille SODATRA - 5% débours',
          confidence: 1.0
        },
        isEditable: false
      });
    }
  }
  
  return { lines, warnings };
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const supabase = createSupabaseClient();
    const body = await req.json();
    
    const { action, params } = body;
    
    switch (action) {
      case 'generate': {
        const request = params as QuotationRequest;
        
        // Validation minimale
        if (!request.finalDestination) {
          return new Response(
            JSON.stringify({ success: false, error: 'Destination finale requise' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          );
        }
        
        if (!request.cargoValue || request.cargoValue <= 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'Valeur marchandise requise' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          );
        }
        
        // Générer les lignes de cotation
        const { lines, warnings } = await generateQuotationLines(supabase, request);
        
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
        
        // Métadonnées
        const incotermRule = INCOTERMS_MATRIX[request.incoterm?.toUpperCase() || 'CIF'];
        const zone = identifyZone(request.finalDestination);
        const transitCountry = detectTransitCountry(request.finalDestination);
        const exceptional = request.dimensions ? checkExceptionalTransport(request.dimensions) : { isExceptional: false, reasons: [] };
        const caf = calculateCAF({
          incoterm: request.incoterm || 'CIF',
          invoiceValue: request.cargoValue
        });
        
        const result: QuotationResult = {
          success: true,
          lines,
          totals,
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
            transitCountry: transitCountry || undefined
          },
          warnings
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
