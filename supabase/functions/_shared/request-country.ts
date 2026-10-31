/** Existing country aliases and fallback, extracted verbatim for shared use. */
export const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  'SENEGAL': 'SN', 'SÉNÉGAL': 'SN',
  'INDIA': 'IN', 'INDE': 'IN',
  'FRANCE': 'FR',
  'CHINA': 'CN', 'CHINE': 'CN',
  'TURKEY': 'TR', 'TURQUIE': 'TR', 'TÜRKIYE': 'TR',
  'GAMBIA': 'GM', 'GAMBIE': 'GM',
  'MALI': 'ML',
  'GUINEA': 'GN', 'GUINÉE': 'GN', 'GUINEE': 'GN',
  'IVORY COAST': 'CI', "CÔTE D'IVOIRE": 'CI', 'COTE D\'IVOIRE': 'CI',
  'GHANA': 'GH',
  'NIGERIA': 'NG', 'NIGÉRIA': 'NG',
  'EGYPT': 'EG', 'EGYPTE': 'EG', 'ÉGYPTE': 'EG',
  'BURKINA FASO': 'BF',
  'NIGER': 'NE',
  'MAURITANIA': 'MR', 'MAURITANIE': 'MR',
  'GERMANY': 'DE', 'ALLEMAGNE': 'DE',
  'NETHERLANDS': 'NL', 'PAYS-BAS': 'NL',
  'BELGIUM': 'BE', 'BELGIQUE': 'BE',
  'UNITED ARAB EMIRATES': 'AE', 'UAE': 'AE',
  'SAUDI ARABIA': 'SA', 'ARABIE SAOUDITE': 'SA',
  'BANGLADESH': 'BD',
  'SRI LANKA': 'LK',
  'GUINEA-BISSAU': 'GW', 'GUINÉE-BISSAU': 'GW',
  'TOGO': 'TG',
  'BENIN': 'BJ', 'BÉNIN': 'BJ',
  'UNITED KINGDOM': 'GB', 'ROYAUME-UNI': 'GB', 'UK': 'GB',
  'UNITED STATES': 'US', 'USA': 'US', 'ÉTATS-UNIS': 'US',
  'SPAIN': 'ES', 'ESPAGNE': 'ES',
  'ITALY': 'IT', 'ITALIE': 'IT',
  'PORTUGAL': 'PT',
  'MOROCCO': 'MA', 'MAROC': 'MA',
  'SOUTH KOREA': 'KR', 'CORÉE DU SUD': 'KR',
  'JAPAN': 'JP', 'JAPON': 'JP',
  'BRAZIL': 'BR', 'BRÉSIL': 'BR',
  'PAKISTAN': 'PK',
  'THAILAND': 'TH', 'THAÏLANDE': 'TH',
  'VIETNAM': 'VN', 'VIÊT NAM': 'VN',
  'INDONESIA': 'ID', 'INDONÉSIE': 'ID',
  'MALAYSIA': 'MY', 'MALAISIE': 'MY',
  'SINGAPORE': 'SG', 'SINGAPOUR': 'SG',
  'CAMEROON': 'CM', 'CAMEROUN': 'CM',
  'CONGO': 'CG',
  'SIERRA LEONE': 'SL',
  'LIBERIA': 'LR', 'LIBÉRIA': 'LR',
};

export function normalizeCountryToISO(raw: string): string {
  if (!raw) return '';
  const upper = raw.toUpperCase().trim();
  // Already ISO 2-letter code
  if (upper.length === 2) return upper;
  return COUNTRY_NAME_TO_ISO[upper] || upper;
}


/** Country recognition for the candidate: existing aliases are independent of a places catalogue.
 * This is not a complete ISO registry. Unknown names/codes remain unresolved without a reference.
 * normalizeCountryToISO above keeps its historical behavior for all existing callers.
 */
export interface CountryReference {country_code:string;country_name:string|null}
export const COUNTRY_ALIAS_REFERENCE_VERSION="request-country-aliases-v1";
const countryKey=(value:string)=>value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[\u2010-\u2015\u2212]/g,"-").replace(/[-\s]+/g," ").trim().toUpperCase();
export function resolveDocumentedCountry(raw:unknown,references:CountryReference[]=[]) {
 if(typeof raw!=="string"||!raw.trim())return null;
 const key=countryKey(raw),known=[...new Set(Object.entries(COUNTRY_NAME_TO_ISO).filter(([name,code])=>countryKey(name)===key||code===key).map(([,code])=>code))];
 const loaded=references.filter(r=>/^[A-Z]{2}$/.test(r.country_code)&&(countryKey(r.country_code)===key||r.country_name&&countryKey(r.country_name)===key||known.includes(r.country_code))).map(r=>r.country_code);
 const codes=[...new Set([...known,...loaded])];if(codes.length!==1)return null;
 const code=codes[0];return {code,reference:known.includes(code)?`${COUNTRY_ALIAS_REFERENCE_VERSION}:${code}`:`locations_reference:${code}`};
}
export function documentedCountryChoices(references:CountryReference[]=[]):CountryReference[] {
 const names=new Map<string,string|null>();for(const [name,code]of Object.entries(COUNTRY_NAME_TO_ISO))if(!names.has(code))names.set(code,name);
 for(const r of references){if(resolveDocumentedCountry(r.country_code,references)?.code!==r.country_code)continue;
  const name=r.country_name&&resolveDocumentedCountry(r.country_name,references)?.code===r.country_code?r.country_name:names.get(r.country_code)??null;names.set(r.country_code,name);}
 return [...names].sort(([a],[b])=>a.localeCompare(b)).map(([country_code,country_name])=>({country_code,country_name}));
}
