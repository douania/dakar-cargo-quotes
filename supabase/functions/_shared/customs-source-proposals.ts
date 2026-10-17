/** Documentary candidates only. No fiscal rule, valuation, conversion or fact promotion. */
import { documentCargoEvidence, dimensionGroupsDisagree, sourceConfidence } from './cargo-source-evidence.ts';
import { ownRequestText } from './request-service-evidence.ts';
import { extractPlainTextFromMime } from './email-text-extraction.ts';

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
const distinct = (values: (string | number | null)[]) => new Set(values.filter(v => v !== null));
type CargoEvidence = ReturnType<typeof documentCargoEvidence>;
export interface CustomsDocumentProposal extends CargoEvidence {
  document_index: number | null;
  document_type: string | null;
  document_date: string | null;
  reference: string | null;
  page_range: string | null;
  content_class: string | null;
  content_classes: string[];
  issues: string[];
}
export interface CustomsSourceProposal {
  attachment_id: string;
  filename: string;
  email_id: string | null;
  email_sent_at: string | null;
  email_received_at: string | null;
  attachment_created_at: string | null;
  email_subject: string | null;
  email_excerpt: string | null;
  documents: CustomsDocumentProposal[];
  nonCommercial: boolean;
  hsDeclared: string | null;
  money: CargoEvidence['money'];
  issues: string[];
  can_select: boolean;
  reasons: string[];
}
export interface CustomsSourceGroup {reference:string|null;attachment_ids:string[];hs_declared:string|null;recommended:boolean}

function documentProposal(raw: Row, root: Row, index: number | null): CustomsDocumentProposal {
  // Never fall back from a sub-document to the flattened attachment extraction.
  const info = row(raw.extracted_info ?? raw);
  const evidence = documentCargoEvidence(raw);
  const document: CustomsDocumentProposal = {
    ...evidence, confidence: sourceConfidence(root, raw), document_index: index,
    document_type: text(raw.doc_type ?? info.document_type ?? raw.type),
    document_date: text(info.document_date ?? info.invoice_date),
    reference: text(info.invoice_number ?? info.invoice_no ?? info.pfi_no),
    page_range: text(raw.page_range), content_class: text(raw.content_class ?? info.content_class ?? root.content_class),
    content_classes: [...new Set([root.content_class, raw.content_class, info.content_class].map(text).filter((v): v is string => v !== null))], issues: [],
  };
  if (document.hsDeclared && !/^(?:\d{6}|\d{8}|\d{10})$/.test(document.hsDeclared.replace(/[.\s]/g, ''))) document.issues.push('Code HS documentaire incomplet ou illisible.');
  if (evidence.money.some(m => !m.currency || !/^[A-Z]{3}$/.test(m.currency))) document.issues.push('Devise documentaire absente ou non reconnue ; aucune conversion déduite.');
  if (document.content_classes.some(c => ['quoted', 'historical', 'hypothesis'].includes(c))) document.issues.push('Document classé cité, historique ou hypothétique : hors proposition adoptable.');
  for (const kind of ['FOB', 'freight', 'insurance', 'total']) {
    const amounts = evidence.money.filter(m => m.kind === kind);
    if (distinct(amounts.map(m => `${m.currency}:${m.amount}`)).size > 1) document.issues.push(`Montants ${kind} contradictoires dans ce document.`);
  }
  const kinds = ['FOB', 'freight', 'insurance', 'total'];
  const amounts = kinds.map(kind => evidence.money.filter(m => m.kind === kind));
  if (amounts.every(a => a.length === 1) && amounts.every(a => a[0].currency && a[0].currency === amounts[0][0].currency) &&
    Math.abs(amounts[0][0].amount + amounts[1][0].amount + amounts[2][0].amount - amounts[3][0].amount) > .011) {
    document.issues.push('Le total déclaré diffère de FOB + fret + assurance ; vérifier la pièce, sans recalcul automatique.');
  }
  return document;
}

function relevant(d: CustomsDocumentProposal): boolean {
  return d.nonCommercial || !!d.hsDeclared || d.money.length > 0 || d.grossKg !== null || d.netKg !== null || d.cartons !== null || d.groups.length > 0 ||
    (!!d.reference && /invoice|packing|facture|colisage/i.test(d.document_type ?? ''));
}

function disagreement(documents: CustomsDocumentProposal[]): string[] {
  const issues: string[] = [];
  if (distinct(documents.map(d => d.hsDeclared?.replace(/[.\s]/g, '') ?? null)).size > 1) issues.push('Classements HS différents entre les documents ; aucune position choisie automatiquement.');
  if (distinct(documents.map(d => d.reference)).size > 1) issues.push('Références documentaires différentes : le rattachement au même envoi doit être vérifié.');
  for (const key of ['grossKg', 'netKg', 'cartons'] as const) {
    if (distinct(documents.map(d => d[key])).size > 1) issues.push(`Données ${key === 'cartons' ? 'de colis' : 'de poids'} contradictoires entre les documents ; la décision douanière ne les résout pas.`);
  }
  if (dimensionGroupsDisagree(documents.map(d => d.groups))) issues.push('Répartitions de dimensions contradictoires entre les documents ; à revoir dans les données du lot.');
  for (const kind of ['FOB', 'freight', 'insurance', 'total']) {
    const amounts = documents.flatMap(d => d.money.filter(m => m.kind === kind));
    if (distinct(amounts.map(m => `${m.currency}:${m.amount}`)).size > 1) issues.push(`Montants ou devises ${kind} différents ; aucune somme ni conversion entre documents.`);
  }
  return issues;
}

function flattenedDisagreement(root: Row, documents: CustomsDocumentProposal[]): string[] {
  if (!Array.isArray(root.documents) || !root.documents.length) return [];
  const summary = documentProposal({...root, documents: []}, root, null), issues: string[] = [];
  const digits = (v: string | null) => v?.replace(/[.\s]/g, '');
  if (summary.hsDeclared && !documents.some(d => digits(d.hsDeclared) === digits(summary.hsDeclared))) issues.push(`Le résumé extrait global indique le HS ${summary.hsDeclared}, absent des sous-documents.`);
  if (summary.reference && !documents.some(d => d.reference === summary.reference)) issues.push(`Le résumé extrait global indique une autre référence : ${summary.reference}.`);
  if (summary.nonCommercial && !documents.some(d => d.nonCommercial)) issues.push('Le résumé extrait global indique FOC/non commercial, sans attribution à un sous-document.');
  for (const m of summary.money) {
    if (!documents.some(d => d.money.some(n => n.kind === m.kind && n.amount === m.amount && n.currency === m.currency))) issues.push(`Le résumé extrait global indique ${m.kind} ${m.amount} ${m.currency ?? 'devise inconnue'}, non retrouvé dans les sous-documents.`);
  }
  for (const key of ['grossKg', 'netKg', 'cartons'] as const) {
    if (summary[key] !== null && !documents.some(d => d[key] === summary[key])) issues.push(`Le résumé extrait global contient une donnée ${key} non attribuée aux sous-documents.`);
  }
  if (summary.groups.length && documents.some(d => d.groups.length) && documents.every(d => !d.groups.length || dimensionGroupsDisagree([summary.groups,d.groups]))) issues.push('Le résumé extrait global donne une répartition de dimensions différente des sous-documents.');
  return issues;
}

export function documentaryCustomsProposals(context: { attachments: Row[] }): CustomsSourceProposal[] {
  const proposals: CustomsSourceProposal[] = [];
  for (const attachment of context.attachments) {
    const root = row(attachment.extracted_data);
    if (['logo', 'signature', 'skipped'].includes(String(root.type).toLowerCase())) continue;
    const rawDocuments = Array.isArray(root.documents) && root.documents.length ? root.documents.map(row) : [root];
    const documents = rawDocuments.map((raw, index) => documentProposal(raw, root, rawDocuments[0] === root ? null : index)).filter(relevant);
    if (!documents.length) continue;
    const flattenedIssues = flattenedDisagreement(root, documents);
    const issues = [...documents.flatMap(d => d.issues), ...disagreement(documents), ...flattenedIssues];
    const compositeLinked = documents.length < 2 || documents.every(d => d.reference && d.reference === documents[0].reference);
    if (!compositeLinked) issues.push('Pièce composite : rattachement des sous-documents à un seul envoi non établi ; retenue indisponible.');
    const allHs = [...distinct(documents.map(d => d.hsDeclared?.replace(/[.\s]/g, '') ?? null))];
    proposals.push({
      attachment_id: String(attachment.id), filename: String(attachment.filename),
      email_id: text(attachment.email_id), email_sent_at: text(attachment.email_sent_at), email_received_at: text(attachment.email_received_at),
      attachment_created_at: text(attachment.created_at), email_subject: text(attachment.email_subject),
      email_excerpt: text(ownRequestText(extractPlainTextFromMime(String(attachment.email_body_text ?? ''))).trim().slice(0, 500)),
      documents, issues, can_select: !flattenedIssues.length && compositeLinked && !documents.some(d => d.content_classes.some(c => ['quoted', 'historical', 'hypothesis'].includes(c))),
      reasons: [documents.some(d => d.nonCommercial)?'Facture FOC/non commerciale : valeur déclarée à examiner, distincte de la valeur douanière.':null,
        documents.some(d => d.hsDeclared)?'Classement HS déclaré dans la pièce.':null,
        documents.some(d => d.money.length)?'Montants documentaires disponibles, sans conversion automatique.':null,
        documents.some(d => d.grossKg!==null||d.cartons!==null||d.groups.length)?'Poids, colis ou dimensions documentés.':null,
        documents.some(d => d.reference)?'Référence documentaire permettant de rapprocher les pièces.':null].filter((v):v is string=>v!==null),
      nonCommercial: documents.some(d => d.nonCommercial), hsDeclared: allHs.length === 1 ? documents.find(d => d.hsDeclared)?.hsDeclared ?? null : null,
      // Compatibility summary only; the UI and proof retain each document separately.
      money: documents.length === 1 ? documents[0].money : [],
    });
  }
  const sharedIssues = disagreement(proposals.flatMap(p => p.documents));
  for (const proposal of proposals) proposal.issues = [...new Set([...proposal.issues, ...sharedIssues])];
  return proposals;
}

export function assertDocumentarySources(ids: string[], context: { attachments: Row[] }): void {
  const proposals = documentaryCustomsProposals(context);
  if (ids.some(id => !proposals.some(p => p.attachment_id === id && p.can_select))) {
    throw new Error('Pièce sans preuve exploitable, citée ou composite ambiguë : choisissez les sources pertinentes du même envoi.');
  }
  const selected = proposals.filter(p => ids.includes(p.attachment_id));
  const documents=selected.flatMap(p=>p.documents),references=distinct(documents.map(d=>d.reference));
  if (references.size>1 || (disagreement(documents).length && (references.size!==1||documents.some(d=>!d.reference)))) {
    throw new Error('Les pièces sélectionnées se contredisent : retenez un ensemble cohérent du même envoi avant adoption.');
  }
}

/** Group by explicit document reference only. Never choose a lot by recency or invent its identity. */
export function customsSourceGroups(proposals: CustomsSourceProposal[]): CustomsSourceGroup[] {
  const groups=new Map<string,CustomsSourceProposal[]>();
  for(const p of proposals.filter(p=>p.can_select)){
    const reference=p.documents[0]?.reference;
    const key=reference?`reference:${reference}`:`unassigned:${p.attachment_id}`;
    groups.set(key,[...(groups.get(key)??[]),p]);
  }
  return [...groups.values()].map(group=>{
    const documents=group.flatMap(p=>p.documents),hs=[...distinct(documents.map(d=>d.hsDeclared?.replace(/[.\s]/g,'')??null))];
    const recommended=group.every(p=>p.documents.every(d=>!d.issues.length))&&!disagreement(documents).length;
    return {reference:documents[0]?.reference??null,attachment_ids:group.map(p=>p.attachment_id),hs_declared:recommended&&hs.length===1?String(hs[0]):null,recommended};
  });
}
