import { assertEquals,assertRejects,assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapAirRequest,mapAirSources,readAirOperatorRequest,type AirLoadedState,type AirOperatorRequest } from "./air-cross-trade-loader.ts";
import { evaluateAirCrossTrade,retainAirCrossTradePlan } from "./air-cross-trade.ts";
const uid="10000000-0000-4000-8000-000000000001", cid="20000000-0000-4000-8000-000000000001", sid="30000000-0000-4000-8000-000000000001";
export function serverFixture() {
 const facts=[{id:"60000000-0000-4000-8000-000000000001",fact_key:"routing.origin_country",value_text:"Kenya"},
  {id:"60000000-0000-4000-8000-000000000002",fact_key:"routing.destination_country",value_text:"Netherlands"},
  {id:"60000000-0000-4000-8000-000000000003",fact_key:"routing.destination_airport",value_text:"AMS"},
  {id:"60000000-0000-4000-8000-000000000004",fact_key:"cargo.description",value_text:"SYNTHETIC GOODS"},
  {id:"60000000-0000-4000-8000-000000000005",fact_key:"cargo.weight_kg",value_number:30}].map(f=>({...f,source_email_id:"70000000-0000-4000-8000-000000000001",source_type:"ai_extraction",is_current:true}));
 const state:AirLoadedState={case:{id:cid,request_type:"AIR_IMPORT",status:"NEED_INFO"},facts,request_lines:[],context_hash:"ctx1",sources_hash:"src1",
  countries:[{country_code:"KE",country_name:"Kenya"},{country_code:"NL",country_name:"Netherlands"}],
  sources:[{id:sid,kind:"rate_card",row:{id:sid,status:"active",service_key:"AIR_FREIGHT",value:4,currency:"XOF",unit:"kg",min_charge:null,
    origin_country:"KE",destination_country:"NL",origin_port:"NBO",destination_port:"AMS",effective_from:"2020-01-01",effective_to:"2099-12-31"}}],fx:[],head:null};
 const operator:AirOperatorRequest={requested_services:["AIR_FREIGHT"],scope_reference:"SYNTHETIC REQUESTED AIR SERVICE",plan:{route:{departure_country:"KE",departure_airport:"NBO",arrival_country:"NL",arrival_airport:"AMS",pre_carriage:"none",routing_reference:"SYNTHETIC OPERATOR ROUTE",acceptance_reference:"SYNTHETIC ACCEPTANCE"},
 services:[{service_key:"AIR_FREIGHT",disposition:"priced",reason:"SYNTHETIC source retained",source_id:`rate_card:${sid}`,source_role:"purchase",coverage:"air_leg",weight_basis:"gross_kg",applicability_reference:"SYNTHETIC quote bills gross kg",client_sale:{amount_xof:1000,basis:"taxes_included",reason:"SYNTHETIC client amount distinct from purchase"}}]},
 attestations:[{service_key:"AIR_FREIGHT",source_kind:"rate_card",source_id:sid,unit:"kg",effective_from:"2020-01-01",effective_to:"2099-12-31",origin_country:"KE",destination_country:"NL",origin_airport:"NBO",destination_airport:"AMS",required_fact_keys:[],included_services:[],reference:"SYNTHETIC APPLICABILITY EVIDENCE"}]};
 return {state,operator,uid,cid,sid};
}
Deno.test("AIR server mapper: loaded rows → normalized source-bound countries → positive priced candidate",async()=>{
 const {state,operator,uid,cid}=serverFixture(), loaded=await mapAirSources(state,operator), request=mapAirRequest(state,operator);
 operator.plan.services[0].source_fingerprint=loaded.sources[0].fingerprint;
 const retained=retainAirCrossTradePlan({history:[],id:"plan",expected_id:null,actor_id:uid,case_id:cid,expected_context:"ctx1",actual_context:"ctx1",plan:operator.plan});
 const result=evaluateAirCrossTrade({request,retained,context_fingerprint:"ctx1",...loaded,as_of:"2026-10-30"});
 assertEquals(result.ready_to_price,true);assertEquals(result.pricing!.total_ttc,1000);assertEquals(result.pricing!.tariff_sources[0].source_amount_xof,120);
 assertEquals(result.pricing!.facts_snapshot,state.facts);assertEquals(request.origin_country!.source_value,"Kenya");
});
Deno.test("AIR server mapper: inactive, conflicting route/unit and widened validity are refused",async()=>{
 for(const change of [(f:ReturnType<typeof serverFixture>)=>{(f.state.sources[0].row as Record<string,unknown>).status="inactive";},
  (f:ReturnType<typeof serverFixture>)=>{f.operator.attestations[0].origin_country="SN";},
  (f:ReturnType<typeof serverFixture>)=>{f.operator.attestations[0].unit="forfait";},
  (f:ReturnType<typeof serverFixture>)=>{f.operator.attestations[0].effective_from="2019-01-01";}]) {const f=serverFixture();change(f);await assertRejects(()=>mapAirSources(f.state,f.operator));}
});
Deno.test("AIR server mapper: client-supplied fake value does not replace authoritative price",async()=>{
 const f=serverFixture();(f.operator.attestations[0] as unknown as Record<string,unknown>).value=999999;
 assertEquals((await mapAirSources(f.state,f.operator)).sources[0].value,4);
});
Deno.test("AIR server mapper: raw country retained, ambiguous aliases not guessed and operator row self-reference allowed",()=>{
 const f=serverFixture();f.state.countries.push({country_code:"UG",country_name:"Kenya"});
 assertEquals(mapAirRequest(f.state,f.operator).origin_country,null);
 f.state.facts[4].source_type="operator_correction";delete (f.state.facts[4] as Record<string,unknown>).source_email_id;
 assertEquals(mapAirRequest(f.state,f.operator).quantities.gross_kg!.source_id,"60000000-0000-4000-8000-000000000005");
});
Deno.test("AIR server mapper: attestation mandatory and source fingerprint binds full loaded row",async()=>{
 const f=serverFixture();assertThrows(()=>readAirOperatorRequest({...f.operator,attestations:[{source_id:f.sid}]}));
 const first=(await mapAirSources(f.state,f.operator)).sources[0].fingerprint;
 (f.state.sources[0].row as Record<string,unknown>).notes="Changed source condition";
 assertEquals((await mapAirSources(f.state,f.operator)).sources[0].fingerprint===first,false);
});

Deno.test("AIR partner amounts: total, kg rate and purchase role retain their structured meaning",async()=>{
 const f=serverFixture();const partner={id:f.sid,kind:"partner_fact",row:{id:f.sid,case_id:f.cid,request_id:"request",response_id:"response",fact_key:"cargo.freight_cost",proposed_value_number:120,currency:"XOF",validation_status:"validated",validated_by:f.uid,validated_at:"2026-10-30T00:00:00Z",source_excerpt:"SYNTHETIC TOTAL QUOTE"},response:{id:"response",request_id:"request",source_email_id:"synthetic-partner-mail"},request:{id:"request",case_id:f.cid}};
 f.state.sources=[partner];f.operator.attestations[0].source_kind="partner_fact";f.operator.plan.services[0].source_id=`partner_fact:${f.sid}`;
 await assertRejects(()=>mapAirSources(f.state,f.operator));
 f.operator.attestations[0].unit="forfait";assertEquals((await mapAirSources(f.state,f.operator)).sources[0].value,120);
 partner.row.fact_key="cargo.freight_rate_per_kg";await assertRejects(()=>mapAirSources(f.state,f.operator));
 f.operator.attestations[0].unit="kg";assertEquals((await mapAirSources(f.state,f.operator)).sources[0].unit,"kg");
 f.operator.plan.services[0].source_role="sale";await assertRejects(()=>mapAirSources(f.state,f.operator));
});

Deno.test("AIR attestation: malformed identities always refuse; pending qualification can stay incomplete",()=>{
 const f=serverFixture();for(const bad of [null,{}, {source_id:f.sid},{source_kind:"rate_card",source_id:f.sid,service_key:""}])assertThrows(()=>readAirOperatorRequest({...f.operator,attestations:[bad]}));
 f.operator.plan.services[0].disposition="pending";
 assertEquals(readAirOperatorRequest({...f.operator,attestations:[{source_kind:"rate_card",source_id:f.sid,service_key:"AIR_FREIGHT"}]}).plan.services[0].disposition,"pending");
});
Deno.test("AIR rate countries: official catalogue names normalize without widening an ambiguous country",async()=>{
 const f=serverFixture();(f.state.sources[0].row as Record<string,unknown>).origin_country="Kenya";
 assertEquals((await mapAirSources(f.state,f.operator)).sources[0].origin_country,"KE");
 f.state.countries.push({country_code:"UG",country_name:"Kenya"});await assertRejects(()=>mapAirSources(f.state,f.operator));
});

Deno.test("AIR country compatibility: documented Guinea-Bissau survives a locations catalogue containing only Belgium",()=>{
 const f=serverFixture();f.state.countries=[{country_code:"BE",country_name:"Belgium"}];f.state.facts[0].value_text="Guinea-Bissau";f.state.facts[1].value_text="Belgium";
 const request=mapAirRequest(f.state,f.operator);assertEquals(request.origin_country?.value,"GW");assertEquals(request.origin_country?.source_value,"Guinea-Bissau");assertEquals(request.destination_country?.value,"BE");
});
Deno.test("AIR source compatibility: known country aliases do not require an invented location row",async()=>{
 const f=serverFixture();f.state.countries=[{country_code:"BE",country_name:"Belgium"}];(f.state.sources[0].row as Record<string,unknown>).origin_country="Guinea-Bissau";(f.state.sources[0].row as Record<string,unknown>).destination_country="Belgium";f.operator.attestations[0].origin_country="GW";f.operator.attestations[0].destination_country="BE";
 assertEquals((await mapAirSources(f.state,f.operator)).sources[0].origin_country,"GW");
});

Deno.test("AIR country recognition does not decide routing or cargo acceptance for a synthetic special consignment",async()=>{
 const f=serverFixture();f.state.countries=[{country_code:"BE",country_name:"Belgium"}];f.state.facts[0].value_text="Guinea-Bissau";f.state.facts[1].value_text="Belgium";f.state.facts[3].value_text="SYNTHETIC UN3373 category B test consignment";
 const before=JSON.stringify(f.state.facts);f.operator.plan.services[0].disposition="pending";f.operator.plan.route.departure_airport="";f.operator.plan.route.departure_country="";f.operator.plan.route.arrival_country="BE";f.operator.plan.route.acceptance_reference=null;
 const request=mapAirRequest(f.state,f.operator),loaded=await mapAirSources(f.state,f.operator),retained=retainAirCrossTradePlan({history:[],id:"test-plan",expected_id:null,actor_id:f.uid,case_id:f.cid,expected_context:"ctx1",actual_context:"ctx1",plan:f.operator.plan});
 const result=evaluateAirCrossTrade({request,retained,context_fingerprint:"ctx1",...loaded,as_of:"2026-10-31"});assertEquals(result.classification,"eligible");assertEquals(result.ready_to_price,false);assertEquals(result.needs.some(n=>n.key==="cargo.acceptance"),true);assertEquals(JSON.stringify(f.state.facts),before);assertEquals(f.operator.plan.route.departure_airport,"");
});
