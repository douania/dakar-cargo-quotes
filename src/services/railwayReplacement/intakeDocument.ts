/** Source-preserving document contracts. No OCR/AI algorithm or network default. */
import { RecoveryError, validateFileDescriptor, canonicalJson, type IntakeFileDescriptor } from './recoveryContract';
import { hasExtractedText, sanitizeDocumentText, EXTRACTION_CONTRACT } from '../../../supabase/functions/_shared/document-extraction';
export async function readFileBytes(file:Blob):Promise<ArrayBuffer>{
 if(typeof file.arrayBuffer==='function')return file.arrayBuffer();
 if(typeof FileReader==='undefined')throw new RecoveryError('FILE_READ_UNAVAILABLE');
 return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new RecoveryError('FILE_READ_UNAVAILABLE'));reader.onload=()=>reader.result instanceof ArrayBuffer?resolve(reader.result):reject(new RecoveryError('FILE_READ_UNAVAILABLE'));reader.readAsArrayBuffer(file);});
}
// A typed view preserves every byte and is accepted across FileReader/VM realms
// by native WebCrypto, including Node 20. Do not stringify or hash a prefix.
export async function sha256Bytes(bytes:ArrayBuffer):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function describeIntakeFile(file:File,id:string,documentId:string):Promise<IntakeFileDescriptor>{
 if(file.size<1||file.size>10*1024*1024)throw new RecoveryError('FILE_SIZE_INVALID');
 const bytes=await readFileBytes(file);if(bytes.byteLength!==file.size)throw new RecoveryError('FILE_READ_CHANGED');
 return validateFileDescriptor({document_id:documentId,name:file.name,mime:file.type,size:file.size,sha256:await sha256Bytes(bytes),path:`${id}/${documentId}-${file.name.replace(/[^\w.-]/g,'_')}`},id);
}
export interface StoredFileReader {read(path:string):Promise<{data:Blob|null;error:unknown}>}
export async function verifyIntakeFile(reader:StoredFileReader,descriptor:IntakeFileDescriptor):Promise<{descriptor:IntakeFileDescriptor}>{
 let result;try{result=await reader.read(descriptor.path);}catch{throw new RecoveryError('FILE_READ_UNCONFIRMED','UNKNOWN');}
 if(result.error||!result.data)throw new RecoveryError('FILE_READ_UNCONFIRMED','UNKNOWN');
 if(result.data.size!==descriptor.size)throw new RecoveryError('FILE_CHANGED');
 const bytes=await readFileBytes(result.data);if(bytes.byteLength!==descriptor.size||await sha256Bytes(bytes)!==descriptor.sha256)throw new RecoveryError('FILE_CHANGED');
 return {descriptor:structuredClone(descriptor)};
}
export function validateDocumentStepOutput(step:string,raw:unknown,file:IntakeFileDescriptor,binding?:{operation_id:string;claim_id:string;input:Record<string,unknown>}):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new RecoveryError('DOCUMENT_RECEIPT_INVALID','UNKNOWN');const out=raw as Record<string,unknown>;
 if(step==='upload'){if(canonicalJson(out.descriptor)!==canonicalJson(file))throw new RecoveryError('DOCUMENT_RECEIPT_INVALID','UNKNOWN');return out;}
 if(!binding||out.operation_id!==binding.operation_id||out.claim_id!==binding.claim_id)throw new RecoveryError('DOCUMENT_TICKET_CHANGED','UNKNOWN');
 if(step==='analysis'&&(out.extraction_claim_id!==binding.input.extraction_claim_id||out.text_sha256!==binding.input.text_sha256))throw new RecoveryError('DOCUMENT_SOURCE_CHANGED','UNKNOWN');
 if(out.file_sha256!==file.sha256)throw new RecoveryError('DOCUMENT_SOURCE_CHANGED','UNKNOWN');
 if(step==='extraction'){
  if(out.extraction_contract!==EXTRACTION_CONTRACT||typeof out.text!=='string'||out.text.length>200000||!hasExtractedText(out.text)||sanitizeDocumentText(out.text)!==out.text||typeof out.text_length!=='number'||out.text_length!==out.text.length)throw new RecoveryError('EXTRACTION_UNCONFIRMED','UNKNOWN');
 }else if(step==='analysis'){if(!out.analysis||typeof out.analysis!=='object'||Array.isArray(out.analysis))throw new RecoveryError('ANALYSIS_UNCONFIRMED','UNKNOWN');}
 else throw new RecoveryError('DOCUMENT_STEP_INVALID');
 return structuredClone(out);
}
