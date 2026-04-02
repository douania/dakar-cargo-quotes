import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

interface DemurrageTierInfo {
  day_from: number;
  day_to: number | null;
  rate_per_day: number;
  currency: string;
  evidence_level: string;
}

interface DemurrageInfo {
  carrier: string;
  free_days: number;
  rate_after_free_days: number;    // Premier tier ou legacy
  rate_currency: string;           // Devise réelle (XOF, EUR, USD)
  container_type: string;
  tiers: DemurrageTierInfo[];      // Paliers réels (vide si fallback legacy)
}

interface Provisions {
  stationnement_fcfa: number;
  surestaries_amount: number;      // Montant brut dans la devise réelle
  surestaries_currency: string;    // Devise réelle
  escorte_fcfa: number;
  segregation_fcfa: number;
  total_provisions_fcfa: number;   // Somme des provisions FCFA/XOF natives UNIQUEMENT
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const input: RiskInput = await req.json();
    console.log("Analyze risks input:", JSON.stringify(input));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const vigilancePoints: VigilancePoint[] = [];
    const provisions: ProvisionLine[] = [];

    // Dériver cargo_type une seule fois pour tout le scope
    // container_type présent → FCL, sinon BREAKBULK
    const cargoType = input.container_type ? 'FCL' : 'BREAKBULK';

    // ===== TIME RISK ANALYSIS =====
    const timeRisk = await analyzeTimeRisk(supabase, input, vigilancePoints, cargoType);

    // ===== NATURE RISK ANALYSIS =====
    const natureRisk = await analyzeNatureRisk(supabase, input, vigilancePoints, provisions, cargoType);

    // ===== DEMURRAGE INFO =====
    const demurrageInfo = await getDemurrageInfo(supabase, input, vigilancePoints);

    // ===== CALCULATE PROVISIONS =====
    let stationnementFcfa = 0;
    let surestariesAmount = 0;
    let surestariesCurrency = 'XOF'; // Default, overridden if demurrageInfo exists
    let escorteFcfa = 0;
    let segregationFcfa = 0;

    // Stationnement provision if time risk is medium or high
    if (timeRisk.level !== 'low') {
      const daysOver = Math.max(0, timeRisk.estimated_clearance_days - timeRisk.franchise_days);
      if (daysOver > 0) {
        // Fetch warehouse rate — colonnes réelles: provider, cargo_type, rate_per_day
        const { data: warehouseRates } = await supabase
          .from('warehouse_franchise')
          .select('rate_per_day')
          .eq('provider', 'PAD')
          .eq('cargo_type', cargoType)
          .eq('is_active', true)
          .order('effective_date', { ascending: false })
          .limit(1);

        const warehouseRate = warehouseRates?.[0] ?? null;
        // Fallback 15 000 FCFA si aucune ligne DB trouvée (filet de sécurité)
        const dailyRate = warehouseRate?.rate_per_day || 15000;
        console.log(`[analyze-risks] warehouse rate_per_day: ${warehouseRate?.rate_per_day ?? 'FALLBACK 15000'} (cargoType=${cargoType})`);
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
      surestariesAmount = demurrageInfo.rate_after_free_days * 3; // 3 days provision
      surestariesCurrency = demurrageInfo.rate_currency;
      provisions.push({
        item: 'Provision surestaries',
        amount: surestariesAmount,
        currency: surestariesCurrency,
        reason: `3 jours de surestaries ${demurrageInfo.carrier} (${surestariesCurrency})`,
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

    // total_provisions_fcfa = somme des provisions FCFA/XOF natives UNIQUEMENT
    // La surestarie n'y entre que si sa devise est nativement XOF/FCFA
    // Pas de conversion implicite EUR→FCFA ou USD→FCFA
    let totalProvisionsFcfa = stationnementFcfa + segregationFcfa + escorteFcfa;
    if (surestariesCurrency === 'XOF' || surestariesCurrency === 'FCFA') {
      totalProvisionsFcfa += surestariesAmount;
    }

    const result: RiskResult = {
      time_risk: timeRisk,
      nature_risk: natureRisk,
      provisions: {
        stationnement_fcfa: stationnementFcfa,
        surestaries_amount: surestariesAmount,
        surestaries_currency: surestariesCurrency,
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
  vigilancePoints: VigilancePoint[],
  cargoType: string
): Promise<TimeRisk> {
  const etaDate = input.eta_date ? new Date(input.eta_date) : null;
  
  // Determine franchise based on operation type
  let franchiseDays = 10; // Default import Senegal
  
  if (input.is_transit || /mali|bamako/i.test(input.transit_destination || input.destination || '')) {
    franchiseDays = 20;
  } else if (/burkina|niger|guinée/i.test(input.destination || '')) {
    franchiseDays = 15;
  }

  // Lecture franchise DB — colonnes réelles: provider, cargo_type, free_days
  const { data: franchiseRows } = await supabase
    .from('warehouse_franchise')
    .select('free_days')
    .eq('provider', 'PAD')
    .eq('cargo_type', cargoType)
    .eq('is_active', true)
    .order('effective_date', { ascending: false })
    .limit(1);

  const franchiseRow = franchiseRows?.[0] ?? null;
  if (franchiseRow) {
    franchiseDays = franchiseRow.free_days;
  }
  console.log(`[analyze-risks] franchise free_days: ${franchiseRow?.free_days ?? 'FALLBACK ' + franchiseDays} (cargoType=${cargoType})`);

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
  provisions: ProvisionLine[],
  cargoType: string
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

  // Try to find demurrage rates parent
  const { data: demurrage } = await supabase
    .from('demurrage_rates')
    .select('*')
    .ilike('carrier', `%${carrierNormalized.substring(0, 3)}%`)
    .eq('container_type', containerNormalized)
    .eq('is_active', true)
    .maybeSingle();

  if (!demurrage) return null;

  // ===== TIERS RESOLUTION =====
  // Priorité : demurrage_tiers (paliers réels) > colonnes legacy (day_1_7_rate, etc.)
  const { data: tiersRows } = await supabase
    .from('demurrage_tiers')
    .select('tier_order, day_from, day_to, rate_per_day, currency, evidence_level, source_document')
    .eq('demurrage_rate_id', demurrage.id)
    .order('tier_order', { ascending: true });

  const tiers: DemurrageTierInfo[] = (tiersRows || []).map((t: any) => ({
    day_from: t.day_from,
    day_to: t.day_to,
    rate_per_day: t.rate_per_day,
    currency: t.currency,
    evidence_level: t.evidence_level,
  }));

  let rateAfterFreeDays: number;
  let rateCurrency: string;

  if (tiers.length > 0) {
    // Tiers réels trouvés → utiliser le premier palier comme référence "après franchise"
    const firstTier = tiers[0];
    rateAfterFreeDays = firstTier.rate_per_day;
    rateCurrency = firstTier.currency;
    console.log(`[analyze-risks] demurrage TIERS carrier=${demurrage.carrier} tiers=${tiers.length} rate=${rateAfterFreeDays} ${rateCurrency} evidence=${firstTier.evidence_level}`);
  } else {
    // Fallback legacy : colonnes day_1_7_rate du parent demurrage_rates
    // NOTE: Ce fallback est un filet de compatibilité, pas une vérité métier.
    // Les colonnes legacy (day_1_7_rate, currency) peuvent contenir des seeds
    // non vérifiées ou des montants approximatifs.
    rateAfterFreeDays = demurrage.day_1_7_rate || 100;
    rateCurrency = demurrage.currency || 'USD'; // Fallback legacy — pas une vérité métier
    console.log(`[analyze-risks] demurrage LEGACY FALLBACK carrier=${demurrage.carrier} tiers=0 rate=${rateAfterFreeDays} ${rateCurrency}`);
  }

  // Contexte analyze-risks = import par défaut
  const carrierFreeDays = demurrage.free_days_import;
  const padFranchise = input.is_transit ? 20 : 10;

  if (carrierFreeDays < padFranchise) {
    vigilancePoints.push({
      category: 'carrier',
      severity: 'warning',
      message_fr: `⏰ ATTENTION: Franchise ${demurrage.carrier} (${carrierFreeDays}j) < Franchise PAD (${padFranchise}j) - Surestaries probables`,
      message_en: `⏰ WARNING: ${demurrage.carrier} free time (${carrierFreeDays}d) < PAD franchise (${padFranchise}d) - Demurrage likely`,
    });
  }

  // Vigilance enrichie avec devise et paliers si tiers disponibles
  if (tiers.length > 0) {
    const tiersDesc = tiers.map(t => 
      `J${t.day_from}${t.day_to ? `-${t.day_to}` : '+'}: ${t.rate_per_day.toLocaleString()} ${t.currency}/j`
    ).join(' | ');
    vigilancePoints.push({
      category: 'carrier',
      severity: 'info',
      message_fr: `📊 Barème ${demurrage.carrier}: ${tiersDesc}`,
      message_en: `📊 ${demurrage.carrier} tariff: ${tiersDesc}`,
    });
  }

  return {
    carrier: demurrage.carrier,
    free_days: demurrage.free_days_import,
    rate_after_free_days: rateAfterFreeDays,
    rate_currency: rateCurrency,
    container_type: demurrage.container_type,
    tiers,
  };
}

function normalizeContainerType(input: string): string {
  const normalized = input.toUpperCase().replace(/['\s-]/g, '');
  const mappings: Record<string, string> = {
    '20': '20DV', '20FT': '20DV', '20GP': '20DV', '20DV': '20DV',
    '40': '40DV', '40FT': '40DV', '40GP': '40DV', '40DV': '40DV',
    '40HQ': '40HC', '40HC': '40HC',
  };
  return mappings[normalized] || '40DV';
}
