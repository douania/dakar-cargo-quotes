/** LOCAL CANDIDATE ONLY. No deployment or active caller authorized. */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { createManualIntakeHandler } from './handler.ts';
export const handleRequest = createManualIntakeHandler({
  authenticate: requireUser,
  record: async (token, params) => {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.rpc('record_intake_snapshot', params);
    return { data, error };
  },
});
if (import.meta.main) Deno.serve(handleRequest);
