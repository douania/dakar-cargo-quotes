import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { csvContent, csvUrl, mode } = await req.json();
    
    let csvData: string;
    
    if (csvContent) {
      csvData = csvContent;
    } else if (csvUrl) {
      const response = await fetch(csvUrl);
      csvData = await response.text();
    } else {
      return new Response(
        JSON.stringify({ error: 'Please provide csvContent or csvUrl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Remove BOM and normalize line endings
    csvData = csvData.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Detect delimiter
    const firstLine = csvData.split('\n')[0];
    const delimiter = firstLine.includes(';') ? ';' : ',';
    console.log('Detected delimiter:', delimiter);

    // Parse CSV with proper quote handling
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const lines = csvData.split('\n').filter(line => line.trim());
    const headers = parseCSVLine(lines[0]).map(h => 
      h.toLowerCase().replace(/[^\w]/g, '').replace(/^"/, '').replace(/"$/, '')
    );
    
    console.log('CSV Headers:', headers.slice(0, 5));
    console.log('Total lines:', lines.length - 1);

    const importMode = mode || 'descriptions_only';
    console.log('Import mode:', importMode);

    // Parse all data first
    const hsCodesData: { code: string; description: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < 2) continue;

      const getVal = (keys: string[]) => {
        for (const key of keys) {
          const idx = headers.indexOf(key);
          if (idx >= 0 && values[idx]) {
            return values[idx].replace(/^"/, '').replace(/"$/, '');
          }
        }
        return '';
      };

      const code = getVal(['hscode', 'hs_code', 'code']);
      const description = getVal(['description', 'libelle', 'designation']);
      
      if (!code) continue;

      // Normalize code (remove dots, spaces, dashes)
      const codeNormalized = code.replace(/[\.\s\-]/g, '');
      hsCodesData.push({ code: codeNormalized, description: description || '' });
    }

    console.log(`Parsed ${hsCodesData.length} codes`);

    // Build a map for quick lookup
    const descriptionMap = new Map(hsCodesData.map(d => [d.code, d.description]));

    // Process in larger batches using upsert
    const batchSize = 500;
    let updatedCount = 0;
    let insertedCount = 0;
    const errors: string[] = [];

    // For descriptions_only mode, we'll do batch upserts with full records
    // First, fetch all existing codes to know which ones exist
    const { data: existingCodes, error: fetchError } = await supabase
      .from('hs_codes')
      .select('code, id, dd, rs, pcs, pcc, cosec, tva, chapter, code_normalized');

    if (fetchError) {
      throw new Error(`Failed to fetch existing codes: ${fetchError.message}`);
    }

    console.log(`Found ${existingCodes?.length || 0} existing codes in database`);

    // Create a map of existing codes
    const existingMap = new Map(existingCodes?.map(c => [c.code, c]) || []);

    // Prepare records for upsert
    const recordsToUpsert: any[] = [];
    const recordsToInsert: any[] = [];

    for (const item of hsCodesData) {
      const existing = existingMap.get(item.code);
      
      if (existing) {
        // Update existing record with description
        recordsToUpsert.push({
          id: existing.id,
          code: existing.code,
          code_normalized: existing.code_normalized || item.code,
          description: item.description,
          dd: existing.dd,
          rs: existing.rs,
          pcs: existing.pcs,
          pcc: existing.pcc,
          cosec: existing.cosec,
          tva: existing.tva,
          chapter: existing.chapter,
        });
      } else {
        // New record
        const chapter = parseInt(item.code.substring(0, 2)) || 0;
        recordsToInsert.push({
          code: item.code,
          code_normalized: item.code,
          description: item.description,
          chapter: chapter,
          dd: 0,
          rs: 1,
          pcs: 0.8,
          pcc: 0.5,
          cosec: 0.4,
          tva: 18,
        });
      }
    }

    console.log(`Records to update: ${recordsToUpsert.length}, to insert: ${recordsToInsert.length}`);

    // Batch upsert existing records (updates)
    for (let i = 0; i < recordsToUpsert.length; i += batchSize) {
      const batch = recordsToUpsert.slice(i, i + batchSize);
      const { error } = await supabase
        .from('hs_codes')
        .upsert(batch, { onConflict: 'id' });

      if (error) {
        console.error(`Update batch error:`, error.message);
        errors.push(`Update batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else {
        updatedCount += batch.length;
      }
    }

    // Batch insert new records
    for (let i = 0; i < recordsToInsert.length; i += batchSize) {
      const batch = recordsToInsert.slice(i, i + batchSize);
      const { error } = await supabase
        .from('hs_codes')
        .insert(batch);

      if (error) {
        console.error(`Insert batch error:`, error.message);
        errors.push(`Insert batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else {
        insertedCount += batch.length;
      }
    }

    console.log(`Completed: updated ${updatedCount}, inserted ${insertedCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Import completed`,
        stats: {
          totalLines: lines.length - 1,
          parsed: hsCodesData.length,
          updated: updatedCount,
          inserted: insertedCount,
          errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
          totalErrors: errors.length
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: unknown) {
    console.error('Import error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
