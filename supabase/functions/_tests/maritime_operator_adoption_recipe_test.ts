import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveSnapshotQualification } from '../generate-quotation-version/qqm-resolver.ts';
import { prepareCommercialQuote, reviseCommercialPreparation } from '../_shared/commercial-preparation.ts';
import { composeCommercialSnapshot } from '../_shared/commercial-snapshot.ts';
import { projectClientQuote } from '../_shared/client-quote-projection.ts';
import { operatorBasisText } from '../_shared/operator-quotation-basis.ts';

// Synthetic structure matching the maritime workflow, never a copied customer quote/rate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HTTP boundary fixture, not domain input.
type Row = Record<string, any>;
const id = '00000000-0000-4000-8000-000000000001';
const basis = {
  schema_version: 1, title: 'SYNTHETIC MARITIME - NE PAS ENVOYER', revision_no: 1,
  source_run_id: id, scope_hash: 'a'.repeat(64), calculated_at: '2026-11-05T12:00:00Z',
  scope: { transport_mode: 'MARITIME', movement_direction: 'IMPORT', origin: {location_code:'TEST-PORT'}, destination:{location_code:'TEST-CITY'},
    cargo_units: [{unit_ref:'test-lot',quantity:20,equipment_code:'20gp',gross_weight_kg:28000,weight_basis:'per_unit',ownership:'COC',dangerous_goods:false,scenario_basis:'COC et zone sous hypothèse synthétique'}]},
  assumptions: [], overlay: [], open_points: [{reason:'customs_regime_unknown'}],
  reservations: [{code:'SCENARIO_DAP_SERVICES_ONLY',message:'Droits et taxes exclus ; prestations DAP uniquement'},
    {code:'TEST_STORAGE',message:'Magasinage à confirmer'}, {code:'TEST_CARRIER',message:'Surestaries à confirmer'}, {code:'TEST_EMPTY',message:'Retour des vides à confirmer'}],
};
const lines = () => [
  {id:'test-thc',description:'THC synthétique',amount:1000,currency:'XOF',bloc:'operationnel',source:{type:'CALCULATED'}},
  {id:'test-delivery',description:'Transport synthétique',amount:2000,currency:'XOF',bloc:'operationnel',source:{type:'OFFICIAL'}},
  {id:'test-pad',description:'Passage synthétique',amount:3000,currency:'XOF',bloc:'operationnel',source:{type:'official'}},
  {id:'test-customs',description:'Honoraires synthétiques',amount:350,currency:'XOF',bloc:'honoraires',source:{type:'validated_internal',confidence:0.95}},
  {id:'test-agency',description:'Agence synthétique',amount:200,currency:'XOF',bloc:'honoraires',source:{type:'validated_internal',confidence:0.95}},
  ...['Magasinage','Surestaries','Retour des vides'].map(description=>({description,amount:null,currency:'XOF',source:{type:'TO_CONFIRM'},bloc:'operationnel'})),
];
const qq = {level:'partial',reasons:[{code:'OPERATOR_QUOTATION_BASIS',message:'Hypothèses'}],firmTotalPolicy:'all_included'};

for (const [flag, vat] of [[false,63],[null,99],['false',99],[true,99],[undefined,99]] as const) {
  Deno.test(`maritime VAT flags ${typeof flag}:${String(flag)}: source semantics and successive commercial revisions preserved`,()=>{
    const raw:Row[]=lines();raw[4].source.vat_applicable=flag;
    const snapshot={operator_basis:basis,meta:{quoteQualification:qq},inputs:{},client:{},raw_lines:raw,lines:raw,
      totals:{currency:'XOF',subtotal_before_sodatra_vat:6550,total_payable:6550+vat,honoraires_ht:550,honoraires_tva:vat}};
    const result=composeCommercialSnapshot(prepareCommercialQuote(id,id,snapshot),id);
    assertEquals(result.totals.honoraires_ht,550);assertEquals(result.totals.honoraires_tva,vat);
    assertEquals(result.totals.honoraires_ttc,550+vat);assertEquals(result.totals.total_payable,6550+vat);
    assertEquals(result.raw_lines[4].bloc,'honoraires');
    const repeated=composeCommercialSnapshot(prepareCommercialQuote(id,id,result),id);
    assertEquals(repeated.totals,result.totals);assertEquals(repeated.raw_lines[4].source.vat_applicable,flag!==false);
    const changed=reviseCommercialPreparation(prepareCommercialQuote(id,id,result),{type:'edit',line_id:'source:4',amount:200,basis:'before_sodatra_vat',reason:'Explicit synthetic before-VAT operator decision'},
      {expected_revision:0,operation_id:'synthetic-operation',actor_id:id,occurred_at:'2026-11-05T12:00:00Z'});
    assertEquals(composeCommercialSnapshot(changed,id).totals.honoraires_tva,99);
  });
}

Deno.test('maritime all honoraria explicitly non-taxable retain zero VAT without inferring exemption from totals',()=>{
  const raw:Row[]=lines();raw[3].source.vat_applicable=false;raw[4].source.vat_applicable=false;
  const snapshot={meta:{quoteQualification:qq},inputs:{},client:{},raw_lines:raw,lines:raw,
    totals:{currency:'XOF',subtotal_before_sodatra_vat:6550,total_payable:6550,honoraires_ht:550,honoraires_tva:0}};
  const result=composeCommercialSnapshot(prepareCommercialQuote(id,id,snapshot),id);
  assertEquals(result.totals.honoraires_ht,550);assertEquals(result.totals.honoraires_tva,0);assertEquals(result.totals.honoraires_ttc,550);
  assertEquals(composeCommercialSnapshot(prepareCommercialQuote(id,id,result),id).totals,result.totals);
  delete raw[3].source.vat_applicable;
  let refused=false;try{composeCommercialSnapshot(prepareCommercialQuote(id,id,snapshot),id);}catch{refused=true;}assert(refused);
});

Deno.test('maritime operator basis: reserves exclude totals and legacy honoraria remain nonfirm without current tariff lookup',()=>{
  const before=JSON.stringify(lines()),result=resolveSnapshotQualification(qq,lines(),undefined,basis);
  assertEquals(result.level,'partial');assertEquals(result.firmTotalPolicy,'excludes_reserved_items');
  assert(result.reasons.some(r=>r.code==='TARIFF_VALIDATION_UNCONFIRMED'));
  assert(result.reasons.some(r=>r.code==='RATE_PENDING_CONFIRMATION'));
  assertEquals(JSON.stringify(lines()),before);
  const legacy=resolveSnapshotQualification(undefined,[],undefined,basis);
  assertEquals(legacy.level,'provisional');
  // Legacy absence continues to use the existing resolver contract.
  assertEquals(resolveSnapshotQualification(undefined,[]),{level:'firm',reasons:[],firmTotalPolicy:'all_included'});
});

Deno.test('maritime commercial revision: filling all priced reserves cannot erase DAP/source partial qualification',()=>{
  const snapshot={operator_basis:basis,meta:{quoteQualification:{...qq,firmTotalPolicy:'excludes_reserved_items'}},inputs:{containers:[{quantity:20}],cargo_weight:560,incoterm:'DAP'},client:{},
    raw_lines:lines(),lines:lines(),totals:{currency:'XOF',subtotal_before_sodatra_vat:6550,total_payable:6649,honoraires_ht:550,honoraires_tva:99}};
  const original=JSON.stringify(snapshot);let draft=prepareCommercialQuote(id,id,snapshot);
  for(const i of [5,6,7])draft=reviseCommercialPreparation(draft,{type:'edit',line_id:`source:${i}`,amount:0,basis:'taxes_included',reason:'Explicit synthetic zero decision only, never a supplier tariff'},
    {expected_revision:draft.revision,operation_id:`test-${i}`,actor_id:id,occurred_at:'2026-11-05T12:00:00Z'});
  const result=composeCommercialSnapshot(draft,id);
  assertEquals(result.commercial.unknown_lines,0);assertEquals(result.totals.total_payable,6649);
  assertEquals(result.meta.quoteQualification.level,'partial');assertEquals(result.meta.quoteQualification.firmTotalPolicy,'excludes_reserved_items');
  assertEquals(result.operator_basis,basis);assertEquals(JSON.stringify(snapshot),original);
  assertStringIncludes(operatorBasisText(result.operator_basis).join('\n'),'Droits et taxes exclus');
});

// Exercise the production version handler, not an implementation mirror. Only HTTP persistence is synthetic.
let versionHandler: ((r:Request)=>Promise<Response>)|undefined;
const originalServe=Deno.serve;
try {
  (Deno as unknown as {serve:(h:typeof versionHandler)=>unknown}).serve=h=>{versionHandler=h;return {};};
  await import('../generate-quotation-version/index.ts');
} finally { Deno.serve=originalServe; }
Deno.test('maritime canonical handler -> snapshot -> commercial projection preserves amounts, three reserves and operator bases',async()=>{
  assert(versionHandler);
  const env=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];const saved=env.map(k=>Deno.env.get(k));
  env.forEach((k,i)=>Deno.env.set(k,i===0?'https://maritime-fixture.invalid':'synthetic-key'));
  const oldFetch=globalThis.fetch;let stored:Row|undefined;let rpcCalls=0;
  const syntheticRun={id,case_id:id,status:'success',run_number:10,inputs_json:{originPort:'TEST-PORT',finalDestination:'TEST-CITY',incoterm:'DAP',containers:[{type:'20GP',quantity:20}],cargoWeight:560},
    facts_snapshot:[{fact_key:'cargo.containers',value_json:[{quantity:50}]}],tariff_lines:lines(),tariff_sources:[],currency:'XOF',total_ht:6550,total_ttc:6649,
    outputs_json:{operator_basis:basis,quoteQualification:qq,totals:{subtotal_before_sodatra_vat:6550,total_payable:6649,honoraires_ht:550,honoraires_tva:99,honoraires_ttc:649}}};
  const sqlOutput=Deno.env.get('DCQ_OPERATOR_RECIPE_OUTPUT');
  const run=sqlOutput ? JSON.parse(await Deno.readTextFile(sqlOutput)) : syntheticRun;
  const activeBasis=run.outputs_json.operator_basis;
  const runId=run.id, caseId=run.case_id, actor=run.created_by ?? id;
  const before=JSON.stringify(run);
  globalThis.fetch=async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);
    assertEquals(url.hostname,'maritime-fixture.invalid','No network/AI allowed');
    const body=request.method==='POST'?await request.json():null;
    const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(url.pathname==='/auth/v1/user')return response({id:actor,email:'test@example.invalid'});
    if(url.pathname.endsWith('/rpc/has_workspace_access'))return response(true);
    if(url.pathname.endsWith('/quote_cases'))return response({id,status:'PRICED_DRAFT',created_by:id,assigned_to:id,thread_id:null});
    if(url.pathname.endsWith('/pricing_runs'))return response(run);
    if(url.pathname.endsWith('/quotation_versions'))return response(null);
    if(url.pathname.endsWith('/runtime_events'))return response(null,201);
    if(url.pathname.endsWith('/rpc/create_canonical_quotation_version')){
      rpcCalls++;stored=body.p_snapshot;
      assertEquals(body.p_actor,actor);assertEquals(body.p_case,caseId);assertEquals(body.p_run,runId);
      assertEquals(body.p_lines.filter((l:Row)=>l.breakdown?.pricing_status==='to_confirm').length,3);
      return response({snapshot:stored,version_id:id,version_number:1,status_after:'QUOTED_VERSIONED',idempotent:false});
    }
    throw Error(`Unexpected I/O ${request.method} ${url.pathname}`);
  };
  try {
    const response=await versionHandler(new Request('https://maritime-fixture.invalid/version',{method:'POST',headers:{Authorization:'Bearer synthetic-user'},body:JSON.stringify({case_id:caseId,pricing_run_id:runId})}));
    assertEquals(response.status,200);assertEquals(rpcCalls,1);assert(stored);
    assertEquals(stored.meta.quoteQualification.level,'partial');assertEquals(stored.meta.quoteQualification.firmTotalPolicy,'excludes_reserved_items');
    assert(stored.meta.quoteQualification.reasons.some((r:Row)=>r.code==='TARIFF_VALIDATION_UNCONFIRMED'));
    assertEquals(stored.inputs.containers[0].quantity,20);assertEquals(stored.inputs.cargo_weight,560);
    assertEquals(stored.operator_basis,activeBasis);assertEquals(stored.totals.honoraires_ht,550);assertEquals(stored.totals.total_payable,6649);
    const projected=projectClientQuote(stored);assertEquals(projected.lines.filter(l=>l.status==='to_confirm').length,3);
    const commercial=composeCommercialSnapshot(prepareCommercialQuote(id,id,stored),id);
    assertEquals(commercial.totals.total_payable,6649);assertEquals(commercial.commercial.unknown_lines,3);
    assertEquals(commercial.operator_basis,activeBasis);assertEquals(commercial.meta.quoteQualification.level,'partial');
    assertEquals(JSON.stringify(run),before);
  } finally {globalThis.fetch=oldFetch;env.forEach((k,i)=>saved[i]===undefined?Deno.env.delete(k):Deno.env.set(k,saved[i]!));}
});
