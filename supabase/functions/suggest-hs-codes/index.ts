import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface HsCodeSuggestion {
  item: string;
  hs_code: string;
  description: string | null;
  dd: number;
  rs: number;
  pcs: number;
  pcc: number;
  cosec: number;
  tva: number;
  confidence: 'high' | 'medium' | 'low';
  estimated_total_rate: number;
}

interface SuggestHsCodesRequest {
  cargo_description: string;
  destination?: string;
  context?: string;
}

// List of common cargo items with known HS codes for quick matching
const COMMON_ITEMS_HS_MAP: Record<string, { hs_prefix: string; keywords: string[] }> = {
  // Vehicles
  "vehicles_cars": { hs_prefix: "8703", keywords: ["car", "voiture", "sedan", "suv", "pick-up", "pickup", "vehicle", "vehicule", "automobile"] },
  "vehicles_trucks": { hs_prefix: "8704", keywords: ["truck", "camion", "lorry", "cargo vehicle"] },
  // Auto parts
  "auto_parts": { hs_prefix: "8708", keywords: ["spare parts", "pièces détachées", "auto parts", "car parts", "pièces auto"] },
  // Tires
  "tires": { hs_prefix: "4011", keywords: ["tire", "tyre", "pneu", "pneumatique"] },
  // Paper products
  "tissue_paper": { hs_prefix: "4818", keywords: ["tissue", "mouchoir", "paper towel", "toilet paper", "napkin", "serviette"] },
  // Food items
  "rice": { hs_prefix: "1006", keywords: ["rice", "riz"] },
  "sugar": { hs_prefix: "1701", keywords: ["sugar", "sucre"] },
  "flour": { hs_prefix: "1101", keywords: ["flour", "farine"] },
  // Electronics
  "phones": { hs_prefix: "8517", keywords: ["phone", "telephone", "mobile", "smartphone"] },
  "computers": { hs_prefix: "8471", keywords: ["computer", "ordinateur", "laptop", "pc"] },
  // Machinery
  "machinery": { hs_prefix: "8479", keywords: ["machine", "machinery", "equipment", "équipement"] },
  // Textiles
  "clothing": { hs_prefix: "6203", keywords: ["clothing", "vêtement", "clothes", "garment"] },
  // Furniture
  "furniture": { hs_prefix: "9403", keywords: ["furniture", "meuble", "table", "chair", "chaise"] },
  // Construction
  "cement": { hs_prefix: "2523", keywords: ["cement", "ciment"] },
  "steel": { hs_prefix: "7208", keywords: ["steel", "acier", "iron", "fer"] },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cargo_description, destination, context }: SuggestHsCodesRequest = await req.json();

    if (!cargo_description || cargo_description.trim().length < 3) {
      return new Response(
        JSON.stringify({ success: false, error: "cargo_description is required (min 3 chars)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log(`[suggest-hs-codes] Processing: "${cargo_description}"`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Use AI to parse cargo description into individual items and map to HS codes
    const aiSuggestions = await getAiHsCodeSuggestions(cargo_description, destination, LOVABLE_API_KEY);
    console.log(`[suggest-hs-codes] AI suggested ${aiSuggestions.length} items`);

    // Step 2: For each AI suggestion, look up the actual HS code in our database
    const enrichedSuggestions: HsCodeSuggestion[] = [];

    for (const aiItem of aiSuggestions) {
      // Try to find exact or partial match in hs_codes table
      const hsCodeData = await findHsCodeInDatabase(supabase, aiItem.hs_code);
      
      if (hsCodeData) {
        // Calculate estimated total duty rate
        const totalRate = (hsCodeData.dd || 0) + (hsCodeData.rs || 0) + 
                          (hsCodeData.pcs || 0) + (hsCodeData.pcc || 0) + 
                          (hsCodeData.cosec || 0) + (hsCodeData.tva || 0);
        
        enrichedSuggestions.push({
          item: aiItem.item,
          hs_code: hsCodeData.code,
          description: hsCodeData.description,
          dd: hsCodeData.dd || 0,
          rs: hsCodeData.rs || 0,
          pcs: hsCodeData.pcs || 0,
          pcc: hsCodeData.pcc || 0,
          cosec: hsCodeData.cosec || 0,
          tva: hsCodeData.tva || 0,
          confidence: aiItem.confidence,
          estimated_total_rate: totalRate
        });
      } else {
        // Use AI-provided data as fallback with medium confidence
        enrichedSuggestions.push({
          item: aiItem.item,
          hs_code: aiItem.hs_code,
          description: aiItem.description || null,
          dd: aiItem.estimated_dd || 0,
          rs: 1,
          pcs: 0.8,
          pcc: 0.5,
          cosec: 0.4,
          tva: 18,
          confidence: 'low',
          estimated_total_rate: (aiItem.estimated_dd || 0) + 1 + 0.8 + 0.5 + 0.4 + 18
        });
      }
    }

    // Step 3: Generate work scope analysis
    const workScope = analyzeWorkScope(cargo_description, context);

    // Step 4: Generate required documents list
    const requiredDocuments = getRequiredDocuments(enrichedSuggestions, destination);

    // Step 5: Generate regulatory notes
    const regulatoryNotes = getRegulatoryNotes(enrichedSuggestions, destination);

    console.log(`[suggest-hs-codes] Returning ${enrichedSuggestions.length} enriched suggestions`);

    return new Response(
      JSON.stringify({
        success: true,
        cargo_description,
        suggestions: enrichedSuggestions,
        work_scope: workScope,
        required_documents: requiredDocuments,
        regulatory_notes: regulatoryNotes,
        can_provide_dap_offer: enrichedSuggestions.length > 0
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[suggest-hs-codes] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

// Use AI to parse cargo description and suggest HS codes
async function getAiHsCodeSuggestions(
  cargoDescription: string,
  destination: string | undefined,
  apiKey: string | undefined
): Promise<{ item: string; hs_code: string; description?: string; estimated_dd?: number; confidence: 'high' | 'medium' | 'low' }[]> {
  
  if (!apiKey) {
    console.log("[suggest-hs-codes] No API key, using keyword matching fallback");
    return getKeywordBasedSuggestions(cargoDescription);
  }

  const prompt = `Tu es un expert en classification douanière UEMOA/Sénégal.
Analyse cette description de marchandises et identifie CHAQUE article distinct avec son code HS probable.

Description du cargo: "${cargoDescription}"
${destination ? `Destination: ${destination}` : ''}

Pour chaque article identifié, fournis:
1. Le nom de l'article en français
2. Le code HS à 10 chiffres le plus probable (format XX.XX.XX.XX.XX ou XXXXXXXXXX)
3. Ta confiance dans cette classification (high/medium/low)
4. Une brève description du code HS
5. Le taux DD estimé (0, 5, 10, 20, ou 35%)

RÈGLES IMPORTANTES:
- Les véhicules d'occasion (used vehicles) ont généralement DD 20%
- Les pièces auto (spare parts) ont généralement DD 10%
- Les pneus ont généralement DD 10-20%
- Le papier/tissue a généralement DD 20%
- Sépare bien chaque article distinct (ex: "2 pick-up + 1 SUV" = 2 lignes si même code, ou séparés si différents)`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Analyse et classifie: "${cargoDescription}"` }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_cargo_items",
              description: "Classifier les articles de cargo avec codes HS",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        item: { type: "string", description: "Nom de l'article en français" },
                        hs_code: { type: "string", description: "Code HS à 10 chiffres" },
                        description: { type: "string", description: "Description du code HS" },
                        estimated_dd: { type: "number", description: "Taux DD estimé en %" },
                        confidence: { 
                          type: "string", 
                          enum: ["high", "medium", "low"],
                          description: "Niveau de confiance"
                        }
                      },
                      required: ["item", "hs_code", "confidence"]
                    }
                  }
                },
                required: ["items"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "classify_cargo_items" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[suggest-hs-codes] AI API error:", response.status, errorText);
      return getKeywordBasedSuggestions(cargoDescription);
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall || toolCall.function.name !== 'classify_cargo_items') {
      console.error("[suggest-hs-codes] Unexpected AI response, falling back to keywords");
      return getKeywordBasedSuggestions(cargoDescription);
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    return parsed.items || [];

  } catch (error) {
    console.error("[suggest-hs-codes] AI call failed:", error);
    return getKeywordBasedSuggestions(cargoDescription);
  }
}

// Fallback keyword-based HS code suggestions
function getKeywordBasedSuggestions(cargoDescription: string): { item: string; hs_code: string; confidence: 'high' | 'medium' | 'low' }[] {
  const description = cargoDescription.toLowerCase();
  const suggestions: { item: string; hs_code: string; confidence: 'high' | 'medium' | 'low' }[] = [];

  for (const [category, data] of Object.entries(COMMON_ITEMS_HS_MAP)) {
    if (data.keywords.some(keyword => description.includes(keyword.toLowerCase()))) {
      const itemName = category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      suggestions.push({
        item: itemName,
        hs_code: data.hs_prefix + ".00.00.00",
        confidence: 'medium'
      });
    }
  }

  return suggestions;
}

// Look up HS code in database
async function findHsCodeInDatabase(
  supabase: any, 
  hsCode: string
): Promise<{ code: string; description: string | null; dd: number; rs: number; pcs: number; pcc: number; cosec: number; tva: number } | null> {
  
  // Normalize the code (remove dots and spaces)
  const normalizedCode = hsCode.replace(/[.\s]/g, '').padEnd(10, '0').substring(0, 10);
  
  // Try exact match first
  let { data, error } = await supabase
    .from('hs_codes')
    .select('code, description, dd, rs, pcs, pcc, cosec, tva')
    .eq('code_normalized', normalizedCode)
    .limit(1)
    .single();

  if (data) return data;

  // Try prefix match (first 8 digits)
  const prefix8 = normalizedCode.substring(0, 8);
  ({ data, error } = await supabase
    .from('hs_codes')
    .select('code, description, dd, rs, pcs, pcc, cosec, tva')
    .like('code_normalized', `${prefix8}%`)
    .limit(1)
    .single());

  if (data) return data;

  // Try prefix match (first 6 digits)
  const prefix6 = normalizedCode.substring(0, 6);
  ({ data, error } = await supabase
    .from('hs_codes')
    .select('code, description, dd, rs, pcs, pcc, cosec, tva')
    .like('code_normalized', `${prefix6}%`)
    .limit(1)
    .single());

  if (data) return data;

  // Try prefix match (first 4 digits - chapter level)
  const prefix4 = normalizedCode.substring(0, 4);
  ({ data, error } = await supabase
    .from('hs_codes')
    .select('code, description, dd, rs, pcs, pcc, cosec, tva')
    .like('code_normalized', `${prefix4}%`)
    .limit(1)
    .single());

  return data || null;
}

// Analyze work scope based on context
function analyzeWorkScope(cargoDescription: string, context?: string): {
  starts_at: string;
  includes_freight: boolean;
  services: string[];
  notes: string[];
} {
  const contextLower = (context || '').toLowerCase();
  const descLower = cargoDescription.toLowerCase();
  
  const services: string[] = [];
  const notes: string[] = [];
  
  // Determine if freight is needed
  const includesFreight = !contextLower.includes('import clearance') && 
                          !contextLower.includes('local delivery only') &&
                          !contextLower.includes('customs clearance only');

  // Check for specific services mentioned
  if (contextLower.includes('customs clearance') || contextLower.includes('dédouanement')) {
    services.push('Dédouanement import');
  }
  if (contextLower.includes('local delivery') || contextLower.includes('livraison')) {
    services.push('Livraison locale');
  }
  if (contextLower.includes('duty') || contextLower.includes('tax')) {
    services.push('Calcul droits et taxes');
  }
  if (contextLower.includes('warehousing') || contextLower.includes('storage') || contextLower.includes('magasinage')) {
    services.push('Stockage/Magasinage');
  }
  
  // Default services if none specified
  if (services.length === 0) {
    services.push('Dédouanement import', 'Livraison locale');
  }

  // Check for special cargo
  if (descLower.includes('vehicle') || descLower.includes('voiture') || descLower.includes('pick-up') || descLower.includes('suv')) {
    notes.push('Véhicules: visite technique COSEC requise');
    notes.push('Documents requis: carte grise originale, certificat de conformité');
  }
  if (descLower.includes('used') || descLower.includes('occasion')) {
    notes.push('Marchandises d\'occasion: certificat de conformité peut être exigé');
  }

  return {
    starts_at: includesFreight ? 'Origine' : 'Port de Dakar (arrivée)',
    includes_freight: includesFreight,
    services,
    notes
  };
}

// Get required documents based on cargo type
function getRequiredDocuments(suggestions: HsCodeSuggestion[], destination?: string): string[] {
  const docs: Set<string> = new Set([
    'Facture commerciale / Commercial Invoice',
    'Packing List / Liste de colisage',
    'Bill of Lading (B/L) ou AWB'
  ]);

  // Check for specific cargo types requiring additional docs
  const hsCodesJoined = suggestions.map(s => s.hs_code).join(' ');
  const itemsJoined = suggestions.map(s => s.item.toLowerCase()).join(' ');

  // Vehicles
  if (hsCodesJoined.includes('8703') || hsCodesJoined.includes('8704') || 
      itemsJoined.includes('véhicule') || itemsJoined.includes('voiture') || itemsJoined.includes('pick-up')) {
    docs.add('Carte grise originale');
    docs.add('Certificat de conformité');
    docs.add('Certificat de non-gage (si applicable)');
  }

  // Food products
  if (hsCodesJoined.match(/^(01|02|03|04|05|06|07|08|09|10|11|12|13|14|15|16|17|18|19|20|21|22|23)/)) {
    docs.add('Certificat phytosanitaire ou sanitaire');
    docs.add('Certificat d\'origine');
  }

  // Pharmaceuticals
  if (hsCodesJoined.includes('3004') || hsCodesJoined.includes('3003')) {
    docs.add('Autorisation du Ministère de la Santé');
    docs.add('Certificat d\'analyse');
  }

  // CEDEAO origin
  if (destination && ['mali', 'bamako', 'burkina', 'ouagadougou', 'niger', 'niamey', 
      'guinee', 'conakry', 'cote d\'ivoire', 'abidjan'].some(loc => destination.toLowerCase().includes(loc))) {
    docs.add('Certificat d\'origine CEDEAO (pour exonération)');
  }

  return Array.from(docs);
}

// Get regulatory notes
function getRegulatoryNotes(suggestions: HsCodeSuggestion[], destination?: string): string[] {
  const notes: string[] = [];
  const itemsJoined = suggestions.map(s => s.item.toLowerCase()).join(' ');
  const hsCodesJoined = suggestions.map(s => s.hs_code).join(' ');

  // Used vehicles
  if (itemsJoined.includes('occasion') || itemsJoined.includes('used')) {
    notes.push('⚠️ Véhicules d\'occasion: Sénégal limite l\'âge des véhicules importés (généralement 8 ans max)');
  }

  // Vehicles inspection
  if (hsCodesJoined.includes('8703') || hsCodesJoined.includes('8704')) {
    notes.push('🔍 Véhicules: Inspection COSEC obligatoire avant mise à la consommation');
    notes.push('📋 Régime 1700 (mise à consommation directe) généralement applicable');
  }

  // Tires
  if (hsCodesJoined.includes('4011')) {
    notes.push('🛞 Pneus: Vérifier conformité aux normes (pas de pneus rechapés pour certains usages)');
  }

  // Duty estimates
  const highDutyItems = suggestions.filter(s => s.dd >= 20);
  if (highDutyItems.length > 0) {
    notes.push(`💰 Taux DD élevés (${highDutyItems[0].dd}%) sur: ${highDutyItems.map(s => s.item).join(', ')}`);
  }

  // Transit to landlocked countries
  if (destination && ['mali', 'bamako', 'burkina', 'ouagadougou', 'niger', 'niamey'].some(loc => destination.toLowerCase().includes(loc))) {
    notes.push('🚛 Transit vers pays enclavé: Procédure TRIE/TIF disponible pour accélération');
  }

  // Default note about CAF value
  notes.push('💡 Pour estimation précise des D&T, fournir la valeur CAF et factures commerciales');

  return notes;
}
