/** Informational volume only. Never writes a fact, closes a gap or defines chargeable weight. */
import type {DimensionGroup} from './cargo-source-evidence.ts';
export type VolumeFact={fact_key:string;value_text?:string|null;value_number?:number|null;value_json?:unknown;source_type?:string|null;is_validated?:boolean|null};
type Row=Record<string,unknown>;
const row=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const rows=(v:unknown):Row[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)) as Row[]:[];
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?v:null;
const protectedFact=(f:VolumeFact|undefined)=>f?.is_validated===true||['operator','operator_correction','manual_input'].includes(f?.source_type??'');
const units:Record<string,number>={mm:.001,cm:.01,m:1};
const parcel='(?:cartons?|boxes?|packages?|pieces?|pcs?|colis|crates?|pkgs?|pallets?|palettes?)';
const prefixCount=new RegExp('(?<![A-Za-z0-9_.+\\-−﹣－])([+-]?\\d+(?:[.,]\\d+)?)\\s*'+parcel+'\\s*[:=-]?\\s*$','i');
const suffixCount=new RegExp('^\\s*(?:[-:=]\\s*)?([+-]?\\d+(?:[.,]\\d+)?)\\s*'+parcel+'\\b','i');
function textGroups(text:string):DimensionGroup[]|null{
 const matches=[...text.matchAll(/([+-]?\d+(?:[.,]\d+)?)\s*[xX×*]\s*([+-]?\d+(?:[.,]\d+)?)\s*[xX×*]\s*([+-]?\d+(?:[.,]\d+)?)(?:\s*(mm|cm|m)\b)?/gi)];
 if(!matches.length)return null;
 const groups:DimensionGroup[]=[];
 for(let i=0;i<matches.length;i++){
  const m=matches[i],start=m.index!,end=start+m[0].length;
  if(start>0&&(/[A-Za-z0-9_.+\-−﹣－]/.test(text[start-1])||/\d\s+$/.test(text.slice(0,start))))return null;
  const from=Math.max(i?matches[i-1].index!+matches[i-1][0].length:0,text.lastIndexOf('\n',start)+1,text.lastIndexOf(';',start)+1,text.lastIndexOf('|',start)+1);
  const before=text.slice(from,start),after=text.slice(end,i+1<matches.length?matches[i+1].index:undefined);
  const afterClause=after.split(/[\r\n;|]/)[0];
  const left=before.match(prefixCount),right=afterClause.match(suffixCount);
  const rawLeft=before.match(new RegExp('(\\S+)\\s*'+parcel+'\\s*[:=-]?\\s*$','i')),rawRight=afterClause.match(new RegExp('^\\s*(?:[-:=]\\s*)?(\\S+)\\s*'+parcel+'\\b','i'));
  if((rawLeft&&!left)||(rawRight&&!right))return null;
  if(right&&i+1<matches.length&&afterClause.slice(right[0].length).trim()===':')return null;
  const a=left?count(Number(left[1].replace(',','.'))):null,b=right?count(Number(right[1].replace(',','.'))):null;
  if((left&&a===null)||(right&&b===null)||(a!==null&&b!==null&&a!==b))return null;
  groups.push({length:Number(m[1].replace(',','.')),width:Number(m[2].replace(',','.')),height:Number(m[3].replace(',','.')),unit:m[4]?.toLowerCase()??'',count:a??b});
 }
 const residue=text.replace(/([+-]?\d+(?:[.,]\d+)?)\s*[xX×*]\s*([+-]?\d+(?:[.,]\d+)?)\s*[xX×*]\s*([+-]?\d+(?:[.,]\d+)?)(?:\s*(mm|cm|m)\b)?/g,'');
 if(/\d\s*[xX×*]\s*[?\d]/.test(residue))return null;
 return groups;
}
function normalizeGroups(groups:unknown):DimensionGroup[]|null{
 if(!Array.isArray(groups)||!groups.length)return null;
 const result:DimensionGroup[]=[];
 for(const raw of groups){const g=row(raw),unit=String(g.unit).toLowerCase();
  if(!Object.prototype.hasOwnProperty.call(units,unit)||!['length','width','height'].every(k=>typeof g[k]==='number'&&Number.isFinite(g[k])&&Number(g[k])>0))return null;
  if(g.count!=null&&count(g.count)===null)return null;
  result.push({length:Number(g.length)*units[unit],width:Number(g.width)*units[unit],height:Number(g.height)*units[unit],unit:'m',count:count(g.count)});
 }return result;
}
const geometry=(g:DimensionGroup)=>[g.length,g.width,g.height].map(n=>Number(n.toPrecision(12))).sort((a,b)=>a-b).join('x');
function signature(groups:DimensionGroup[],withCounts=true):string{
 const merged=new Map<string,number|null>();
 for(const g of groups){const key=geometry(g),old=merged.get(key);merged.set(key,g.count===null||old===null?null:(old??0)+g.count);}
 return JSON.stringify([...merged].sort(([a],[b])=>a.localeCompare(b)).map(([key,n])=>withCounts?[key,n]:key));
}
export function stableCoherenceInput(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(stableCoherenceInput).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableCoherenceInput((value as Row)[k])).join(',')+'}';
 return JSON.stringify(value??null);
}
export function assessCargoVolume(facts:readonly VolumeFact[]|undefined){
 const byKey=new Map((facts??[]).map(f=>[f.fact_key,f])),dim=byKey.get('cargo.dimensions'),volume=byKey.get('cargo.volume_cbm'),pieces=count(byKey.get('cargo.pieces_count')?.value_number);
 const evidence=row(byKey.get('cargo.dimensions_evidence')?.value_json);
 const inputFact=(f:VolumeFact|undefined)=>f?{value_text:f.value_text??null,value_number:f.value_number??null,value_json:f.value_json??null,source_type:f.source_type??null,is_validated:f.is_validated??false}:null;
 const inputKey=stableCoherenceInput({available:facts!==undefined,dimensions:inputFact(dim),pieces:inputFact(byKey.get('cargo.pieces_count')),volume:inputFact(volume),evidence});
 const result=(reason:string,volumeCbm:number|null=null)=>({reason,volumeCbm,inputKey});
 if(facts===undefined)return result('CURRENT_FACTS_UNAVAILABLE');
 // An existing operator/current fact is never replaced by an advisory calculation.
 if(volume)return result(typeof volume.value_number==='number'&&Number.isFinite(volume.value_number)&&volume.value_number>0?'EXISTING_VOLUME':'EXISTING_VOLUME_INVALID');
 const text=dim?.value_text?.trim()??'';
 if(!text&&!Object.keys(evidence).length)return result('NO_DIMENSIONS');
 const alternatives:DimensionGroup[][]=[];
 if(text){const parsed=textGroups(text),normalized=parsed&&normalizeGroups(parsed);if(!normalized)return result('DIMENSIONS_UNSUPPORTED');alternatives.push(normalized);}
 if(!protectedFact(dim)&&Object.keys(evidence).length){
  if(evidence.conflict===true)return result('DIMENSIONS_CONFLICT');
  if(evidence.type!=='dimension_groups_v1'||!Array.isArray(evidence.sources)||!evidence.sources.length)return result('DIMENSIONS_UNSUPPORTED');
  for(const source of evidence.sources){const normalized=normalizeGroups(row(source).groups);if(!normalized)return result('DIMENSIONS_UNSUPPORTED');alternatives.push(normalized);}
 }
 if(!alternatives.length)return result('NO_DIMENSIONS');
 if(pieces===null)return result('ALLOCATION_UNKNOWN');
 // One confirmed parcel is the only count that needs no subgroup allocation.
 const allocations=alternatives.map(gs=>gs.length===1&&gs[0].count===null&&pieces===1?[{...gs[0],count:1}]:gs);
 if(new Set(allocations.map(gs=>signature(gs,false))).size!==1)return result('DIMENSIONS_CONFLICT');
 const complete=allocations.filter(gs=>gs.every(g=>g.count!==null));
 if(!complete.length)return result('ALLOCATION_UNKNOWN');
 if(complete.some(gs=>gs.reduce((n,g)=>n+g.count!,0)!==pieces)||new Set(complete.map(gs=>signature(gs))).size!==1)return result('ALLOCATION_CONFLICT');
 const selected=complete[0];
 // Partial alternatives may corroborate geometry, never supply invented counts.
 for(const gs of allocations){const known=new Map<string,number>();for(const g of gs)known.set(geometry(g),(known.get(geometry(g))??0)+(g.count??1));for(const [key,n] of known){const declared=selected.filter(s=>geometry(s)===key).reduce((sum,s)=>sum+s.count!,0);if(n>declared)return result('ALLOCATION_CONFLICT');}}
 const total=selected.reduce((n,g)=>n+g.length*g.width*g.height*g.count!,0);
 if(!Number.isFinite(total)||total<=0||total>=10000)return result('VOLUME_OUT_OF_RANGE');
 return result('COMPLETE_ALLOCATION',Number(total.toPrecision(12)));
}
const volumeGuide='Volume à confirmer : vérifier les unités et l’allocation des dimensions à tous les colis avant tout calcul global.';
const refreshedGuide='Conseil de volume réévalué depuis les faits actuels ; historique conservé.';
export function projectVolumeAdvice(base:Row,facts:readonly VolumeFact[]|undefined,openGapKeys?:readonly string[]):Row{
 const assessment=assessCargoVolume(facts),old=row(base.volume_advice);
 const derived=rows(base.derived_candidates).filter(d=>d.fact_key!=='cargo.volume_cbm');
 const blockers=rows(base.false_blocker_candidates).filter(d=>d.gap_key!=='cargo.volume_cbm');
 const warnings=rows(base.warnings).filter(w=>!String(w.code).startsWith('VOLUME_ADVICE_'));
 const guidance=(Array.isArray(base.operator_guidance)?base.operator_guidance:[]).filter((g):g is string=>typeof g==='string'&&g!==volumeGuide&&g!==refreshedGuide);
 if(assessment.volumeCbm!==null){
  derived.push({fact_key:'cargo.volume_cbm',value_number:assessment.volumeCbm,reason_code:'DIMENSIONS_TO_VOLUME',auto_applicable:true,explanation_fr:`Volume total calculé depuis les allocations actuelles : ${assessment.volumeCbm} m³.`});
  if(openGapKeys?.includes('cargo.volume_cbm'))blockers.push({gap_key:'cargo.volume_cbm',reason_code:'DERIVABLE_FROM_DIMENSIONS',message_fr:'Volume calculable depuis les allocations complètes ; le gap reste à résoudre par le parcours normal.'});
 }else if(!['NO_DIMENSIONS','EXISTING_VOLUME'].includes(assessment.reason)){
  warnings.push({code:'VOLUME_ADVICE_'+assessment.reason,severity:'warning',message_fr:volumeGuide});guidance.push(volumeGuide);
 }
 const hasOldVolume=rows(base.derived_candidates).some(d=>d.fact_key==='cargo.volume_cbm')||rows(base.false_blocker_candidates).some(d=>d.gap_key==='cargo.volume_cbm');
 if(hasOldVolume&&(old.version!==1||old.input_key!==assessment.inputKey))guidance.push(refreshedGuide);
 const summary=[];const contradictions=rows(base.contradiction_flags);
 if(contradictions.length)summary.push(`${contradictions.length} contradiction(s) détectée(s)`);
 if(warnings.length)summary.push(`${warnings.length} avertissement(s)`);
 if(derived.length)summary.push(`${derived.length} fait(s) dérivable(s)`);
 if(blockers.length)summary.push(`${blockers.length} gap(s) potentiellement résolvable(s) automatiquement`);
 return {...base,derived_candidates:derived,false_blocker_candidates:blockers,warnings,operator_guidance:guidance,
  summary:summary.length?summary.join(', ')+'.':'Aucune incohérence détectée.',confidence:contradictions.length||warnings.length?.7:.95,volume_advice:{version:1,input_key:assessment.inputKey,reason:assessment.reason}};
}
