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
  regime_code?: string;
}

interface DutyBreakdown {
  name: string;
  code: string;
  rate: number;
  base: number;
  amount: number;
  notes?: string;
}

interface RegimeFlags {
  dd: boolean;
  stx: boolean;
  rs: boolean;
  tin: boolean;
  tva: boolean;
  cosec: boolean;
  pcs: boolean;
  pcc: boolean;
  tpast: boolean;
  ta: boolean;
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
    const { code, caf_value, origin, is_cge = false, is_cedeao = false, quantity = 1, regime_code } = body;

    if (!code || !caf_value) {
      return new Response(
        JSON.stringify({ error: 'code and caf_value are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Calculate duties for:', { code, caf_value, origin, is_cge, is_cedeao, regime_code });

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

    // Fetch customs regime if specified
    let regimeFlags: RegimeFlags = {
      dd: true, stx: true, rs: true, tin: true, tva: true,
      cosec: true, pcs: true, pcc: true, tpast: true, ta: true
    };
    let regimeName: string | null = null;

    if (regime_code) {
      const { data: regime, error: regimeError } = await supabase
        .from('customs_regimes')
        .select('*')
        .eq('code', regime_code)
        .eq('is_active', true)
        .maybeSingle();

      if (regimeError) {
        console.error('Regime lookup error:', regimeError);
      } else if (regime) {
        regimeFlags = {
          dd: regime.dd ?? false,
          stx: regime.stx ?? false,
          rs: regime.rs ?? false,
          tin: regime.tin ?? false,
          tva: regime.tva ?? false,
          cosec: regime.cosec ?? false,
          pcs: regime.pcs ?? false,
          pcc: regime.pcc ?? false,
          tpast: regime.tpast ?? false,
          ta: regime.ta ?? false,
        };
        regimeName = regime.name;
        console.log('Applied regime:', regime_code, regimeName, regimeFlags);
      } else {
        console.warn('Regime not found:', regime_code);
      }
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
    const ddRate = regimeFlags.dd ? (parseFloat(hsCode.dd) || 0) : 0;
    const ddAmount = caf_value * (ddRate / 100);
    breakdown.push({
      name: 'Droit de Douane',
      code: 'DD',
      rate: ddRate,
      base: caf_value,
      amount: ddAmount,
      notes: !regimeFlags.dd ? `Exonéré (régime ${regime_code})` : undefined,
    });

    // 2. Surtaxe (STX) - if applicable and regime allows
    const surtaxeRate = regimeFlags.stx ? (parseFloat(hsCode.surtaxe) || 0) : 0;
    if (surtaxeRate > 0 || !regimeFlags.stx) {
      const surtaxeAmount = caf_value * (surtaxeRate / 100);
      breakdown.push({
        name: 'Surtaxe',
        code: 'SURTAXE',
        rate: surtaxeRate,
        base: caf_value,
        amount: surtaxeAmount,
        notes: !regimeFlags.stx ? `Exonéré (régime ${regime_code})` : undefined,
      });
    }

    // 3. Redevance Statistique (RS)
    const rsRate = regimeFlags.rs ? (parseFloat(hsCode.rs) || 1) : 0;
    const rsAmount = caf_value * (rsRate / 100);
    breakdown.push({
      name: 'Redevance Statistique',
      code: 'RS',
      rate: rsRate,
      base: caf_value,
      amount: rsAmount,
      notes: !regimeFlags.rs ? `Exonéré (régime ${regime_code})` : undefined,
    });

    // 4. Prélèvement Communautaire de Solidarité (PCS)
    const pcsRate = regimeFlags.pcs ? (parseFloat(hsCode.pcs) || 0.8) : 0;
    const pcsAmount = caf_value * (pcsRate / 100);
    breakdown.push({
      name: 'Prélèvement Communautaire de Solidarité',
      code: 'PCS',
      rate: pcsRate,
      base: caf_value,
      amount: pcsAmount,
      notes: !regimeFlags.pcs ? `Exonéré (régime ${regime_code})` : undefined,
    });

    // 5. Prélèvement CEDEAO (PCC) - only for non-CEDEAO origins and if regime allows
    let pccRate = 0;
    let pccNotes: string | undefined;
    if (!regimeFlags.pcc) {
      pccRate = 0;
      pccNotes = `Exonéré (régime ${regime_code})`;
    } else if (is_cedeao) {
      pccRate = 0;
      pccNotes = 'Exonéré (origine CEDEAO)';
    } else {
      pccRate = parseFloat(hsCode.pcc) || 0.5;
    }
    const pccAmount = caf_value * (pccRate / 100);
    breakdown.push({
      name: 'Prélèvement CEDEAO',
      code: 'PCC',
      rate: pccRate,
      base: caf_value,
      amount: pccAmount,
      notes: pccNotes,
    });

    // 6. COSEC
    const cosecRate = regimeFlags.cosec ? (parseFloat(hsCode.cosec) || 0.4) : 0;
    const cosecAmount = caf_value * (cosecRate / 100);
    breakdown.push({
      name: 'COSEC',
      code: 'COSEC',
      rate: cosecRate,
      base: caf_value,
      amount: cosecAmount,
      notes: !regimeFlags.cosec ? `Exonéré (régime ${regime_code})` : undefined,
    });

    // Calculate intermediary base for taxes
    const baseTaxeIntermediaire = caf_value + ddAmount + rsAmount;

    // 7. Taxe Intérieure (TIN) if applicable and regime allows
    const tinRate = regimeFlags.tin ? (parseFloat(hsCode.tin) || 0) : 0;
    let tinAmount = 0;
    if (tinRate > 0 || (hsCode.tin > 0 && !regimeFlags.tin)) {
      tinAmount = baseTaxeIntermediaire * (tinRate / 100);
      breakdown.push({
        name: 'Taxe Intérieure',
        code: 'TIN',
        rate: tinRate,
        base: baseTaxeIntermediaire,
        amount: tinAmount,
        notes: !regimeFlags.tin ? `Exonéré (régime ${regime_code})` : undefined,
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

    // 10. Taxe Pastorale (TPAST) if applicable and regime allows
    const tPastRate = regimeFlags.tpast ? (parseFloat(hsCode.t_past) || 0) : 0;
    if (tPastRate > 0 || (hsCode.t_past > 0 && !regimeFlags.tpast)) {
      breakdown.push({
        name: 'Taxe Pastorale',
        code: 'T_PAST',
        rate: tPastRate,
        base: caf_value,
        amount: caf_value * (tPastRate / 100),
        notes: !regimeFlags.tpast ? `Exonéré (régime ${regime_code})` : undefined,
      });
    }

    // 11. Taxe Parafiscale (T_PARA)
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

    // 12. Taxe sur le Ciment (T_CIMENT)
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

    // 13. TVA - if regime allows
    const tvaRate = regimeFlags.tva ? (parseFloat(hsCode.tva) || 18) : 0;
    const tvaAmount = baseTVA * (tvaRate / 100);
    let tvaNotes: string | undefined;
    if (!regimeFlags.tva) {
      tvaNotes = `Exonéré (régime ${regime_code})`;
    } else if (tvaRate === 0) {
      tvaNotes = 'Exonéré';
    }
    breakdown.push({
      name: 'Taxe sur la Valeur Ajoutée',
      code: 'TVA',
      rate: tvaRate,
      base: baseTVA,
      amount: tvaAmount,
      notes: tvaNotes,
    });

    // 14. Acompte BIC (only for non-CGE importers)
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
      regime: regime_code ? {
        code: regime_code,
        name: regimeName,
        flags: regimeFlags,
      } : null,
      input: {
        caf_value,
        origin: origin || 'Non spécifié',
        is_cge,
        is_cedeao,
        quantity,
        regime_code: regime_code || null,
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
