import { renderResumePdf } from './src/controllers/resumePdfController.js';
import fs from 'node:fs';
const role = (title, company, dates, n) => `
  <div style="margin-bottom:10px">
    <div style="break-after:avoid">
      <div style="display:flex;justify-content:space-between"><span style="font-weight:700">${title}</span><span style="opacity:.72">${dates}</span></div>
      <div style="font-style:italic;color:#1f3a5f;margin-bottom:2px">${company}</div>
    </div>
    <ul style="padding-left:18px;margin:2px 0 0">
      ${Array.from({length:n}).map((_,i)=>`<li style="margin-bottom:1px;break-inside:avoid">Built <strong>Go</strong> microservices and <strong>React</strong> components, bullet ${i+1}, ~26 words describing specific feature logic, an edge case, and API behavior in production with tracing.</li>`).join('')}
    </ul>
  </div>`;
const html = `
  <div style="text-align:center;margin-bottom:18px"><div style="font-size:24pt;font-weight:700">Sample Candidate</div></div>
  <div style="margin-bottom:14px"><div style="font-weight:700;break-after:avoid">EXPERIENCE</div>
    ${role('Senior Software Engineer','Accolade, Inc.','2022 – Present',12)}
    ${role('Software Engineer','WSECU','2021 – 2022',12)}
  </div>`;
const res = { _h:{}, setHeader(k,v){this._h[k]=v;}, status(c){this._c=c;return this;}, json(o){console.log('JSON',this._c,o);}, end(b){fs.writeFileSync('/tmp/pdf2.pdf',b);console.log('bytes',b.length);} };
await renderResumePdf({ body:{ html, paper:'letter', marginInches:0.5, font:'"Inter", sans-serif', baseSizePt:10.5, fileName:'two-roles.pdf' } }, res);
const buf=fs.readFileSync('/tmp/pdf2.pdf').toString('latin1');console.log('Page count:',(buf.match(/\/Type\s*\/Page[^s]/g)||[]).length);
