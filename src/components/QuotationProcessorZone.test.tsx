import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/hooks/usePuzzleAnalysis',()=>({usePuzzleAnalysis:()=>null}));
vi.mock('@/components/QuotationExcelExport',()=>({QuotationExcelExport:()=>null}));
import { QuotationProcessorWithPuzzle } from './QuotationProcessorWithPuzzle';
import { readServerGenerationPricing } from '@/lib/generationZoneContract';
import type { QuotationProcessResult } from '@/services/emailService';
afterEach(cleanup);
function result(factor?:number, historical=false):QuotationProcessResult {
 const pricing=readServerGenerationPricing({sodatra_fees:{fees:[{key:'fixture',label:'Honoraires serveur synthétiques',suggested_amount:120,min_amount:0,max_amount:500,unit:'dossier',formula:'FIXTURE',is_editable:true,factors_applied:[]}],total_suggested:120,complexity_factor:factor,complexity_reasons:[],transport_mode:'maritime'},quotation_metadata:{zone_resolution:{status:factor?'matched':'unknown',source:'delivery_zones'},zone:factor?{multiplier:factor}:null}});
 return {importedEmailId:'synthetic',originalEmail:{subject:'Fixture',from:'synthetic@example.invalid',body:'Fixture',date:'2026-01-01'},draft:{id:'draft',subject:'Fixture',body:'Fixture',to:['synthetic@example.invalid']},analysis:{confidence:1,missingInfo:[],quotationDetails:{}},extractedData:{destination:'Ville inconnue'},transportMode:'maritime',...(historical?{}:{serverPricing:pricing})};
}
function view(value:QuotationProcessResult) {return <MemoryRouter><TooltipProvider><QuotationProcessorWithPuzzle open result={value} isLoading={false} onOpenChange={()=>{}} onComplete={()=>{}}/></TooltipProvider></MemoryRouter>;}
describe('actual processor selects server pricing without local Dakar fallback',()=>{
 it('renders explicit unknown from fresh service result and clears a previously known factor',()=>{
  const rendered=render(view(result(1.3)));fireEvent.keyDown(screen.getByRole('tab',{name:'Coûts'}),{key:'Enter'});
  expect(screen.getByText('×1.30 complexité')).toBeInTheDocument();expect(screen.getByText('Honoraires serveur synthétiques')).toBeInTheDocument();
  rendered.rerender(view(result()));
  expect(screen.getAllByText('Facteur de zone à confirmer').length).toBeGreaterThan(0);expect(screen.queryByText(/×1\.30|×1\.00/)).not.toBeInTheDocument();
  expect(screen.getByText('Honoraires serveur synthétiques')).toBeInTheDocument();
 });
 it('preserves the existing local/historical path when no fresh server pricing is present',()=>{
  render(view(result(undefined,true)));fireEvent.keyDown(screen.getByRole('tab',{name:'Coûts'}),{key:'Enter'});
  expect(screen.getByText('×1.00 complexité')).toBeInTheDocument();expect(screen.queryByText('Honoraires serveur synthétiques')).not.toBeInTheDocument();
 });
});
