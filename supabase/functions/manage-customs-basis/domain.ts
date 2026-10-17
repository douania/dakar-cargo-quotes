import { customsRow, customsUuid, validateCustomsDecision } from '../_shared/customs-basis.ts';
export function parseCustomsCommand(value: unknown) {
  const b=customsRow(value),read=b.action==='read';
  const keys=read?['action','case_id']:['action','case_id','id','parent_id','context_hash','decision'];
  if (!customsUuid(b.case_id) || !['read','adopt'].includes(String(b.action)) || Object.keys(b).some(k=>!keys.includes(k))) throw new Error('Demande de bases douanières invalide');
  if (!read && (!customsUuid(b.id) || (b.parent_id!==null&&!customsUuid(b.parent_id)) || typeof b.context_hash!=='string' || !/^[a-f0-9]{32}$/.test(b.context_hash))) throw new Error('Relisez les pièces et la décision courante');
  return {action:read?'read':'adopt',case_id:b.case_id,id:b.id,parent_id:b.parent_id,context_hash:b.context_hash,decision:read?null:validateCustomsDecision(b.decision)};
}
