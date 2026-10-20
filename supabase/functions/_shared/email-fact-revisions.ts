// Own-message proposals. The database decides order and writes their history atomically.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
export interface RevisionEmail { id: string; body_text?: string | null; from_address?: string | null; sent_at?: string | null; }
export interface RevisionFact {
  key: string; category: string; value: unknown; valueType: 'text' | 'number' | 'json' | 'date';
  sourceType: string; sourceEmailId?: string; sourceAttachmentId?: string; sourceExcerpt?: string;
  confidence: number; isAssumption?: boolean;
}
export interface RevisionCandidate {
  email_id: string | null; body_sha256: string | null; excerpt: string | null;
  value_type: RevisionFact['valueType']; value: unknown; source_type: string; confidence: number;
  evidence_error: string | null;
}
export interface RevisionGroup { key: string; category: string; candidates: RevisionCandidate[]; }
const normalized = (s: string) => s.replace(/\s+/g, ' ').trim();
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, stable(x)])) : v;
export async function sourceSha256(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Extraction remains in the established parser. This only binds each proposal
 * to its own source; the database decides ordering under the case lock. */
export async function prepareRevisionGroups(args: {
  emails: RevisionEmail[]; facts: RevisionFact[];
  ownBody: (raw: string) => string;
  basic: (email: RevisionEmail) => RevisionFact[];
  eligible: (fact: RevisionFact) => boolean;
}): Promise<RevisionGroup[]> {
  const emails = new Map(args.emails.map(e => [e.id, e]));
  const hashes = new Map(await Promise.all(args.emails.map(async e => [e.id, await sourceSha256(e.body_text || '')] as const)));
  const basic = args.emails.flatMap(e => args.basic(e));
  const basicSet = new Set(basic);
  const grouped = new Map<string, RevisionGroup>();
  for (const fact of [...basic, ...args.facts]) {
    // Assumptions and document/derived workflows retain their existing guards.
    if (fact.isAssumption || fact.sourceAttachmentId || !['email_body', 'ai_extraction'].includes(fact.sourceType)
      || fact.key === 'contacts.client_email' || !args.eligible(fact)) continue;
    const email = fact.sourceEmailId ? emails.get(fact.sourceEmailId) : undefined;
    const own = email ? args.ownBody(email.body_text || '') : '';
    let excerpt = fact.sourceExcerpt?.trim() || '';
    if (!excerpt && basicSet.has(fact)) excerpt = own;
    if (basicSet.has(fact) && !normalized(own).includes(normalized(excerpt))) excerpt = own;
    const error = !email ? 'SOURCE_EMAIL_MISSING' : !own.trim() ? 'OWN_TEXT_MISSING'
      : !excerpt || !normalized(own).includes(normalized(excerpt)) ? 'OWN_EXCERPT_NOT_PROVEN' : null;
    if (fact.valueType === 'number' && (typeof fact.value !== 'number' || !Number.isFinite(fact.value))) continue;
    const candidate: RevisionCandidate = {
      email_id: email?.id || null, body_sha256: email ? hashes.get(email.id)! : null,
      excerpt: error ? null : excerpt.slice(0, 2000), value_type: fact.valueType, value: stable(fact.value),
      source_type: fact.sourceType, confidence: Number.isFinite(fact.confidence) ? Math.min(.99, Math.max(0, fact.confidence)) : 0, evidence_error: error,
    };
    const group = grouped.get(fact.key) || { key: fact.key, category: fact.category, candidates: [] };
    if (!group.candidates.some(c => JSON.stringify(c) === JSON.stringify(candidate))) group.candidates.push(candidate);
    grouped.set(fact.key, group);
  }
  return [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key)).map(g => ({ ...g,
    candidates: g.candidates.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  }));
}

export interface RevisionDecision {
  key: string; status: 'applied' | 'confirmed' | 'unchanged' | 'ignored' | 'conflict' | 'protected';
  reason: string; fact_id: string | null; changed: boolean; replay: boolean; had_current?: boolean;
}
export interface RevisionWriter {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Only the admitted server analyser calls this; the RPC independently proves the
 * registered defect from an immutable receipt and derives the successor value. */
export async function reprocessEquipment(client: SupabaseClient, args: {
  caseId: string; actorId: string; groups: RevisionGroup[]; allEmails: RevisionEmail[]; collectionComplete: boolean;
}): Promise<RevisionDecision | null> {
  const group = args.groups.find(g => g.key === 'cargo.containers');
  if (!group || !group.candidates.length || !group.candidates.every(c => c.value_type === 'json' &&
    Array.isArray(c.value) && c.value.length === 1 && /^(20|40)(HC|HQ)$/.test(String(c.value[0]?.type)))) return null;
  if (!args.collectionComplete) throw new Error('Equipment source collection incomplete');
  const {data: current, error: readError} = await client.from('quote_facts')
    .select('id,source_revision_id,source_type,is_validated,source_email_id,source_excerpt,value_json,value_text,value_number,value_date')
    .eq('case_id',args.caseId).eq('fact_key','cargo.containers').eq('is_current',true).maybeSingle();
  if (readError) throw new Error('Equipment state unavailable: '+readError.message);
  if (!current || current.is_validated || current.source_type !== 'email_body' || !current.source_revision_id ||
    !Array.isArray(current.value_json) || current.value_json.length !== 1 ||
    !/^(20|40)GP$/.test(String((current.value_json[0] as {type?:unknown})?.type))) return null;
  const legacy=current.value_json[0] as {type:string;quantity:unknown};
  if(!group.candidates.every(c=>c.email_id===current.source_email_id&&Array.isArray(c.value)&&
    c.value[0]?.quantity===legacy.quantity&&String(c.value[0]?.type).slice(0,2)===legacy.type.slice(0,2)))return null;
  const manifest = await Promise.all([...args.allEmails].sort((a,b)=>a.id.localeCompare(b.id)).map(async e=>({
    id:e.id,sha256:await sourceSha256(e.body_text || ''),from_address:e.from_address??null,sent_at:e.sent_at??null,
  })));
  const command = 'equipment-v2:'+await sourceSha256(JSON.stringify(stable({groups:[group],manifest,
    fact:current.id,revision:current.source_revision_id,rule:'equipment-unicode-suffix/2'})));
  const {data,error} = await client.rpc('reprocess_case_equipment',{
    p_case:args.caseId,p_actor:args.actorId,p_command:command,p_expected_fact:current.id,
    p_expected_revision:current.source_revision_id,p_groups:[group],p_manifest:manifest,
  });
  if (error) throw new Error('Equipment reprocessing failed: '+error.message);
  const receipt = data as Record<string,unknown> | null;
  if(receipt?.status==='not_eligible'&&receipt.rule==='equipment-unicode-suffix/2')return null;
  if (!receipt || receipt.key !== 'cargo.containers' || receipt.status !== 'applied' || receipt.reason !== 'parser_correction' ||
    typeof receipt.fact_id !== 'string' || typeof receipt.changed !== 'boolean' || typeof receipt.replay !== 'boolean') {
    throw new Error('Equipment reprocessing receipt unavailable; verify before retrying');
  }
  return receipt as unknown as RevisionDecision;
}
export async function writeEmailFactRevisions(client: RevisionWriter, args: {
  caseId: string; actorId: string; groups: RevisionGroup[]; allEmails: RevisionEmail[]; collectionComplete: boolean;
}): Promise<RevisionDecision[]> {
  if (args.groups.length === 0) return [];
  if (!args.collectionComplete) throw new Error('Email source collection incomplete; corrections were not applied');
  const manifest = await Promise.all([...args.allEmails].sort((a, b) => a.id.localeCompare(b.id)).map(async e => ({
    id: e.id, sha256: await sourceSha256(e.body_text || ''), from_address: e.from_address ?? null, sent_at: e.sent_at ?? null,
  })));
  const command = await sourceSha256(JSON.stringify(stable({ groups: args.groups, manifest })));
  const { data, error } = await client.rpc('apply_case_email_fact_revisions', {
    p_case: args.caseId, p_actor: args.actorId, p_command: command, p_groups: args.groups, p_manifest: manifest,
  });
  if (error) throw new Error('Email fact corrections could not be recorded: ' + error.message);
  const decisions = data && typeof data === 'object' && 'decisions' in data ? data.decisions : undefined;
  const statuses = new Set(['applied', 'confirmed', 'unchanged', 'ignored', 'conflict', 'protected']);
  if (!Array.isArray(decisions) || decisions.length !== args.groups.length || decisions.some(d => !d ||
    typeof d !== 'object' || !statuses.has(d.status) || typeof d.changed !== 'boolean' || typeof d.replay !== 'boolean' ||
    typeof d.reason !== 'string' || (d.fact_id !== null && typeof d.fact_id !== 'string') ||
    !args.groups.some(g => g.key === d.key)) || new Set(decisions.map(d => d.key)).size !== decisions.length) {
    throw new Error('Email fact correction result unavailable; verify before retrying');
  }
  return decisions as RevisionDecision[];
}
