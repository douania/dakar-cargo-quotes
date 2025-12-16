import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CalculationRequest {
  code: string;
  caf_value: number;
  origin?: string;
  is_cge?: boolean;
  is_cedeao?: boolean;
  quantity?: number;
}

interface DutyBreakdown {
  name: string;
  code: string;
  rate: number;
  base: number;
  amount: number;
  notes?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const body: CalculationRequest = await req.json();
    const { code, caf_value, origin, is_cge = false, is_cedeao = false, quantity = 1 } = body;

    if (!code || !caf_value) {
      return new Response(
        JSON.stringify({ error: 'code and caf_value are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Calculate duties for:', { code, caf_value, origin, is_cge, is_cedeao });

    // Normalize code for lookup
    const normalizedCode = code.replace(/[\.\s]/g, '');

    // Fetch HS code data
    const { data: hsCode, error: hsError } = await supabase
      .from('hs_codes')
      .select('*')
      .or(`code.eq.${code},code_normalized.eq.${normalizedCode}`)
      .limit(1)
      .maybeSingle();

    if (hsError) {
      console.error('HS code lookup error:', hsError);
      return new Response(
        JSON.stringify({ error: 'Failed to lookup HS code' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hsCode) {
      return new Response(
        JSON.stringify({ 
          error: 'HS code not found',
          code,
          suggestion: 'Vérifiez le code SH ou consultez la nomenclature douanière'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch current tax rates
    const { data: taxRates } = await supabase
      .from('tax_rates')
      .select('*')
      .eq('is_active', true);

    const getTaxRate = (taxCode: string): number => {
      const rate = taxRates?.find(t => t.code === taxCode);
      return rate ? parseFloat(rate.rate) : 0;
    };

    // Calculate duties step by step
    const breakdown: DutyBreakdown[] = [];
    let runningBase = caf_value;

    // 1. Droit de Douane (DD)
    const ddRate = parseFloat(hsCode.dd) || 0;
    const ddAmount = caf_value * (ddRate / 100);
    breakdown.push({
      name: 'Droit de Douane',
      code: 'DD',
      rate: ddRate,
      base: caf_value,
      amount: ddAmount,
    });

    // 2. Surtaxe (if applicable)
    const surtaxeRate = parseFloat(hsCode.surtaxe) || 0;
    if (surtaxeRate > 0) {
      const surtaxeAmount = caf_value * (surtaxeRate / 100);
      breakdown.push({
        name: 'Surtaxe',
        code: 'SURTAXE',
        rate: surtaxeRate,
        base: caf_value,
        amount: surtaxeAmount,
      });
    }

    // 3. Redevance Statistique (RS)
    const rsRate = parseFloat(hsCode.rs) || 1;
    const rsAmount = caf_value * (rsRate / 100);
    breakdown.push({
      name: 'Redevance Statistique',
      code: 'RS',
      rate: rsRate,
      base: caf_value,
      amount: rsAmount,
    });

    // 4. Prélèvement Communautaire de Solidarité (PCS)
    const pcsRate = parseFloat(hsCode.pcs) || 0.8;
    const pcsAmount = caf_value * (pcsRate / 100);
    breakdown.push({
      name: 'Prélèvement Communautaire de Solidarité',
      code: 'PCS',
      rate: pcsRate,
      base: caf_value,
      amount: pcsAmount,
    });

    // 5. Prélèvement CEDEAO (PCC) - only for non-CEDEAO origins
    const pccRate = parseFloat(hsCode.pcc) || 0.5;
    const pccAmount = is_cedeao ? 0 : caf_value * (pccRate / 100);
    breakdown.push({
      name: 'Prélèvement CEDEAO',
      code: 'PCC',
      rate: is_cedeao ? 0 : pccRate,
      base: caf_value,
      amount: pccAmount,
      notes: is_cedeao ? 'Exonéré (origine CEDEAO)' : undefined,
    });

    // 6. COSEC
    const cosecRate = parseFloat(hsCode.cosec) || 0.4;
    const cosecAmount = caf_value * (cosecRate / 100);
    breakdown.push({
      name: 'COSEC',
      code: 'COSEC',
      rate: cosecRate,
      base: caf_value,
      amount: cosecAmount,
    });

    // Calculate intermediary base for taxes
    const baseTaxeIntermediaire = caf_value + ddAmount + rsAmount;

    // 7. Taxe Intérieure (TIN) if applicable
    const tinRate = parseFloat(hsCode.tin) || 0;
    let tinAmount = 0;
    if (tinRate > 0) {
      tinAmount = baseTaxeIntermediaire * (tinRate / 100);
      breakdown.push({
        name: 'Taxe Intérieure',
        code: 'TIN',
        rate: tinRate,
        base: baseTaxeIntermediaire,
        amount: tinAmount,
      });
    }

    // 8. Taxe Conjoncturelle (TCI) if applicable
    const tciRate = parseFloat(hsCode.t_conj) || 0;
    let tciAmount = 0;
    if (tciRate > 0) {
      tciAmount = caf_value * (tciRate / 100);
      breakdown.push({
        name: 'Taxe Conjoncturelle à l\'Importation',
        code: 'TCI',
        rate: tciRate,
        base: caf_value,
        amount: tciAmount,
        notes: 'Protection produits locaux (sucre, huiles)',
      });
    }

    // 9. Taxe Environnementale Véhicules (TEV) if applicable
    const tevRate = parseFloat(hsCode.tev) || 0;
    if (tevRate > 0) {
      const tevAmount = caf_value * (tevRate / 100);
      breakdown.push({
        name: 'Taxe Environnementale Véhicules',
        code: 'TEV',
        rate: tevRate,
        base: caf_value,
        amount: tevAmount,
      });
    }

    // 10. Other special taxes
    const tPastRate = parseFloat(hsCode.t_past) || 0;
    if (tPastRate > 0) {
      breakdown.push({
        name: 'Taxe Pastorale',
        code: 'T_PAST',
        rate: tPastRate,
        base: caf_value,
        amount: caf_value * (tPastRate / 100),
      });
    }

    const tParaRate = parseFloat(hsCode.t_para) || 0;
    if (tParaRate > 0) {
      breakdown.push({
        name: 'Taxe Parafiscale',
        code: 'T_PARA',
        rate: tParaRate,
        base: caf_value,
        amount: caf_value * (tParaRate / 100),
      });
    }

    const tCimentRate = parseFloat(hsCode.t_ciment) || 0;
    if (tCimentRate > 0) {
      breakdown.push({
        name: 'Taxe sur le Ciment',
        code: 'T_CIMENT',
        rate: tCimentRate,
        base: caf_value,
        amount: caf_value * (tCimentRate / 100),
      });
    }

    // Calculate TVA base
    const baseTVA = caf_value + ddAmount + rsAmount + tinAmount + tciAmount;

    // 11. TVA
    const tvaRate = parseFloat(hsCode.tva) || 18;
    const tvaAmount = tvaRate > 0 ? baseTVA * (tvaRate / 100) : 0;
    breakdown.push({
      name: 'Taxe sur la Valeur Ajoutée',
      code: 'TVA',
      rate: tvaRate,
      base: baseTVA,
      amount: tvaAmount,
      notes: tvaRate === 0 ? 'Exonéré' : undefined,
    });

    // 12. Acompte BIC (only for non-CGE importers)
    const bicApplicable = hsCode.bic && !is_cge;
    const bicRate = bicApplicable ? 3 : 0;
    const bicAmount = bicApplicable ? baseTVA * (bicRate / 100) : 0;
    breakdown.push({
      name: 'Acompte BIC',
      code: 'BIC',
      rate: bicRate,
      base: baseTVA,
      amount: bicAmount,
      notes: is_cge ? 'Exonéré (entreprise CGE)' : (!hsCode.bic ? 'Non applicable' : undefined),
    });

    // Calculate totals
    const totalDroitsDouane = breakdown
      .filter(d => ['DD', 'SURTAXE', 'RS', 'PCS', 'PCC', 'COSEC'].includes(d.code))
      .reduce((sum, d) => sum + d.amount, 0);

    const totalTaxesInterieures = breakdown
      .filter(d => ['TIN', 'TCI', 'TEV', 'T_PAST', 'T_PARA', 'T_CIMENT'].includes(d.code))
      .reduce((sum, d) => sum + d.amount, 0);

    const totalTVA = tvaAmount;
    const totalBIC = bicAmount;
    const grandTotal = breakdown.reduce((sum, d) => sum + d.amount, 0);

    // Format response
    const response = {
      success: true,
      hs_code: {
        code: hsCode.code,
        description: hsCode.description,
        chapter: hsCode.chapter,
        mercurialis: hsCode.mercurialis,
      },
      input: {
        caf_value,
        origin: origin || 'Non spécifié',
        is_cge,
        is_cedeao,
        quantity,
      },
      breakdown,
      totals: {
        droits_douane: Math.round(totalDroitsDouane),
        taxes_interieures: Math.round(totalTaxesInterieures),
        tva: Math.round(totalTVA),
        acompte_bic: Math.round(totalBIC),
        total_debours: Math.round(grandTotal),
        valeur_imposable: Math.round(caf_value + grandTotal),
      },
      formatted: {
        caf_value: formatCurrency(caf_value),
        total_debours: formatCurrency(grandTotal),
        valeur_imposable: formatCurrency(caf_value + grandTotal),
      },
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: unknown) {
    console.error('Calculate duties error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount)) + ' FCFA';
}
