import {assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('QUOTATION_ENGINE_DISABLE_SERVE','1');
const {generateQuotationLines}=await import('../quotation-engine/index.ts');
const fixture={cargo_type:'FCL',provider:'PAD',free_days:15,rate_per_day:5000,rate_unit:'XOF/EVP/jour',source_document:'SYNTHETIC maritime-only franchise'};
function db(){const reads:string[]=[];return {reads,from(table:string){reads.push(table);const data=table==='warehouse_franchise'?[fixture]:[];const chain=new Proxy({}, {get:(_target,key)=>key==='then'?(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve,reject):()=>chain});return chain;}};}
const request={incoterm:'DDP',finalDestination:'Dakar',cargoType:'GENERAL_CARGO',cargoWeight:.22,containers:[]};
Deno.test('AIR: maritime franchise never supplies a free storage amount or terms',async()=>{
 const client=db(),result=await generateQuotationLines(client,{...request,transportMode:'aerien'});
 const storage=result.lines.find(l=>l.id==='warehouse_franchise');
 assertEquals(storage?.amount,null);assertEquals(storage?.source.type,'TO_CONFIRM');
 assertEquals(client.reads.includes('warehouse_franchise'),false);
 assertEquals(/15|5000|EVP|PAD|FCL/.test(storage?.description??''),false);
});
Deno.test('Maritime: existing explicit franchise result remains unchanged',async()=>{
 const client=db(),result=await generateQuotationLines(client,{...request,transportMode:'maritime'});
 const storage=result.lines.find(l=>l.id==='warehouse_franchise');
 assertEquals(storage?.amount,0);assertEquals(storage?.source.type,'OFFICIAL');
 assertEquals(storage?.description.includes('15 jours'),true);assertEquals(client.reads.includes('warehouse_franchise'),true);
});
