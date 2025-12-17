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

    // Detect delimiter (comma or semicolon)
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
    
    console.log('CSV Headers:', headers);
    console.log('Total lines:', lines.length - 1);

    // Determine mode: 'descriptions_only' just updates descriptions, 'full' does full upsert
    const importMode = mode || 'descriptions_only';
    console.log('Import mode:', importMode);

    const hsCodesData: any[] = [];
    let skipped = 0;
    let processed = 0;

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      
      if (values.length < 2) {
        skipped++;
        continue;
      }

      const getVal = (keys: string[]) => {
        for (const key of keys) {
          const idx = headers.indexOf(key);
          if (idx >= 0 && values[idx]) {
            return values[idx].replace(/^"/, '').replace(/"$/, '');
          }
        }
        return '';
      };

      // Support both 'hs_code' and 'code' column names
      const code = getVal(['hscode', 'hs_code', 'code']);
      const description = getVal(['description', 'libelle', 'designation']);
      
      if (!code) {
        skipped++;
        continue;
      }

      // Normalize code (remove dots, spaces, dashes)
      const codeNormalized = code.replace(/[\.\s\-]/g, '');
      
      if (importMode === 'descriptions_only') {
        // Only update descriptions for existing codes
        hsCodesData.push({
          code_normalized: codeNormalized,
          description: description || null,
        });
      } else {
        // Full import with all fields
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

        const chapter = parseInt(codeNormalized.substring(0, 2)) || 0;

        hsCodesData.push({
          code: codeNormalized,
          code_normalized: codeNormalized,
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
          description: description || null,
          chapter: chapter,
        });
      }

      processed++;
    }

    console.log(`Processed ${processed} codes, skipped ${skipped}`);

    // Process in batches
    const batchSize = 100;
    let updatedCount = 0;
    let insertedCount = 0;
    let errors: string[] = [];

    if (importMode === 'descriptions_only') {
      // Update descriptions for existing codes using code_normalized match
      for (let i = 0; i < hsCodesData.length; i += batchSize) {
        const batch = hsCodesData.slice(i, i + batchSize);
        
        for (const item of batch) {
          // Try to update by matching code_normalized to code
          const { data: updated, error } = await supabase
            .from('hs_codes')
            .update({ description: item.description })
            .eq('code', item.code_normalized)
            .select('id');

          if (error) {
            errors.push(`Update ${item.code_normalized}: ${error.message}`);
          } else if (updated && updated.length > 0) {
            updatedCount++;
          } else {
            // Code doesn't exist, try to insert
            const chapter = parseInt(item.code_normalized.substring(0, 2)) || 0;
            const { error: insertError } = await supabase
              .from('hs_codes')
              .insert({
                code: item.code_normalized,
                code_normalized: item.code_normalized,
                description: item.description,
                chapter: chapter,
                dd: 0,
                rs: 1,
                pcs: 0.8,
                pcc: 0.5,
                cosec: 0.4,
                tva: 18,
              });
            
            if (insertError) {
              // Might be duplicate, ignore
              if (!insertError.message.includes('duplicate')) {
                errors.push(`Insert ${item.code_normalized}: ${insertError.message}`);
              }
            } else {
              insertedCount++;
            }
          }
        }
        
        console.log(`Processed batch ${Math.floor(i / batchSize) + 1}, updated: ${updatedCount}, inserted: ${insertedCount}`);
      }
    } else {
      // Full upsert
      for (let i = 0; i < hsCodesData.length; i += batchSize) {
        const batch = hsCodesData.slice(i, i + batchSize);
        
        const { error } = await supabase
          .from('hs_codes')
          .upsert(batch, { 
            onConflict: 'code_normalized',
            ignoreDuplicates: false 
          });

        if (error) {
          console.error(`Batch ${i / batchSize + 1} error:`, error);
          errors.push(`Batch ${i / batchSize + 1}: ${error.message}`);
        } else {
          insertedCount += batch.length;
          console.log(`Upserted batch ${i / batchSize + 1}, total: ${insertedCount}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Import completed`,
        stats: {
          totalLines: lines.length - 1,
          processed,
          skipped,
          updated: updatedCount,
          inserted: insertedCount,
          errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
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
