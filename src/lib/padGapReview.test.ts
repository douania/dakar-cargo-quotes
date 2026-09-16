import { describe, expect, it } from 'vitest';
import { buildClientQuestionsFromGaps, isClientResolvableGap } from '../../supabase/functions/_shared/client-gap-policy';
import { hasPadGapReference, isCurrentGapDraft, isObsoletePadDraft, isUsableClientGapRequest, latestGapActions } from './padGapReview';

describe('PAD review policy, without pricing or fact promotion', () => {
  it.each(['fr','en'] as const)('never interprets missing PAD as missing description (%s)', language => {
    expect(isClientResolvableGap('pricing.pad_category')).toBe(false);
    expect(buildClientQuestionsFromGaps([{gap_key:'pricing.pad_category'}],language)).toEqual([]);
    const questions=buildClientQuestionsFromGaps([{gap_key:'pricing.pad_category'},{gap_key:'cargo.weight_kg'}],language);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatch(/poids|weight/);
    expect(questions[0]).not.toMatch(/description|nature/);
  });
  it('keeps real missing descriptions and composite ambiguities client-resolvable',()=>{
    for(const key of ['cargo.description','cargo.mixed_scope_confirmation','cargo.weight_total_confirmation']) {
      expect(isClientResolvableGap(key)).toBe(true);
      expect(buildClientQuestionsFromGaps([{gap_key:key}])).toHaveLength(1);
    }
  });
  it('retires entire mixed bodies and detects legacy dedupe references',()=>{
    expect(isObsoletePadDraft({requested_gap_keys:['cargo.weight_kg','pricing.pad_category']})).toBe(true);
    expect(isObsoletePadDraft({source_action_dedupe_key:'REQUEST_CLIENT_INFO_FOR_GAPS:case:pricing.pad_category,cargo.weight_kg'})).toBe(true);
    expect(hasPadGapReference(['other.pricing.pad_category'],null)).toBe(false);
    expect(isObsoletePadDraft(null)).toBe(false);
  });
  it('never reuses a partial, mixed, closed-scope or unkeyed draft',()=>{
    expect(isCurrentGapDraft({requested_gap_keys:['cargo.weight_kg']},['cargo.weight_kg'])).toBe(true);
    expect(isCurrentGapDraft({requested_gap_keys:['cargo.description','cargo.weight_kg']},['cargo.weight_kg'])).toBe(false);
    expect(isCurrentGapDraft({requested_gap_keys:['cargo.weight_kg','pricing.pad_category']},['cargo.weight_kg'])).toBe(false);
    expect(isCurrentGapDraft({requested_gap_keys:['cargo.weight_kg']},[])).toBe(false);
    expect(isCurrentGapDraft({},['cargo.weight_kg'])).toBe(false);
  });
  it('reduces append-only history before looking for open work',()=>{
    const event=(status:string)=>({event_data:{action_code:'REQUEST_CLIENT_INFO_FOR_GAPS',dedupe_key:'key',status}});
    expect(latestGapActions([event('done'),event('open')])).toEqual([event('done')]);
    expect(latestGapActions([event('open'),event('done'),event('open')])).toEqual([event('open')]);
  });
  it('requires an explicit clean source for unsent drafts but preserves genuine sent/answered follow-up',()=>{
    const row={gap_key:'cargo.weight_kg',status:'drafted',source_timeline_event_id:'old'};
    const mixed=[{id:'old',event_data:{kind:'reply_draft_v1',requested_gap_keys:['pricing.pad_category','cargo.weight_kg']}}];
    expect(isUsableClientGapRequest(row,[])).toBe(false);
    expect(isUsableClientGapRequest(row,mixed)).toBe(false);
    for(const status of ['sent','answered'])expect(isUsableClientGapRequest({...row,status},mixed)).toBe(true);
    expect(isUsableClientGapRequest({...row,gap_key:'pricing.pad_category',status:'answered'},mixed)).toBe(false);
    expect(isUsableClientGapRequest(row,[{id:'old',event_data:{kind:'reply_draft_v1',requested_gap_keys:['cargo.weight_kg']}}])).toBe(true);
  });
});
