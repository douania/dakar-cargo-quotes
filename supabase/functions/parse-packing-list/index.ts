import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXTRACTION_PROMPT = `Tu es un expert en logistique qui analyse des fichiers Excel de packing list.

MISSION : Extraire UNIQUEMENT les lignes de colisage/colis d'un fichier Excel.

RÈGLES D'EXTRACTION :
1. Ignore les factures, proformas, devis
2. Ignore les lignes de TOTAL, SUBTOTAL, SET GW, GRAND TOTAL
3. Ignore les headers et lignes vides
4. Ignore les lignes en double (même colis répété)
5. Nettoie les symboles (~, ±, ≈) des valeurs numériques
6. Convertis les unités si nécessaire :
   - cm → mm (x10)
   - m → mm (x1000)
   - tonnes → kg (x1000)

DETECTION DES COLONNES :
- Cherche les colonnes avec : N°, No, Numéro, Case, Colis, Package, Collo, Mark
- Dimensions : L, W, H, Length, Width, Height, Longueur, Largeur, Hauteur, Dim
- Poids : Weight, Gross, Net, GW, NW, Poids, Brut, KG, Kg
- Description : Description, Désignation, Contents, Contenu, Marchandise

FORMAT DE SORTIE :
Pour chaque colis, retourne un objet avec EXACTEMENT ces champs :
- id: string (numéro du colis, ex: "1", "51575-1", "CASE 1")
- description: string (description du contenu)
- length: number (longueur en mm)
- width: number (largeur en mm)
- height: number (hauteur en mm)
- weight: number (poids BRUT en kg - IMPORTANT: garde les valeurs en kg, ne divise pas)
- quantity: number (1 par défaut, sauf si explicitement indiqué)
- stackable: boolean (true sauf si fragile/top only/non-stackable)

ATTENTION POIDS :
- Si le poids est 61000, c'est 61000 kg (61 tonnes), PAS 61 kg
- Les transformateurs, machines lourdes peuvent peser 50-100 tonnes
- Ne divise JAMAIS le poids par 1000

ATTENTION DIMENSIONS :
- Identifie l'unité dans les headers (mm, cm, m)
- Convertis TOUJOURS en mm
- 5200 cm = 52000 mm
- 2.5 m = 2500 mm`;

interface PackingItem {
  id: string;
  description: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  quantity: number;
  stackable: boolean;
}

interface ExtractionResult {
  items: PackingItem[];
  document_type: string;
  sheets_analyzed: string[];
  warnings: string[];
}

// Convert Excel file to base64 text for AI analysis
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function extractWithAI(fileBase64: string, fileName: string): Promise<ExtractionResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  console.log("Calling Lovable AI for packing list extraction...");
  console.log("File name:", fileName);

  // Use Gemini's vision capability to analyze the Excel file
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { 
          role: "user", 
          content: [
            {
              type: "text",
              text: `Analyse ce fichier Excel "${fileName}" et extrait les articles de la packing list. Le fichier est encodé en base64.`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${fileBase64}`
              }
            }
          ]
        }
      ],
      tools: [{
        type: "function",
        function: {
          name: "extract_packing_items",
          description: "Extrait les articles de la packing list",
          parameters: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", description: "Identifiant du colis" },
                    description: { type: "string", description: "Description du contenu" },
                    length: { type: "number", description: "Longueur en mm" },
                    width: { type: "number", description: "Largeur en mm" },
                    height: { type: "number", description: "Hauteur en mm" },
                    weight: { type: "number", description: "Poids brut en kg" },
                    quantity: { type: "number", description: "Quantité" },
                    stackable: { type: "boolean", description: "Empilable ou non" }
                  },
                  required: ["id", "description", "length", "width", "height", "weight", "quantity", "stackable"]
                }
              },
              document_type: { 
                type: "string", 
                enum: ["packing_list", "invoice", "mixed", "unknown"],
                description: "Type de document détecté" 
              },
              sheets_analyzed: {
                type: "array",
                items: { type: "string" },
                description: "Noms des onglets analysés"
              },
              warnings: { 
                type: "array", 
                items: { type: "string" },
                description: "Avertissements (lignes ignorées, conversions, etc.)"
              }
            },
            required: ["items", "document_type", "sheets_analyzed", "warnings"]
          }
        }
      }],
      tool_choice: { type: "function", function: { name: "extract_packing_items" } }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI API error:", response.status, errorText);
    throw new Error(`AI extraction failed: ${response.status}`);
  }

  const data = await response.json();
  console.log("AI response received");

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== "extract_packing_items") {
    // Try to parse from content if tool call failed
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      console.log("Trying to parse from content:", content.substring(0, 500));
    }
    throw new Error("Invalid AI response format");
  }

  const result = JSON.parse(toolCall.function.arguments);
  
  // Validate and clean items
  const validItems = result.items
    .filter((item: any) => {
      // Filter out invalid items
      if (!item.id || !item.weight || item.weight <= 0) return false;
      if (!item.length || !item.width || !item.height) return false;
      return true;
    })
    .map((item: any): PackingItem => ({
      id: String(item.id).trim(),
      description: String(item.description || "").trim(),
      length: Math.round(Number(item.length) || 0),
      width: Math.round(Number(item.width) || 0),
      height: Math.round(Number(item.height) || 0),
      weight: Number(item.weight) || 0,
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      stackable: Boolean(item.stackable)
    }));

  return {
    items: validItems,
    document_type: result.document_type || "unknown",
    sheets_analyzed: result.sheets_analyzed || [],
    warnings: result.warnings || []
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    
    let fileBuffer: ArrayBuffer;
    let fileName = "uploaded_file.xlsx";
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      
      if (!file) {
        return new Response(
          JSON.stringify({ error: 'No file provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      fileName = file.name;
      fileBuffer = await file.arrayBuffer();
    } else {
      // Raw binary upload
      fileBuffer = await req.arrayBuffer();
    }

    console.log(`Processing file: ${fileName}, size: ${fileBuffer.byteLength} bytes`);

    // Check file size (max 10MB for AI processing)
    if (fileBuffer.byteLength > 10 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ 
          error: 'File too large. Maximum size is 10MB.',
          items: [],
          warnings: ['Le fichier est trop volumineux (max 10 MB)']
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert to base64 for AI
    const fileBase64 = arrayBufferToBase64(fileBuffer);
    console.log(`Base64 length: ${fileBase64.length}`);

    // Extract with AI
    const result = await extractWithAI(fileBase64, fileName);
    
    console.log(`Extracted ${result.items.length} items`);
    console.log(`Document type: ${result.document_type}`);
    console.log(`Warnings: ${result.warnings.join(', ')}`);

    return new Response(
      JSON.stringify({
        items: result.items,
        document_type: result.document_type,
        sheets_analyzed: result.sheets_analyzed,
        warnings: result.warnings,
        total_items: result.items.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing packing list:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        items: [],
        warnings: ['Erreur lors du traitement du fichier']
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
