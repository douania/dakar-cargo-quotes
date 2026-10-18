import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const {parseContainersFromText,extractFactsBasic,ownFactEmailBody}=await import('../build-case-puzzle/index.ts');
const basic=(body_text:string)=>extractFactsBasic([{id:'own-mail',from_address:'client@fixture.invalid',body_text}],[]).find(f=>f.key==='cargo.containers')?.value??[];
const expected=[{type:'40HC',quantity:2}];
for(const [name,body,wanted]of[
 ['reply','Please quote 2x40HC.\nOn Tuesday, Buyer wrote:\n> Please quote 2x40HC.',expected],
 ['follow-up only','Any news about the rate?\nOn Tuesday, Buyer wrote:\n> Please quote 2x40HC.',[]],
 ['forward','Please review the context below.\n----- Forwarded message -----\nFrom: client@fixture.invalid\nDate: Tuesday\nSubject: Original request\n2x40HC',[]],
 ['new text before Outlook history','Please quote 2x40HC.\nFrom: client@fixture.invalid\nSent: Tuesday\nTo: ops@fixture.invalid\nSubject: Old request\n9x20GP',expected],
 ['inline quoted lines','> Previously 9x20GP\nPlease quote 2x40HC.',expected],
 ['French history','Please quote 2x40HC.\nLe mardi, Client a écrit :\n9x20GP',expected],
 ['Chinese header block','Please quote 2x40HC.\n发件人：client@fixture.invalid\n发送时间：Tuesday\n收件人：ops@fixture.invalid\n主题：old request\n9x20GP',expected],
 ['legacy Chinese header block','Please quote 2x40HC.\n\u00e5\u008f\u0091\u00e4\u00bb\u00b6\u00e4\u00ba\u00ba\u00ef\u00bc\u009aclient@fixture.invalid\n\u00e5\u008f\u0091\u00e9\u0080\u0081\u00e6\u0097\u00b6\u00e9\u0097\u00b4\u00ef\u00bc\u009aTuesday\n9x20GP',expected],
]as const)Deno.test('quoted containers: '+name,()=>{assertEquals(parseContainersFromText(body),wanted);assertEquals(basic(body),wanted);});
Deno.test('quoted containers: HTML blockquote is historical, own text after it remains own',()=>{
 const html='<div>Please quote 2x40HC.</div><blockquote><p>Previously 9x20GP</p></blockquote><div>Delivery to Dakar.</div>';
 assertEquals(basic(html),expected);assertEquals(basic(btoa(html)),expected);
});
Deno.test('quoted containers: two own lots of the same type and quantity are not false duplicates',()=>{
 const body='Lot A: 2x40HC\nLot B: 2x40HC\nOn Tuesday, Buyer wrote:\n> Lot A: 2x40HC\n> Lot B: 2x40HC';
 assertEquals(parseContainersFromText(body),[{type:'40HC',quantity:4}]);
 assertEquals(basic(body),[{type:'40HC',quantity:2},{type:'40HC',quantity:2}]);
});
Deno.test('quoted containers: route label From alone is not a mail history boundary',()=>{
 const body='From: Dakar Port\nTo: local warehouse\nPlease quote 2x40HC.';
 assertEquals(parseContainersFromText(body),expected);assertEquals(basic(body),expected);
});
Deno.test('quoted containers: MIME alternative representation does not add a second declaration',()=>{
 const mime='Content-Type: multipart/alternative; boundary="q"\r\n\r\n--q\r\nContent-Type: text/plain\r\n\r\nPlease quote 2x40HC.\r\n--q\r\nContent-Type: text/html\r\n\r\n<div>Please quote 2x40HC.</div>\r\n--q--';
 assertEquals(basic(mime),expected);
});
Deno.test('quoted containers: a short own MIME part is not replaced by a later part',()=>{
 const mime='Content-Type: multipart/mixed; boundary="q"\r\n\r\n--q\r\nContent-Type: text/plain\r\n\r\nThanks\r\n--q\r\nContent-Type: text/plain\r\n\r\nOld forwarded 9x20GP\r\n--q--';
 assertEquals(ownFactEmailBody(mime),'Thanks');assertEquals(basic(mime),[]);
});
Deno.test('quoted containers: HTML-only MIME ignores envelope preamble and epilogue',()=>{
 const mime='Content-Type: multipart/alternative; boundary="q"\r\n\r\npreamble\r\n--q\r\nContent-Type: text/html\r\n\r\n<div>Please quote 2x40HC.</div><blockquote>Old 9x20GP</blockquote>\r\n--q--\r\nepilogue';
 assertEquals(basic(mime),expected);
});
Deno.test('quoted containers: nested MIME reads actual alternative body once',()=>{
 const mime='Content-Type: multipart/mixed; boundary="outer"\r\n\r\npreamble\r\n--outer\r\nContent-Type: multipart/alternative; boundary="inner"\r\n\r\n--inner\r\nContent-Type: text/html\r\n\r\n<div>Please quote 2x40HC.</div><blockquote>Old 9x20GP</blockquote>\r\n--inner--\r\n--outer--';
 assertEquals(basic(mime),expected);
});
