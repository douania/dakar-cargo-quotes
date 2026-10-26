import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,waitFor,cleanup,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Intake from '../Intake';
const m=vi.hoisted(()=>({create:vi.fn(),invoke:vi.fn(),from:vi.fn(),upload:vi.fn(),navigate:vi.fn()}));
vi.mock('react-router-dom',()=>({useNavigate:()=>m.navigate}));
vi.mock('@/components/layout/MainLayout',()=>({MainLayout:({children}:{children:React.ReactNode})=><main>{children}</main>}));
vi.mock('@/services/railwayApi',()=>({createIntake:m.create}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:m.invoke},from:m.from,auth:{getUser:async()=>({data:{user:{id:'synthetic-user'}}}),getSession:async()=>({data:{session:{access_token:'synthetic-session-not-real'}}})},storage:{from:()=>({upload:m.upload})}}}));
const result={success:true,case_id:'synthetic-case',status:'FACTS_PARTIAL',workflow_key:'AIR_IMPORT',complexity_level:1,confidence:0.8,missing_fields:[],assumptions:[],normalized_request:{}};
let fetchMock:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.clearAllMocks();m.create.mockResolvedValue(result);m.upload.mockResolvedValue({error:null});m.from.mockReturnValue({insert:vi.fn().mockResolvedValue({error:null})});
  m.invoke.mockImplementation(async(name:string,options:{body:{facts:unknown[]}})=>name==='set-intake-facts-batch'?{data:{ok:true,data:{case_id:result.case_id,facts:options.body.facts}},error:null}:{data:null,error:{context:Response.json({success:false,extraction:{status:'error',code:'OCR_NOT_CONFIGURED'}},{status:503})}});
  fetchMock=vi.fn().mockResolvedValue(Response.json({success:false,extraction_contract:1,extraction:{status:'error',code:'OCR_NOT_CONFIGURED'}},{status:503}));vi.stubGlobal('fetch',fetchMock);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function file(){const input=document.querySelector('input[type=file]') as HTMLInputElement;await userEvent.upload(input,new File([new Uint8Array([137,80])],'synthetic.png',{type:'image/png'}));}
it('document extraction failure keeps the selected file and never calls document AI analysis',async()=>{
  render(<Intake/>);await file();await userEvent.click(screen.getByRole('button',{name:'Analyser le document'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('service de lecture'));expect(screen.getByText('synthetic.png')).toBeVisible();expect(m.invoke.mock.calls.map(([name])=>name)).toEqual(['parse-document']);expect(m.create).not.toHaveBeenCalled();
});
it('post-creation extraction failure preserves the created case, critical facts and source with visible recovery',async()=>{
  render(<Intake/>);await file();await userEvent.type(screen.getByPlaceholderText(/Exemple:/), 'Demande synthétique de livraison de cinq colis vers Dakar.');await userEvent.click(screen.getByRole('button',{name:'Analyser la demande'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Dossier créé et document conservé'));
  expect(m.create).toHaveBeenCalledTimes(1);expect(m.upload).toHaveBeenCalledTimes(1);expect(fetchMock).toHaveBeenCalledTimes(1);expect(m.invoke.mock.calls.map(([name])=>name)).toEqual(['set-intake-facts-batch']);
  expect(screen.getByRole('button',{name:'Ouvrir le dossier'})).toBeEnabled();await userEvent.click(screen.getByRole('button',{name:'Ouvrir le dossier'}));expect(m.navigate).toHaveBeenCalledWith('/case/synthetic-case');
});
it('failed file persistence is not described as a conserved document and never recreates the case',async()=>{
  m.upload.mockResolvedValue({error:new Error('synthetic upload failure')});render(<Intake/>);await file();await userEvent.type(screen.getByPlaceholderText(/Exemple:/), 'Demande synthétique de livraison de cinq colis vers Dakar.');await userEvent.click(screen.getByRole('button',{name:'Analyser la demande'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('ajout du document non confirmé'));expect(m.create).toHaveBeenCalledTimes(1);expect(fetchMock).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Ouvrir le dossier'})).toBeEnabled();
});

it('plain text declared total weight reaches the existing atomic batch without file or AI',async()=>{
  const text="RECETTE SYNTHETIQUE - AUCUN ENVOI CLIENT. Demande de cotation DAP pour un conteneur 20 pieds standard (20DV), COC, marchandises non dangereuses, 5 000 kg au total. Origine Shanghai, arrivée au port de Dakar, livraison à Dakar. Les tarifs et frais doivent être vérifiés par l’opérateur ; aucun tarif ne doit être inventé. Référence DCQ-SIMPLE-20261026.";
  m.create.mockResolvedValue({...result,workflow_key:'WF_SIMPLE_QUOTE',missing_fields:[{field:'cargo.weight',question:'Poids total ?',priority:'high'}]});
  render(<Intake/>);fireEvent.change(screen.getByLabelText('Texte de la demande'),{target:{value:text}});
  await userEvent.click(screen.getByRole('button',{name:'Analyser la demande'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Ouvrir le dossier'})).toBeEnabled());
  expect(m.create).toHaveBeenCalledExactlyOnceWith({source:{type:'email_text',text}});
  expect(m.invoke).toHaveBeenCalledExactlyOnceWith('set-intake-facts-batch',{body:expect.objectContaining({source_type:'email_body',facts:expect.arrayContaining([{fact_key:'cargo.weight_kg',value_number:5000}])})});
  expect(screen.getByText(/poids total : 5[ \u00a0\u202f]000 kg/)).toBeVisible();
  expect(screen.queryByText('Poids total ?')).not.toBeInTheDocument();
  expect(m.upload).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
});

it('ambiguous text totals stay absent from the atomic batch with visible correction guidance',async()=>{
  render(<Intake/>);fireEvent.change(screen.getByLabelText('Texte de la demande'),{target:{value:'1 conteneur 20 pieds. Poids total : 5 t / 6 t.'}});
  await userEvent.click(screen.getByRole('button',{name:'Analyser la demande'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Ouvrir le dossier'})).toBeEnabled());
  expect(screen.getByText(/Poids total non repris/)).toBeVisible();
  const batch=m.invoke.mock.calls.find(([name])=>name==='set-intake-facts-batch')![1].body;
  expect(batch.facts.some((fact:{fact_key:string})=>fact.fact_key==='cargo.weight_kg')).toBe(false);
  expect(m.create).toHaveBeenCalledTimes(1);expect(m.upload).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
});
