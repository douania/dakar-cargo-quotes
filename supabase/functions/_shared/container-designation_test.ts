import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {CONTAINER_PROFILES} from './dpw-dthc-tariff.ts';
import {CONTAINER_DESIGNATION_RULE,normalizeContainerDesignation,normalizeContainerInventory,inspectContainerText,SUPPORTED_CONTAINER_DESIGNATION_ALIASES,VERIFIED_ISO_EQUIPMENT} from './container-designation.ts';
import {prepareRevisionGroups} from './email-fact-revisions.ts';
import {readLotContainers} from './lot-confirmation.ts';
import {padGroupAllocationIssue} from './pad-group-confirmation.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const {parseContainersFromText,extractFactsBasic,bindExtractedFactSources}=await import('../build-case-puzzle/index.ts');
const expected=(code:string)=>SUPPORTED_CONTAINER_DESIGNATION_ALIASES[code];
for(const code of Object.keys(CONTAINER_PROFILES))Deno.test('designation matrix: '+code+' through exact token, own parser, binding and lot reader',async()=>{
 const size=code.slice(0,2),suffix=code.slice(2),type=expected(code);
 for(const raw of [code,`${size}'${suffix}`,`${size}’${suffix}`,`${size}′${suffix}`,`${size} ${suffix.toLowerCase()}`,`${size}-${suffix}`,`${size}_${suffix}`,`${size} ft ${suffix}`,`${size} feet ${suffix}`,`${size} pieds ${suffix}`]){
  const d=normalizeContainerDesignation(raw);assertEquals(d.status,'supported',raw);if(d.status==='supported')assertEquals(d.type,type,raw);
  assertEquals(parseContainersFromText('3 × '+raw,false,true),[{type,quantity:3}],raw);
  const email={id:'own',from_address:'client@fixture.invalid',body_text:'No. of containers: 3 × '+raw};
  const fact=extractFactsBasic([email],[]).find(f=>f.key==='cargo.containers');assertEquals(fact?.value,[{type,quantity:3}],raw);
  const bound=bindExtractedFactSources([{...fact!,value:[{type:raw,quantity:3}],sourceType:'ai_extraction'}],[email],[]);assertEquals(bound.length,1,raw);
  assertEquals(readLotContainers([{key:'cargo.containers',value:[{type:raw,quantity:3}]}]),{status:'valid',containers:[{type,quantity:3}]},raw);
  const groups=await prepareRevisionGroups({emails:[email],facts:bound,ownBody:s=>s,basic:()=>[],eligible:()=>true});assertEquals(groups[0].candidates[0].value,[{type,quantity:3}],raw);
 }
});
Deno.test('designation: closed existing aliases and source-preserving semantic conventions',()=>{
 for(const [raw,type] of [['40 dry van','40GP'],['20 dry container','20GP'],['40 general purpose','40GP'],["40 dry 9’6",'40HC'],["20 dry 8'6",'20GP'],['40 flat-rack','40FR'],['20 open-top','20OT'],['20 reefer','20RF']] as const){
  const d=normalizeContainerDesignation(raw);assertEquals(d.status,'supported',raw);if(d.status==='supported')assertEquals(d.type,type,raw);
 }
 for(const [a,b] of [['20GP','40GP'],['40GP','40HC'],['40RF','40HC'],['40FR','40OT'],['40FL','40FR'],['40HC','45HC']]){
  const x=normalizeContainerDesignation(a),y=normalizeContainerDesignation(b);assert(x.status==='supported'&&y.status==='supported');assert(x.type!==y.type);
 }
});
Deno.test('designation: PostgreSQL and TypeScript use the same closed46alias reference',async()=>{
 const sql=await Deno.readTextFile(new URL('../../migrations/20261020104000_equipment_notation_receipts.sql',import.meta.url));
 assertEquals(JSON.parse(/aliases jsonb:='([^']+)'/.exec(sql)![1]),SUPPORTED_CONTAINER_DESIGNATION_ALIASES);
});
Deno.test('designation: verified ISO subtypes are recognized independently from pricing; original code retained',()=>{
 for(const [raw,row] of Object.entries(VERIFIED_ISO_EQUIPMENT)){
  const d=normalizeContainerDesignation(raw);assert(d.status==='recognized_unpriced');assertEquals(d.type,raw);assertEquals(d.details,{lengthFeet:row[0],family:row[1],height:row[2],subtype:row[3],iso:raw});
  assertEquals(normalizeContainerInventory([{type:raw,quantity:1}]).status,'invalid');
  assertEquals(parseContainersFromText('1x'+raw),[]);
 }
 const hc=normalizeContainerDesignation('45G1'),long=normalizeContainerDesignation('L5G1');assert(hc.status==='recognized_unpriced'&&long.status==='recognized_unpriced');assertEquals(hc.details.lengthFeet,40);assertEquals(long.details.lengthFeet,45);
});
Deno.test('designation: ambiguity, unsupported subtypes and qualifiers never select a default dry type',()=>{
 for(const raw of ['40',"40'",'20/40','40/45 HC','DV/HC','40 HC or RF','40RF-HC','40REEFER HC','40OT HC','40FR HC','40RH','40RQ','40OQ','40FQ','40SR','20TK','20TANK','40HT','40PW','20PLATFORM','40NOR','20FR DG SOC','40HQsuffix','53HC','40SIDEOPENING']){
  assert(normalizeContainerDesignation(raw).status!=='supported',raw);
  assertEquals(normalizeContainerInventory([{type:raw,quantity:1}]).status,'invalid',raw);
 }
 for(const raw of ["3x40'",'2x40 mystery','1x40RF HC','2x40 OT HC','1x40/45 HC','1x40 HC or RF']){
  const parsed=inspectContainerText(raw,true);assert(parsed.issues.length>0,raw);assertEquals(parsed.containers,[],raw);
 }
});
Deno.test('designation: numeric references, dimensions, currencies and dates are not equipment',()=>{
 for(const raw of ['2020','2040','400','40 000 USD','40 kg','40 m','Phone: +44 20 12345678','Dimensions40 x20 x45 cm','2026-10-20','RefABC40HC','Invoice420000 XOF'])assertEquals(parseContainersFromText(raw),[],raw);
 assertEquals(parseContainersFromText('2x40HC; phone+44 20 12345678; Incoterm2020'),[{type:'40HC',quantity:2}]);
 for(const text of ['Reference A1B2','cargo C2H6'])assertEquals(inspectContainerText('2x40HC; '+text,true),{containers:[{type:'40HC',quantity:2}],issues:[]});
});
Deno.test('designation: no subtype truncation, fractional/negative count, or competing ownership',()=>{
 for(const raw of ['1x40GP high cube','1x40RF high cube','1x40HC tank','1x40HC SOC COC','1x40HC SOC and COC','1.5x40HC','-1x40HC']){
  const parsed=inspectContainerText(raw,true);assertEquals(parsed.containers,[],raw);assert(parsed.issues.length>0,raw);
 }
 for(const raw of ['3 containers 40HC','3x containers40HC','3 CNTRS 40HC'])assertEquals(inspectContainerText(raw,true),{containers:[{type:'40HC',quantity:3}],issues:[]},raw);
 assertEquals(parseContainersFromText('1x40HQ SOC;1x40HC COC'),[{type:'40HC',quantity:1,coc_soc:'SOC'},{type:'40HC',quantity:1,coc_soc:'COC'}]);
});
Deno.test('designation: two unsupported PAD equipment values can never match as empty strings',()=>{
 const group={unit_ref:'a',equipment_code:'40RH',quantity:1,ownership:'SOC' as const,description:'synthetic',total_weight_kg:null};
 for(const type of ['40TK','40RH'])assertEquals(padGroupAllocationIssue([group],[{key:'cargo.containers',json:[{type,quantity:1,coc_soc:'SOC'}]}]),'PAD_GROUP_ALLOCATION_REQUIRED');
});
Deno.test('designation: unresolved own text is a preserved conflict candidate; raw values and grouping survive normalization',async()=>{
 const email={id:'own',body_text:'No. of containers: 2x40 mystery',from_address:'client@fixture.invalid'};
 const groups=await prepareRevisionGroups({emails:[email],facts:[],ownBody:s=>s,basic:()=>[],eligible:()=>true});assertEquals(groups[0].key,'cargo.containers');assert(groups[0].candidates[0].evidence_error);assert(groups[0].candidates[0].excerpt?.includes('mystery'));
 const original=[{type:"40’ HC",quantity:2,unit_ref:'a'},{type:'40HC',quantity:3,unit_ref:'b'}];
 const normalized=normalizeContainerInventory(original);assertEquals(normalized.status,'valid');assertEquals(normalized.value,[{type:'40HC',quantity:2,unit_ref:'a'},{type:'40HC',quantity:3,unit_ref:'b'}]);assertEquals(original[0].type,'40’ HC');assertEquals(CONTAINER_DESIGNATION_RULE,'container-designation/1');
});
