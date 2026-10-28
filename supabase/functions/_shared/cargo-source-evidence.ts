/** Source normalization only. No tariff, customs valuation or operator adoption. */
export type DimensionGroup = { count: number | null; length: number; width: number; height: number; unit: string };
type Info = Record<string, unknown>;
const object = (v: unknown): Info => v && typeof v === "object" && !Array.isArray(v) ? v as Info : {};

export function sourceConfidence(data: unknown, document?: unknown): number | null {
  const values = [object(data).confidence, object(document).confidence]
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
  return values.length ? Math.min(...values) : null;
}

export function sourceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let text = value.trim().replace(/[\s']/g, "");
  if (!/^[+-]?[\d.,]+$/.test(text)) return null;
  if (text.includes(",") && text.includes(".")) text = text.lastIndexOf(",") > text.lastIndexOf(".")
    ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  else if (text.includes(",")) text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function declaredWeightKg(value: unknown, keyHasKgUnit = false): number | null {
  if (typeof value === "number") return keyHasKgUnit && value > 0 && Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([\d\s,.'\u00a0]+)\s*(kg|kgs|kilograms?|t|tons?|tonnes?)?$/i);
  if (!match || (!match[2] && !keyHasKgUnit)) return null;
  const number = sourceNumber(match[1]);
  if (number === null || number <= 0) return null;
  return /^(?:t|tons?|tonnes?)$/i.test(match[2] || "") ? number * 1000 : number;
}

export type EmailWeightScopeIssue = { reason:'PER_UNIT_WEIGHT_NOT_TOTAL'; unit_declarations:Array<{kg:number;excerpt:string}> };
/** A clipped model quote must not strip the per-carton qualifier from a total.
 * Check every occurrence in this own source; never multiply units or borrow a
 * total from another message. Ordinary explicit totals retain their path. */
export function emailWeightScopeIssue(body:string,excerpt:string,valueKg:number):EmailWeightScopeIssue|null{
 const normalized=(s:string)=>s.replace(/\s+/g,' ').trim();
 const prefixLength=(n:number)=>body.slice(0,n).replace(/\s+/g,' ').trimStart().length;
 const declarations:Array<{kg:number;unit:boolean;start:number;end:number;excerpt:string}>=[];
 let previousEnd=0;
 for(const m of body.matchAll(/\b(\d[\d ,.'\u00a0]*)\s*(kgs?|kilograms?|t|tons?|tonnes?)\b/gi)){
  const kg=declaredWeightKg(m[0]);if(kg===null)continue;
  const start=m.index,end=start+m[0].length;
  const lineStart=Math.max(body.lastIndexOf('\n',start),body.lastIndexOf(';',start),body.lastIndexOf('|',start))+1;
  const contextStart=/^[ \t]*$/.test(body.slice(lineStart,start))?Math.max(previousEnd,body.lastIndexOf('\n',Math.max(0,lineStart-2))+1):Math.max(lineStart,previousEnd);
  const before=body.slice(contextStart,start);
  const after=body.slice(end);
  const unit=/^\s*(?:(?:per|par)\b\s*\S+|\/\s*\S+|each\b|chacun(?:e)?\b)/i.test(after)||
   /(?:\b(?:per|par)\s+(?:cartons?|boxes?|packages?|pieces?|pcs?|colis|crates?|pkgs?|pallets?|palettes?|units?|buses?|vehicles?|sets?)|\b(?:unit(?:ary)?\s+(?:gross\s+)?weight|poids\s+unitaire)|\beach\s+(?:carton|box|package|piece|crate|pallet|unit|bus|vehicle|set)\s*(?:weighs|weight|gross\s+weight)?)\s*[:=]?\s*$/i.test(before);
  const lineEnd=body.indexOf('\n',end);
  declarations.push({kg,unit,start:prefixLength(start),end:prefixLength(start+m[1].trimEnd().length),excerpt:body.slice(Math.max(contextStart,start-120),Math.min(lineEnd<0?body.length:lineEnd,end+80)).trim()});
  previousEnd=end;
 }
 const unitDeclarations=declarations.filter(d=>d.unit);if(!unitDeclarations.length)return null;
 const issue:EmailWeightScopeIssue={reason:'PER_UNIT_WEIGHT_NOT_TOTAL',unit_declarations:unitDeclarations.map(d=>({kg:d.kg,excerpt:d.excerpt}))};
 const source=normalized(body),quote=normalized(excerpt);if(!quote)return issue;
 let occurrence=source.indexOf(quote);if(occurrence<0)return issue;
 while(occurrence>=0){
  const referenced=declarations.filter(d=>d.start>=occurrence&&d.end<=occurrence+quote.length);
  if(!referenced.some(d=>!d.unit&&Math.abs(d.kg-valueKg)<1e-9))return issue;
  occurrence=source.indexOf(quote,occurrence+1);
 }
 return null;
}

export function emailCargoEvidence(body: string) {
  const total = body.match(/\btotal[ \t]*[:=]?[ \t]*(\d+)[ \t]*(?:cartons?|packages?|pieces?|pcs|colis|crates?|pkgs?)\b/i)
    ?? body.match(/(?:^|[\r\n])[ \t]*(?:total[ \t]+(?:cartons?|packages?|pieces?|colis|crates?|pkgs?)|(?:cartons?|packages?|pieces?|colis|crates?|pkgs?)[ \t]+(?:total)?)[ \t]*[:=]?[ \t]*(\d+)\b/i)
    ?? body.match(/\b(?:total\s*[:=]?\s*)?(\d+)\s*(?:cartons?|packages?|pieces?|pcs|colis|crates?|pkgs?)\b/i);
  const weight = body.match(/\b(?:gross\s*(?:wt|weight)|poids\s*brut)\s*[:=]?\s*(\d[\d ,.'\u00a0]*)\s*(kgs?|kilograms?|t|tons?|tonnes?)\b/i)
    ?? body.match(/\b(\d[\d ,.'\u00a0]*)\s*(kgs?|kilograms?|t|tons?|tonnes?)\b/i);
  const groups: DimensionGroup[] = [];
  const excerpts: string[] = [];
  for (const m of body.matchAll(/(\d+(?:[.,]\d+)?)\s*[*x×]\s*(\d+(?:[.,]\d+)?)\s*[*x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b(?:[^\r\n\d]{0,20}(\d+)\s*(?:cartons?|packages?|pieces?|pcs|colis)\b)?/gi)) {
    const group = { length: Number(m[1].replace(",", ".")), width: Number(m[2].replace(",", ".")), height: Number(m[3].replace(",", ".")), unit: m[4].toLowerCase(), count: m[5] ? Number(m[5]) : null };
    if (!groups.some(g => JSON.stringify(g) === JSON.stringify(group))) { groups.push(group); excerpts.push(m[0]); }
  }
  // A subgroup is not a shipment total. Without an explicit total, accept only a
  // standalone count; a count attached to one of several dimensions stays evidence.
  const countIsSubgroup = total && groups.length > 1 && excerpts.some(e => e.includes(total[0]));
  const perUnit = weight && /^[ \t]*(?:per\b|par\b|\/)[ \t]*\S+/i.test(body.slice(weight.index! + weight[0].length));
  return { pieces: total && !countIsSubgroup ? Number(total[1]) : null, piecesExcerpt: total?.[0] ?? null,
    weightKg: weight && !perUnit ? declaredWeightKg(`${weight[1]} ${weight[2]}`) : null, weightExcerpt: weight?.[0] ?? null, groups, excerpts };
}

function infoDimensionGroups(info: Info): DimensionGroup[] {
  const groups = new Map<string, DimensionGroup>();
    const rows = Array.isArray(info.line_items) ? info.line_items : [];
    for (const row of rows) {
      const item = object(row);
      const dim = String(item.dimension_cm_carton ?? item.dimensions_cm ?? "").match(/^(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)$/i);
      const count = sourceNumber(item.no_of_cartons ?? item.number_of_packages);
      if (!dim || count === null || count <= 0 || !Number.isInteger(count)) continue;
      const key = dim.slice(1).join("x");
      const previous = groups.get(key);
      groups.set(key, { length: Number(dim[1].replace(",", ".")), width: Number(dim[2].replace(",", ".")), height: Number(dim[3].replace(",", ".")), unit: "cm", count: (previous?.count ?? 0) + count });
    }
  return [...groups.values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function documentDimensionSources(extracted: unknown) {
  const root = object(extracted), docs = Array.isArray(root.documents) ? root.documents.map(object) : [];
  // Each sub-document keeps its own allocation. Never sum several documents.
  const sources = docs.length ? docs.map((doc, index) => ({ document_index: index, doc_type: doc.doc_type ?? null,
    confidence: sourceConfidence(root, doc), groups: infoDimensionGroups(object(doc.extracted_info)) }))
    : [{ document_index: null, doc_type: null, confidence: sourceConfidence(root), groups: infoDimensionGroups(object(root.extracted_info ?? root)) }];
  return sources.filter(source => source.groups.length);
}

export function documentDimensionGroups(extracted: unknown): DimensionGroup[] {
  return documentDimensionSources(extracted)[0]?.groups ?? [];
}

export function dimensionGroupsDisagree(groups: DimensionGroup[][]): boolean {
  const signatures = groups.filter(g => g.length && g.every(d => d.count !== null)).map(g => {
    const normalized = g.map(d => { const scale = d.unit === 'm' ? 100 : d.unit === 'mm' ? .1 : 1;
      return { count: d.count, length: Math.round(d.length * scale * 1e6) / 1e6,
        width: Math.round(d.width * scale * 1e6) / 1e6, height: Math.round(d.height * scale * 1e6) / 1e6 }; });
    return JSON.stringify(normalized.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  });
  return new Set(signatures).size > 1;
}

export type DocumentMoney = { kind: "FOB" | "freight" | "insurance" | "total"; amount: number; currency: string | null; field: string };
export function documentCargoEvidence(extracted: unknown) {
  const root = object(extracted), docs = Array.isArray(root.documents) ? root.documents.map(object) : [];
  const info = object(root.extracted_info ?? docs[0]?.extracted_info ?? root);
  const infos = [info, ...docs.map(d => object(d.extracted_info))];
  const isNonCommercial = (v: Info) => /non[\s_-]*commercial/i.test(String(v.document_type ?? v.doc_type ?? "")) || /^FOC$/i.test(String(v.payment_terms ?? "").trim());
  const nonCommercial = infos.some(isNonCommercial) || docs.some(isNonCommercial) || isNonCommercial(root) || /non[\s_-]*commercial/i.test(String(root.description ?? ""));
  const financialInfo = infos.find(i => sourceNumber(i.total_amount) !== null) ?? info;
  const money: DocumentMoney[] = [];
  const currency = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() === "€" ? "EUR" : v.trim().toUpperCase() : null;
  const tls = Array.isArray(root.tariff_lines) && root.tariff_lines.length ? root.tariff_lines : docs.flatMap(d => Array.isArray(d.tariff_lines) ? d.tariff_lines : []);
  for (const row of tls) {
    const line = object(row), label = String(line.service ?? line.designation ?? "");
    const kind = /\bFOB\b/i.test(label) ? "FOB" : /\b(?:FRET|FREIGHT)\b/i.test(label) ? "freight" : /\b(?:INSURANCE|ASSURANCE)\b/i.test(label) ? "insurance" : /^TOTAL(?:\s+VALUE)?(?:\s+EUR)?$/i.test(label.trim()) ? "total" : null;
    const amount = sourceNumber(line.amount ?? line.montant);
    if (kind && amount !== null && amount >= 0) money.push({ kind, amount, currency: currency(line.currency ?? line.devise), field: `tariff_line:${label}` });
  }
  const amount = sourceNumber(financialInfo.total_amount), totalCurrency = currency(financialInfo.total_currency);
  if (amount !== null && !money.some(m => m.kind === "total")) money.push({ kind: "total", amount, currency: totalCurrency, field: "total_amount" });
  const paymentInfo = infos.find(isNonCommercial) ?? financialInfo;
  return { nonCommercial, paymentTerms: typeof paymentInfo.payment_terms === "string" ? paymentInfo.payment_terms : null,
    confidence: sourceConfidence(root), money, hsDeclared: typeof info.hs_code === "string" ? info.hs_code : null,
    cartons: sourceNumber(info.total_cartons), grossKg: declaredWeightKg(info.total_gross_weight_kg, true), netKg: declaredWeightKg(info.total_net_weight_kg, true),
    groups: documentDimensionGroups(root) };
}
