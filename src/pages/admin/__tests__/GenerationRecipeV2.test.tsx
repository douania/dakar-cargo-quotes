import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useLayoutEffect } from 'react';
import GenerationRecipe from '../GenerationRecipeV2';
import { IDEMPOTENT_RECIPE, RECIPE_V2_MARKER, LEGACY_RECIPE_MARKER, readRecipeMarker, readRecipeReceiptV2 } from '@/lib/generationRecipeV2';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T = '11111111-1111-4111-8111-111111111111', P = '22222222-2222-4222-8222-222222222222', D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const G = '99999999-9999-4999-8999-999999999999';
const KEY = RECIPE_V2_MARKER;
type Row = Record<string, unknown>;
type Reply = { data: unknown; error: unknown; count?: number | null };
const f = vi.hoisted(() => ({ user: null as { id: string; email: string } | null, authStatus: 'authenticated', getUser: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), reads: [] as { table: string; fields: string; filters: Record<string, unknown>; options: unknown }[], reply: {} as Record<string, Reply>, persisted: null as Row | null }));
vi.mock('@/features/auth', () => ({ useAuth: () => ({ user: f.user, authStatus: f.authStatus }) }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: (...args: unknown[]) => f.getUser(...args) }, rpc: (...args: unknown[]) => f.rpc(...args),
  functions: { invoke: (...args: unknown[]) => f.invoke(...args) },
  from: (table: string) => {
    if (!['emails', 'quote_cases', 'email_attachments', 'email_drafts'].includes(table)) throw new Error(`Unexpected table: ${table}`);
    const read = { table, fields: '', filters: {} as Record<string, unknown>, options: undefined as unknown };
    const query = {
      select: (fields: string, options?: unknown) => { read.fields = fields; read.options = options; return query; },
      eq: (key: string, value: unknown) => { read.filters[key] = value; return query; },
      limit: (n: number) => { expect(n).toBe(2); return query; },
      range: (start: number, end: number) => { expect([start, end]).toEqual([0, 999]); return query; },
      single: () => query,
      then: (resolve: (reply: Reply) => unknown, reject: (reason: unknown) => unknown) => {
        f.reads.push(read);
        const reply = table === 'email_drafts' && read.filters.id ? { data: f.persisted, error: null } : f.reply[table];
        return Promise.resolve(reply).then(resolve, reject);
      },
    };
    return query;
  },
} }));


function draft() { return {id:D,original_email_id:E,created_by:A,status:'draft',sent_at:null,subject:'[RECETTE AUTH] Synthetic'}; }
function good(state='completed',revoked=false) { return {ok:true,data:{success:true,recipe_mode:IDEMPOTENT_RECIPE,zone_reply_contract:'optional_factor_v1',
 recipe_receipt:{kind:'receipt',grant_id:G,actor_id:A,case_id:C,email_id:E,state,attempt_id:state==='authorized'?null:P,draft_id:state==='completed'?D:null,engine_verified:state==='completed'?true:null,revoked},
 recipe_effects:{draft_persisted:true,application_ai_calls_occurred:true,usage_counters_may_change:true,attachment_analysis_performed:false,files_created:false,download_links_created:false},attachment_needed:false,attachment_data:null,generated_attachment:null}}; }
beforeEach(()=>{
 f.user={id:A,email:'operator@example.invalid'};f.authStatus='authenticated';f.reads=[];
 f.getUser.mockReset().mockResolvedValue({data:{user:f.user},error:null});f.rpc.mockReset().mockResolvedValue({data:true,error:null});
 f.reply={emails:{data:{id:E,subject:'Synthetic',thread_ref:T},error:null},quote_cases:{data:[{id:C,thread_id:T}],error:null},email_attachments:{data:[{id:P,email_id:E,is_analyzed:true}],count:1,error:null},email_drafts:{data:null,count:0,error:null}};
 f.persisted=draft();f.invoke.mockReset().mockResolvedValue({data:good(),error:null});sessionStorage.clear();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No connected fetch in synthetic tests');}));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const show=()=>render(<MemoryRouter><GenerationRecipe/></MemoryRouter>);
async function fill(){for(const[label,value]of [['Opérateur autorisé (UUID)',A],['Dossier (UUID)',C],['Courriel (UUID)',E],['Autorisation de recette (UUID)',G]])fireEvent.change(screen.getByLabelText(label),{target:{value}});}
const check=()=>userEvent.click(screen.getByRole('button',{name:'Vérifier avant l’essai'}));
const status=()=>userEvent.click(screen.getByRole('button',{name:'Consulter le résultat sans relancer'}));
const generate=()=>userEvent.click(screen.getByRole('button',{name:'Exécuter l’essai interne une fois'}));
async function ready(){await fill();await check();await screen.findByText('Vérification effectuée');await userEvent.click(screen.getByRole('checkbox'));}
const saved=()=>({actorId:A,caseId:C,emailId:E,grantId:G,attemptId:P,attemptedAt:'2026-11-05T12:00:00.000Z'});

it('makes no API calls on load and requires four UUIDs with focused error',async()=>{show();expect(f.invoke).not.toHaveBeenCalled();expect(f.getUser).not.toHaveBeenCalled();await check();expect(await screen.findByRole('alert')).toHaveTextContent('quatre identifiants');expect(screen.getByLabelText('Opérateur autorisé (UUID)')).toHaveFocus();expect(f.reads).toHaveLength(0);});
it('reads only existing metadata before execution',async()=>{show();await ready();expect(f.reads.map(r=>r.table)).toEqual(['emails','quote_cases','email_attachments','email_drafts']);expect(f.reads.map(r=>r.fields).join()).not.toMatch(/body|storage|extracted|token/);expect(f.invoke).not.toHaveBeenCalled();});
it('writes one stable nonsecret marker before one versioned run and confirms persisted owner draft',async()=>{show();await ready();await generate();await screen.findByText('Brouillon interne confirmé');expect(f.invoke).toHaveBeenCalledTimes(1);const [name,options]=f.invoke.mock.calls[0];expect(name).toBe('generate-response');const m=readRecipeMarker(sessionStorage.getItem(KEY)!);expect(options.body).toMatchObject({recipe_mode:IDEMPOTENT_RECIPE,recipe_action:'run',recipe_grant_id:G,recipe_case_id:C,recipe_email_id:E,recipe_attempt_id:m.attemptId,zone_reply_contract:'optional_factor_v1'});expect(options).not.toHaveProperty('headers');expect(options.body).not.toHaveProperty('emailId');expect(options.body).not.toHaveProperty('quotationData');expect(options.body).not.toHaveProperty('actor_id');expect(options.body).not.toHaveProperty('fence');expect(Object.keys(m).sort()).toEqual(['actorId','attemptId','attemptedAt','caseId','emailId','grantId'].sort());expect(f.getUser).toHaveBeenCalledTimes(2);expect(f.reads.at(-1)?.filters).toEqual({id:D,original_email_id:E,created_by:A});expect(screen.queryByRole('button',{name:'Exécuter l’essai interne une fois'})).not.toBeInTheDocument();expect(fetch).not.toHaveBeenCalled();});
it('status is receipt-only: no preflight, registration, marker write or generation intent',async()=>{show();await fill();await status();await screen.findByText('Brouillon interne confirmé');expect(f.getUser).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();expect(sessionStorage.getItem(KEY)).toBeNull();expect(f.invoke).toHaveBeenCalledWith('generate-response',{body:{recipe_mode:IDEMPOTENT_RECIPE,recipe_action:'status',recipe_grant_id:G,recipe_email_id:E,recipe_case_id:C}});expect(f.reads.map(r=>r.table)).toEqual(['email_drafts']);});
it('valid uppercase UUID fields keep the normalized own receipt visible',async()=>{show();await fill();for(const[label,value]of [['Opérateur autorisé (UUID)',A],['Dossier (UUID)',C],['Courriel (UUID)',E],['Autorisation de recette (UUID)',G]])fireEvent.change(screen.getByLabelText(label),{target:{value:value.toUpperCase()}});await status();await screen.findByText('Brouillon interne confirmé');expect(screen.getByRole('button',{name:'Fermer l’autorisation de recette'})).toBeVisible();expect(f.invoke.mock.calls[0][1].body.recipe_case_id).toBe(C);});
it('recovers a lost response by consulting the same server grant without a second run',async()=>{f.invoke.mockResolvedValueOnce({data:null,error:new Error('unconfirmed')}).mockResolvedValue({data:good(),error:null});show();await ready();await generate();expect(await screen.findByRole('alert')).toHaveTextContent('des frais IA');const m=sessionStorage.getItem(KEY);await status();await screen.findByText('Brouillon interne confirmé');expect(sessionStorage.getItem(KEY)).toBe(m);expect(f.invoke.mock.calls.map(c=>c[1].body.recipe_action)).toEqual(['run','status']);});
it.each(['running','uncertain'])('unresolved %s receipt blocks all new work without claiming the worker is alive',async state=>{f.invoke.mockResolvedValue({data:good(state),error:null});show();await fill();await status();await screen.findByText('Traitement non confirmé ; courriel réservé');expect(screen.getByRole('button',{name:'Vérifier avant l’essai'})).toBeDisabled();expect(f.reads).toHaveLength(0);expect(screen.getByText(/ne prouve pas que le serveur travaille encore/)).toBeInTheDocument();expect(f.invoke).toHaveBeenCalledTimes(1);});
it('authorized without terminal receipt does not claim a completed draft',async()=>{f.invoke.mockResolvedValue({data:good('authorized'),error:null});show();await fill();await status();await screen.findByText('Autorisation enregistrée ; aucun reçu terminal');expect(f.reads).toHaveLength(0);expect(screen.queryByText('Brouillon interne confirmé')).not.toBeInTheDocument();});
it('closing a completed authorization is explicit and never automatic on status',async()=>{show();await fill();await status();await screen.findByText('Brouillon interne confirmé');expect(f.invoke.mock.calls.map(c=>c[1].body.recipe_action)).toEqual(['status']);f.invoke.mockResolvedValue({data:good('completed',true),error:null});await userEvent.click(screen.getByRole('button',{name:'Fermer l’autorisation de recette'}));await screen.findByText('L’autorisation est fermée ; les états non confirmés restent réservés.');expect(f.invoke.mock.calls.map(c=>c[1].body.recipe_action)).toEqual(['status','revoke']);expect(sessionStorage.getItem(KEY)).toBeNull();});
it('legacy marker is preserved and never converted to a new grant or cleared',()=>{sessionStorage.setItem(LEGACY_RECIPE_MARKER,JSON.stringify({old:'unknown'}));show();expect(screen.getByRole('alert')).toHaveTextContent('Ancienne tentative sans reçu durable');expect(screen.getByRole('button',{name:'Vérifier avant l’essai'})).toBeDisabled();expect(sessionStorage.getItem(LEGACY_RECIPE_MARKER)).not.toBeNull();expect(f.invoke).not.toHaveBeenCalled();});
it('reload restores own IDs and only permits receipt consultation',async()=>{sessionStorage.setItem(KEY,JSON.stringify(saved()));show();expect(screen.getByLabelText('Autorisation de recette (UUID)')).toHaveValue(G);expect(screen.getByRole('button',{name:'Vérifier avant l’essai'})).toBeDisabled();await status();await screen.findByText('Brouillon interne confirmé');expect(f.invoke.mock.calls[0][1].body).not.toHaveProperty('recipe_attempt_id');});
it('another operator never sees saved target IDs',()=>{sessionStorage.setItem(KEY,JSON.stringify(saved()));f.user={id:P,email:'other@example.invalid'};show();expect(screen.getByLabelText('Autorisation de recette (UUID)')).toHaveValue('');expect(screen.getByLabelText('Courriel (UUID)')).toHaveValue('');expect(f.invoke).not.toHaveBeenCalled();});
it('corrupt marker blocks generation without displaying its payload',()=>{sessionStorage.setItem(KEY,'PRIVATE_SYNTHETIC_MARKER');show();expect(screen.getByRole('alert')).toHaveTextContent('Suivi indisponible');expect(screen.queryByText('PRIVATE_SYNTHETIC_MARKER')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Vérifier avant l’essai'})).toBeDisabled();});
it('storage read failure leaves readonly consultation available',async()=>{vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked');});show();await fill();await status();await screen.findByText('Brouillon interne confirmé');expect(f.getUser).not.toHaveBeenCalled();expect(f.invoke).toHaveBeenCalledTimes(1);});
it('failed marker write prevents any generation call',async()=>{show();await ready();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});await generate();expect(await screen.findByText('Suivi indisponible')).toBeInTheDocument();expect(f.invoke).not.toHaveBeenCalled();});
it('double click cannot admit two client requests',async()=>{let settle!:(value:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{settle=r;}));show();await ready();fireEvent.click(screen.getByRole('button',{name:'Exécuter l’essai interne une fois'}));fireEvent.click(screen.getByRole('button',{name:'Exécuter l’essai interne une fois'}));await waitFor(()=>expect(f.invoke).toHaveBeenCalledTimes(1));await act(async()=>settle({data:good(),error:null}));await screen.findByText('Brouillon interne confirmé');});
it('90-second timeout retains marker and ignores late output',async()=>{show();await ready();let settle!:(value:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{settle=r;}));vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Exécuter l’essai interne une fois'}));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});expect(f.invoke).toHaveBeenCalledTimes(1);await act(async()=>{await vi.advanceTimersByTimeAsync(90001);});expect(screen.getByRole('alert')).toHaveTextContent('Consultez le reçu sans relancer');expect(sessionStorage.getItem(KEY)).not.toBeNull();await act(async()=>settle({data:good(),error:null}));expect(screen.queryByText('Brouillon interne confirmé')).not.toBeInTheDocument();});
it('late status output cannot cross an identity change',async()=>{let settle!:(value:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{settle=r;}));const view=show();await fill();await status();f.user={id:P,email:'other@example.invalid'};view.rerender(<MemoryRouter><GenerationRecipe/></MemoryRouter>);await act(async()=>settle({data:good(),error:null}));expect(screen.queryByText('Brouillon interne confirmé')).not.toBeInTheDocument();expect(f.reads).toHaveLength(0);});
it('already displayed receipt disappears at the identity-change commit before passive cleanup',async()=>{const commits:string[]=[];function Probe(){useLayoutEffect(()=>{commits.push(document.body.textContent??'');});return null;}const view=render(<MemoryRouter><GenerationRecipe/><Probe/></MemoryRouter>);await fill();await status();await screen.findByText('Brouillon interne confirmé');commits.length=0;f.user={id:P,email:'other@example.invalid'};view.rerender(<MemoryRouter><GenerationRecipe/><Probe/></MemoryRouter>);expect(commits.length).toBeGreaterThan(0);expect(commits.every(text=>!text.includes(D)&&!text.includes('Brouillon interne confirmé'))).toBe(true);});
it('completed receipt with missing owner draft never enables regeneration',async()=>{f.persisted=null;show();await fill();await status();await screen.findByText('Reçu terminé ; relecture du brouillon non confirmée');expect(screen.getByRole('button',{name:'Vérifier avant l’essai'})).toBeDisabled();expect(screen.queryByRole('button',{name:'Fermer l’autorisation de recette'})).not.toBeInTheDocument();});
it.each(['unauthenticated','loading','timeout'])('auth state %s cannot invoke',async state=>{f.authStatus=state;show();await fill();expect(screen.getByRole('button',{name:'Consulter le résultat sans relancer'})).toBeDisabled();expect(f.invoke).not.toHaveBeenCalled();});
it.each([
 ['workspace revoked',()=>f.rpc.mockResolvedValue({data:false,error:null})],
 ['wrong operator',()=>f.getUser.mockResolvedValue({data:{user:{id:P}},error:null})],
 ['ambiguous case',()=>{f.reply.quote_cases.data=[{id:C,thread_id:T},{id:P,thread_id:T}];}],
 ['wrong case',()=>{f.reply.quote_cases.data=[{id:P,thread_id:T}];}],
 ['unanalyzed attachment',()=>{f.reply.email_attachments.data=[{id:P,email_id:E,is_analyzed:false}];}],
 ['incomplete attachment count',()=>{f.reply.email_attachments.count=null;}],
 ['preexisting draft',()=>{f.reply.email_drafts.count=1;}],
] as const)('preflight refuses %s without any generation',async(_,change)=>{change();show();await fill();await check();expect(await screen.findByRole('alert')).toBeInTheDocument();expect(f.invoke).not.toHaveBeenCalled();});
it.each(['RECIPE_LEDGER_NOT_READY','RECIPE_TARGET_UNRESOLVED','RECIPE_GRANT_CONFLICT'])('shows filtered diagnostic %s without private payload',async code=>{f.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:{code,message:'PRIVATE_SYNTHETIC_BODY'},correlation_id:C}),{status:409})}});show();await fill();await status();expect(await screen.findByRole('alert')).toHaveTextContent(code);expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE_SYNTHETIC');expect(f.invoke).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(KEY)).toBeNull();});
it.each(['grant_id','actor_id','case_id','email_id'])('rejects mismatched receipt %s before persisted read',async key=>{const g=good();(g.data.recipe_receipt as Record<string,unknown>)[key]=T;f.invoke.mockResolvedValue({data:g,error:null});show();await fill();await status();expect(await screen.findByRole('alert')).toBeInTheDocument();expect(f.reads).toHaveLength(0);});
it('rejects missing effects or files and preserves strict marker parsing',()=>{const target={actorId:A,caseId:C,emailId:E,grantId:G};const g=good();g.data.recipe_effects.files_created=true;expect(()=>readRecipeReceiptV2(g,target)).toThrow();expect(()=>readRecipeMarker(JSON.stringify({...saved(),token:'PRIVATE'}))).toThrow();});
