import "https://deno.land/x/xhr@0.1.0/mod.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const EXTRACTION_PROMPT = `Tu es un expert en logistique qui analyse des packing lists.

MISSION : Extraire TOUTES les lignes de colisage/colis avec leurs dimensions EXACTES telles qu'elles apparaissent dans le fichier.

RÈGLES D'EXTRACTION :
1. Ignore les factures, proformas, devis
2. Ignore les lignes de TOTAL, SUBTOTAL, SET GW, GRAND TOTAL
3. Ignore les headers et lignes vides
4. GESTION DES SETS MULTIPLES (CRITIQUE):
   - Si le même numéro de colis apparaît plusieurs fois (ex: "1" trois fois), ce sont des SETS DISTINCTS
   - Cherche des indicateurs de sets: "SET 1/2/3", numéros de série dans le nom du fichier, ou répétition complète de la liste
   - Génère des IDs UNIQUES: préfixe chaque colis par un identifiant de set (ex: "A-1", "B-1", "C-1" ou "S1-1", "S2-1")
   - NE JAMAIS fusionner des colis physiquement distincts même s'ils ont les mêmes caractéristiques
   - Compte le nombre de sets détectés dans set_count
5. Nettoie les symboles (~, ±, ≈) des valeurs numériques

DÉTECTION DES UNITÉS DE DIMENSIONS :
1. Cherche dans les en-têtes de colonnes l'unité mentionnée (mm, cm, m, inch, ft)
2. Si l'en-tête indique "L(mm)" ou "Length (mm)" → source_unit = "mm"
3. Si l'en-tête indique "L(cm)" ou "Length (cm)" → source_unit = "cm"
4. Si l'en-tête indique "L(m)" ou "Length (m)" → source_unit = "m"
5. Si aucune unité n'est indiquée, analyse les valeurs typiques :
   - Valeurs > 1000 pour la longueur (ex: 5420) → probablement "mm"
   - Valeurs entre 10-500 pour la longueur → probablement "cm"
   - Valeurs < 10 pour la longueur → probablement "m"

EXTRACTION FIDÈLE DES DIMENSIONS :
- Extrait les valeurs EXACTES du fichier dans source_length, source_width, source_height
- Indique l'unité détectée dans source_unit
- NE MODIFIE JAMAIS les valeurs - même si elles te semblent "suspectes" ou très grandes
- Des équipements industriels (transformateurs, turbines) peuvent légitimement mesurer > 10 mètres

POIDS :
- Les poids sont généralement en kg
- "~61000" signifie 61000 kg (61 tonnes) - c'est un transformateur de puissance
- Ne divise JAMAIS le poids par 1000
- Si le poids semble être en grammes (valeurs très petites < 1), convertis en kg

FORMAT DE SORTIE :
Pour chaque colis, retourne :
- id: string UNIQUE (ex: "S1-1", "S2-1" si multi-sets détectés, sinon "1", "2")
- description: string (description du contenu, préfixée par [SET X] si multi-sets)
- source_length: number (longueur EXACTE telle qu'elle apparaît dans le fichier)
- source_width: number (largeur EXACTE telle qu'elle apparaît dans le fichier)
- source_height: number (hauteur EXACTE telle qu'elle apparaît dans le fichier)
- source_unit: "mm" | "cm" | "m" | "inch" | "ft" | "unknown"
- weight: number (poids brut en kg)
- quantity: number (1 par défaut)
- stackable: boolean (false pour MAIN BODY/colis lourds >5T, true sinon)`;

interface SourcePackingItem {
  id: string;
  description: string;
  source_length: number;
  source_width: number;
  source_height: number;
  source_unit: 'mm' | 'cm' | 'm' | 'inch' | 'ft' | 'unknown';
  weight: number;
  quantity: number;
  stackable: boolean;
}

interface PackingItem {
  id: string;
  description: string;
  length: number;  // en cm (calculé)
  width: number;   // en cm (calculé)
  height: number;  // en cm (calculé)
  source_length: number;  // valeur originale du fichier
  source_width: number;   // valeur originale du fichier
  source_height: number;  // valeur originale du fichier
  source_unit: string;    // unité originale détectée
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

// Post-traitement: garantir des IDs uniques même si l'AI n'a pas bien distingué les sets
function ensureUniqueIds(items: PackingItem[]): PackingItem[] {
  // Count occurrences of each ID
  const idOccurrences: Record<string, number> = {};
  items.forEach(item => {
    idOccurrences[item.id] = (idOccurrences[item.id] || 0) + 1;
  });
  
  // Find IDs with duplicates
  const duplicateIds = Object.entries(idOccurrences).filter(([_, count]) => count > 1);
  
  if (duplicateIds.length === 0) {
    return items; // No duplicates, return as-is
  }
  
  console.log(`Detected ${duplicateIds.length} IDs with duplicates, renaming...`);
  
  // Rename items with duplicate IDs
  const setCounters: Record<string, number> = {};
  
  return items.map(item => {
    if (idOccurrences[item.id] > 1) {
      setCounters[item.id] = (setCounters[item.id] || 0) + 1;
      const setLetter = String.fromCharCode(64 + setCounters[item.id]); // A, B, C...
      const newId = `${item.id}-${setLetter}`;
      const newDescription = item.description.startsWith('[SET') 
        ? item.description 
        : `[SET ${setLetter}] ${item.description}`;
      
      console.log(`Renamed: ${item.id} → ${newId}`);
      
      return {
        ...item,
        id: newId,
        description: newDescription
      };
    }
    return item;
  });
}

// Conversion déterministe des dimensions vers cm
function convertToCm(value: number, unit: string): number {
  switch (unit) {
    case 'mm':
      return Math.round(value / 10);
    case 'cm':
      return Math.round(value);
    case 'm':
      return Math.round(value * 100);
    case 'inch':
      return Math.round(value * 2.54);
    case 'ft':
      return Math.round(value * 30.48);
    default:
      // Unknown unit - return as-is (assume cm)
      return Math.round(value);
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
          content: `Analyse ce contenu de packing list et extrait les articles UNIQUES avec leurs dimensions EXACTES telles qu'elles apparaissent dans le fichier:\n\n${fileContent}`
        }
      ],
      tools: [{
        type: "function",
        function: {
          name: "extract_packing_items",
          description: "Extrait les articles de la packing list avec dimensions source exactes",
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
                    source_length: { type: "number", description: "Longueur EXACTE telle qu'elle apparaît dans le fichier" },
                    source_width: { type: "number", description: "Largeur EXACTE telle qu'elle apparaît dans le fichier" },
                    source_height: { type: "number", description: "Hauteur EXACTE telle qu'elle apparaît dans le fichier" },
                    source_unit: { 
                      type: "string", 
                      enum: ["mm", "cm", "m", "inch", "ft", "unknown"],
                      description: "Unité des dimensions détectée dans le fichier" 
                    },
                    weight: { type: "number", description: "Poids brut en kg" },
                    quantity: { type: "number", description: "Quantité" },
                    stackable: { type: "boolean", description: "Empilable ou non (false si poids > 5000kg)" }
                  },
                  required: ["id", "description", "source_length", "source_width", "source_height", "source_unit", "weight", "quantity", "stackable"]
                }
              },
              detected_dimension_unit: {
                type: "string",
                enum: ["mm", "cm", "m", "inch", "ft", "unknown"],
                description: "Unité globale des dimensions détectée dans le fichier (basée sur les en-têtes de colonnes)"
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
              },
              set_count: {
                type: "number",
                description: "Nombre de sets/lots distincts détectés dans le fichier (1 si pas de répétition, 2+ si multi-sets)"
              }
            },
            required: ["items", "detected_dimension_unit", "document_type", "sheets_analyzed", "warnings", "set_count"]
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
  const globalUnit = result.detected_dimension_unit || 'unknown';
  const setCount = result.set_count || 1;
  
  // Log detected unit and sets for debugging
  console.log(`Detected dimension unit: ${globalUnit}, set_count: ${setCount}`);
  
  // Validate and convert items
  let validItems = result.items
    .filter((item: Record<string, unknown>) => {
      if (!item.id) return false;
      const weight = Number(item.weight);
      if (!weight || weight <= 0) return false;
      const sourceLength = Number(item.source_length);
      const sourceWidth = Number(item.source_width);
      const sourceHeight = Number(item.source_height);
      if (!sourceLength || !sourceWidth || !sourceHeight) return false;
      return true;
    })
    .map((item: Record<string, unknown>): PackingItem => {
      // Valeurs source exactes du fichier
      const sourceLength = Number(item.source_length) || 0;
      const sourceWidth = Number(item.source_width) || 0;
      const sourceHeight = Number(item.source_height) || 0;
      const itemUnit = String(item.source_unit || globalUnit || 'unknown');
      
      // Conversion déterministe vers cm basée sur l'unité détectée
      const length = convertToCm(sourceLength, itemUnit);
      const width = convertToCm(sourceWidth, itemUnit);
      const height = convertToCm(sourceHeight, itemUnit);
      
      // Log pour debug
      console.log(`Item ${item.id}: source=${sourceLength}x${sourceWidth}x${sourceHeight} ${itemUnit} → ${length}x${width}x${height} cm`);
      
      return {
        id: String(item.id).trim(),
        description: String(item.description || "").trim(),
        length,
        width,
        height,
        source_length: sourceLength,
        source_width: sourceWidth,
        source_height: sourceHeight,
        source_unit: itemUnit,
        weight: Number(item.weight) || 0,
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
        stackable: Boolean(item.stackable)
      };
    });

  // Post-processing: ensure unique IDs (fallback if AI didn't properly distinguish sets)
  validItems = ensureUniqueIds(validItems);

  // Build warnings
  const warnings = result.warnings || [];
  if (globalUnit && globalUnit !== 'cm' && globalUnit !== 'unknown') {
    warnings.push(`Unité source détectée: ${globalUnit} → Dimensions converties en cm`);
  }
  if (globalUnit === 'unknown') {
    warnings.push(`Unité non détectée dans le fichier - dimensions assumées en cm`);
  }
  if (setCount > 1) {
    warnings.push(`${setCount} sets/lots distincts détectés dans le fichier`);
  }
  
  // Log summary
  if (validItems.length > 0) {
    const maxDimCm = Math.max(...validItems.map((i: PackingItem) => Math.max(i.length, i.width, i.height)));
    console.log(`Extraction complete: ${validItems.length} items, max dimension: ${maxDimCm} cm (${(maxDimCm/100).toFixed(2)} m)`);
  }

  return {
    items: validItems,
    document_type: result.document_type || "packing_list",
    sheets_analyzed: result.sheets_analyzed || [],
    warnings,
    detected_dimension_unit: globalUnit
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
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
