import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IncotermInput {
  incoterm: string;
  origin_country?: string;
  destination_country?: string;
  cargo_type?: string;
  fob_value?: number;
  freight_cost?: number;
  insurance_cost?: number;
  currency?: string;
}

interface IncotermResult {
  incoterm: IncotermDetails;
  costs_to_quote: string[];
  costs_excluded: string[];
  caf_calculation: CafCalculation;
  responsibility_map: Record<string, 'buyer' | 'seller'>;
  quotation_guidance: QuotationGuidance;
}

interface IncotermDetails {
  code: string;
  name: string;
  groupe: string;
  description_fr: string;
  description_en: string;
  maritime_only: boolean;
}

interface CafCalculation {
  method: 'FOB_PLUS_FREIGHT' | 'INVOICE_VALUE' | 'EXW_PLUS_ALL';
  estimated_caf_value: number | null;
  components: CafComponent[];
  notes: string;
}

interface CafComponent {
  name: string;
  value: number | null;
  currency: string;
  included: boolean;
}

interface QuotationGuidance {
  what_to_include_fr: string[];
  what_to_include_en: string[];
  what_seller_handles_fr: string[];
  what_seller_handles_en: string[];
  vigilance_points_fr: string[];
  vigilance_points_en: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: IncotermInput = await req.json();
    console.log("Arbitrage Incoterm input:", JSON.stringify(input));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { incoterm, fob_value, freight_cost, insurance_cost, currency = 'USD' } = input;

    // Normalize incoterm
    const normalizedIncoterm = incoterm.toUpperCase().trim();

    // Fetch incoterm reference
    const { data: incotermRef, error } = await supabase
      .from('incoterms_reference')
      .select('*')
      .eq('code', normalizedIncoterm)
      .maybeSingle();

    if (error || !incotermRef) {
      console.error("Incoterm not found:", normalizedIncoterm);
      return new Response(
        JSON.stringify({ 
          error: `Incoterm inconnu: ${normalizedIncoterm}`,
          valid_incoterms: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse costs_to_quote from JSON
    const costsToQuote: string[] = incotermRef.costs_to_quote || [];
    
    // Determine what's excluded (what seller handles)
    const allCostTypes = [
      'origine_enlevement', 'export_dedouanement', 'fret_principal', 
      'assurance', 'port_destination', 'import_dedouanement', 'livraison_finale'
    ];
    const costsExcluded = allCostTypes.filter(c => !costsToQuote.includes(c));

    // Build responsibility map
    const responsibilityMap: Record<string, 'buyer' | 'seller'> = {
      export_clearance: incotermRef.seller_export_clearance ? 'seller' : 'buyer',
      origin_loading: incotermRef.seller_origin_loading ? 'seller' : 'buyer',
      main_carriage: incotermRef.seller_main_carriage ? 'seller' : 'buyer',
      insurance: incotermRef.seller_main_carriage_insurance ? 'seller' : 'buyer',
      destination_unloading: incotermRef.seller_destination_unloading ? 'seller' : 'buyer',
      import_clearance: incotermRef.seller_import_clearance ? 'seller' : 'buyer',
      destination_delivery: incotermRef.seller_destination_delivery ? 'seller' : 'buyer',
    };

    // CAF calculation
    const cafMethod = incotermRef.caf_calculation_method as 'FOB_PLUS_FREIGHT' | 'INVOICE_VALUE' | 'EXW_PLUS_ALL';
    let estimatedCafValue: number | null = null;
    const cafComponents: CafComponent[] = [];

    if (cafMethod === 'FOB_PLUS_FREIGHT') {
      cafComponents.push({ name: 'FOB Value', value: fob_value || null, currency, included: true });
      cafComponents.push({ name: 'Freight', value: freight_cost || null, currency, included: true });
      cafComponents.push({ name: 'Insurance', value: insurance_cost || null, currency, included: true });
      
      if (fob_value) {
        estimatedCafValue = fob_value + (freight_cost || 0) + (insurance_cost || 0);
      }
    } else if (cafMethod === 'INVOICE_VALUE') {
      cafComponents.push({ name: 'Invoice Value (CIF/CIP)', value: fob_value || null, currency, included: true });
      estimatedCafValue = fob_value || null;
    } else if (cafMethod === 'EXW_PLUS_ALL') {
      cafComponents.push({ name: 'EXW Value', value: fob_value || null, currency, included: true });
      cafComponents.push({ name: 'Origin Costs', value: null, currency, included: true });
      cafComponents.push({ name: 'Freight', value: freight_cost || null, currency, included: true });
      cafComponents.push({ name: 'Insurance', value: insurance_cost || null, currency, included: true });
    }

    // Build quotation guidance
    const quotationGuidance = buildQuotationGuidance(incotermRef, costsToQuote);

    const result: IncotermResult = {
      incoterm: {
        code: incotermRef.code,
        name: incotermRef.name,
        groupe: incotermRef.groupe,
        description_fr: incotermRef.description_fr,
        description_en: incotermRef.description_en,
        maritime_only: incotermRef.maritime_only,
      },
      costs_to_quote: costsToQuote,
      costs_excluded: costsExcluded,
      caf_calculation: {
        method: cafMethod,
        estimated_caf_value: estimatedCafValue,
        components: cafComponents,
        notes: getCafNotes(cafMethod),
      },
      responsibility_map: responsibilityMap,
      quotation_guidance: quotationGuidance,
    };

    console.log("Arbitrage Incoterm result:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Arbitrage Incoterm error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur d'arbitrage" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildQuotationGuidance(incotermRef: any, costsToQuote: string[]): QuotationGuidance {
  const costLabels: Record<string, { fr: string; en: string }> = {
    origine_enlevement: { fr: "Enlèvement origine", en: "Origin pickup" },
    export_dedouanement: { fr: "Dédouanement export", en: "Export clearance" },
    fret_principal: { fr: "Fret maritime/aérien", en: "Main freight" },
    assurance: { fr: "Assurance transport", en: "Transport insurance" },
    port_destination: { fr: "Frais portuaires Dakar (THC, DAM, etc.)", en: "Dakar port charges (THC, DAM, etc.)" },
    import_dedouanement: { fr: "Dédouanement import (DD, TVA, etc.)", en: "Import clearance (duties, VAT, etc.)" },
    livraison_finale: { fr: "Transport/livraison finale", en: "Final delivery" },
  };

  const whatToIncludeFr: string[] = [];
  const whatToIncludeEn: string[] = [];
  const whatSellerHandlesFr: string[] = [];
  const whatSellerHandlesEn: string[] = [];

  for (const [key, labels] of Object.entries(costLabels)) {
    if (costsToQuote.includes(key)) {
      whatToIncludeFr.push(`✅ ${labels.fr}`);
      whatToIncludeEn.push(`✅ ${labels.en}`);
    } else {
      whatSellerHandlesFr.push(`🚫 ${labels.fr} (vendeur)`);
      whatSellerHandlesEn.push(`🚫 ${labels.en} (seller)`);
    }
  }

  // Add vigilance points based on groupe
  const vigilancePointsFr: string[] = [];
  const vigilancePointsEn: string[] = [];

  switch (incotermRef.groupe) {
    case 'E':
      vigilancePointsFr.push("⚠️ EXW = Totalité des frais à votre charge");
      vigilancePointsFr.push("📋 Vérifier si le client peut gérer le dédouanement export");
      vigilancePointsEn.push("⚠️ EXW = All costs are your responsibility");
      vigilancePointsEn.push("📋 Check if customer can handle export clearance");
      break;
    case 'F':
      vigilancePointsFr.push("📦 Groupe F = Fret principal à coter");
      vigilancePointsFr.push("🔒 Assurance transport à proposer (facultative mais recommandée)");
      vigilancePointsEn.push("📦 Group F = Main freight to quote");
      vigilancePointsEn.push("🔒 Transport insurance to offer (optional but recommended)");
      break;
    case 'C':
      vigilancePointsFr.push("✈️ Groupe C = Fret inclus dans prix vendeur");
      vigilancePointsFr.push("📍 Seuls les frais locaux Dakar à coter");
      if (incotermRef.code === 'CFR' || incotermRef.code === 'CPT') {
        vigilancePointsFr.push("🔒 Assurance NON incluse - À proposer impérativement");
        vigilancePointsEn.push("🔒 Insurance NOT included - Must propose");
      }
      vigilancePointsEn.push("✈️ Group C = Freight included in seller price");
      vigilancePointsEn.push("📍 Only Dakar local charges to quote");
      break;
    case 'D':
      vigilancePointsFr.push("🏁 Groupe D = Vendeur assume risques jusqu'à destination");
      if (incotermRef.code === 'DDP') {
        vigilancePointsFr.push("💰 DDP = ZÉRO frais pour le client final");
        vigilancePointsFr.push("📧 Facturer l'agent exportateur/vendeur, pas l'importateur");
        vigilancePointsEn.push("💰 DDP = ZERO cost for final customer");
        vigilancePointsEn.push("📧 Invoice the exporter/seller agent, not the importer");
      } else {
        vigilancePointsFr.push("🛃 Dédouanement import reste à la charge de l'acheteur");
        vigilancePointsEn.push("🛃 Import clearance remains buyer's responsibility");
      }
      vigilancePointsEn.push("🏁 Group D = Seller bears risks to destination");
      break;
  }

  // Maritime-only warning
  if (incotermRef.maritime_only) {
    vigilancePointsFr.push("🚢 Incoterm MARITIME uniquement - Pas pour transport aérien ou routier");
    vigilancePointsEn.push("🚢 MARITIME only Incoterm - Not for air or road transport");
  }

  return {
    what_to_include_fr: whatToIncludeFr,
    what_to_include_en: whatToIncludeEn,
    what_seller_handles_fr: whatSellerHandlesFr,
    what_seller_handles_en: whatSellerHandlesEn,
    vigilance_points_fr: vigilancePointsFr,
    vigilance_points_en: vigilancePointsEn,
  };
}

function getCafNotes(method: string): string {
  switch (method) {
    case 'FOB_PLUS_FREIGHT':
      return "Valeur CAF = FOB + Fret + Assurance (0.5% si non spécifiée)";
    case 'INVOICE_VALUE':
      return "Valeur CAF = Valeur facture CIF/CIP (fret déjà inclus)";
    case 'EXW_PLUS_ALL':
      return "Valeur CAF = EXW + tous frais jusqu'à destination";
    default:
      return "";
  }
}
