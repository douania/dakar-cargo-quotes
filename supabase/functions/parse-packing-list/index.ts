import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXTRACTION_PROMPT = `Tu es un expert en logistique qui analyse des packing lists.

MISSION : Extraire UNIQUEMENT les lignes de colisage/colis et CONVERTIR toutes les dimensions en CENTIMÈTRES (cm).

RÈGLES D'EXTRACTION :
1. Ignore les factures, proformas, devis
2. Ignore les lignes de TOTAL, SUBTOTAL, SET GW, GRAND TOTAL
3. Ignore les headers et lignes vides
4. Ignore les lignes en double (même colis répété dans différents sets/onglets)
5. Nettoie les symboles (~, ±, ≈) des valeurs numériques

IMPORTANT - DÉTECTION DES UNITÉS DE DIMENSIONS :
1. Cherche dans les en-têtes de colonnes l'unité mentionnée (mm, cm, m, inch, ft)
2. Si l'en-tête indique "L(mm)" ou "Length (mm)" → les valeurs sont en millimètres
3. Si l'en-tête indique "L(cm)" ou "Length (cm)" → les valeurs sont en centimètres
4. Si l'en-tête indique "L(m)" ou "Length (m)" → les valeurs sont en mètres
5. Si aucune unité n'est indiquée, analyse les valeurs :
   - Valeurs > 1000 pour la longueur (ex: 5420) → probablement en mm
   - Valeurs entre 10-500 pour la longueur → probablement en cm
   - Valeurs < 10 pour la longueur → probablement en mètres

CONVERSION OBLIGATOIRE VERS CENTIMÈTRES :
- Si mm détecté : divise par 10 (ex: 5420 mm → 542 cm)
- Si m détecté : multiplie par 100 (ex: 5.42 m → 542 cm)
- Si cm détecté : garde tel quel
- Si inch détecté : multiplie par 2.54
- Si ft détecté : multiplie par 30.48

IMPORTANT - POIDS :
- Les poids sont généralement en kg
- "~61000" signifie 61000 kg (61 tonnes) - c'est un transformateur de puissance
- Ne divise JAMAIS le poids par 1000
- Si le poids semble être en grammes (valeurs très petites < 1), convertis en kg

FORMAT DE SORTIE :
Pour chaque colis UNIQUE (pas de doublons), retourne :
- id: string (numéro du colis, ex: "1", "2")
- description: string (description du contenu)
- length: number (longueur CONVERTIE EN CM)
- width: number (largeur CONVERTIE EN CM)
- height: number (hauteur CONVERTIE EN CM)
- weight: number (poids brut en kg)
- quantity: number (1 par défaut)
- stackable: boolean (false pour MAIN BODY/colis lourds >5T, true sinon)

IMPORTANT : Tu DOIS indiquer dans detected_dimension_unit l'unité que tu as détectée dans le fichier source.`;

interface PackingItem {
  id: string;
  description: string;
  length: number;  // en cm
  width: number;   // en cm
  height: number;  // en cm
  weight: number;  // en kg
  quantity: number;
  stackable: boolean;
}

interface ExtractionResult {
  items: PackingItem[];
  document_type: string;
  sheets_analyzed: string[];
  warnings: string[];
  detected_dimension_unit: string;
}

function parseExcelToText(buffer: ArrayBuffer): { text: string; sheetNames: string[] } {
  try {
    const uint8Array = new Uint8Array(buffer);
    const workbook = XLSX.read(uint8Array, { type: 'array' });
    const sheetNames = workbook.SheetNames;
    
    // Priority sheets for packing lists
    const priorityKeywords = ['packing', 'list', 'colisage', 'colis', 'package', 'cargo'];
    
    // Sort sheets by priority (packing list related first)
    const sortedSheets = [...sheetNames].sort((a: string, b: string) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aPriority = priorityKeywords.some(k => aLower.includes(k)) ? 0 : 1;
      const bPriority = priorityKeywords.some(k => bLower.includes(k)) ? 0 : 1;
      return aPriority - bPriority;
    });

    let allText = "";
    const analyzedSheets: string[] = [];
    
    for (const sheetName of sortedSheets) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      
      // Convert to CSV format for AI parsing
      const csvData = XLSX.utils.sheet_to_csv(sheet, { FS: ' | ', RS: '\n' });
      
      // Skip empty sheets
      const lines = csvData.split('\n').filter((l: string) => l.trim().length > 0);
      if (lines.length < 2) continue;
      
      analyzedSheets.push(sheetName);
      allText += `\n=== ONGLET: ${sheetName} ===\n`;
      allText += csvData;
      
      // Limit total text to prevent timeout
      if (allText.length > 25000) {
        allText += "\n[...truncated for length...]\n";
        break;
      }
    }

    return { text: allText, sheetNames: analyzedSheets };
  } catch (error) {
    console.error("Excel parsing error:", error);
    throw new Error(`Failed to parse Excel: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function extractWithAI(fileContent: string): Promise<ExtractionResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  console.log("Calling Lovable AI for packing list extraction...");
  console.log("Content length:", fileContent.length);

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
          content: `Analyse ce contenu de packing list, DÉTECTE L'UNITÉ DES DIMENSIONS, et extrait les articles UNIQUES avec les dimensions CONVERTIES EN CENTIMÈTRES:\n\n${fileContent}`
        }
      ],
      tools: [{
        type: "function",
        function: {
          name: "extract_packing_items",
          description: "Extrait les articles de la packing list avec dimensions converties en cm",
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
                    length: { type: "number", description: "Longueur CONVERTIE EN CENTIMÈTRES (cm)" },
                    width: { type: "number", description: "Largeur CONVERTIE EN CENTIMÈTRES (cm)" },
                    height: { type: "number", description: "Hauteur CONVERTIE EN CENTIMÈTRES (cm)" },
                    weight: { type: "number", description: "Poids brut en kg" },
                    quantity: { type: "number", description: "Quantité" },
                    stackable: { type: "boolean", description: "Empilable ou non (false si poids > 5000kg)" }
                  },
                  required: ["id", "description", "length", "width", "height", "weight", "quantity", "stackable"]
                }
              },
              detected_dimension_unit: {
                type: "string",
                enum: ["mm", "cm", "m", "inch", "unknown"],
                description: "Unité des dimensions détectée dans le fichier source AVANT conversion"
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
                description: "Avertissements (lignes ignorées, doublons détectés, unité ambiguë, etc.)"
              }
            },
            required: ["items", "detected_dimension_unit", "document_type", "sheets_analyzed", "warnings"]
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
    const content = data.choices?.[0]?.message?.content;
    console.error("Unexpected AI response format. Content:", content?.substring(0, 500));
    throw new Error("Invalid AI response format - no tool call returned");
  }

  const result = JSON.parse(toolCall.function.arguments);
  
  // Log detected unit for debugging
  console.log(`Detected dimension unit: ${result.detected_dimension_unit}`);
  
  // Validate and clean items
  const validItems = result.items
    .filter((item: Record<string, unknown>) => {
      if (!item.id) return false;
      const weight = Number(item.weight);
      if (!weight || weight <= 0) return false;
      const length = Number(item.length);
      const width = Number(item.width);
      const height = Number(item.height);
      if (!length || !width || !height) return false;
      return true;
    })
    .map((item: Record<string, unknown>): PackingItem => {
      // Les dimensions sont déjà en cm grâce à la conversion IA
      let length = Math.round(Number(item.length) || 0);
      let width = Math.round(Number(item.width) || 0);
      let height = Math.round(Number(item.height) || 0);
      
      // Validation de sécurité : si les dimensions semblent encore en mm (> 1400 cm = 14m)
      // c'est que l'IA n'a pas fait la conversion, on la fait ici
      const maxDim = Math.max(length, width, height);
      if (maxDim > 1400) {
        console.log(`Safety conversion for item ${item.id}: dimensions seem to be in mm`);
        length = Math.round(length / 10);
        width = Math.round(width / 10);
        height = Math.round(height / 10);
      }
      
      return {
        id: String(item.id).trim(),
        description: String(item.description || "").trim(),
        length,
        width,
        height,
        weight: Number(item.weight) || 0,
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
        stackable: Boolean(item.stackable)
      };
    });

  // Add warning about unit conversion if detected
  const warnings = result.warnings || [];
  if (result.detected_dimension_unit && result.detected_dimension_unit !== 'cm') {
    warnings.push(`Unité détectée: ${result.detected_dimension_unit} - Dimensions converties en cm`);
  }

  return {
    items: validItems,
    document_type: result.document_type || "packing_list",
    sheets_analyzed: result.sheets_analyzed || [],
    warnings,
    detected_dimension_unit: result.detected_dimension_unit || "unknown"
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
      return new Response(
        JSON.stringify({ error: 'Please upload a file using multipart/form-data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    // Parse Excel to text
    const { text: excelText, sheetNames } = parseExcelToText(fileBuffer);
    console.log(`Parsed ${sheetNames.length} sheets, text length: ${excelText.length}`);

    if (!excelText.trim()) {
      return new Response(
        JSON.stringify({ 
          error: 'No data found in Excel file',
          items: [],
          warnings: ['Le fichier semble vide ou ne contient pas de données exploitables']
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract with AI
    const result = await extractWithAI(excelText);
    
    console.log(`Extracted ${result.items.length} items`);
    console.log(`Document type: ${result.document_type}`);
    console.log(`Detected dimension unit: ${result.detected_dimension_unit}`);
    if (result.warnings.length > 0) {
      console.log(`Warnings: ${result.warnings.join(', ')}`);
    }

    // Log sample items for verification (dimensions should now be in cm)
    if (result.items.length > 0) {
      console.log(`First item (dimensions in cm): ${JSON.stringify(result.items[0])}`);
      const heavyItems = result.items.filter(i => i.weight > 10000);
      if (heavyItems.length > 0) {
        console.log(`Heavy items (>10t): ${heavyItems.map(i => `${i.id}: ${i.weight}kg`).join(', ')}`);
      }
    }

    return new Response(
      JSON.stringify({
        items: result.items,
        document_type: result.document_type,
        sheets_analyzed: sheetNames,
        warnings: result.warnings,
        total_items: result.items.length,
        detected_dimension_unit: result.detected_dimension_unit
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
