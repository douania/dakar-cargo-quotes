import {assertEquals,assert} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {splitEmailQuoteContext,renderEmailHtmlWithQuotes} from './email-quote-context.ts';
Deno.test('email quote context: route headers with subject are current, not copied mail headers',()=>{
 const raw='From: Dakar\nTo: warehouse\nSubject: Freight\n2x40HC';assertEquals(splitEmailQuoteContext(raw).ownText,raw);
});
Deno.test('email quote context: wrapped reply header marks history, preserving raw source',()=>{
 const raw='New instruction\nOn Tuesday, a buyer\nwrote:\n2x40HC',saved=raw,r=splitEmailQuoteContext(raw);
 assertEquals(r.ownText,'New instruction');assert(r.quotedText.includes('2x40HC'));assertEquals(raw,saved);
});
Deno.test('email quote context: known HTML quote class can follow another class; own reply after it survives',()=>{
 const r=splitEmailQuoteContext('<div>New 2x40HC</div><div class="mail gmail_quote"><div>Old 9x20GP</div></div><div>New delivery Dakar</div>');
 assert(r.ownText.includes('2x40HC'));assert(r.ownText.includes('New delivery Dakar'));assert(!r.ownText.includes('9x20GP'));assert(r.quotedText.includes('9x20GP'));
});
Deno.test('email quote context: title/class substrings do not turn own content into a quote',()=>{
 const r=splitEmailQuoteContext('<div title="gmail_quote" class="not_gmail_quote">2x40HC</div>');assertEquals(r.ownText,'2x40HC');assertEquals(r.hasQuotedHistory,false);
});
Deno.test('email quote context: HTML comments/style/script never become cargo text',()=>{
 const r=renderEmailHtmlWithQuotes('<div>2x40HC</div><!--9x20GP--><style>9x20GP</style><script>9x20GP</script>');assert(r.includes('2x40HC'));assert(!r.includes('9x20GP'));
});
Deno.test('email quote context: sender block without an address still needs a date header',()=>{
 const r=splitEmailQuoteContext('Current\nFrom: Buyer\nSent: Tuesday\nSubject: old\n9x20GP');assertEquals(r.ownText,'Current');assert(r.quotedText.includes('9x20GP'));
});
