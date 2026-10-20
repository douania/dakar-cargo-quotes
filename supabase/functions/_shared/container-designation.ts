// Documentary normalization only. The tariff/reference modules remain unchanged.
import {CONTAINER_PROFILES,DTHC_CONTAINER_TYPE_ALIASES} from './dpw-dthc-tariff.ts';
export const CONTAINER_DESIGNATION_RULE='container-designation/1';
export type ContainerDesignation = {status:'supported';type:string;raw:string;rule:string}
 | {status:'recognized_unpriced';type:string;raw:string;reason:string;rule:string;details:Record<string,unknown>}
 | {status:'ambiguous'|'unsupported';raw:unknown;reason:string;rule:string};
const marks=/[‘’′ʼ＇]/g;
const suffixAliases:Readonly<Record<string,string>>={FLATRACK:'FR',OPENTOP:'OT',REEFER:'RF',STD:'ST',DRYVAN:'DV',DRYCONTAINER:'DC',GENERALPURPOSE:'GP',HIGHCUBE:'HC'};
const canonical=(type:string)=>type.replace(/(DV|DC|ST)$/,'GP').replace(/HQ$/,'HC');
export const SUPPORTED_CONTAINER_DESIGNATION_ALIASES:Readonly<Record<string,string>>=Object.freeze(Object.fromEntries([
 ...Object.keys(CONTAINER_PROFILES).map(k=>[k,canonical(k)]),
 ...Object.entries(DTHC_CONTAINER_TYPE_ALIASES).filter(([k])=>!/(DG|SOC|COC)/.test(k)).map(([k,v])=>[k,canonical(v)]),
 ...[20,40,45].flatMap(size=>Object.entries(suffixAliases).filter(([,code])=>Object.prototype.hasOwnProperty.call(CONTAINER_PROFILES,size+code)).map(([alias,code])=>[size+alias,canonical(size+code)])),
]));
// Closed, documented ISO examples. Preserve the whole code and subtype; no tariff projection.
// Hapag-Lloyd container-type-groups.html; BIC size-type-code/type-code-designation (20 Oct 2026).
export const VERIFIED_ISO_EQUIPMENT:Readonly<Record<string,readonly [number,string,string,string]>>={
 '22G0':[20,'DRY','STANDARD','general purpose'],'22G1':[20,'DRY','STANDARD','passive vents'],
 '42G0':[40,'DRY','STANDARD','general purpose'],'42G1':[40,'DRY','STANDARD','passive vents'],
 '45G0':[40,'DRY','HC','general purpose'],'45G1':[40,'DRY','HC','passive vents'],'L5G1':[45,'DRY','HC','passive vents'],
 '22R1':[20,'REEFER','STANDARD','refrigerated'],'45R1':[40,'REEFER','HC','refrigerated'],
 '22U1':[20,'OPEN_TOP','STANDARD','open top'],'42U1':[40,'OPEN_TOP','STANDARD','open top'],'45U1':[40,'OPEN_TOP','HC','open top'],
 '22U6':[20,'HARDTOP','STANDARD','hardtop'],'42U6':[40,'HARDTOP','STANDARD','hardtop'],'45U6':[40,'HARDTOP','HC','hardtop'],
 '22P1':[20,'FLAT_RACK','STANDARD','fixed ends'],'42P1':[40,'FLAT_RACK','STANDARD','fixed ends'],
 '22P3':[20,'FLAT_RACK','STANDARD','collapsible'],'42P3':[40,'FLAT_RACK','STANDARD','collapsible'],'45P3':[40,'FLAT_RACK','HC','collapsible'],
 '22V0':[20,'VENTILATED','STANDARD','ventilated'],'22T0':[20,'TANK','STANDARD','nondangerous liquids'],
 '22T5':[20,'TANK','STANDARD','dangerous liquids; test pressure4bar'],'22T6':[20,'TANK','STANDARD','dangerous liquids; test pressure6bar'],
};

/** Match the whole designation, never a numeric prefix or a tariff fallback. */
export function normalizeContainerDesignation(raw:unknown):ContainerDesignation {
 const fail=(status:'ambiguous'|'unsupported',reason:string):ContainerDesignation=>({status,raw,reason,rule:CONTAINER_DESIGNATION_RULE});
 if(typeof raw!=='string'||!raw.trim())return fail('unsupported','DESIGNATION_MISSING');
 const text=raw.normalize('NFKC').replace(marks,"'").toUpperCase().trim();
 if(/[/|?]|\b(?:OR|OU)\b/.test(text))return fail('ambiguous','ALTERNATIVE_OR_UNCERTAIN_TYPE');
 const iso=VERIFIED_ISO_EQUIPMENT[text];
 if(iso)return {status:'recognized_unpriced',type:text,raw,rule:CONTAINER_DESIGNATION_RULE,reason:'ISO_SUBTYPE_NOT_ADOPTED',
  details:{lengthFeet:iso[0],family:iso[1],height:iso[2],subtype:iso[3],iso:text}};
 if(/^[0-9A-Z][0-9][A-Z][0-9]$/.test(text))return fail('unsupported','ISO_SUBTYPE_UNVERIFIED');
 const m=/^(20|40|45)(?!\d)([\s\S]*)$/.exec(text);
 if(!m)return fail('unsupported','SIZE_OR_SYNTAX_UNSUPPORTED');
 let tail=m[2].replace(/^\s*(?:FT\.?|FEET|FOOT|PIEDS?)(?=\s|['._-]|[A-Z]|$)/,'');
 if(!/^[A-Z0-9\s'._()–—-]*$/.test(tail))return fail('unsupported','DESIGNATION_SYNTAX_UNSUPPORTED');
 tail=tail.replace(/[\s'._()–—-]/g,'');
 if(!tail)return fail('ambiguous','EQUIPMENT_TYPE_MISSING');
 const joined=m[1]+tail;
 if(/(?:DG|SOC|COC|NOR|NONOPERATING)/.test(tail))return fail('unsupported','EQUIPMENT_QUALIFIERS_REQUIRE_REVIEW');
 const compound=/^(REEFER|RF|OPENTOP|OT|FLATRACK|FR|GP|DV|DC|DRY)(?:HC|HQ|HIGHCUBE)$/.exec(tail);
 if(compound)return {status:'recognized_unpriced',type:m[1]+tail,raw,rule:CONTAINER_DESIGNATION_RULE,reason:'HEIGHT_SUBTYPE_NOT_ADOPTED',
  details:{lengthFeet:Number(m[1]),family:compound[1],height:'HC'}};
 if(/^(RH|RQ|OQ|FQ|SR|RE|REEF|HT|HARDTOP|TK|TANK|ISOTANK|CITERNE|PLATFORM|PW|PALLETWIDE|BK|BULK|VENTILATED|INSULATED|GOH|GARMENTAINER|AUTOTAINER|SIDEOPENING|DOUBLEDoor|CONTROLLEDATMOSPHERE)$/i.test(tail))
  return {status:'recognized_unpriced',type:joined,raw,rule:CONTAINER_DESIGNATION_RULE,reason:'SUBTYPE_OR_ISSUER_CONVENTION_NOT_ADOPTED',details:{lengthFeet:Number(m[1]),subtype:tail}};
 // Closed intake aliases already documented by the existing reference.
 const known=SUPPORTED_CONTAINER_DESIGNATION_ALIASES[joined];
 if(!known)return fail('unsupported','EQUIPMENT_SUBTYPE_UNSUPPORTED');
 // Existing source parser already equates dry DV/STD with GP; common dry aliases
 // are attested by DSV/MSC, and dry HQ/HC by OOCL. Special equipment stays distinct.
 const type=known;
 return {status:'supported',type,raw,rule:CONTAINER_DESIGNATION_RULE};
}

export function normalizeContainerInventory(raw:unknown) {
 if(!Array.isArray(raw)||!raw.length)return {status:'invalid' as const,value:raw,reason:'CONTAINER_INVENTORY_INVALID'};
 const value:Array<Record<string,unknown>&{type:string;quantity:number}>=[];
 for(const row of raw){
  if(!row||typeof row!=='object'||Array.isArray(row)||!Number.isSafeInteger(row.quantity)||row.quantity<=0)
   return {status:'invalid' as const,value:raw,reason:'CONTAINER_QUANTITY_INVALID'};
  const designation=normalizeContainerDesignation(row.type);
  if(designation.status!=='supported')return {status:'invalid' as const,value:raw,reason:designation.reason};
  value.push({...row,type:designation.type,quantity:row.quantity});
 }
 return {status:'valid' as const,value,reason:null};
}

export interface ContainerTextIssue {raw:string;reason:string;index:number;}
/** Quantity separators and whole tokens prevent years, phones and dimensions becoming cargo. */
export function inspectContainerText(raw:string,explicitQuantityOnly=false) {
 const text=raw.normalize('NFKC').replace(marks,"'").toUpperCase();
 const re=/(?<![A-Z0-9.,-])(?:(\d{1,6})(?:\s*(?:X|×|\*|PCS?)\s*|\s+)(?:CONT(?:A)?INERS?\s*|CNTRS?\s*)?)?(20|40|45)(?!\d)/g;
 const containers:Array<{type:string;quantity:number;coc_soc?:string}>=[],issues:ContainerTextIssue[]=[];
 for(const invalid of text.matchAll(/(?<![A-Z0-9])(?:-\d+|\d+[.,]\d+)\s*[X×*]\s*(?:20|40|45)(?!\d)/g))issues.push({raw:invalid[0],reason:'CONTAINER_QUANTITY_INVALID',index:invalid.index!});
 if(/\b(?:20|40|45)\s*\/\s*(?:20|40|45)\b|\b(?:GP|DV|HC|HQ|RF|OT|FR|FL)\s*\/\s*(?:GP|DV|HC|HQ|RF|OT|FR|FL)\b/.test(text))
  issues.push({raw,reason:'ALTERNATIVE_OR_UNCERTAIN_TYPE',index:0});
 let match:RegExpExecArray|null;
 while((match=re.exec(text))){
  const rest=text.slice(re.lastIndex),unit=/^\s*(?:'|FT\.?\b|FEET\b|FOOT\b|PIEDS?\b)/.test(rest);
  const explicit=!!match[1]&&/[X×*]|PCS?/i.test(match[0]);
  if(/^\s*(?:[X×*]\s*\d|CM\b|MM\b|METRES?\b|METERS?\b)/.test(rest))continue;
  let accepted:{end:number;type:string}|null=null,recognized:ContainerDesignation|null=null;
  const max=Math.min(80,rest.search(/[\r\n,;+]/)<0?rest.length:rest.search(/[\r\n,;+]/));
  for(let n=1;n<=max;n++){
   if(/[A-Z0-9]/.test(rest[n]??''))continue;
   const d=normalizeContainerDesignation(match[2]+rest.slice(0,n));
   if(d.status==='supported')accepted={end:n,type:d.type};
   else if(d.status==='recognized_unpriced')recognized=d;
  }
  if(recognized){issues.push({raw:recognized.raw as string,reason:recognized.status==='recognized_unpriced'?recognized.reason:'EQUIPMENT_SUBTYPE_UNSUPPORTED',index:match.index});continue;}
  if(accepted){
   const following=rest.slice(accepted.end);
   // An additional equipment/height token is a subtype, never a disposable suffix.
   if(/^\s*(?:\/|\||\?|OR\b|OU\b)/.test(following)||/^[-_ /\s]*(?:HC|HQ|HIGH\s*CUBE|RF|RH|OT|FR|FL|REEFER|OPEN\s*TOP|FLAT\s*RACK|HT|HARDTOP|TANK|CITERNE|PLATFORM|BK|BULK|VENTILATED|INSULATED|GOH|GARMENTAINER|DG|NOR|SIDE\s*OPENING|PALLET\s*WIDE|9\s*'\s*6)\b/.test(following)){
    issues.push({raw:match[0]+rest.slice(0,Math.min(max,accepted.end+20)),reason:'COMPOSITE_OR_ALTERNATIVE_SUBTYPE',index:match.index});continue;
   }
   if(explicitQuantityOnly&&!match[1]){issues.push({raw:match[0]+rest.slice(0,accepted.end),reason:'CONTAINER_QUANTITY_MISSING',index:match.index});continue;}
   const quantity=match[1]?Number(match[1]):1;
   if(quantity<1){issues.push({raw:match[0],reason:'CONTAINER_QUANTITY_INVALID',index:match.index});continue;}
   const owner=/^\s*(SOC|COC)\b/.exec(following);
   if(owner&&/^\s*(?:AND\s+|OR\s+|\/\s*)?(SOC|COC)\b/.test(following.slice(owner[0].length))){issues.push({raw:match[0]+rest.slice(0,Math.min(max,accepted.end+25)),reason:'OWNERSHIP_AMBIGUOUS',index:match.index});continue;}
   containers.push({type:accepted.type,quantity,...(owner?{coc_soc:owner[1]}:{})});re.lastIndex+=accepted.end+(owner?.[0].length || 0);
  }else if(explicit||unit||/^(?:CONTAINER|EQUIPMENT)\s+(20|40|45)\b/.test(text)||text.trim()===match[2]){
   issues.push({raw:match[0]+rest.slice(0,Math.min(max,30)),reason:unit||!rest.trim()?'EQUIPMENT_TYPE_MISSING':'EQUIPMENT_SUBTYPE_UNSUPPORTED',index:match.index});
  }
 }
 for(const match of text.matchAll(/(?<![A-Z0-9])(?:[1-9]\d{0,5}\s*[X×*]\s*)?([A-Z0-9][0-9][A-Z][0-9])(?![A-Z0-9])/g)){
  if(!VERIFIED_ISO_EQUIPMENT[match[1]]&&!/^\d+\s*[X×*]/.test(match[0])&&!/\b(?:CONTAINER|EQUIPMENT|ISO)\s*:?\s*$/.test(text.slice(Math.max(0,match.index!-30),match.index)))continue;
  const d=normalizeContainerDesignation(match[1]);
  if(d.status!=='supported'&&!issues.some(i=>i.index===match.index))issues.push({raw:match[0],reason:'ISO_SUBTYPE_NOT_ADOPTED',index:match.index!});
 }
 return {containers:issues.length?[]:containers,issues};
}
