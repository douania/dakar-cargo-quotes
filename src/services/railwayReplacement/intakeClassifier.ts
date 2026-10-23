/** Pure port of router/{canonical,classifier}.py at c34c6dc.
 * Classification only: does not create a case or claim durable persistence.
 * Historical WF_* values are deliberately not mapped to SEA or AIR service modes.
 */
export interface NormalizedRequest {
  intent: string;
  modes: unknown[];
  parties: { shipper: Record<string, unknown>; consignee: Record<string, unknown> };
  route: { origins: { name: string; type: string }[]; hubs: unknown[]; destinations: { name: string; type: string }[]; legs: unknown[] };
  cargo: { items: unknown[]; units_summary: Record<string, unknown>; dangerous_goods: { is_dg: boolean; un: null; class: null } };
  constraints: { exceptional_convoy: string };
  commercial: { currency: string; incoterm: null; insurance: boolean };
}
export interface IntakeClassification {
  normalized_request: NormalizedRequest;
  missing_fields: { field: string; question: string; priority: string }[];
  assumptions: string[];
  confidence: number;
  complexity_level: number;
  workflow_key: string;
}
export function emptyNormalizedRequest(): NormalizedRequest {
  return {
    intent: 'quote', modes: [], parties: { shipper: {}, consignee: {} },
    route: { origins: [], hubs: [], destinations: [], legs: [] },
    cargo: { items: [], units_summary: {}, dangerous_goods: { is_dg: false, un: null, class: null } },
    constraints: { exceptional_convoy: 'unknown' },
    commercial: { currency: 'XOF', incoterm: null, insurance: false },
  };
}
// Python re uses Unicode word boundaries; JavaScript \\b does not.
function wordPattern(pattern: string, global = false): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, global ? 'giu' : 'iu');
}
function decimalValue(digits: string): bigint {
  return BigInt(Array.from(digits, (digit) => {
    const point = digit.codePointAt(0)!;
    let start = point;
    while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((point - start) % 10);
  }).join(''));
}
export function complexityAndWorkflow(req: Pick<NormalizedRequest, 'intent' | 'cargo' | 'route' | 'constraints'>): { complexity_level: number; workflow_key: string } {
  let score = req.intent === 'tender' ? 6 : req.intent === 'project_cargo' ? 4 : 0;
  if (req.cargo.items.length > 10) score += 2;
  if (req.cargo.items.length > 50) score += 2;
  if (req.route.origins.length > 1) score += 2;
  if (req.route.destinations.length > 1) score += 2;
  if (req.route.legs.length > 1) score += 3;
  if (req.constraints.exceptional_convoy === 'yes') score += 3;
  if (score >= 6) return { complexity_level: 4, workflow_key: 'WF_TENDER' };
  if (score >= 4) return { complexity_level: 3, workflow_key: 'WF_PROJECT_CARGO' };
  if (score >= 2) return { complexity_level: 2, workflow_key: 'WF_STANDARD_QUOTE' };
  return { complexity_level: 1, workflow_key: 'WF_SIMPLE_QUOTE' };
}
export function classifyIntakeText(text: string): IntakeClassification {
  const req = emptyNormalizedRequest();
  const missing: IntakeClassification['missing_fields'] = [];
  const assumptions: string[] = [];
  let confidence = 0.55;
  // CPython str.strip/re \\s include NEL and U+001C..1F, and exclude BOM.
  const space = '[\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const t = text.replace(new RegExp(`^${space}+|${space}+$`, 'gu'), '');
  if (wordPattern("tender|rfp|appel d['']offre|m[iİı]nusca").test(t)) {
    req.intent = 'tender'; confidence += 0.15;
  }
  if (wordPattern('project cargo|heavy l[iİı]ft|oog|hors gabar[iİı]t|convo[iİı] except[iİı]onnel').test(t)) {
    req.intent = 'project_cargo'; confidence += 0.10;
  }
  const cityPattern = wordPattern('Dakar|Bamako|Ab[iİı]djan|Douala|Bangu[iİı]|Conakry|Ouagadougou|N[iİı]amey|Lomé|Cotonou|Accra|Lagos', true);
  const cities = Array.from(t.matchAll(cityPattern), (match) => match[0][0].toUpperCase() + match[0].slice(1).toLowerCase());
  const uniqueCities = [...new Set(cities)];
  if (uniqueCities.length) {
    req.route.origins = [{ name: uniqueCities[0], type: 'city' }];
    if (uniqueCities.length >= 2) req.route.destinations = [{ name: uniqueCities[1], type: 'city' }];
    confidence += 0.10;
  }
  // Deliberately keep the source's unbounded unit suffix and first-match semantics.
  const weightMatch = t.match(new RegExp(`(\\p{Nd}+)${space}*(kg|t|tonnes?)`, 'iu'));
  if (weightMatch) {
    let weight = decimalValue(weightMatch[1]);
    if (['t', 'tonne', 'tonnes'].includes(weightMatch[2].toLowerCase())) weight *= BigInt(1000);
    if (weight > BigInt(10000)) { assumptions.push(`Colis lourd détecté: ${weight}kg`); confidence += 0.05; }
  }
  if (!req.route.origins.length) missing.push({ field: 'route.origins', question: "Quelle est l'origine (ville/site/port) ?", priority: 'high' });
  if (!req.route.destinations.length) missing.push({ field: 'route.destinations', question: 'Quelle est la destination (ville/site/port) ?', priority: 'high' });
  return { normalized_request: req, missing_fields: missing, assumptions, confidence: Math.min(confidence, 0.95), ...complexityAndWorkflow(req) };
}
