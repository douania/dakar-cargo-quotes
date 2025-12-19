import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CoherenceInput {
  weight_kg?: number;
  volume_cbm?: number;
  container_type?: string;
  cargo_description?: string;
  hs_code?: string;
}

interface CoherenceResult {
  is_coherent: boolean;
  density_kg_cbm: number | null;
  alerts: Alert[];
  ctu_code_check_needed: boolean;
  recommended_container: string | null;
  container_specs: ContainerSpecs | null;
  validation_details: ValidationDetails;
}

interface Alert {
  type: 'overweight' | 'overvolume' | 'density_high' | 'density_low' | 'container_mismatch';
  severity: 'warning' | 'critical';
  message_fr: string;
  message_en: string;
  ctu_reference?: string;
}

interface ContainerSpecs {
  code: string;
  max_payload_kg: number;
  volume_cbm: number;
  evp_equivalent: number;
}

interface ValidationDetails {
  weight_check: 'ok' | 'warning' | 'critical' | 'not_checked';
  volume_check: 'ok' | 'warning' | 'critical' | 'not_checked';
  density_check: 'ok' | 'warning' | 'critical' | 'not_checked';
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: CoherenceInput = await req.json();
    console.log("Audit cohérence input:", JSON.stringify(input));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { weight_kg, volume_cbm, container_type, cargo_description } = input;

    const alerts: Alert[] = [];
    let is_coherent = true;
    let ctu_code_check_needed = false;
    let recommended_container: string | null = null;
    let container_specs: ContainerSpecs | null = null;
    let density_kg_cbm: number | null = null;

    const validation_details: ValidationDetails = {
      weight_check: 'not_checked',
      volume_check: 'not_checked',
      density_check: 'not_checked',
    };

    // Fetch container specifications if container type provided
    if (container_type) {
      // Normalize container type to our format
      const normalizedType = normalizeContainerType(container_type);
      
      const { data: specs } = await supabase
        .from('container_specifications')
        .select('*')
        .eq('code', normalizedType)
        .maybeSingle();

      if (specs) {
        container_specs = {
          code: specs.code,
          max_payload_kg: specs.max_payload_kg,
          volume_cbm: specs.volume_cbm,
          evp_equivalent: specs.evp_equivalent,
        };

        // Weight validation
        if (weight_kg) {
          if (weight_kg > specs.max_payload_kg) {
            is_coherent = false;
            ctu_code_check_needed = true;
            validation_details.weight_check = 'critical';
            alerts.push({
              type: 'overweight',
              severity: 'critical',
              message_fr: `⚠️ SURCHARGE CRITIQUE: ${weight_kg.toLocaleString('fr-FR')} kg dépasse la charge utile max de ${specs.max_payload_kg.toLocaleString('fr-FR')} kg pour ${specs.code}`,
              message_en: `⚠️ CRITICAL OVERWEIGHT: ${weight_kg.toLocaleString('en-US')} kg exceeds max payload of ${specs.max_payload_kg.toLocaleString('en-US')} kg for ${specs.code}`,
              ctu_reference: 'CTU Code Section 4.1 - Limites de charge',
            });
          } else if (weight_kg > specs.max_payload_kg * 0.95) {
            validation_details.weight_check = 'warning';
            alerts.push({
              type: 'overweight',
              severity: 'warning',
              message_fr: `⚡ Poids proche de la limite: ${weight_kg.toLocaleString('fr-FR')} kg / ${specs.max_payload_kg.toLocaleString('fr-FR')} kg max (${Math.round(weight_kg/specs.max_payload_kg*100)}%)`,
              message_en: `⚡ Weight near limit: ${weight_kg.toLocaleString('en-US')} kg / ${specs.max_payload_kg.toLocaleString('en-US')} kg max (${Math.round(weight_kg/specs.max_payload_kg*100)}%)`,
            });
          } else {
            validation_details.weight_check = 'ok';
          }
        }

        // Volume validation
        if (volume_cbm) {
          if (volume_cbm > specs.volume_cbm) {
            is_coherent = false;
            validation_details.volume_check = 'critical';
            alerts.push({
              type: 'overvolume',
              severity: 'critical',
              message_fr: `⚠️ VOLUME EXCÉDENTAIRE: ${volume_cbm} m³ dépasse la capacité de ${specs.volume_cbm} m³ pour ${specs.code}`,
              message_en: `⚠️ VOLUME EXCEEDED: ${volume_cbm} cbm exceeds capacity of ${specs.volume_cbm} cbm for ${specs.code}`,
              ctu_reference: 'CTU Code Section 3.2 - Dimensions conteneurs',
            });
          } else if (volume_cbm > specs.volume_cbm * 0.95) {
            validation_details.volume_check = 'warning';
            alerts.push({
              type: 'overvolume',
              severity: 'warning',
              message_fr: `⚡ Volume proche de la limite: ${volume_cbm} m³ / ${specs.volume_cbm} m³ max`,
              message_en: `⚡ Volume near limit: ${volume_cbm} cbm / ${specs.volume_cbm} cbm max`,
            });
          } else {
            validation_details.volume_check = 'ok';
          }
        }

        // Density validation (poids/volume ratio)
        if (weight_kg && volume_cbm && volume_cbm > 0) {
          density_kg_cbm = Math.round(weight_kg / volume_cbm);
          
          if (density_kg_cbm > specs.normal_density_max_kg_cbm) {
            ctu_code_check_needed = true;
            validation_details.density_check = 'critical';
            alerts.push({
              type: 'density_high',
              severity: 'critical',
              message_fr: `⚠️ DENSITÉ ANORMALE: ${density_kg_cbm} kg/m³ (normal: ${specs.normal_density_min_kg_cbm}-${specs.normal_density_max_kg_cbm} kg/m³) - Vérifier le cubage ou risque de surcharge!`,
              message_en: `⚠️ ABNORMAL DENSITY: ${density_kg_cbm} kg/cbm (normal: ${specs.normal_density_min_kg_cbm}-${specs.normal_density_max_kg_cbm} kg/cbm) - Check cubage or overload risk!`,
              ctu_reference: 'CTU Code Section 4.2 - Répartition des masses',
            });
          } else if (density_kg_cbm < specs.normal_density_min_kg_cbm * 0.5) {
            validation_details.density_check = 'warning';
            alerts.push({
              type: 'density_low',
              severity: 'warning',
              message_fr: `💨 Densité très faible: ${density_kg_cbm} kg/m³ - Marchandise légère/volumineuse, vérifier calage`,
              message_en: `💨 Very low density: ${density_kg_cbm} kg/cbm - Light/bulky cargo, check securing`,
              ctu_reference: 'CTU Code Section 5 - Arrimage et calage',
            });
          } else {
            validation_details.density_check = 'ok';
          }
        }
      }
    }

    // Recommend container if weight and volume provided but no container specified
    if (weight_kg && volume_cbm && !container_type) {
      const { data: allSpecs } = await supabase
        .from('container_specifications')
        .select('*')
        .eq('type', 'DRY')
        .order('volume_cbm');

      if (allSpecs) {
        // Find smallest container that fits both weight and volume
        for (const spec of allSpecs) {
          if (weight_kg <= spec.max_payload_kg && volume_cbm <= spec.volume_cbm) {
            recommended_container = spec.code;
            break;
          }
        }

        if (!recommended_container && allSpecs.length > 0) {
          // Nothing fits - recommend largest and flag issue
          recommended_container = allSpecs[allSpecs.length - 1].code;
          alerts.push({
            type: 'container_mismatch',
            severity: 'warning',
            message_fr: `📦 Aucun conteneur standard ne convient - Envisager LCL ou flat rack`,
            message_en: `📦 No standard container fits - Consider LCL or flat rack`,
          });
        }
      }
    }

    // Check for dangerous goods keywords in cargo description
    if (cargo_description) {
      const dangerousKeywords = [
        'inflammable', 'flammable', 'explosif', 'explosive', 'corrosif', 'corrosive',
        'toxique', 'toxic', 'radioactif', 'radioactive', 'gaz', 'gas', 'chimique',
        'chemical', 'batterie', 'battery', 'lithium', 'aérosol', 'aerosol', 'peinture',
        'paint', 'acide', 'acid', 'ammoniac', 'ammonia', 'pesticide'
      ];

      const lowerDesc = cargo_description.toLowerCase();
      const foundDangerous = dangerousKeywords.filter(k => lowerDesc.includes(k));

      if (foundDangerous.length > 0) {
        ctu_code_check_needed = true;
        alerts.push({
          type: 'density_high', // Reusing type for IMO alert
          severity: 'warning',
          message_fr: `☢️ Marchandise potentiellement dangereuse détectée (${foundDangerous.join(', ')}) - Vérifier classification IMO`,
          message_en: `☢️ Potentially dangerous goods detected (${foundDangerous.join(', ')}) - Check IMO classification`,
          ctu_reference: 'CTU Code Annexe 3 - Marchandises dangereuses',
        });
      }
    }

    const result: CoherenceResult = {
      is_coherent,
      density_kg_cbm,
      alerts,
      ctu_code_check_needed,
      recommended_container,
      container_specs,
      validation_details,
    };

    console.log("Audit cohérence result:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Audit cohérence error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur d'audit" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper function to normalize container type strings
function normalizeContainerType(input: string): string {
  const normalized = input.toUpperCase().replace(/['\s-]/g, '');
  
  // Common mappings
  const mappings: Record<string, string> = {
    '20': '20DV',
    '20FT': '20DV',
    '20GP': '20DV',
    '20DC': '20DV',
    '20STD': '20DV',
    '40': '40DV',
    '40FT': '40DV',
    '40GP': '40DV',
    '40DC': '40DV',
    '40STD': '40DV',
    '40HQ': '40HC',
    '40HIGHCUBE': '40HC',
    '20REEFER': '20RF',
    '40REEFER': '40RF',
    '40REEFERHC': '40RH',
    '20OPENTOP': '20OT',
    '40OPENTOP': '40OT',
    '20FLATRACK': '20FR',
    '40FLATRACK': '40FR',
    '20TANK': '20TK',
  };

  return mappings[normalized] || normalized;
}
