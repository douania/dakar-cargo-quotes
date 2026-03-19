

# Patch CL2-résiduel — Branche image/PDF erreur AI générique

## Problème

Ligne 1508 : bare `continue;` dans la branche image/PDF quand `!aiResponse.ok` et le statut n'est ni 402 ni 429. Pas de release du claim, pas de mark `is_analyzed`, pas de push dans `results`. Le claim reste posé jusqu'à expiration (15 min).

La branche Excel (L1392-1405) gère correctement ce cas avec un update ownership-aware + continue.

## Fix — 1 remplacement

### L1508

**Avant :**
```typescript
            continue;
```

**Après :**
```typescript
            // Mark as analyzed with error — ownership-aware (align with Excel branch)
            const { error: updateErr } = await supabase
              .from('email_attachments')
              .update({
                is_analyzed: true,
                extracted_text: extractedText || null,
                extracted_data: { type: 'error', message: 'AI analysis failed', status: aiResponse.status },
                analysis_claimed_at: null
              })
              .eq('id', attachment.id)
              .eq('is_analyzed', false)
              .eq('analysis_claimed_at', claimTs);
            if (updateErr) console.warn('[analyze-attachments] Update failed (AI error doc):', updateErr.message);
            results.push({
              attachment_id: attachment.id,
              filename: attachment.filename,
              success: false,
              skipped: true,
              error_code: `AI_HTTP_${aiResponse.status}`,
              error_message: `AI analysis failed (${aiResponse.status})`
            });
            continue;
```

## Scope

- 1 line replaced in `supabase/functions/analyze-attachments/index.ts`
- Aligns image/PDF branch with Excel branch behavior
- No other files touched

