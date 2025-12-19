import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RiskInput {
  eta_date?: string;
  cargo_nature?: string;
  hs_code?: string;
  destination?: string;
  container_type?: string;
  carrier?: string;
  is_transit?: boolean;
  transit_destination?: string;
}

interface RiskResult {
  time_risk: TimeRisk;
  nature_risk: NatureRisk;
  provisions: Provisions;
  vigilance_points: VigilancePoint[];
  demurrage_info: DemurrageInfo | null;
}

interface TimeRisk {
  level: 'low' | 'medium' | 'high';
  eta_date: string | null;
  working_days_to_franchise: number | null;
  franchise_days: number;
  holidays_in_range: Holiday[];
  weekends_in_range: number;
  estimated_clearance_days: number;
  risk_explanation_fr: string;
  risk_explanation_en: string;
}

interface Holiday {
  date: string;
  name: string;
  impact: string;
}

interface NatureRisk {
  level: 'low' | 'medium' | 'high';
  imo_class: ImoClass | null;
  is_reefer: boolean;
  is_oversized: boolean;
  special_handling: string[];
  surcharges_percent: number;
  risk_explanation_fr: string;
  risk_explanation_en: string;
}

interface ImoClass {
  class_code: string;
  division: string | null;
  name_fr: string;
  name_en: string;
  port_surcharge_percent: number;
  storage_surcharge_percent: number;
  requires_segregation: boolean;
  handling_notes: string;
}

interface Provisions {
  stationnement_fcfa: number;
  surestaries_usd: number;
  escorte_fcfa: number;
  segregation_fcfa: number;
  total_provisions_fcfa: number;
  breakdown: ProvisionLine[];
}

interface ProvisionLine {
  item: string;
  amount: number;
  currency: string;
  reason: string;
}

interface VigilancePoint {
  category: 'time' | 'nature' | 'carrier' | 'destination' | 'general';
  severity: 'info' | 'warning' | 'critical';
  message_fr: string;
  message_en: string;
}

interface DemurrageInfo {
  carrier: string;
  free_days: number;
  rate_after_free_days_usd: number;
  container_type: string;
}

// Exchange rate (approximate)
const USD_TO_FCFA = 615;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: RiskInput = await req.json();
    console.log("Analyze risks input:", JSON.stringify(input));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const vigilancePoints: VigilancePoint[] = [];
    const provisions: ProvisionLine[] = [];

    // ===== TIME RISK ANALYSIS =====
    const timeRisk = await analyzeTimeRisk(supabase, input, vigilancePoints);

    // ===== NATURE RISK ANALYSIS =====
    const natureRisk = await analyzeNatureRisk(supabase, input, vigilancePoints, provisions);

    // ===== DEMURRAGE INFO =====
    const demurrageInfo = await getDemurrageInfo(supabase, input, vigilancePoints);

    // ===== CALCULATE PROVISIONS =====
    let stationnementFcfa = 0;
    let surestariesUsd = 0;
    let escorteFcfa = 0;
    let segregationFcfa = 0;

    // Stationnement provision if time risk is medium or high
    if (timeRisk.level !== 'low') {
      const daysOver = Math.max(0, timeRisk.estimated_clearance_days - timeRisk.franchise_days);
      if (daysOver > 0) {
        // Fetch warehouse rate
        const { data: warehouse } = await supabase
          .from('warehouse_franchise')
          .select('rate_after_franchise_day')
          .eq('operation_type', input.is_transit ? 'TRANSIT_MALI' : 'IMPORT_SENEGAL')
          .maybeSingle();

        const dailyRate = warehouse?.rate_after_franchise_day || 15000;
        stationnementFcfa = daysOver * dailyRate * (input.container_type?.includes('40') ? 2 : 1);
        provisions.push({
          item: 'Provision magasinage',
          amount: stationnementFcfa,
          currency: 'FCFA',
          reason: `${daysOver} jours au-delà de la franchise`,
        });
      }
    }

    // Surestaries provision
    if (demurrageInfo && timeRisk.level === 'high') {
      surestariesUsd = demurrageInfo.rate_after_free_days_usd * 3; // 3 days provision
      provisions.push({
        item: 'Provision surestaries',
        amount: surestariesUsd,
        currency: 'USD',
        reason: `3 jours de surestaries ${demurrageInfo.carrier}`,
      });
    }

    // IMO/Dangerous goods provisions
    if (natureRisk.imo_class) {
      if (natureRisk.imo_class.requires_segregation) {
        segregationFcfa = 150000;
        provisions.push({
          item: 'Surcharge IMO ségrégation',
          amount: segregationFcfa,
          currency: 'FCFA',
          reason: `Classe ${natureRisk.imo_class.class_code} - Stockage séparé`,
        });
      }
    }

    // Oversized cargo escort
    if (natureRisk.is_oversized) {
      escorteFcfa = 250000;
      provisions.push({
        item: 'Escorte hors-gabarit',
        amount: escorteFcfa,
        currency: 'FCFA',
        reason: 'Convoi exceptionnel avec escorte',
      });
    }

    const totalProvisionsFcfa = stationnementFcfa + segregationFcfa + escorteFcfa + 
      Math.round(surestariesUsd * USD_TO_FCFA);

    const result: RiskResult = {
      time_risk: timeRisk,
      nature_risk: natureRisk,
      provisions: {
        stationnement_fcfa: stationnementFcfa,
        surestaries_usd: surestariesUsd,
        escorte_fcfa: escorteFcfa,
        segregation_fcfa: segregationFcfa,
        total_provisions_fcfa: totalProvisionsFcfa,
        breakdown: provisions,
      },
      vigilance_points: vigilancePoints,
      demurrage_info: demurrageInfo,
    };

    console.log("Analyze risks result:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Analyze risks error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur d'analyse" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function analyzeTimeRisk(
  supabase: any, 
  input: RiskInput, 
  vigilancePoints: VigilancePoint[]
): Promise<TimeRisk> {
  const etaDate = input.eta_date ? new Date(input.eta_date) : null;
  
  // Determine franchise based on operation type
  let franchiseDays = 10; // Default import Senegal
  let operationType = 'IMPORT_SENEGAL';
  
  if (input.is_transit || /mali|bamako/i.test(input.transit_destination || input.destination || '')) {
    franchiseDays = 20;
    operationType = 'TRANSIT_MALI';
  } else if (/burkina|niger|guinée/i.test(input.destination || '')) {
    franchiseDays = 15;
    operationType = 'TRANSIT_AUTRES';
  }

  // Try to get exact franchise from database
  const { data: warehouse } = await supabase
    .from('warehouse_franchise')
    .select('free_days')
    .eq('operation_type', operationType)
    .maybeSingle();

  if (warehouse) {
    franchiseDays = warehouse.free_days;
  }

  let workingDaysToFranchise: number | null = null;
  let holidaysInRange: Holiday[] = [];
  let weekendsInRange = 0;
  let estimatedClearanceDays = 5; // Default estimate
  let level: 'low' | 'medium' | 'high' = 'low';
  let explanationFr = '';
  let explanationEn = '';

  if (etaDate) {
    // Calculate working days
    const endDate = new Date(etaDate);
    endDate.setDate(endDate.getDate() + franchiseDays);

    // Fetch holidays in range
    const { data: holidays } = await supabase
      .from('holidays_pad')
      .select('date, name, impact')
      .gte('date', etaDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    if (holidays) {
      holidaysInRange = holidays.map((h: any) => ({
        date: h.date,
        name: h.name,
        impact: h.impact,
      }));
    }

    // Count weekends
    let current = new Date(etaDate);
    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        weekendsInRange++;
      }
      current.setDate(current.getDate() + 1);
    }

    // Calculate working days
    const closureDays = holidaysInRange.filter(h => h.impact === 'fermeture').length;
    workingDaysToFranchise = franchiseDays - weekendsInRange - closureDays;

    // Estimate clearance time
    estimatedClearanceDays = 5; // Base
    if (input.is_transit) estimatedClearanceDays += 2;
    if (holidaysInRange.length > 0) estimatedClearanceDays += holidaysInRange.length;

    // Determine risk level
    if (workingDaysToFranchise < estimatedClearanceDays) {
      level = 'high';
      explanationFr = `⚠️ RISQUE ÉLEVÉ: Seulement ${workingDaysToFranchise} jours ouvrés avant fin de franchise (${franchiseDays}j), estimation dédouanement: ${estimatedClearanceDays}j`;
      explanationEn = `⚠️ HIGH RISK: Only ${workingDaysToFranchise} working days before franchise end (${franchiseDays}d), estimated clearance: ${estimatedClearanceDays}d`;
      
      vigilancePoints.push({
        category: 'time',
        severity: 'critical',
        message_fr: `🕐 ETA ${etaDate.toLocaleDateString('fr-FR')}: Risque de dépassement franchise magasinage (${franchiseDays}j)`,
        message_en: `🕐 ETA ${etaDate.toLocaleDateString('en-US')}: Risk of warehouse franchise overrun (${franchiseDays}d)`,
      });
    } else if (workingDaysToFranchise - estimatedClearanceDays < 3) {
      level = 'medium';
      explanationFr = `⚡ Marge réduite: ${workingDaysToFranchise - estimatedClearanceDays} jours de marge sur la franchise`;
      explanationEn = `⚡ Tight margin: ${workingDaysToFranchise - estimatedClearanceDays} days margin on franchise`;
      
      vigilancePoints.push({
        category: 'time',
        severity: 'warning',
        message_fr: `📅 Anticiper les docs - marge serrée sur franchise ${franchiseDays}j`,
        message_en: `📅 Prepare docs early - tight margin on ${franchiseDays}d franchise`,
      });
    } else {
      explanationFr = `✅ Franchise confortable: ${workingDaysToFranchise} jours ouvrés disponibles`;
      explanationEn = `✅ Comfortable franchise: ${workingDaysToFranchise} working days available`;
    }

    // Add holiday warnings
    if (holidaysInRange.length > 0) {
      vigilancePoints.push({
        category: 'time',
        severity: 'warning',
        message_fr: `🗓️ ${holidaysInRange.length} jour(s) férié(s) dans la période: ${holidaysInRange.map(h => h.name).join(', ')}`,
        message_en: `🗓️ ${holidaysInRange.length} holiday(s) in period: ${holidaysInRange.map(h => h.name).join(', ')}`,
      });
    }
  } else {
    explanationFr = "📭 Pas d'ETA fourni - Impossible d'évaluer le risque temps";
    explanationEn = "📭 No ETA provided - Cannot assess time risk";
  }

  return {
    level,
    eta_date: etaDate?.toISOString().split('T')[0] || null,
    working_days_to_franchise: workingDaysToFranchise,
    franchise_days: franchiseDays,
    holidays_in_range: holidaysInRange,
    weekends_in_range: weekendsInRange,
    estimated_clearance_days: estimatedClearanceDays,
    risk_explanation_fr: explanationFr,
    risk_explanation_en: explanationEn,
  };
}

async function analyzeNatureRisk(
  supabase: any,
  input: RiskInput,
  vigilancePoints: VigilancePoint[],
  provisions: ProvisionLine[]
): Promise<NatureRisk> {
  let level: 'low' | 'medium' | 'high' = 'low';
  let imoClass: ImoClass | null = null;
  let isReefer = false;
  let isOversized = false;
  const specialHandling: string[] = [];
  let surchargesPercent = 0;
  let explanationFr = '';
  let explanationEn = '';

  const cargoNature = (input.cargo_nature || '').toLowerCase();
  const containerType = (input.container_type || '').toUpperCase();

  // Check for reefer
  if (containerType.includes('RF') || containerType.includes('REEFER') || 
      /réfrigéré|frozen|frais|froid|reefer|température/i.test(cargoNature)) {
    isReefer = true;
    level = 'medium';
    specialHandling.push('Conteneur frigorifique - Branchement électrique requis');
    surchargesPercent += 25;
    
    vigilancePoints.push({
      category: 'nature',
      severity: 'warning',
      message_fr: '❄️ REEFER: Vérifier disponibilité prises électriques et température requise',
      message_en: '❄️ REEFER: Check power outlet availability and required temperature',
    });
  }

  // Check for oversized
  if (containerType.includes('FR') || containerType.includes('OT') || 
      /hors.?gabarit|oversized|flat.?rack|open.?top|exceptional|convoi/i.test(cargoNature)) {
    isOversized = true;
    level = level === 'low' ? 'medium' : level;
    specialHandling.push('Hors-gabarit - Escorte et permis requis');
    surchargesPercent += 50;
    
    vigilancePoints.push({
      category: 'nature',
      severity: 'warning',
      message_fr: '📐 HORS-GABARIT: Prévoir escorte, permis spécial et reconnaissance itinéraire',
      message_en: '📐 OVERSIZED: Plan escort, special permit and route survey',
    });
  }

  // Check for dangerous goods (IMO)
  const dangerousPatterns = [
    { pattern: /explosif|explosive|dynamite|munition/i, classCode: '1', division: '1.1' },
    { pattern: /gaz.?inflammable|propane|butane|aérosol/i, classCode: '2', division: '2.1' },
    { pattern: /gaz.?toxique|chlore|ammoniac/i, classCode: '2', division: '2.3' },
    { pattern: /inflammable|essence|peinture|solvant|alcool/i, classCode: '3', division: null },
    { pattern: /corrosif|acide|batterie|soude/i, classCode: '8', division: null },
    { pattern: /lithium|battery|pile/i, classCode: '9', division: null },
    { pattern: /chimique|chemical|pesticide/i, classCode: '6', division: '6.1' },
  ];

  for (const { pattern, classCode, division } of dangerousPatterns) {
    if (pattern.test(cargoNature)) {
      // Fetch IMO class details
      const { data: imo } = await supabase
        .from('imo_classes')
        .select('*')
        .eq('class_code', classCode)
        .eq('division', division)
        .maybeSingle();

      if (imo) {
        imoClass = {
          class_code: imo.class_code,
          division: imo.division,
          name_fr: imo.name_fr,
          name_en: imo.name_en,
          port_surcharge_percent: imo.port_surcharge_percent,
          storage_surcharge_percent: imo.storage_surcharge_percent,
          requires_segregation: imo.requires_segregation,
          handling_notes: imo.handling_notes,
        };

        level = 'high';
        surchargesPercent += imo.port_surcharge_percent;
        specialHandling.push(`IMO Classe ${classCode}: ${imo.name_fr}`);

        vigilancePoints.push({
          category: 'nature',
          severity: 'critical',
          message_fr: `☢️ MARCHANDISE DANGEREUSE IMO ${classCode}: ${imo.name_fr} - ${imo.handling_notes}`,
          message_en: `☢️ DANGEROUS GOODS IMO ${classCode}: ${imo.name_en} - ${imo.handling_notes}`,
        });

        if (imo.requires_segregation) {
          vigilancePoints.push({
            category: 'nature',
            severity: 'critical',
            message_fr: '🚧 SÉGRÉGATION OBLIGATOIRE - Zone de stockage dédiée DPW',
            message_en: '🚧 SEGREGATION REQUIRED - Dedicated DPW storage area',
          });
        }
      }
      break; // Only match first dangerous pattern
    }
  }

  // Build explanation
  if (level === 'high') {
    explanationFr = `⚠️ RISQUE ÉLEVÉ: Marchandise spéciale (${specialHandling.join(', ')})`;
    explanationEn = `⚠️ HIGH RISK: Special cargo (${specialHandling.join(', ')})`;
  } else if (level === 'medium') {
    explanationFr = `⚡ Risque modéré: ${specialHandling.join(', ')}`;
    explanationEn = `⚡ Moderate risk: ${specialHandling.join(', ')}`;
  } else {
    explanationFr = '✅ Marchandise standard - Pas de contrainte particulière';
    explanationEn = '✅ Standard cargo - No special constraints';
  }

  return {
    level,
    imo_class: imoClass,
    is_reefer: isReefer,
    is_oversized: isOversized,
    special_handling: specialHandling,
    surcharges_percent: surchargesPercent,
    risk_explanation_fr: explanationFr,
    risk_explanation_en: explanationEn,
  };
}

async function getDemurrageInfo(
  supabase: any,
  input: RiskInput,
  vigilancePoints: VigilancePoint[]
): Promise<DemurrageInfo | null> {
  if (!input.carrier) return null;

  const carrierNormalized = input.carrier.toUpperCase().replace(/[-\s]/g, '');
  const containerNormalized = normalizeContainerType(input.container_type || '40DV');

  // Try to find demurrage rates
  const { data: demurrage } = await supabase
    .from('demurrage_rates')
    .select('*')
    .ilike('carrier', `%${carrierNormalized.substring(0, 3)}%`)
    .eq('container_type', containerNormalized)
    .eq('is_active', true)
    .maybeSingle();

  if (demurrage) {
    // Compare carrier free days with PAD franchise
    const carrierFreeDays = demurrage.free_days_standard;
    const padFranchise = input.is_transit ? 20 : 10;

    if (carrierFreeDays < padFranchise) {
      vigilancePoints.push({
        category: 'carrier',
        severity: 'warning',
        message_fr: `⏰ ATTENTION: Franchise ${demurrage.carrier} (${carrierFreeDays}j) < Franchise PAD (${padFranchise}j) - Surestaries probables`,
        message_en: `⏰ WARNING: ${demurrage.carrier} free time (${carrierFreeDays}d) < PAD franchise (${padFranchise}d) - Demurrage likely`,
      });
    }

    return {
      carrier: demurrage.carrier,
      free_days: demurrage.free_days_standard,
      rate_after_free_days_usd: demurrage.rate_day_1_7 || 100,
      container_type: demurrage.container_type,
    };
  }

  return null;
}

function normalizeContainerType(input: string): string {
  const normalized = input.toUpperCase().replace(/['\s-]/g, '');
  const mappings: Record<string, string> = {
    '20': '20DV', '20FT': '20DV', '20GP': '20DV',
    '40': '40DV', '40FT': '40DV', '40GP': '40DV',
    '40HQ': '40HC', '40HC': '40HC',
  };
  return mappings[normalized] || '40DV';
}
