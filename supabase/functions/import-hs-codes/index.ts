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

    // Get the CSV content from request body or fetch from URL
    const { csvContent, csvUrl } = await req.json();
    
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

    // Remove BOM character if present and normalize line endings
    csvData = csvData.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Parse CSV
    const lines = csvData.split('\n').filter(line => line.trim());
    const headers = lines[0].split(';').map(h => h.trim().toLowerCase().replace(/[^\w]/g, ''));
    
    console.log('CSV Headers (cleaned):', headers);
    
    console.log('CSV Headers:', headers);
    console.log('Total lines to process:', lines.length - 1);

    const hsCodesData: any[] = [];
    let skipped = 0;
    let processed = 0;

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(';').map(v => v.trim());
      
      if (values.length < 2) {
        skipped++;
        continue;
      }

      const getVal = (key: string) => {
        const idx = headers.indexOf(key);
        return idx >= 0 ? values[idx] : '';
      };

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

      const code = getVal('code');
      if (!code) {
        skipped++;
        continue;
      }

      // Normalize code (remove dots and spaces)
      const codeNormalized = code.replace(/[\.\s]/g, '');
      
      // Extract chapter from code
      const chapter = parseInt(codeNormalized.substring(0, 2)) || 0;

      hsCodesData.push({
        code: code,
        code_normalized: codeNormalized,
        dd: parseNumber(getVal('dd')),
        surtaxe: parseNumber(getVal('surtaxe')),
        rs: parseNumber(getVal('rs')) || 1,
        pcs: parseNumber(getVal('pcs')) || 0.8,
        pcc: parseNumber(getVal('pcc')) || 0.5,
        cosec: parseNumber(getVal('cosec')) || 0.4,
        uemoa: parseNumber(getVal('uemoa')) || 5,
        tin: parseNumber(getVal('tin')),
        tva: parseNumber(getVal('tva')) || 18,
        tev: parseNumber(getVal('tev')),
        ta: parseNumber(getVal('ta')),
        t_past: parseNumber(getVal('t_past')),
        t_para: parseNumber(getVal('t_para')),
        t_conj: parseNumber(getVal('t_conj')),
        t_ciment: parseNumber(getVal('t_ciment')),
        ref: parseNumber(getVal('ref')),
        bic: parseBool(getVal('bic')),
        mercurialis: parseBool(getVal('mercurialis')),
        description: getVal('description') || null,
        chapter: chapter,
      });

      processed++;
    }

    console.log(`Processed ${processed} codes, skipped ${skipped}`);

    // Insert in batches of 500
    const batchSize = 500;
    let insertedCount = 0;
    let errors: string[] = [];

    for (let i = 0; i < hsCodesData.length; i += batchSize) {
      const batch = hsCodesData.slice(i, i + batchSize);
      
      const { data, error } = await supabase
        .from('hs_codes')
        .upsert(batch, { 
          onConflict: 'code',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error(`Batch ${i / batchSize + 1} error:`, error);
        errors.push(`Batch ${i / batchSize + 1}: ${error.message}`);
      } else {
        insertedCount += batch.length;
        console.log(`Inserted batch ${i / batchSize + 1}, total: ${insertedCount}`);
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
          inserted: insertedCount,
          errors: errors.length > 0 ? errors : undefined
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
