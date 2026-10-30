// Regenerates create_task's confirmation card inside voiceos.integration.json.
// Run `bun build-confirm.ts` after editing this file. VoiceOS caches the manifest
// at install time, so the integration must be reinstalled/refreshed afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { renderCustom, markHtml } from "./widgetKit.ts";

const manifestPath = `${import.meta.dir}/voiceos.integration.json`;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const tool = manifest.tools.find((t: any) => t.name === "create_task");

const css = `
.as{position:relative;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;padding:10px 14px 2px;color:var(--ink-1);--pop:#2b2b2f}
html[data-k-theme=light] .as{--pop:#fff}
/* Same header as the result card (server.ts) so the two read as one flow. */
.as-head{display:flex;align-items:center;gap:8px;margin-bottom:9px}
.as-chip{font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-4)}
.as-title{display:block;width:100%;padding:2px 0 7px;margin-bottom:8px;background:transparent;border:0;border-bottom:2px solid var(--accent);outline:none;font:inherit;font-size:17px;font-weight:600;letter-spacing:-.01em;line-height:1.3;color:var(--ink-1)}
.as-title::placeholder{color:var(--ink-4)}

.as-row{display:flex;align-items:center;min-height:32px}
.as-lbl{flex:none;width:58px;font-size:12px;color:var(--ink-3)}
.as-val{flex:1;min-width:0;display:flex;align-items:center;gap:6px;height:28px;margin-left:-8px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:var(--ink-1);font:inherit;font-size:13px;font-weight:500;text-align:left;cursor:pointer}
.as-val>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-val:hover,.as-val[aria-expanded=true]{background:var(--fill-1)}
.as-val.as-empty{color:var(--ink-3)}
.as-val svg{flex:none;color:var(--ink-4);transition:transform .15s ease}
.as-val[aria-expanded=true] svg{transform:rotate(180deg)}
.as-time{font-variant-numeric:tabular-nums}

.as-val .as-ic{flex:none;color:var(--ink-3)}
/* Date and time share the Due row; the time button only appears once there is a date. */
.as-val+.as-val{margin-left:4px}
#as-due-btn{flex:7}
.as-time{flex:3}
.as-val[hidden]{display:none}

/* Popovers float over the rows below instead of pushing them down. */
.as-pop{position:absolute;z-index:999;left:64px;right:14px;padding:6px;border-radius:12px;background:var(--pop);box-shadow:0 0 0 1px var(--line),0 12px 32px rgba(0,0,0,.45)}
html[data-k-theme=light] .as-pop{box-shadow:0 0 0 1px var(--line),0 12px 28px rgba(0,0,0,.16)}
.as-pop[hidden]{display:none}
.as-list{max-height:180px;overflow-y:auto}
.as-opt{display:flex;align-items:center;width:100%;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--ink-1);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.as-opt>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-opt:hover{background:var(--fill-2)}
.as-opt.as-none{color:var(--ink-3)}
.as-opt[aria-selected=true]::after{content:"";flex:none;width:9px;height:5px;margin:-3px 2px 0 8px;border:solid var(--accent);border-width:0 0 2px 2px;transform:rotate(-45deg)}

.as-quick{display:flex;gap:4px;padding:0 0 6px;margin-bottom:6px;border-bottom:1px solid var(--line)}
.as-c{flex:1;height:26px;padding:0 6px;border:0;border-radius:7px;background:var(--fill-1);color:var(--ink-1);font:inherit;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.as-c:hover{background:var(--fill-2)}
.as-c[aria-pressed=true]{background:var(--accent);color:#fff}
/* Clear sits at the top: the bottom-right corner belongs to the host's Create task button. */
.as-clear{flex:none;height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--ink-2);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.as-clear:hover{background:var(--fill-2);color:var(--ink-1)}
.as-clear:disabled{color:var(--ink-4);background:transparent;cursor:default}

.as-calh{display:flex;align-items:center;justify-content:space-between;padding:2px 2px 4px;font-size:12.5px;font-weight:600}
.as-calh button{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--ink-2);font-size:15px;line-height:1;cursor:pointer}
.as-calh button:hover{background:var(--fill-2)}
.as-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}
.as-grid>span{font-size:10px;color:var(--ink-4);padding:2px 0 3px}
.as-grid>button{height:26px;border:0;border-radius:6px;background:transparent;color:var(--ink-1);font:inherit;font-size:12px;font-variant-numeric:tabular-nums;cursor:pointer}
.as-grid>button:hover{background:var(--fill-2)}
.as-grid>button.as-past{color:var(--ink-4)}
.as-grid>button.as-today{color:var(--accent);font-weight:600}
.as-grid>button[aria-pressed=true]{background:var(--accent);color:#fff}

.as button:focus-visible,.as-title:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.as-title:focus-visible{outline:none;border-bottom-width:3px}
@media(prefers-reduced-motion:reduce){.as-val svg{transition:none}}
`;

const chevron = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.75L5 6.25l2.5-2.5"/></svg>`;
const calIcon = `<svg class="as-ic" width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.75" y="2.75" width="10.5" height="9.5" rx="2"/><path d="M1.75 5.75h10.5M4.75 1.25v2.5M9.25 1.25v2.5"/></svg>`;
const menuRow = (key: string, label: string) => `
<input type="hidden" id="as-${key}" data-voiceos-key="${key}" />
<div class="as-row"><span class="as-lbl">${label}</span><button type="button" class="as-val" data-menu="${key}" aria-expanded="false"><span></span>${chevron}</button></div>
<div class="as-pop" id="as-pop-${key}" hidden><div class="as-list" role="listbox" aria-label="${label}"></div></div>`;

const body = `<div class="as">
<div class="as-head">${markHtml()}<span class="as-chip">New task</span></div>
<input class="as-title" data-voiceos-key="name" placeholder="Task name" spellcheck="false" autocomplete="off" />
<input type="hidden" id="as-due_on" data-voiceos-key="due_on" />
<input type="hidden" id="as-due_time" data-voiceos-key="due_time" />
<div class="as-row"><span class="as-lbl">Due</span><button type="button" class="as-val" data-menu="cal" id="as-due-btn" aria-expanded="false" aria-haspopup="dialog">${calIcon}<span></span>${chevron}</button><button type="button" class="as-val as-time" data-menu="due_time" aria-expanded="false" aria-label="Due time" hidden><span></span>${chevron}</button></div>
<div class="as-pop" id="as-pop-cal" role="dialog" aria-label="Due date" hidden>
<div class="as-quick"><button type="button" class="as-c" data-q="today">Today</button><button type="button" class="as-c" data-q="tomorrow">Tomorrow</button><button type="button" class="as-c" data-q="mon">Next Mon</button><button type="button" class="as-clear" id="as-clear">Clear</button></div>
<div class="as-calh"><button type="button" id="as-prev" aria-label="Previous month">&lsaquo;</button><span id="as-month"></span><button type="button" id="as-next" aria-label="Next month">&rsaquo;</button></div><div class="as-grid" id="as-grid"></div>
</div>
<div class="as-pop" id="as-pop-due_time" hidden><div class="as-list" role="listbox" aria-label="Due time"></div></div>
${menuRow("project", "Project")}
${menuRow("section", "Section")}
</div>
<script>(function(){
/* Runs before the kit's init handler (this script precedes it); the kit then
   hydrates the keyed hidden inputs from args, so we render from args directly. */
var $=function(id){return document.getElementById(id)};
/* Programmatic value changes don't fire 'input'; the kit stages edits from that event. */
function stage(el,v){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))}
var pad=function(n){return(n<10?'0':'')+n};
var ymd=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
var parse=function(s){var m=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s||'');return m?new Date(+m[1],m[2]-1,+m[3]):null};
var today=new Date();today.setHours(0,0,0,0);
var plus=function(n){var d=new Date(today);d.setDate(d.getDate()+n);return d};
var quick={today:ymd(today),tomorrow:ymd(plus(1)),mon:ymd(plus((8-today.getDay())%7||7))};
var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var view=new Date(today.getFullYear(),today.getMonth(),1);
var clock=function(v){var m=/^(\\d{1,2}):(\\d{2})/.exec(v);if(!m)return v;var h=+m[1];return((h+11)%12+1)+':'+m[2]+(h<12?' AM':' PM')};

/* Each menu: options [{v,l}], the first being the "none" choice. */
var menus={due_time:[{v:'',l:'No time'}],project:[{v:'',l:'No project'}],section:[{v:'',l:'Default section'}]};
for(var h=0;h<24;h++)for(var m=0;m<60;m+=30){var t=pad(h)+':'+pad(m);menus.due_time.push({v:t,l:clock(t)})}
/* The value that will execute always gets an option, so the card never shows less than it sends. */
function ensure(key,v,label){if(!v)return;for(var i=0;i<menus[key].length;i++)if(menus[key][i].v===v)return;menus[key].push({v:v,l:label||v})}
function labelOf(key,v){for(var i=0;i<menus[key].length;i++)if(menus[key][i].v===v)return menus[key][i].l;return v}

var openId='';
function closeAll(except){
  openId=except||'';
  var pops=document.querySelectorAll('.as-pop');
  for(var i=0;i<pops.length;i++)pops[i].hidden=pops[i].id!==openId;
  var vals=document.querySelectorAll('.as-val');
  for(var j=0;j<vals.length;j++)vals[j].setAttribute('aria-expanded',String('as-pop-'+vals[j].getAttribute('data-menu')===openId));
  place();
}
/* Anchor the open popover under its row. The frame is only as tall as the
   document, so when the popover would run past the card bottom the document
   grows (min-height) instead of the rows moving; 52px keeps the list clear of
   the host's floating confirm button. */
function place(){
  var root=document.documentElement;root.style.minHeight='';
  if(!openId)return;
  var pop=$(openId),btn=document.querySelector('[data-menu="'+openId.slice(7)+'"]');
  var top=btn.getBoundingClientRect().bottom-document.querySelector('.as').getBoundingClientRect().top+4;
  pop.style.top=top+'px';
  var need=Math.ceil(pop.getBoundingClientRect().bottom+52);
  if(need>root.getBoundingClientRect().height)root.style.minHeight=need+'px';
}
function renderMenu(key){
  var btn=document.querySelector('[data-menu="'+key+'"]'),v=$('as-'+key).value;
  var noDate=key==='due_time'&&!$('as-due_on').value;
  btn.hidden=noDate;
  btn.querySelector('span').textContent=key==='due_time'&&!v?'Add time':labelOf(key,v);
  btn.classList.toggle('as-empty',!v);
  var list=$('as-pop-'+key).firstChild;list.textContent='';
  menus[key].forEach(function(o,i){
    var b=document.createElement('button');
    b.type='button';b.className='as-opt'+(i===0?' as-none':'');b.setAttribute('role','option');
    b.setAttribute('data-key',key);b.setAttribute('data-v',o.v);b.setAttribute('aria-selected',String(o.v===v));
    var s=document.createElement('span');s.textContent=o.l;b.appendChild(s);list.appendChild(b);
  });
}
function renderDate(){
  var v=$('as-due_on').value,d=parse(v);
  var chips=document.querySelectorAll('.as-c[data-q]');
  for(var i=0;i<chips.length;i++)chips[i].setAttribute('aria-pressed',String(quick[chips[i].getAttribute('data-q')]===v));
  var btn=$('as-due-btn');
  btn.querySelector('span').textContent=!d?'No due date':v===quick.today?'Today':v===quick.tomorrow?'Tomorrow':DAYS[d.getDay()]+', '+MONTHS[d.getMonth()]+' '+d.getDate()+(d.getFullYear()!==today.getFullYear()?', '+d.getFullYear():'');
  btn.classList.toggle('as-empty',!d);
  $('as-clear').disabled=!v;
  $('as-month').textContent=MONTHS[view.getMonth()]+' '+view.getFullYear();
  var g=$('as-grid');g.textContent='';
  'Su Mo Tu We Th Fr Sa'.split(' ').forEach(function(t){var s=document.createElement('span');s.textContent=t;g.appendChild(s)});
  for(var k=0;k<view.getDay();k++)g.appendChild(document.createElement('span'));
  var n=new Date(view.getFullYear(),view.getMonth()+1,0).getDate();
  for(var day=1;day<=n;day++){
    var dd=new Date(view.getFullYear(),view.getMonth(),day),b=document.createElement('button');
    b.type='button';b.textContent=day;b.setAttribute('data-v',ymd(dd));
    b.className=+dd===+today?'as-today':dd<today?'as-past':'';
    b.setAttribute('aria-pressed',String(ymd(dd)===v));g.appendChild(b);
  }
  renderMenu('due_time');
}
/* Clearing the date also clears its time. */
function setDate(v){stage($('as-due_on'),v);if(!v&&$('as-due_time').value)stage($('as-due_time'),'');renderDate()}

document.addEventListener('click',function(e){
  var t=e.target;if(!t||!t.closest)return;
  var chip=t.closest('.as-c[data-q]');
  if(chip){setDate(quick[chip.getAttribute('data-q')]);closeAll('');return}
  if(t.closest('#as-clear')){setDate('');closeAll('');return}
  if(t.closest('#as-prev')){view.setMonth(view.getMonth()-1);renderDate();place();return}
  if(t.closest('#as-next')){view.setMonth(view.getMonth()+1);renderDate();place();return}
  var day=t.closest('#as-grid>button');
  if(day){setDate(day.getAttribute('data-v'));closeAll('');return}
  var val=t.closest('.as-val');
  if(val){
    var key=val.getAttribute('data-menu'),open=val.getAttribute('aria-expanded')!=='true';
    if(open&&key==='cal'){var d=parse($('as-due_on').value)||today;view=new Date(d.getFullYear(),d.getMonth(),1);renderDate()}
    closeAll(open?'as-pop-'+key:'');
    if(open&&key!=='cal'){var pop=$('as-pop-'+key),sel=pop.querySelector('[aria-selected=true]:not(.as-none)')||pop.querySelector('[data-v="09:00"]');if(sel)pop.firstChild.scrollTop=sel.offsetTop-pop.firstChild.offsetTop-(pop.firstChild.clientHeight-sel.offsetHeight)/2}
    return;
  }
  var opt=t.closest('.as-opt');
  if(opt){var k=opt.getAttribute('data-key');stage($('as-'+k),opt.getAttribute('data-v'));closeAll('');renderMenu(k);return}
  /* A click anywhere outside the open popover dismisses it. */
  if(!t.closest('.as-pop'))closeAll('');
});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeAll('')});

addEventListener('message',function(e){
  if(e.source!==parent||!e.data||e.data.type!=='voiceos:init')return;
  var a=e.data.args||{};
  [['project',a.project_choices],['section',a.section_choices]].forEach(function(p){
    (Array.isArray(p[1])?p[1]:[]).forEach(function(c){if(c&&c.gid!=null)ensure(p[0],String(c.gid),String(c.name||c.gid))});
  });
  ensure('project',a.project?String(a.project):'');
  ensure('section',a.section?String(a.section):'');
  ensure('due_time',a.due_time?String(a.due_time):'',a.due_time?clock(String(a.due_time)):'');
  ['due_on','due_time','project','section'].forEach(function(k){$('as-'+k).value=a[k]==null?'':String(a[k])});
  var d=parse(a.due_on);if(d)view=new Date(d.getFullYear(),d.getMonth(),1);
  renderDate();renderMenu('project');renderMenu('section');
});
renderDate();renderMenu('project');renderMenu('section');
})();</script>`;

const card = renderCustom({ accent: "#f06a6a", css, body, mode: "confirm", height: 236 });
tool.confirmation.root.html = card.html;
tool.confirmation.root.height = card.height;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`confirmation card: ${card.html.length} chars, height ${card.height}`);
