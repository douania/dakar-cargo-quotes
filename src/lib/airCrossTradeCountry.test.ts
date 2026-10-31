import {expect,it} from 'vitest';
import {documentedCountryChoices} from '../../supabase/functions/_shared/request-country';
import {sourceAttestation} from './airCrossTradeDraft';
it('country choices and source prefill use the known GW alias without creating any place',()=>{
 const references=[{country_code:'BE',country_name:'Belgium'}],before=JSON.stringify(references),choices=documentedCountryChoices(references);
 expect(choices.find(c=>c.country_code==='GW')).toMatchObject({country_name:'GUINEA-BISSAU'});expect(JSON.stringify(references)).toBe(before);
 const source=sourceAttestation('rate_card',{id:'synthetic-source',unit:'forfait',origin_country:'Guinée-Bissau',destination_country:'Belgium'},'AIR_FREIGHT',references);
 expect(source.origin_country).toBe('GW');expect(source.destination_country).toBe('BE');expect(source.reference).toBe('');
});
it('country prefill never guesses an unknown or contradictory source country',()=>{
 expect(sourceAttestation('rate_card',{id:'synthetic',unit:'forfait',origin_country:'Atlantis'},'AIR_FREIGHT',[]).origin_country).toBe('');
 expect(sourceAttestation('rate_card',{id:'synthetic',unit:'forfait',origin_country:'Guinea-Bissau'},'AIR_FREIGHT',[{country_code:'UG',country_name:'Guinea-Bissau'}]).origin_country).toBe('');
});

it('display choices never replace the raw reference context used by actual source prefill',()=>{
 const countries=[{country_code:'UG',country_name:'Guinea-Bissau'}],state={countries,country_choices:documentedCountryChoices(countries)};
 expect(state.country_choices.some(c=>c.country_code==='GW')).toBe(true);
 expect(sourceAttestation('rate_card',{id:'synthetic',unit:'forfait',origin_country:'Guinea-Bissau'},'AIR_FREIGHT',state.countries).origin_country).toBe('');
 expect(state.countries).toEqual(countries);
});
