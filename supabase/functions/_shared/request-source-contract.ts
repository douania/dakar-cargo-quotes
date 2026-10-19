/** Source assertions, not a precedence rule or an automatic contract decision. */
export const SOURCE_CONTRACT_PREFIX = 'source_contract.';
export interface ContractSource {
  id: string; kind: 'email' | 'attachment'; text: string; name?: string;
  emailId?: string | null; sentAt?: string | null;
  sourceHash?: string | null;
}
export interface ContractAssertion {
  key: 'export_customs' | 'rfq_deadline'; value: string; sourceId: string;
  sourceKind: ContractSource['kind']; excerpt: string; page: number | null;
  scopeHeading?: string;
}
export interface ContractConflict {
  key: string; category: 'other' | 'timing'; question: string; assertions: ContractAssertion[];
}
export interface ContractEvidence {
  kind: 'source_contract_review'; version: 1; fingerprint: string;
  sources: Array<{id: string; kind: ContractSource['kind']; name: string | null; emailId: string | null; sentAt:string|null; sourceHash:string|null; sha256: string; readable: boolean}>;
  assertions: ContractAssertion[]; conflicts: ContractConflict[]; collectionComplete: boolean;
}
export async function contractHash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function pageAt(text: string, index: number): number | null {
  const separators = [...text.slice(0,index).matchAll(/(?:^|\n\n)([1-9]\d?)\s/g)];
  return separators.length ? Number(separators[separators.length-1][1]) : null;
}
function customsAssertions(source: ContractSource): ContractAssertion[] {
  const out: ContractAssertion[]=[];
  for(const match of source.text.matchAll(/\be\s*xport\s+customs\s+clearance\b/gi)) {
    const index=match.index??0, before=source.text.slice(0,index);
    const sections=[...before.matchAll(/\b((?:not[ \t]+)?i[ \t]*ncluded|excluded)\b/gi)];
    const heading=sections[sections.length-1]?.[1],section=heading?.replace(/\s/g,'').toLowerCase();
    const clauseStart=Math.max(before.lastIndexOf('\n'),before.lastIndexOf('.'),before.lastIndexOf(';'))+1;
    const after=source.text.slice(index+match[0].length),stop=after.search(/[\n.;]/);
    const clauseEnd=index+match[0].length+(stop<0?after.length:stop);
    const clause=source.text.slice(clauseStart,clauseEnd);
    const excluded=/\b(?:exclude|excluding|excluded|not[ \t]+included|do[ \t]+not[ \t]+include)\b/i.test(clause);
    const positive=clause.replace(/\b(?:not[ \t]+included|do[ \t]+not[ \t]+include)\b/gi,'');
    const included=/\b(?:include|including|included)\b/i.test(positive);
    const values=excluded||included?[...(excluded?['excluded']:[]),...(included?['included']:[])]:section==='excluded'||section==='notincluded'?['excluded']:section==='included'?['included']:[];
    for(const value of values)out.push({key:'export_customs',value,sourceId:source.id,sourceKind:source.kind,
      excerpt:clause.trim(),scopeHeading:heading,page:pageAt(source.text,index)});
  }
  return out;
}
function deadlineValue(text: string, sentAt: string | null | undefined): string | null {
  const clock=/(\d(?:[ \t]?\d)?)\s*:\s*(\d[ \t]?\d)\s*(AM|PM)?\s*(?:hrs?\.?\s*)?(U\.?\s*A\.?\s*E\.?|UTC|GMT)\b/i.exec(text);
  if(!clock)return null;
  let hour=Number(clock[1].replace(/\s/g,''));const minute=Number(clock[2].replace(/\s/g,''));
  if(hour>23||minute>59)return null;
  if(clock[3]){if(hour<1||hour>12)return null;hour=hour%12+(clock[3].toUpperCase()==='PM'?12:0);}
  const numeric=/(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/.exec(text);
  const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const named=/(\d{1,2})\s*(?:st|nd|rd|th|h)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?/i.exec(text);
  let date='date_unknown';
  if(numeric)date=`${numeric[3]}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}`;
  else if(named){const year=named[3]??sentAt?.slice(0,4);if(year&&/^\d{4}$/.test(year))date=`${year}-${String(months.indexOf(named[2].toLowerCase())+1).padStart(2,'0')}-${named[1].padStart(2,'0')}`;}
  const zone=clock[4].replace(/[.\s]/g,'').toUpperCase();
  return `${date} ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} ${zone}`;
}
function deadlineAssertions(source: ContractSource): ContractAssertion[] {
  const out: ContractAssertion[]=[];
  for(const match of source.text.matchAll(/(?:Bid\s+Submission\s+Deadline|Deadline\s+for\s+submission|Submission\s+deadline)\s*[:-]?\s*/gi)) {
    const index=match.index??0, tail=source.text.slice(index,index+230),value=deadlineValue(tail,source.sentAt);
    if(value)out.push({key:'rfq_deadline',value,sourceId:source.id,sourceKind:source.kind,
      excerpt:tail.split(/\n\n|Bid Submission Email|To\s*:/i)[0].trim(),page:pageAt(source.text,index)});
  }
  return out;
}
export async function assessRequestSourceContract(sources: ContractSource[],collectionComplete=true): Promise<ContractEvidence> {
  const ordered=[...sources].sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  const inventory=await Promise.all(ordered.map(async s=>({id:s.id,kind:s.kind,name:s.name??null,emailId:s.emailId??null,sentAt:s.sentAt??null,sourceHash:s.sourceHash??null,sha256:await contractHash(s.text),readable:!!s.text.trim()})));
  const assertions=ordered.flatMap(s=>[...customsAssertions(s),...deadlineAssertions(s)]);
  const conflicts: ContractConflict[]=[];
  for(const key of ['export_customs','rfq_deadline'] as const){
    const candidates=assertions.filter(a=>a.key===key);
    if(new Set(candidates.map(a=>a.value)).size<2)continue;
    const label=key==='export_customs'?'Dédouanement export : inclusion/exclusion contradictoire entre les sources.':'Échéance de soumission : plusieurs dates/heures documentaires incompatibles.';
    conflicts.push({key:SOURCE_CONTRACT_PREFIX+key,category:key==='export_customs'?'other':'timing',
      question:label+' Décision explicite requise ; aucune priorité automatique entre courriel et pièce jointe.',assertions:candidates});
  }
  return {kind:'source_contract_review',version:1,fingerprint:await contractHash(JSON.stringify({version:1,sources:inventory,collectionComplete})),sources:inventory,assertions,conflicts,collectionComplete};
}
export interface ContractGap {id:string;gap_key:string;status:string;question_fr?:string;is_blocking?:boolean;waived_by?:string|null;waived_reason?:string|null;}
export interface ContractStore {
  readPrevious():Promise<ContractEvidence|null>;readGaps():Promise<ContractGap[]>;
  ensureGap(conflict:ContractConflict,existing:ContractGap|undefined):Promise<void>;
  appendEvidence(evidence:ContractEvidence):Promise<void>;
}
/** No automatic resolution: a changed/readable source or homonymous fact is not an operator decision. */
export async function syncRequestSourceContract(store:ContractStore,evidence:ContractEvidence):Promise<number>{
  const previous=await store.readPrevious();
  if(!previous&&!evidence.assertions.length)return 0;
  const gaps=await store.readGaps();let created=0;
  for(const conflict of evidence.conflicts){
    const open=gaps.find(g=>g.gap_key===conflict.key&&g.status==='open');
    // Retain older resolved/waived rows as history. They carry no inventory-bound
    // contract decision, so cannot resolve a currently detected disagreement.
    await store.ensureGap(conflict,open);if(!open)created++;
  }
  if(previous?.fingerprint!==evidence.fingerprint)await store.appendEvidence(evidence);
  return created;
}
export interface SeaGatewayProposal {emailId:string;gateway:string;finalCity:string;excerpt:string;}
export function explicitSeaGatewayClauses(emails:Array<{id:string;text:string}>):SeaGatewayProposal[]{
  return emails.flatMap(email=>[...email.text.matchAll(/(?:Place\s+of\s+delivery|Final\s+destination|Delivery\s+destination)\s*:\s*([^\n]+?)\s+via\s+([^\n.;]+)/gi)].map(m=>({emailId:email.id,
    finalCity:m[1].split(',')[0].trim(),gateway:m[2].trim(),excerpt:m[0]})));
}
export function seaGatewayAliasCandidates(gateway:string):string[]{
  if(/\b(?:or|ou|and|et)\b|[/;]/i.test(gateway))return [];
  const words=gateway.toUpperCase().replace(/[,]+/g,' ').trim().split(/\s+/);
  return words.slice(0,6).map((_,i)=>words.slice(0,words.length-i).join(' ')).filter(Boolean);
}
