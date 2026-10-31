import {assertEquals} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {COUNTRY_ALIAS_REFERENCE_VERSION,documentedCountryChoices,normalizeCountryToISO,resolveDocumentedCountry} from "./request-country.ts";
Deno.test("country evidence: known aliases and codes survive an incomplete places catalogue",()=>{
 for(const name of ["Guinea-Bissau","Guinée-Bissau","Guinea Bissau","GW"]){const found=resolveDocumentedCountry(name,[{country_code:"BE",country_name:"Belgium"}]);assertEquals(found,{code:"GW",reference:`${COUNTRY_ALIAS_REFERENCE_VERSION}:GW`});}
 assertEquals(resolveDocumentedCountry("Guinea")?.code,"GN");assertEquals(resolveDocumentedCountry("Belgique")?.code,"BE");
 assertEquals(documentedCountryChoices([{country_code:"BE",country_name:"Belgium"}]).filter(c=>c.country_code==="GW").length,1);
});
Deno.test("country evidence: unknowns stay unknown, conflicting names are not guessed, existing reference-only countries survive",()=>{
 assertEquals(resolveDocumentedCountry("Atlantis"),null);assertEquals(resolveDocumentedCountry("ZZ"),null);
 assertEquals(resolveDocumentedCountry("Guinea-Bissau",[{country_code:"UG",country_name:"Guinea-Bissau"}]),null);
 assertEquals(resolveDocumentedCountry("Kenya",[{country_code:"KE",country_name:"Kenya"},{country_code:"UG",country_name:"Kenya"}]),null);
 assertEquals(resolveDocumentedCountry("Kenya",[{country_code:"KE",country_name:"Kenya"}]),{code:"KE",reference:"locations_reference:KE"});
});
Deno.test("country evidence: legacy fallback behavior is unchanged",()=>{
 assertEquals(normalizeCountryToISO("Guinea-Bissau"),"GW");assertEquals(normalizeCountryToISO("Kenya"),"KENYA");assertEquals(normalizeCountryToISO("ZZ"),"ZZ");assertEquals(normalizeCountryToISO("UK"),"UK");
});
