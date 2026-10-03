/* DeepDive Builder form application.
 * Standalone (offline HTML) it keeps drafts in localStorage; embedded in the portal (?embed=1)
 * the portal owns the data and this module talks to it through ./bridge.js.
 */
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import ICONS from "./icons.json";
import { buildDeck, planStakeholders, embedData, readEmbeddedData, buildTrackerXlsx, readTrackerXlsx } from "./deck.js";
import { createBridge } from "./bridge.js";
import "./styles.css";

"use strict";
const KEY = "deepdive-builder-draft-v1";
const REG = ["Registered","Not Registered","Pending"];
const PRICING = ["Protected","Fair Pricing","Not Protected","Pending"];
const IMPACT = ["High","Medium","Low"];
const YN = ["Yes","No"];

const blank = () => ({
  customer:"", oppName:"", oppNumber:"", value:"", presalesReceived:"", submissionDate:"", presalesOwner:"", accountManager:"",
  background:"",
  requirements:[{text:""}], psDuration:"", msDuration:"", sow:"", solution:"",
  internal:[{unit:"",scope:""}], vendors:[{name:"",reg:"",pricing:"",scope:"",internal:false,justification:""}],
  driver:"", differentiator:"", competitors:[{name:""}], proactive:"", proactiveType:[],
  winTech:[{action:"",owner:"",date:""}], winFin:[{action:"",owner:"",date:""}],
  riskTech:[{risk:"",mitigation:"",owner:"",date:"",impact:""}], riskFin:[{risk:"",mitigation:"",owner:"",date:"",impact:""}],
  groups:[{name:"",rows:[{item:"",provider:"",communicated:"",quoteRec:"",tpRec:"",quoteVal:"",tpVal:"",comments:""}]}],
  support:[{need:"",from:"",priority:"",date:""}]
});
const newOf = {
  requirements:()=>({text:""}), competitors:()=>({name:""}), support:()=>({need:"",from:"",priority:"",date:""}), internal:()=>({unit:"",scope:""}), vendors:()=>({name:"",reg:"",pricing:"",scope:"",internal:false,justification:""}),
  winTech:()=>({action:"",owner:"",date:""}), winFin:()=>({action:"",owner:"",date:""}),
  riskTech:()=>({risk:"",mitigation:"",owner:"",date:"",impact:""}), riskFin:()=>({risk:"",mitigation:"",owner:"",date:"",impact:""}),
  groups:()=>({name:"",rows:[newRow()]}), rows:()=>newRow()
};
function newRow(){return {item:"",provider:"",communicated:"",quoteRec:"",tpRec:"",quoteVal:"",tpVal:"",comments:""};}

const bridge = createBridge();
const EMBED = bridge.embedded;
let READONLY = false;
let CONTEXT = {};  // {opportunityNumber, opportunityName, customer, owner, versionNumber, status} from the portal
// Owned by the Create Opportunity record: shown read-only here and re-applied after Open/Example/Clear.
const PORTAL_FIELDS = ["oppNumber", "oppName", "customer", "presalesOwner"];
function applyPortalFields(){
  if(!EMBED) return;
  if(CONTEXT.opportunityNumber) S.oppNumber = CONTEXT.opportunityNumber;
  if(CONTEXT.opportunityName) S.oppName = CONTEXT.opportunityName;
  if(CONTEXT.customer) S.customer = CONTEXT.customer;
  if(CONTEXT.owner) S.presalesOwner = CONTEXT.owner;
}
if (EMBED) document.body.classList.add("embed");
let S = EMBED ? blank() : (load() || blank());
let current = 0;
const touched = new Set();
const revealed = new Set(); // steps where all errors are shown

/* ---------- Field definitions ---------- */
const F = (path,label,o={}) => Object.assign({path,label,req:true,type:"text",max:60},o);
const steps = [
  { title:"Opportunity", lede:"Basic details used on the cover and the Opportunity Snapshot slide.", blocks:()=>[
    {title:"Opportunity details", cols:2, fields:[
      F("customer","Customer / account name",{max:60}), F("oppName","Opportunity name",{type:"textarea",rows:2,max:120,span:true,hint:"Arabic or English. Long names shrink to fit on the slides."}),
      F("oppNumber","Opportunity number",{max:30}), F("value","Estimated value (SAR)",{type:"number",hint:"Numbers only, e.g. 25000000"}),
      F("presalesReceived","Presales received",{type:"date"}), F("submissionDate","Submission date",{type:"date"}),
      F("presalesOwner","Presales owner",{max:30}), F("accountManager","Account manager",{max:30})]},
    {title:"Opportunity background / History", note:"Describe the history with this customer. For example: previous projects delivered, workshops, PoCs or assessments, and ongoing engagements. One point per line; each line becomes a bullet.", cols:1, fields:[
      F("background","Opportunity background / history",{type:"textarea",max:650,rows:6,maxLines:6})]}
  ]},
  { title:"Scope", lede:"Why the customer needs this, what we will deliver, and for how long.", blocks:()=>[
    {title:"Customer business need / pain point", list:"requirements", min:1, max:6, add:"Add business need / pain point", item:[F("text","Business need / pain point",{max:100})]},
    {divider:true, title:"Scope of work", note:"Up to 1,000 characters. One point per line; each line becomes a bullet on the slide.", cols:1, fields:[
      F("sow","Scope of work notes",{type:"textarea",max:1000,rows:9,maxLines:15})]},
    {title:"Proposed solution / Deliverables", note:"One point per line, up to 7 lines. Each line becomes a bullet on the slide.", cols:1, fields:[
      F("solution","Proposed solution / deliverables notes",{type:"textarea",max:520,rows:6,maxLines:7})]},
    {title:"Duration", note:"Write N/A if the opportunity has no professional services or no managed services.", cols:2, fields:[
      F("psDuration","PS duration",{max:12,hint:"Professional services, e.g. 6 months"}),
      F("msDuration","MS duration",{max:12,hint:"Managed services, e.g. 3 years"})]}
  ]},
  { title:"Stakeholders", lede:"Internal units and the partners and vendors involved in this opportunity.", blocks:()=>[
    {title:"Internal stakeholders", note:"Use the arrows to change the order. Slides split automatically when the list is long.", list:"internal", min:1, add:"Add internal unit", item:[F("unit","Unit",{max:20}),F("scope","Scope",{type:"textarea",rows:2,max:100})]},
    {title:"Partners and vendors", note:"Use the arrows to change the order. Slides split automatically when the list is long.", list:"vendors", min:1, add:"Add vendor / partner", item:[
      F("name","Vendor / partner",{max:20}), F("reg","Deal registration",{type:"select",options:REG}), F("pricing","Pricing status",{type:"select",options:PRICING}),
      F("scope","Scope",{type:"textarea",max:500,rows:4,span:true}),
      F("internal","Can we deliver this scope internally or through our subsidiaries?",{type:"checkbox",req:false,span:true}),
      F("justification","Justification for using this vendor / partner",{type:"textarea",max:500,rows:4,span:true,
        hint:"Explain why the scope is not delivered internally or through a subsidiary, and state whether there is documented confirmation from the relevant stakeholder declining to participate.",
        when:(p)=>get(p.replace(/\.[^.]+$/,".internal"))===true})], itemCols:3}
  ]},
  { title:"Winning strategy", lede:"What drives the customer’s decision and how we plan to win.", blocks:()=>[
    {title:"Decision driver and differentiator", cols:1, fields:[
      F("driver","Customer decision driver",{type:"textarea",max:500,rows:4}),
      F("differentiator","Our differentiator",{type:"textarea",max:500,rows:4})]},
    {title:"Competitors", note:"Add each competitor separately. Write “None identified” if there are none.", list:"competitors", min:1, max:6, add:"Add competitor", item:[F("name","Competitor",{max:30})]},
    {title:"Proactive engagement", cols:2, fields:[
      F("proactive","Was this proactive?",{type:"select",options:YN}),
      F("proactiveType","Engagement type",{type:"multi",options:["PoC","Workshop","Write RFP","Assessment","Other"],span:true,hint:"Select all that apply",when:()=>S.proactive==="Yes"})]},
    {title:"How to win — technically", list:"winTech", min:1, max:3, add:"Add technical action", item:[F("owner","Owner",{max:16}),F("date","Due date",{type:"date"}),F("action","Action",{max:100,span:true})], itemCols:2},
    {title:"How to win — financially", list:"winFin", min:1, max:3, add:"Add financial action", item:[F("owner","Owner",{max:16}),F("date","Due date",{type:"date"}),F("action","Action",{max:100,span:true})], itemCols:2}
  ]},
  { title:"Risks", lede:"Add at least one technical and one financial risk, each with a mitigation owner.", blocks:()=>[
    {title:"Technical risks", list:"riskTech", min:1, add:"Add technical risk", per:5, perLabel:"risks per category", item:riskFields(), itemCols:3},
    {title:"Financial risks", list:"riskFin", min:1, add:"Add financial risk", per:5, perLabel:"risks per category", item:riskFields(), itemCols:3}
  ]},
  { title:"Readiness checklist", lede:"Track quotes and technical proposals (TP) for each component, grouped by area.", blocks:()=>[
    {title:"Checklist groups", groups:true}
  ]},
  { title:"Support needed", lede:"What help the team needs to win this opportunity, and from whom.", blocks:()=>[
    {title:"Support requests", note:"If no support is needed, add one row saying so and set priority to Low.", list:"support", min:1, add:"Add support request", per:6, perLabel:"requests", item:[
      F("need","Support needed",{type:"textarea",rows:2,max:120,span:true}), F("from","Needed from",{max:40,hint:"Team, manager or vendor"}), F("priority","Priority",{type:"select",options:IMPACT}),
      // A High priority item drives the management "Support Needed / Risks" view, so it needs a date.
      F("date","Needed by",{type:"date",reqIf:(p)=>String(get(p.replace(/\.[^.]+$/,".priority"))||"").toLowerCase()==="high",
        hint:"Required when the priority is High"})], itemCols:3}
  ]},
  { title:"Documents", docs:true, lede:"Upload the opportunity and bid documents. They belong to this DeepDive version." },
  { title:"Review & download", review:true }
];
function riskFields(){return [F("owner","Owner",{max:16}),F("date","Due date",{type:"date"}),F("impact","Impact",{type:"select",options:IMPACT}),F("risk","Risk / gap",{max:100,span:true}),F("mitigation","Mitigation",{max:100,span:true})];}
const rowFields = [F("item","Component",{max:30}),F("provider","Provided by",{max:22,hint:"Internal, vendor or partner"}),
  F("communicated","Communicated",{type:"select",options:YN}),F("quoteRec","Quote received",{type:"select",options:YN}),F("tpRec","TP received",{type:"select",options:YN}),
  F("quoteVal","Quote validated",{type:"select",options:YN}),F("tpVal","TP validated",{type:"select",options:YN}),F("comments","Comments",{max:36,hint:"Write N/A if nothing to add"})];

/* ---------- State helpers ---------- */
function get(path){return path.split(".").reduce((o,k)=>o==null?undefined:o[k],S);}
function set(path,v){const ks=path.split(".");let o=S;ks.slice(0,-1).forEach(k=>o=o[k]);o[ks[ks.length-1]]=v;}
function migrate(d){
  d=d||{};
  if(d.background==null&&(d.bgPrevious||d.bgWorkshops||d.bgOngoing)) d.background=[d.bgPrevious,d.bgWorkshops,d.bgOngoing].filter(Boolean).join("\n");
  if(d.psDuration==null&&d.duration) d.psDuration=d.duration;
  if(d.driver==null&&Array.isArray(d.drivers)) d.driver=d.drivers.filter(Boolean).join("; ");
  if(d.differentiator==null&&Array.isArray(d.differentiators)) d.differentiator=d.differentiators.filter(Boolean).join("; ");
  if(d.competitors==null&&typeof d.competition==="string"&&d.competition.trim()) d.competitors=d.competition.split(/[,،;\n]+/).map(x=>({name:x.trim()})).filter(x=>x.name);
  (d.vendors||[]).forEach(v=>{if(v.pricing==="Preferred Pricing")v.pricing="";if(typeof v.internal!=="boolean")v.internal=false;if(typeof v.justification!=="string")v.justification="";});
  if(!Array.isArray(d.proactiveType)) d.proactiveType=d.proactiveType?[d.proactiveType]:[];
  ["bgPrevious","bgWorkshops","bgOngoing","duration","drivers","differentiators","competition","pain"].forEach(k=>delete d[k]);
  const out=Object.assign(blank(),d);
  (out.groups||[]).forEach(g=>(g.rows||[]).forEach(r=>{if(r.comments==null)r.comments="";}));
  return out;
}
function load(){try{const r=localStorage.getItem(KEY);if(!r)return null;return migrate(JSON.parse(r));}catch(e){return null;}}
let saveTimer;
function save(){
  if(EMBED){ if(!READONLY) bridge.changed(S, validate()); return; }
  clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(S));$("#saveState").textContent="Draft saved on this computer";}catch(e){$("#saveState").textContent="Autosave unavailable — use Save draft";}},300);}
const $=(q)=>document.querySelector(q);
const esc=(t)=>String(t==null?"":t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function ask(msg,yes,alt){return new Promise(res=>{const m=$("#modal");$("#modalText").textContent=msg;$("#modalYes").textContent=yes||"Continue";
  const altBtn=$("#modalAlt");altBtn.hidden=!alt;if(alt)altBtn.textContent=alt;m.classList.add("open");$("#modalYes").focus();
  const done=v=>{m.classList.remove("open");$("#modalYes").onclick=$("#modalNo").onclick=altBtn.onclick=null;res(v);};
  $("#modalYes").onclick=()=>done(alt?"yes":true);$("#modalNo").onclick=()=>done(false);altBtn.onclick=()=>done("alt");});}
let dlCap;
async function saveFile(filename,blob){
  if(dlCap===undefined){try{dlCap=(window.claude&&typeof window.claude.use==="function")?await window.claude.use("downloads"):null;}catch(e){dlCap=null;}}
  if(dlCap){
    try{await dlCap.save({filename,data:blob});return true;}
    catch(err){const code=err&&err.code;
      if(code==="declined")return false;
      if(code==="rate_limited"){toast("Another save prompt is open. Finish it, then try again.");return false;}
      toast("This file couldn’t be saved here ("+(code||"error")+"). Try the offline HTML file instead.");return false;}
  }
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.rel="noopener";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);return true;
}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600);}

/* ---------- Validation ---------- */
function validate(){
  const errs=[];
  const chk=(step,f,base,ctx)=>{
    const path=base?base+"."+f.path:f.path;
    if(f.when&&!f.when(path))return;
    const v=get(path);
    const label=(ctx?ctx+" — ":"")+f.label;
    if(isRequired(f,path)&&(v==null||(Array.isArray(v)?v.length===0:String(v).trim()===""))) errs.push({step,path,label,msg:"Required"});
    else if(f.maxLines&&String(v||"").split(/\n+/).filter(x=>x.trim()).length>f.maxLines) errs.push({step,path,label,msg:`Use ${f.maxLines} lines or fewer`});
  };
  steps.forEach((st,si)=>{
    if(st.review||!st.blocks)return;        // the Documents step has no form fields
    st.blocks().forEach(b=>{
      if(b.fields) b.fields.forEach(f=>chk(si,f));
      if(b.list){
        const arr=get(b.list)||[];
        if(arr.length<(b.min||0)) errs.push({step:si,path:"list:"+b.list,label:b.title,msg:`Add at least ${b.min}`});
        arr.forEach((_,i)=>b.item.forEach(f=>chk(si,f,b.list+"."+i,`${b.title.replace(/s$/,"")} ${i+1}`)));
      }
      if(b.groups){
        if(!S.groups.length) errs.push({step:si,path:"list:groups",label:"Checklist",msg:"Add at least 1 group"});
        S.groups.forEach((g,gi)=>{
          chk(si,F("name","Group name"),"groups."+gi,`Group ${gi+1}`);
          if(!g.rows.length) errs.push({step:si,path:"list:groups."+gi+".rows",label:`Group ${gi+1}`,msg:"Add at least 1 component"});
          g.rows.forEach((_,ri)=>rowFields.forEach(f=>chk(si,f,`groups.${gi}.rows.${ri}`,`${g.name||"Group "+(gi+1)} · row ${ri+1}`)));
        });
      }
    });
  });
  return errs;
}

/* ---------- Rendering ---------- */
let ERRMSG=new Map();
function isRequired(f,path){return !!(f.req||(typeof f.reqIf==="function"&&f.reqIf(path)));}
function fieldHTML(f,path,errMap,si){
  if(f.when&&!f.when(path))return "";
  const v=get(path)??"";
  const id="f_"+path.replace(/\./g,"_");
  const show=(touched.has(path)||revealed.has(si))&&errMap.has(path);
  let input;
  const locked=READONLY||(EMBED&&PORTAL_FIELDS.includes(path));
  const req=isRequired(f,path);
  const common=`id="${id}" data-path="${esc(path)}" data-step="${si}" ${req?'aria-required="true"':""} ${show?'aria-invalid="true"':""} ${locked?(f.type==="select"||f.type==="checkbox"?"disabled":"readonly"):""}`;
  if(f.type==="checkbox"){
    return `<div class="field${f.span?" span-all":""}" data-wrap="${esc(path)}"><label class="check"><input type="checkbox" ${common} ${v===true?"checked":""}><span>${esc(f.label)}</span></label></div>`;
  }
  if(f.type==="multi"){
    const arr=Array.isArray(v)?v:[];
    input=`<div class="chips" role="group" aria-labelledby="${id}_lbl">${f.options.map((o,oi)=>`<label class="chip"><input type="checkbox" ${READONLY?"disabled":""} ${oi===0?`id="${id}"`:""} data-path="${esc(path)}" data-step="${si}" data-opt="${esc(o)}" ${arr.includes(o)?"checked":""}>${esc(o)}</label>`).join("")}</div>`;
    return `<div class="field${show?" invalid":""}${f.span?" span-all":""}" data-wrap="${esc(path)}">
    <span class="lbl" id="${id}_lbl" style="font-size:13px;font-weight:600">${esc(f.label)}${req?'<span class="req" aria-hidden="true">*</span>':""}</span>${input}
    <div class="meta"><span class="${show?"err":"hint"}" data-msg>${show?esc(ERRMSG.get(path)||"Required"):esc(f.hint||"")}</span></div></div>`;
  }
  if(f.type==="textarea") input=`<textarea ${common} maxlength="${f.max}" rows="${f.rows||3}">${esc(v)}</textarea>`;
  else if(f.type==="select") input=`<select ${common}><option value="">Select…</option>${f.options.map(o=>`<option${o===v?" selected":""}>${esc(o)}</option>`).join("")}</select>`;
  else if(f.type==="date") input=`<input type="date" ${common} value="${esc(v)}">`;
  else if(f.type==="number") input=`<input type="number" min="0" step="1" inputmode="numeric" ${common} value="${esc(v)}">`;
  else input=`<input type="text" ${common} maxlength="${f.max}" value="${esc(v)}">`;
  const counter=(f.type==="text"||f.type==="textarea")?`<span class="count" data-count="${id}"></span>`:"";
  return `<div class="field${show?" invalid":""}${f.span?" span-all":""}" data-wrap="${esc(path)}">
    <label for="${id}">${esc(f.label)}${req?'<span class="req" aria-hidden="true">*</span>':""}</label>${input}
    <div class="meta"><span class="${show?"err":"hint"}" data-msg>${show?esc(ERRMSG.get(path)||"Required"):esc(f.hint||"")}</span>${counter}</div></div>`;
}
function ctrls(path,i,len,label){
  return `<div class="ctrls"><button type="button" data-move="${path}" data-i="${i}" data-dir="-1" aria-label="Move ${esc(label)} ${i+1} up" title="Move up" ${i===0?"disabled":""}>▲</button>
    <button type="button" data-move="${path}" data-i="${i}" data-dir="1" aria-label="Move ${esc(label)} ${i+1} down" title="Move down" ${i>=len-1?"disabled":""}>▼</button>
    <button type="button" class="del" data-remove="${path}" data-i="${i}" aria-label="Remove ${esc(label)} ${i+1}" title="Remove" ${len<=1?"disabled":""}>×</button></div>`;
}
function listHTML(b,errMap,si){
  const arr=get(b.list)||[];
  const cols=b.itemCols||b.item.length;
  const items=arr.map((_,i)=>`<div class="item"><span class="idx">${i+1}</span>
    <div class="grid cols-${Math.min(cols,4)}">${b.item.map(f=>fieldHTML(f,`${b.list}.${i}.${f.path}`,errMap,si)).join("")}</div>
    ${ctrls(b.list,i,arr.length,b.title)}</div>`).join("");
  const minErr=revealed.has(si)&&errMap.has("list:"+b.list);
  const full=b.max&&arr.length>=b.max;
  let note="";
  if(b.per){const n=Math.max(1,Math.ceil(arr.length/b.per));note=`<div class="split-note">${b.per} ${b.perLabel} fit on one slide${n>1?` — this will create ${n} slides automatically`:""}.</div>`;}
  if(b.max) note+=`<div class="split-note">${arr.length} of ${b.max} used.</div>`;
  return `<div class="items" id="list_${b.list}">${items}</div>
    <button type="button" class="add" data-add="${b.list}" ${full?"disabled":""}>+ ${esc(b.add)}</button>${note}
    ${minErr?`<div class="list-error">Add at least ${b.min}.</div>`:""}`;
}
function groupsHTML(errMap,si){
  const bar=`<div class="excel-panel"><h3>Work in Excel instead</h3>
    <ol><li>Download the Excel sample (or your current checklist).</li><li>Update it in Excel. To add a row, click the last cell of the table and press <b>Tab</b>.</li><li>Upload the sheet here. Its rows become normal checklist items that you can still edit below.</li></ol>
    <div class="toolbar" style="margin:0"><button type="button" class="btn ghost" data-action="sampleXlsx"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16"/></svg>Download Excel sample</button>
    <button type="button" class="btn ghost" data-action="exportXlsx"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16"/></svg>Download current checklist</button>
    <label for="xlsxIn" class="btn primary" role="button" tabindex="0" data-uplabel><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17V5m0 0L7 10m5-5l5 5M4 19h16"/></svg>Upload Excel sheet</label></div></div>`;
  const g=S.groups.map((grp,gi)=>`<div class="group">
    <div class="group-head"><div class="grid cols-2">${fieldHTML(F("name","Group name",{max:30,hint:"e.g. Active Network"}),`groups.${gi}.name`,errMap,si)}</div>
      ${ctrls("groups",gi,S.groups.length,"group")}</div>
    <div class="items">${grp.rows.map((_,ri)=>`<div class="item"><span class="idx">${ri+1}</span>
      <div class="grid cols-4">${rowFields.map(f=>fieldHTML(f,`groups.${gi}.rows.${ri}.${f.path}`,errMap,si)).join("")}</div>
      ${ctrls(`groups.${gi}.rows`,ri,grp.rows.length,"row")}</div>`).join("")}</div>
    <button type="button" class="add" data-add="groups.${gi}.rows">+ Add component</button></div>`).join("");
  return bar+g+`<button type="button" class="add" data-add="groups">+ Add group</button><div class="split-note">About 12 rows fit on one slide; longer checklists continue on extra slides automatically.</div>`;
}
function renderSteps(errs){
  const counts=steps.map((_,i)=>errs.filter(e=>e.step===i).length);
  const info=steps.map((st,i)=>{
    const done=st.review?!errs.length:counts[i]===0;
    const n=st.review?errs.length:counts[i];
    const shown=st.review||st.docs||revealed.has(i);
    const state=st.docs?(DOCS.items.length?`${DOCS.items.length} file${DOCS.items.length===1?"":"s"}`:"None yet")
      :done?(st.review?"Ready":"Complete"):(shown?`${n} missing`:`${n} to fill`);
    return {done,state,pending:!done&&!shown};
  });
  const list=$("#stepList");
  if(list.children.length===steps.length){
    [...list.children].forEach((li,i)=>{const b=li.firstElementChild;
      b.classList.toggle("done",info[i].done);
      if(i===current)b.setAttribute("aria-current","step");else b.removeAttribute("aria-current");
      b.querySelector(".num").textContent=info[i].done&&!steps[i].review?"✓":i+1;
      const st=b.querySelector(".state");st.textContent=info[i].state;st.classList.toggle("pending",info[i].pending);});
    return;
  }
  list.innerHTML=steps.map((st,i)=>`<li><button type="button" data-go="${i}" class="${info[i].done?"done":""}" ${i===current?'aria-current="step"':""}>
      <span class="num">${info[i].done&&!st.review?"✓":i+1}</span><span class="label">${esc(st.title)}</span><span class="state${info[i].pending?" pending":""}">${info[i].state}</span></button></li>`).join("");
}
function render(focusPath){
  const errs=validate(); const errMap=new Set(errs.map(e=>e.path)); ERRMSG=new Map(errs.map(e=>[e.path,e.msg]));
  renderSteps(errs);
  const st=steps[current];
  let html=`<p class="step-kicker">Step ${current+1} of ${steps.length}</p><h1>${esc(st.title)}</h1>`;
  if(st.docs) html+=docsHTML();
  else if(st.review) html+=reviewHTML(errs);
  else {
    html+=`<p class="lede">${esc(st.lede)} Fields marked <span class="req">*</span> are required.</p>`;
    st.blocks().forEach(b=>{
      if(b.divider) html+=`<hr class="divider">`;
      html+=`<section class="block"><h2>${esc(b.title)}</h2>${b.note?`<p class="block-note">${esc(b.note)}</p>`:'<div style="height:10px"></div>'}`;
      if(b.fields) html+=`<div class="grid cols-${b.cols||2}">${b.fields.map(f=>fieldHTML(f,f.path,errMap,current)).join("")}</div>`;
      if(b.list) html+=listHTML(b,errMap,current);
      if(b.groups) html+=groupsHTML(errMap,current);
      html+=`</section>`;
    });
  }
  $("#panel").innerHTML=html;
  if(st.docs) wireDocs();
  document.querySelectorAll("[data-count]").forEach(updateCount);
  $("#btnBack").disabled=current===0;
  $("#btnNext").style.display=st.review?"none":"";
  $("#btnNext").textContent=current===steps.length-2?"Review":"Next";
  if(focusPath){const el=document.querySelector(`[data-path="${CSS.escape(focusPath)}"]`)||document.getElementById("list_"+focusPath.replace(/^list:/,""));
    if(el){el.scrollIntoView({block:"center",behavior:"smooth"});if(el.focus)el.focus({preventScroll:true});const w=el.closest(".field")||el;w.classList.add("flash");}}
}
/* Documents live with the DeepDive version, so the portal owns them: this step shows the list it sends
   and asks the portal to upload or remove, keeping everything inside the form. */
let DOCS={items:[],snapshot:[],canManage:false,category:"rfp",categories:[]};
function reportHeight(){
  const h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
  parent.postMessage({type:"builder:height",height:h},"*");
}
if(EMBED){
  new ResizeObserver(reportHeight).observe(document.documentElement);
  window.addEventListener("load",reportHeight);
  setInterval(reportHeight,1000);
}

window.addEventListener("message",(e)=>{
  const d=e.data||{};
  if(d.type!=="docs:list") return;
  DOCS={...DOCS,items:d.items||[],snapshot:d.snapshot||[],canManage:!!d.canManage,
        categories:d.categories||DOCS.categories};
  if(!DOCS.categories.some(c=>c.key===DOCS.category)) DOCS.category=(DOCS.categories[0]||{key:"rfp"}).key;
  if(steps[current] && steps[current].docs) render();
});
function docsHTML(){
  if(!EMBED) return `<p class="lede">Documents are managed in the portal. Open this DeepDive from the portal to attach files.</p>`;
  const snap=DOCS.snapshot.map(r=>`<li><span>${esc(r.label)}</span><b>${r.version?esc(r.version):"Not available"}</b></li>`).join("");
  const rows=DOCS.items.length?DOCS.items.map(d=>`<tr><td><b>${esc(d.file_name)}</b><div class="muted">${esc(d.category_label||d.category)} · v${d.doc_version}</div></td>
      <td>${esc(d.uploaded_by||"")}</td><td>${esc((d.uploaded_at||"").slice(0,10))}</td>
      <td>${DOCS.canManage?`<button type="button" class="ghost doc-remove" data-id="${esc(d.id)}">Remove</button>`:""}</td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">No documents in this version yet.</td></tr>`;
  const options=DOCS.categories.map(c=>`<option value="${esc(c.key)}"${c.key===DOCS.category?" selected":""}>${esc(c.label)}</option>`).join("");
  return `<p class="lede">${esc(steps[current].lede)}</p>
    <ul class="doc-snapshot">${snap}</ul>
    ${DOCS.canManage?`<div class="doc-upload">
      <label for="docCategory">Document type</label>
      <select id="docCategory">${options}</select>
      <input type="file" id="docFiles" multiple hidden>
      <button type="button" class="primary" id="docPick">Choose files</button>
      <span class="muted">PDF, Word, Excel, PowerPoint, text, email or image</span>
    </div>`:`<p class="muted">This version is submitted, so its documents can no longer change.</p>`}
    <table class="doc-table"><thead><tr><th>Document</th><th>Uploaded by</th><th>Uploaded</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>`;
}
function wireDocs(){
  const pick=$("#docPick"), input=$("#docFiles"), cat=$("#docCategory");
  if(cat) cat.onchange=()=>{DOCS.category=cat.value;};
  if(pick&&input){
    pick.onclick=()=>input.click();
    input.onchange=()=>{
      if(input.files&&input.files.length) parent.postMessage({type:"docs:upload",category:DOCS.category,files:[...input.files]},"*");
      input.value="";
    };
  }
  document.querySelectorAll(".doc-remove").forEach(b=>{
    b.onclick=()=>parent.postMessage({type:"docs:remove",id:b.dataset.id},"*");
  });
}

function reviewHTML(errs){
  const nInt=Math.max(1,planStakeholders(S).length);
  const nRisk=Math.max(Math.ceil(S.riskTech.length/5),Math.ceil(S.riskFin.length/5),1);
  const rows=S.groups.reduce((a,g)=>a+1+g.rows.length,0), nChk=Math.max(1,Math.ceil(rows/12));
  const nSup=Math.max(1,Math.ceil(S.support.length/6));
  const total=5+nInt+nRisk+nChk+nSup;
  let h=`<p class="lede">Check that everything is complete, then download the PowerPoint file.</p>`;
  if(errs.length){
    h+=`<div class="summary bad"><div class="big">${errs.length}</div><div><b>${errs.length===1?"1 required field is":errs.length+" required fields are"} still empty</b><p>The download unlocks when every required field is filled in. Select an item to go straight to it.</p></div></div>`;
    steps.forEach((st,si)=>{const list=errs.filter(e=>e.step===si);if(!list.length)return;
      h+=`<div class="miss-step"><h3>${si+1}. ${esc(st.title)}</h3><ul>${list.map(e=>`<li><a href="#" data-jump="${si}" data-path="${esc(e.path)}"><span>${esc(e.label)}</span><span>${esc(e.msg)}</span></a></li>`).join("")}</ul></div>`;});
  } else {
    h+=`<div class="summary good"><div class="big">✓</div><div><b>Everything is filled in</b><p>Your deck will have ${total} slides.</p></div></div>`;
  }
  h+=`<section class="block"><h2>What the deck will contain</h2><div class="deck-plan">
    <div><b>Cover</b>1 slide</div><div><b>01 Snapshot</b>1 slide</div><div><b>02 Scope</b>2 slides</div>
    <div><b>03 Stakeholders</b>${nInt} slide${nInt>1?"s":""}</div><div><b>04 Winning strategy</b>1 slide</div>
    <div><b>05 Risks</b>${nRisk} slide${nRisk>1?"s":""}</div><div><b>06 Readiness</b>${nChk} slide${nChk>1?"s":""}</div><div><b>07 Support needed</b>${nSup} slide${nSup>1?"s":""}</div></div>
    <div class="toolbar"><button type="button" class="btn coral download" id="btnDownload" ${errs.length?"disabled":""}>Download PowerPoint + Excel tracker</button>
    <button type="button" class="btn ghost" data-action="exportXlsx">Excel tracker only</button></div>
    ${errs.length?'<p class="block-note" style="margin-top:10px">Complete the items above to enable the download.</p>':""}</section>`;
  return h;
}
function updateCount(span){
  const el=document.getElementById(span.dataset.count); if(!el)return;
  const max=+el.getAttribute("maxlength"), n=el.value.length;
  span.textContent=n>=max*0.7?`${n}/${max}`:""; span.classList.toggle("near",n>=max*0.9);
}
function refreshField(path){
  const errs=validate(); const errMap=new Set(errs.map(e=>e.path)); ERRMSG=new Map(errs.map(e=>[e.path,e.msg])); renderSteps(errs);
  const wrap=document.querySelector(`[data-wrap="${CSS.escape(path)}"]`); if(!wrap)return;
  const show=(touched.has(path)||revealed.has(current))&&errMap.has(path);
  wrap.classList.toggle("invalid",show);
  const input=wrap.querySelector("[data-path]"); if(show)input.setAttribute("aria-invalid","true");else input.removeAttribute("aria-invalid");
  const msg=wrap.querySelector("[data-msg]"); const f=findDef(path); if(!msg)return;
  msg.className=show?"err":"hint"; msg.textContent=show?(ERRMSG.get(path)||"Required"):(f&&f.hint)||"";
}
function findDef(path){
  const parts=path.split("."); const last=parts[parts.length-1];
  for(const st of steps){if(st.review||!st.blocks)continue;for(const b of st.blocks()){
    if(b.fields){const f=b.fields.find(x=>x.path===path);if(f)return f;}
    if(b.list&&parts[0]===b.list){return b.item.find(x=>x.path===last);}
  }}
  if(parts[0]==="groups"){return parts.length===3?{hint:"e.g. Active Network"}:rowFields.find(x=>x.path===last);}
}

/* ---------- Events ---------- */
document.addEventListener("input",e=>{
  const p=e.target.dataset&&e.target.dataset.path; if(!p)return;
  if(e.target.dataset.opt!==undefined) set(p,[...document.querySelectorAll(`[data-path="${CSS.escape(p)}"][data-opt]`)].filter(c=>c.checked).map(c=>c.dataset.opt));
  else if(e.target.type==="checkbox") set(p,e.target.checked);
  else set(p,e.target.value);
  save();
  const c=document.querySelector(`[data-count="${e.target.id}"]`); if(c)updateCount(c);
  if(p==="proactive"||/^vendors\.\d+\.internal$/.test(p)){render();const el=document.querySelector(`[data-path="${CSS.escape(p)}"]`);if(el)el.focus();return;}
  refreshField(p);
});
document.addEventListener("change",e=>{const p=e.target.dataset&&e.target.dataset.path;if(p){touched.add(p);refreshField(p);}});
document.addEventListener("focusout",e=>{const p=e.target.dataset&&e.target.dataset.path;if(p){touched.add(p);refreshField(p);}});
document.addEventListener("keydown",e=>{const l=e.target.closest&&e.target.closest("[data-uplabel]");if(l&&(e.key==="Enter"||e.key===" ")){e.preventDefault();$("#xlsxIn").click();}});
document.addEventListener("click",e=>{
  const t=e.target.closest("button,a"); if(!t)return;
  if(t.dataset.go!==undefined){go(+t.dataset.go);}
  else if(t.dataset.add){const path=t.dataset.add;const arr=get(path);const key=path.split(".").pop();arr.push(newOf[key]());save();
    render();const n=arr.length-1;const first=document.querySelector(`[data-path^="${CSS.escape(path+"."+n+".")}"]`);if(first){first.focus();first.scrollIntoView({block:"center"});}}
  else if(t.dataset.remove){const arr=get(t.dataset.remove);if(arr.length>1){arr.splice(+t.dataset.i,1);save();render();}}
  else if(t.dataset.jump!==undefined){e.preventDefault();const p=t.dataset.path;touched.add(p);revealed.add(+t.dataset.jump);current=+t.dataset.jump;render(p);}
  else if(t.id==="btnDownload"){download(t);}
  else if(t.dataset.move){const arr=get(t.dataset.move);const i=+t.dataset.i,j=i+(+t.dataset.dir);if(j>=0&&j<arr.length){[arr[i],arr[j]]=[arr[j],arr[i]];touched.clear();save();render();
      const btn=document.querySelector(`[data-move="${CSS.escape(t.dataset.move)}"][data-i="${j}"][data-dir="${t.dataset.dir}"]`)||document.querySelector(`[data-move="${CSS.escape(t.dataset.move)}"][data-i="${j}"]`);if(btn){btn.focus();btn.closest(".item,.group")&&btn.closest(".item,.group").classList.add("flash");}}}
  else if(t.dataset.action==="exportXlsx"){exportTracker(false);}
  else if(t.dataset.action==="sampleXlsx"){exportTracker(true);}
});
function go(i){ if(current!==steps.length-1)revealed.add(current); current=i; if(steps[i].review)steps.forEach((_,k)=>revealed.add(k)); render(); window.scrollTo({top:0}); }
$("#btnNext").onclick=()=>go(Math.min(current+1,steps.length-1));
$("#btnBack").onclick=()=>go(Math.max(current-1,0));
$("#btnSave").onclick=()=>{
  const blob=new Blob([JSON.stringify(S,null,2)],{type:"application/json"});
  saveFile(fileBase()+"_draft.json",blob).then(ok=>{if(ok)toast("Draft saved as a file. Load it later with “Open”.");});
};
async function exportTracker(sample){
  try{
    const data=sample?{groups:JSON.parse(JSON.stringify(SAMPLE_GROUPS))}:JSON.parse(JSON.stringify(S));
    const blob=await buildTrackerXlsx(JSZip,data);
    const name=sample?"DeepDive_Readiness_Checklist_Sample.xlsx":fileBase()+"_Readiness_Checklist.xlsx";
    if(await saveFile(name,blob))toast(sample?"Excel sample downloaded.":"Checklist downloaded as Excel.");
  }catch(err){console.error(err);toast("The Excel file couldn’t be created: "+err.message);}
}
async function importTracker(f){
  let groups;
  try{groups=await readTrackerXlsx(JSZip,f);}
  catch(err){console.error(err);
    toast(err.missing?`This sheet is missing columns: ${err.missing.join(", ")}. Start from the Excel sample.`:"That file couldn’t be read. Upload the Excel sample or a checklist downloaded from DeepDive Builder.");return;}
  if(!groups.length){toast("No rows found in the Readiness Checklist sheet.");return;}
  const filled=S.groups.some(g=>g.name||g.rows.some(r=>r.item||r.provider));
  let mode="replace";
  if(filled){const ans=await ask(`“${f.name}” has ${groups.reduce((a,g)=>a+g.rows.length,0)} rows. Replace the current checklist, or add these rows to it?`,"Replace","Add to checklist");
    if(!ans)return; mode=ans==="alt"?"add":"replace";}
  if(mode==="replace") S.groups=groups;
  else groups.forEach(g=>{const ex=S.groups.find(x=>x.name&&x.name.trim().toLowerCase()===g.name.trim().toLowerCase());if(ex)ex.rows.push(...g.rows);else S.groups.push(g);});
  S.groups=S.groups.filter(g=>g.name||g.rows.some(r=>r.item||r.provider)); if(!S.groups.length)S.groups=blank().groups;
  const ci=steps.findIndex(st=>st.title==="Readiness checklist");
  save();touched.clear();revealed.add(ci);current=ci;render();window.scrollTo({top:0});
  const rows=groups.reduce((a,g)=>a+g.rows.length,0);
  toast(`${mode==="add"?"Added":"Imported"} ${rows} row${rows===1?"":"s"}. Anything marked in red still needs attention.`);
}
$("#xlsxIn").onchange=async(e)=>{const f=e.target.files[0];e.target.value="";if(f)await importTracker(f);};
$("#fileIn").onchange=async(e)=>{const f=e.target.files[0];if(!f)return;
  if(/\.xlsx$/i.test(f.name)){e.target.value="";await importTracker(f);return;}
  const hasData=JSON.stringify(S)!==JSON.stringify(blank());
  if(hasData&&!(await ask(`Open “${f.name}”? This replaces what is currently in the form.`,"Open"))){e.target.value="";return;}
  try{
    let data;
    if(/\.pptx$/i.test(f.name)){
      data=await readEmbeddedData(JSZip,f);
      if(!data){toast("This PowerPoint wasn’t created with this version of DeepDive Builder, so its content can’t be loaded.");e.target.value="";return;}
    } else data=JSON.parse(await f.text());
    S=migrate(data);applyPortalFields();save();touched.clear();revealed.clear();current=0;render();toast(`Opened “${f.name}”. Make your changes, then download again.`);
  }catch(err){console.error(err);toast("That file couldn’t be opened. Choose a PowerPoint made with DeepDive Builder or a saved draft (.json).");}
  e.target.value="";};
$("#btnClear").onclick=async()=>{if(await ask("Clear every field and start a new DeepDive? Save a draft first if you want to keep this one.","Clear form")){S=blank();applyPortalFields();touched.clear();revealed.clear();current=0;save();render();}};
$("#btnExample").onclick=async()=>{if(await ask("Replace the current form with example data?","Load example")){S=example();applyPortalFields();touched.clear();revealed.clear();save();render();toast("Example loaded — go to Review to try the download.");}};

function fileBase(){const clean=t=>(t||"").trim().replace(/[\\/:*?"<>|]+/g,"").replace(/\s+/g,"_").slice(0,40);
  return ["DeepDive",clean(S.customer),clean(S.oppName)].filter(Boolean).join("_");}
function coverPng(){
  const c=document.createElement("canvas");c.width=2666;c.height=1500;const x=c.getContext("2d");const k=200;
  const circ=(l,t,d,col)=>{x.beginPath();x.arc((l+d/2)*k,(t+d/2)*k,d/2*k,0,Math.PI*2);x.fillStyle=col;x.fill();};
  circ(8.2,-2.2,7.5,"#5E13A0");circ(10.4,4.6,4.2,"#FF375E");
  return c.toDataURL("image/png").replace(/^data:/,"");
}
async function download(btn){
  if(validate().length){render();return;}
  btn.disabled=true;const old=btn.textContent;btn.textContent="Building your deck…";
  try{
    const clean=JSON.parse(JSON.stringify(S));
    const pres=buildDeck(PptxGenJS,clean,ICONS,coverPng());
    const raw=await pres.write({outputType:"blob"});
    const blob=await embedData(JSZip,raw,clean);
    const ok=await saveFile(fileBase()+".pptx",blob);
    const xl=await buildTrackerXlsx(JSZip,clean);
    const ok2=await saveFile(fileBase()+"_Readiness_Tracker.xlsx",xl);
    toast(ok&&ok2?"PowerPoint and Excel tracker downloaded.":ok?"PowerPoint downloaded.":ok2?"Excel tracker downloaded.":"Download cancelled.");
  }catch(err){console.error(err);toast("The deck couldn’t be built: "+err.message);}
  btn.disabled=false;btn.textContent=old;
}
const SAMPLE_GROUPS=[
  {name:"IoT Platform",rows:[{item:"IoT Platform",provider:"SenseTime",communicated:"Yes",quoteRec:"No",tpRec:"No",quoteVal:"No",tpVal:"No",comments:"N/A"}]},
  {name:"Hardware",rows:[
    {item:"Bird Nest",provider:"Intyx",communicated:"Yes",quoteRec:"No",tpRec:"No",quoteVal:"No",tpVal:"No",comments:"N/A"},
    {item:"Sky Quality",provider:"Intyx",communicated:"No",quoteRec:"No",tpRec:"No",quoteVal:"No",tpVal:"No",comments:"N/A"},
    {item:"Traps",provider:"Intyx",communicated:"No",quoteRec:"No",tpRec:"No",quoteVal:"No",tpVal:"No",comments:"N/A"},
    {item:"Underwater",provider:"Intyx",communicated:"No",quoteRec:"No",tpRec:"No",quoteVal:"No",tpVal:"No",comments:"N/A"},
    {item:"In-situ Hydrophones",provider:"Intyx",communicated:"No",quoteRec:"No",tpRec:"No",quoteVal:"No",tpVal:"No",comments:"N/A"},
    {item:"MET Ocean Buoys",provider:"Intyx",communicated:"No",quoteRec:"No",tpRec:"No",quoteVal:"No",tpVal:"No",comments:"N/A"},
    {item:"Sky Quality Meters",provider:"Intyx",communicated:"No",quoteRec:"No",tpRec:"No",quoteVal:"No",tpVal:"No",comments:"N/A"}]}
];
function example(){
  const S=blank();
  Object.assign(S,{customer:"Red Sea Global",oppName:"Environment and Sustainability Solution",oppNumber:"OP-2026-159388",value:"28000000",
    presalesReceived:"2026-08-02",submissionDate:"2026-09-28",presalesOwner:"Mohammed Rabie",accountManager:"Saleh Halawani",
    background:"Previous phase 1 (MVP) was implemented by DEYARAT and the customer was not happy\nThis opportunity is for the next phases of the existing opportunity: phases 3, 4 and 5 (Full Scale, Testing, MS)",
    requirements:[{text:"Unified platform for Smart Environment & Sustainability."}],
    sow:"Implement and operationalize RSG's Smart Environment & Sustainability solution as a unified platform for environmental monitoring, environmental intelligence, asset management, analytics, AI, reporting, alerts, and integration with the broader Smart Destination ecosystem.",
    solution:"Unified IoT Platform\n4 types of Cameras (Bird Nest, Sky Quality, Traps, Underwater)\n3 types of Sensors (In-situ Hydrophones, MET Ocean Buoys, Sky Quality Meters)\nImplementation and hardware integration\nManaged Services",
    psDuration:"6 Months",msDuration:"5 years",
    internal:[{unit:"Pulse by solutions",scope:"Supervision"},{unit:"PM",scope:"PS project management"},{unit:"MS",scope:"Managed service project manager"}],
    vendors:[{name:"SenseTime",reg:"Pending",pricing:"Protected",scope:"The Unified Platform, PS and MS.",internal:false},
      {name:"Intyx",reg:"Pending",pricing:"Protected",scope:"4 types of Cameras (Bird Nest, Sky Quality, Traps, Underwater)\n3 types of Sensors (In-situ Hydrophones, MET Ocean Buoys, Sky Quality Meters)",internal:false}],
    driver:"The quality of the implementation by DEYARAT in phase 1 (MVP) was not up to customer expectations.\nPrice",
    differentiator:"Customer aligned with Intyx, and solutions by stc is working with Intyx instead of DEYARAT\nProtection from SenseTime",
    competitors:[{name:"DEYARAT"}],proactive:"Yes",proactiveType:["Workshop"],
    winTech:[{action:"Comply with the technical criteria",owner:"Mohammed Rabie",date:"2026-09-24"}],
    winFin:[{action:"Meet customer target price (28M)",owner:"Saleh Halawani",date:"2026-09-27"}],
    riskTech:[{risk:"Lack of Pulse capabilities in environmental monitoring",mitigation:"Partner with Intyx",owner:"Mohammed Rabie",date:"2026-09-24",impact:"High"}],
    riskFin:[{risk:"Initial pricing (35M) vs customer budget (28M)",mitigation:"Round of commercial discussion with vendors",owner:"Saleh Halawani",date:"2026-09-27",impact:"High"}],
    groups:JSON.parse(JSON.stringify(SAMPLE_GROUPS)),
    support:[{need:"Vendor commercial quotation from SenseTime",from:"SenseTime channel team",priority:"High",date:"2026-09-22"},
      {need:"Management pricing approval for the 28M target",from:"VP Sales",priority:"High",date:"2026-09-24"},
      {need:"Pulse by solutions to participate in the integration part",from:"Pulse by solutions",priority:"Medium",date:"2026-09-17"}]});
  return S;
}
bridge.onLoad(({data, readOnly, context}) => {
  S = migrate(data || {});
  READONLY = !!readOnly;
  CONTEXT = context || {};
  applyPortalFields();
  document.body.classList.toggle("readonly", READONLY);
  touched.clear(); revealed.clear();
  render();
  bridge.state(S, validate());
});
bridge.onGotoReview(() => { steps.forEach((_, k) => revealed.add(k)); current = steps.length - 1; render(); window.scrollTo({ top: 0 }); });
bridge.onRequestState(() => bridge.state(S, validate()));
render();
bridge.ready();
