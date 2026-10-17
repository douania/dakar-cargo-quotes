import { expect,it,vi } from 'vitest';
import { extractionPayload, prepareCaseDocuments, hasExtractedText } from './documentExtraction';
const ready={success:true,status:'ok',extraction_contract:1,remaining:0};
it.each([
  null,{success:true,document:{text_preview:'[OCR vide]',extracted_data:{extractionStatus:'error'}}},
  {success:false,extraction_contract:1,extraction:{status:'error',code:'OCR_NOT_CONFIGURED'}},
  {success:true,extraction_contract:1,extraction:{status:'empty',text_length:0,persisted:false}},
  {success:true,extraction_contract:1,extraction:{status:'extracted',text_length:0,persisted:true}},
  {success:true,extraction_contract:1,extraction:{status:'extracted',text_length:100,persisted:false}},
])('no failed, empty, unpersisted or old200 payload is text evidence %#',async data=>{
  await expect(extractionPayload(data)).rejects.toThrow(/conservé/);
});
it('reads the safe failure code inside a real SDK HTTP-error response',async()=>{
  const error={context:Response.json({extraction:{status:'error',code:'OCR_NOT_CONFIGURED'},error:'synthetic internal detail'})};
  await expect(extractionPayload(null,error)).rejects.toThrow("service de lecture");
});
it('only confirmed persisted nonempty text can advance',async()=>{
  const body={success:true,extraction_contract:1,extraction:{status:'extracted',text_length:4,persisted:true}};
  expect(await extractionPayload(body)).toBe(body);expect(hasExtractedText('5 kg')).toBe(true);
});
it.each([null,{remaining:0},{...ready,remaining:null},{...ready,remaining:-1},{...ready,remaining:0.5},{...ready,processed_id:'doc',text_length:0},{...ready,status:'error'},{...ready,success:false}])('preflight rejects missing/unknown/failed preparation %#',async data=>{
  const invoke=vi.fn().mockResolvedValue({data,error:null});await expect(prepareCaseDocuments(invoke,'case-a')).rejects.toThrow();expect(invoke).toHaveBeenCalledTimes(1);
});
it('prepares at most five real pending documents and does not announce ready for a sixth',async()=>{
  const invoke=vi.fn();for(let remaining=5;remaining>=1;remaining--)invoke.mockResolvedValueOnce({data:{...ready,remaining,processed_id:'doc-'+remaining,text_length:4},error:null});
  await expect(prepareCaseDocuments(invoke,'case-a')).rejects.toThrow('restent à préparer');expect(invoke).toHaveBeenCalledTimes(5);
});
it('email-only case with no pending documents and a completed retry can advance',async()=>{
  const invoke=vi.fn().mockResolvedValueOnce({data:{...ready,remaining:1,processed_id:'doc-a',text_length:4},error:null}).mockResolvedValueOnce({data:ready,error:null});
  await expect(prepareCaseDocuments(invoke,'case-a')).resolves.toBeUndefined();expect(invoke).toHaveBeenCalledTimes(2);
});
