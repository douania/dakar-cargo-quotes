/** Source views only. Raw messages remain untouched; no date/priority or quantity inference. */
export interface EmailQuoteSections { ownText: string; quotedText: string; hasQuotedHistory: boolean }
const SIMPLE_ENTITIES: Record<string, string> = {'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#039;':"'"};
const entities = (text: string) => text.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#039);/gi, value =>
  (SIMPLE_ENTITIES[value.toLowerCase()] ?? value))
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (raw, value: string) => {
    const n = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1),16) : Number(value);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
  });

/** Extraction view only: select one MIME representation and retain its quote structure.
 * The canonical decoder shared with pricing is left byte-identical. */
export function decodeEmailQuoteView(raw: string, fallback: (body:string)=>string, depth=0): string {
  if(!raw)return '';
  const decode=(content:string,headers:string)=>{
    if(/content-transfer-encoding:\s*base64/i.test(headers)){
      try{return new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\s/g,'')),c=>c.charCodeAt(0)));}catch{return '';}
    }
    return /content-transfer-encoding:\s*quoted-printable/i.test(headers)
      ?content.replace(/=\r?\n/g,'').replace(/=([0-9a-f]{2})/gi,(_,hex:string)=>String.fromCharCode(parseInt(hex,16))):content;
  };
  const boundary=raw.match(/boundary="?([^"\s;]+)"?/i)?.[1];
  if(boundary&&depth<4){
    let html:string|undefined,nested:string|undefined;
    for(const part of raw.split('--'+boundary).slice(1)){
      if(part.startsWith('--'))break;
      const separator=part.match(/\r?\n\r?\n/);if(separator?.index===undefined)continue;
      const headers=part.slice(0,separator.index),content=part.slice(separator.index+separator[0].length).trim();
      if(/content-disposition:\s*attachment|content-type:\s*image\//i.test(headers))continue;
      if(/content-type:\s*text\/plain\b/i.test(headers)){const text=decode(content,headers);if(text)return renderEmailHtmlWithQuotes(text).slice(0,4000);}
      else if(/content-type:\s*text\/html\b/i.test(headers)&&html===undefined)html=decode(content,headers);
      else if(/content-type:\s*multipart\//i.test(headers)&&nested===undefined)nested=decodeEmailQuoteView(part,fallback,depth+1);
    }
    if(nested)return nested;
    if(html!==undefined)return renderEmailHtmlWithQuotes(html).slice(0,4000);
  }
  if(!boundary){
    const stripped=raw.replace(/\s/g,'');
    if(/^[A-Za-z0-9+/=]{40,}$/.test(stripped.slice(0,200))){
      try{const leading=stripped.match(/^[A-Za-z0-9+/=]+/)?.[0]||stripped,n=Math.min(leading.length,8000);
        const decoded=new TextDecoder().decode(Uint8Array.from(atob(leading.slice(0,Math.floor(n/4)*4)),c=>c.charCodeAt(0)));
        return renderEmailHtmlWithQuotes(decoded).slice(0,4000);
      }catch{/* Unusable encoding keeps the existing fallback view. */}
    }
  }
  return renderEmailHtmlWithQuotes(fallback(raw)).slice(0,4000);
}

/** Preserve blockquote/known quoted containers before MIME HTML is flattened. */
export function renderEmailHtmlWithQuotes(raw: string): string {
  if (!/<(?:html|body|div|p|br|blockquote|table|tr|span)\b/i.test(raw)) return raw;
  const stack: Array<{tag:string;quote:boolean;skip:boolean}> = [];
  const chunks: Array<{quote:boolean;text:string}> = [];
  const emit = (text:string) => {
    const state=stack.at(-1);if(state?.skip)return;
    const quote=state?.quote??false,last=chunks.at(-1);
    if(last?.quote===quote)last.text+=text;else chunks.push({quote,text});
  };
  for(const token of raw.match(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>|[^<]+|</gi)??[]){
    if(token.startsWith('<!--'))continue;
    const tag=token.match(/^<(\/?)\s*([a-z0-9]+)/i);
    if(!tag){emit(entities(token));continue;}
    const name=tag[2].toLowerCase(),block=/^(?:div|p|br|tr|li|table|blockquote|hr)$/.test(name);
    if(tag[1]){
      if(block)emit('\n');
      const index=stack.map(s=>s.tag).lastIndexOf(name);if(index>=0)stack.splice(index);
    }else{
      if(block)emit('\n');
      if(!/^(?:br|hr|img|meta|link|input|wbr)$/.test(name)&&!token.endsWith('/>')){
        const parent=stack.at(-1);
        const quoteClass=Array.from(token.matchAll(/\b(?:class|id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))
          .some(m=>(m[1]??m[2]??m[3]).split(/\s+/).some(c=>/^(gmail_quote|yahoo_quoted|moz-forward-container)$/i.test(c)));
        stack.push({tag:name,quote:!!parent?.quote||name==='blockquote'||quoteClass,skip:!!parent?.skip||/^(?:script|style)$/.test(name)});
      }
    }
  }
  return chunks.map(c=>c.quote?c.text.split(/\r?\n/).map(line=>'> '+line).join('\n'):c.text).join('\n');
}

const SENDER = /^\s*(?:From|De|发件人|\u00e5\u008f\u0091\u00e4\u00bb\u00b6\u00e4\u00ba\u00ba)\s*(?::|：|\u00ef\u00bc\u009a)/i;
const OTHER_HEADER = /^\s*(?:Sent|Date|To|Cc|Subject|Envoy[ée]|Envoy\u00c3\u00a9|À|A|Objet|Sujet|发送时间|收件人|主题|\u00e5\u008f\u0091\u00e9\u0080\u0081\u00e6\u0097\u00b6\u00e9\u0097\u00b4)\s*(?::|：|\u00ef\u00bc\u009a)/i;
const DATE_HEADER = /^\s*(?:Sent|Date|Envoy[ée]|Envoy\u00c3\u00a9|发送时间|\u00e5\u008f\u0091\u00e9\u0080\u0081\u00e6\u0097\u00b6\u00e9\u0097\u00b4)\s*(?::|：|\u00ef\u00bc\u009a)/i;
const HISTORY = /^\s*(?:On .{1,500} wrote\s*:|Le .{1,500}(?:a\s+)?[ée]crit\s*:|[-_\s]*(?:Original Message|Forwarded message|Message d['’]origine|Message transf[ée]r[ée])[-_\s]*:?|Begin forwarded message\s*:)\s*$/i;

export function splitEmailQuoteContext(body: string): EmailQuoteSections {
  const lines=renderEmailHtmlWithQuotes(body).replace(/\r\n?/g,'\n').split('\n');
  const own:string[]=[],quoted:string[]=[];let history=false;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/^\s*>/.test(line)){quoted.push(line.replace(/^\s*>\s?/,''));continue;}
    const headers=lines.slice(i+1,i+9).filter(next=>OTHER_HEADER.test(next));
    const headerBlock=SENDER.test(line)&&(headers.length>=2&&headers.some(next=>DATE_HEADER.test(next))||headers.length>0&&/@[^\s<>]+/.test(line));
    const wrappedReply=/^\s*(?:On|Le)\s/i.test(line)&&[2,3].some(n=>HISTORY.test(lines.slice(i,i+n).join(' ').replace(/\s+/g,' ')));
    if(HISTORY.test(line)||wrappedReply||headerBlock)history=true;
    (history?quoted:own).push(line);
  }
  return {ownText:own.join('\n').trim(),quotedText:quoted.join('\n').trim(),hasQuotedHistory:quoted.some(line=>line.trim().length>0)};
}
