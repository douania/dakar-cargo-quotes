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
    
    console.log('CSV Headers:', headers.slice(0, 10));
    console.log('Total lines:', lines.length - 1);

    const importMode = mode || 'full';
    console.log('Import mode:', importMode);

    const parseNumber = (val: string): number => {
      if (!val || val === '' || val.toUpperCase() === 'FALSE') return 0;
      if (val.toUpperCase() === 'TRUE') return 1;
      const num = parseFloat(val.replace(',', '.'));
      return isNaN(num) ? 0 : num;
    };

    const parseBool = (val: string): boolean => {
      if (!val) return false;
      return val.toUpperCase() === 'TRUE' || val === '1';
    };

    // Parse all data
    const hsCodesData: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < 2) continue;

      const getVal = (keys: string[]) => {
        for (const key of keys) {
          const idx = headers.indexOf(key);
          if (idx >= 0 && values[idx] !== undefined) {
            return values[idx].replace(/^"/, '').replace(/"$/, '');
          }
        }
        return '';
      };

      const code = getVal(['hscode', 'hs_code', 'code']);
      if (!code) continue;

      // Normalize code (remove dots, spaces, dashes)
      const codeNormalized = code.replace(/[\.\s\-]/g, '');
      const chapter = parseInt(codeNormalized.substring(0, 2)) || 0;

      if (importMode === 'descriptions_only') {
        const description = getVal(['description', 'libelle', 'designation']);
        hsCodesData.push({ 
          code: codeNormalized, 
          description: description || '' 
        });
      } else {
        // Full mode with all rates
        hsCodesData.push({
          code: codeNormalized,
          code_normalized: codeNormalized,
          chapter: chapter,
          dd: parseNumber(getVal(['dd'])),
          surtaxe: parseNumber(getVal(['surtaxe'])),
          rs: parseNumber(getVal(['rs'])) || 1,
          pcs: parseNumber(getVal(['pcs'])) || 0.8,
          pcc: parseNumber(getVal(['pcc'])) || 0.5,
          cosec: parseNumber(getVal(['cosec'])) || 0.4,
          uemoa: parseNumber(getVal(['uemoa'])) || 5,
          tin: parseNumber(getVal(['tin'])),
          tva: parseNumber(getVal(['tva'])) || 18,
          tev: parseNumber(getVal(['tev'])),
          ta: parseNumber(getVal(['ta'])),
          t_past: parseNumber(getVal(['t_past', 'tpast'])),
          t_para: parseNumber(getVal(['t_para', 'tpara'])),
          t_conj: parseNumber(getVal(['t_conj', 'tconj'])),
          t_ciment: parseNumber(getVal(['t_ciment', 'tciment'])),
          ref: parseNumber(getVal(['ref'])),
          bic: parseBool(getVal(['bic'])),
          mercurialis: parseBool(getVal(['mercurialis'])),
          description: getVal(['description', 'libelle', 'designation']) || null,
        });
      }
    }

    console.log(`Parsed ${hsCodesData.length} codes`);

    const batchSize = 500;
    let updatedCount = 0;
    let insertedCount = 0;
    const errors: string[] = [];

    if (importMode === 'descriptions_only') {
      // Fetch existing codes for description updates
      const { data: existingCodes, error: fetchError } = await supabase
        .from('hs_codes')
        .select('code, id, dd, rs, pcs, pcc, cosec, tva, chapter, code_normalized');

      if (fetchError) {
        throw new Error(`Failed to fetch existing codes: ${fetchError.message}`);
      }

      const existingMap = new Map(existingCodes?.map(c => [c.code, c]) || []);

      const recordsToUpsert: any[] = [];
      const recordsToInsert: any[] = [];

      for (const item of hsCodesData) {
        const existing = existingMap.get(item.code);
        
        if (existing) {
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

      // Batch upsert
      for (let i = 0; i < recordsToUpsert.length; i += batchSize) {
        const batch = recordsToUpsert.slice(i, i + batchSize);
        const { error } = await supabase.from('hs_codes').upsert(batch, { onConflict: 'id' });
        if (error) errors.push(`Update batch: ${error.message}`);
        else updatedCount += batch.length;
      }

      for (let i = 0; i < recordsToInsert.length; i += batchSize) {
        const batch = recordsToInsert.slice(i, i + batchSize);
        const { error } = await supabase.from('hs_codes').insert(batch);
        if (error) errors.push(`Insert batch: ${error.message}`);
        else insertedCount += batch.length;
      }
    } else {
      // Full mode: upsert all records with rates
      // Fetch existing to preserve descriptions if not in CSV
      const { data: existingCodes, error: fetchError } = await supabase
        .from('hs_codes')
        .select('code, id, description');

      if (fetchError) {
        throw new Error(`Failed to fetch existing codes: ${fetchError.message}`);
      }

      const existingMap = new Map(existingCodes?.map(c => [c.code, c]) || []);
      console.log(`Found ${existingMap.size} existing codes`);

      const recordsToUpsert: any[] = [];
      const recordsToInsert: any[] = [];

      for (const item of hsCodesData) {
        const existing = existingMap.get(item.code);
        
        if (existing) {
          // Update existing: keep description if CSV doesn't have one
          recordsToUpsert.push({
            id: existing.id,
            ...item,
            description: item.description || existing.description,
          });
        } else {
          recordsToInsert.push(item);
        }
      }

      console.log(`To update: ${recordsToUpsert.length}, to insert: ${recordsToInsert.length}`);

      // Batch upsert existing
      for (let i = 0; i < recordsToUpsert.length; i += batchSize) {
        const batch = recordsToUpsert.slice(i, i + batchSize);
        const { error } = await supabase.from('hs_codes').upsert(batch, { onConflict: 'id' });
        if (error) {
          console.error(`Update batch ${Math.floor(i/batchSize)+1} error:`, error.message);
          errors.push(`Update: ${error.message}`);
        } else {
          updatedCount += batch.length;
        }
      }

      // Batch insert new
      for (let i = 0; i < recordsToInsert.length; i += batchSize) {
        const batch = recordsToInsert.slice(i, i + batchSize);
        const { error } = await supabase.from('hs_codes').insert(batch);
        if (error) {
          console.error(`Insert batch ${Math.floor(i/batchSize)+1} error:`, error.message);
          errors.push(`Insert: ${error.message}`);
        } else {
          insertedCount += batch.length;
        }
      }
    }

    console.log(`Completed: updated ${updatedCount}, inserted ${insertedCount}, errors ${errors.length}`);

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
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
