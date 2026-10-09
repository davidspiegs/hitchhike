/** Runs the emitted next-workspace runtime with synthetic fixtures; no live providers. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Script, createContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
const built = await build({entryPoints:['src/workspace-ui.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {workspaceHtml} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const html=workspaceHtml('QA <script>',{}),source=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
new Script(source);
const testFilter=process.env.WORKSPACE_UI_TEST_MATCH?new RegExp(process.env.WORKSPACE_UI_TEST_MATCH):null;
let passed=0;const check=async(name,fn)=>{if(testFilter&&!testFilter.test(name))return;await fn();console.log('ok '+(++passed)+' - '+name);};
function documentDouble(){const doc={activeElement:null,hidden:false};class Node{constructor(tag='',text=''){this.nodeType=tag?1:3;this.tagName=tag.toUpperCase();this.childNodes=[];this.attrs={};this.dataset={};this.events={};this.style={};this.scrollHeight=240;this._text=text;this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.open=false;this.parentNode=null;}get id(){return this.attrs.id||'';}set id(v){this.attrs.id=v;}get className(){return this.attrs.class||'';}set className(v){this.attrs.class=v;}get disabled(){return this.attrs.disabled!==undefined;}set disabled(v){if(v)this.attrs.disabled='';else delete this.attrs.disabled;}get hidden(){return this.attrs.hidden!==undefined;}set hidden(v){if(v)this.attrs.hidden='';else delete this.attrs.hidden;}get open(){return this.attrs.open!==undefined;}set open(v){if(v)this.attrs.open='';else delete this.attrs.open;}get children(){return this.childNodes.filter(n=>n.nodeType===1);}get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}get textContent(){return this.nodeType===3?this._text:this.childNodes.map(n=>n.textContent).join('');}set textContent(t){this.replaceChildren(new Node('',String(t)));}setAttribute(k,v){this.attrs[k]=String(v);if(k==='value')this.value=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}append(...nodes){for(const n of nodes){const item=n?.nodeType?n:new Node('',String(n));item.parentNode=this;this.childNodes.push(item);}if(this.tagName==='SELECT')this.value=(this.children.find(n=>n.attrs.selected!==undefined)||this.children[0])?.value||'';}prepend(...nodes){const old=this.childNodes;this.childNodes=[];this.append(...nodes,...old);}replaceChildren(...nodes){this.childNodes.forEach(n=>n.parentNode=null);this.childNodes=[];this.append(...nodes);}replaceWith(...nodes){if(!this.parentNode)return;const parent=this.parentNode,index=parent.childNodes.indexOf(this),items=nodes.map(n=>n?.nodeType?n:new Node('',String(n)));for(const item of items)item.parentNode=parent;parent.childNodes.splice(index,1,...items);this.parentNode=null;}remove(){if(!this.parentNode)return;this.parentNode.childNodes=this.parentNode.childNodes.filter(n=>n!==this);this.parentNode=null;}matches(q){const tag=q.match(/^[a-z0-9]+/)?.[0],id=q.match(/#([\w-]+)/)?.[1],cls=q.match(/\.([\w-]+)/)?.[1];return (!tag||this.tagName===tag.toUpperCase())&&(!id||this.id===id)&&(!cls||this.className.split(' ').includes(cls))&&this.nodeType===1;}querySelectorAll(q){return this.children.flatMap(n=>[...(n.matches(q)?[n]:[]),...n.querySelectorAll(q)]);}querySelector(q){return this.querySelectorAll(q)[0]||null;}addEventListener(e,fn){(this.events[e]||=[]).push(fn);}async dispatch(e){for(const f of this.events[e]||[])await f({target:this,currentTarget:this,preventDefault(){}});}async click(){if(!this.disabled)await this.dispatch('click');}focus(){doc.activeElement=this;}select(){this.selected=true;}reportValidity(){if(this.tagName==='FORM')return this.querySelectorAll('input').concat(this.querySelectorAll('textarea')).every(n=>n.reportValidity());return this.attrs.required===undefined||!!this.value;}get outerHTML(){throw new Error('No HTML parsing permitted');}}
 doc.body=new Node('body');doc.createElement=tag=>new Node(tag);doc.createElementNS=(ns,tag)=>{const n=new Node(tag);n.namespaceURI=ns;return n;};doc.createTextNode=t=>new Node('',String(t));doc.querySelector=s=>doc.body.querySelector(s);doc.querySelectorAll=s=>doc.body.querySelectorAll(s);doc.events={};doc.addEventListener=(event,handler)=>{(doc.events[event]||=[]).push(handler);};doc.dispatch=async event=>{for(const handler of doc.events[event]||[])await handler({type:event,target:doc,preventDefault(){}});};doc.createRange=()=>({selectNodeContents(){}});for(const[,tag,attrs]of html.matchAll(/<([a-z]+)\b([^>]*\bid="[^"]+"[^>]*)>/g)){const node=new Node(tag);for(const[,k,v]of attrs.matchAll(/([\w-]+)="([^"]*)"/g))node.setAttribute(k,v);doc.body.append(node);}doc.body.dataset={hosted:'false',assets:'{}'};return doc;}
const now=new Date().toISOString();
const agent={id:'claude',handle:'claude',name:'Claude',platform:'claude',platform_label:'Claude',connects:'mcp',can_work:true,can_request:true,last_seen_at:null};
const settings={purpose:'',initiative:false,permitted_collaborators:['*'],allowed_request_categories:['task'],allowed_work_categories:['task'],sharing:{instructions:'Relevant supplied context only.',approved_sources:[],recipient_rules:[]},standing_responsibilities:[],authorization_boundaries:[],background:{method:'manual',interval_minutes:null},instructions:{profile:'judgment',custom_prompt:null},setup_background:null};
const config={agent_id:'claude',version:0,settings,onboarding:{surface:'chat',step:'connect',provider:'claude'},readiness:{access:{verified:false,last_seen_at:null},collaboration:{verified:false},peer_collaboration:{verified:false},background:{verified:false,observed_runs:0}},release:{enabled:true},roster:[]};
const overview={agents:[agent],jobs:[],platforms:[{id:'claude',label:'Claude',blurb:'Chat',defaults:{work_types:['task'],poll_minutes:null}}]};
const guide={surface:'chat',surfaces:[{id:'chat',label:'Claude chat',prerequisites:['Use desktop if connector settings are missing.'],steps:[{title:'Add custom connector',text:'Open Claude settings.',copy:'https://api.example.test/mcp'}],recovery:['Check your account.'],sources:[]}],accessPrompt:'Confirm connection claude without sending work.',collaborationPrompt:'Refresh configuration; send relevant context only.',backgroundPrompt:'Verify a provider schedule.'};
// Optional deterministic time drives the actual browser timeout and event callbacks.
function mockClock(start=Date.parse('2026-10-03T12:00:00Z')){
  let current=start,nextId=0;const pending=new Map();
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[current]));}static now(){return current;}}
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {Date:ClockDate,get now(){return current;},get pending(){return [...pending.values()].map(timer=>({id:timer.id,at:timer.at}));},
    setTimeout:(callback,delay=0,...args)=>{const id=++nextId;pending.set(id,{id,at:current+Math.max(0,Number(delay)||0),callback,args});return id;},
    clearTimeout:id=>pending.delete(id),flush,
    async advance(ms){const until=current+ms;assert.ok(ms>=0);let count=0;await flush();
      while(true){const next=[...pending.values()].filter(timer=>timer.at<=until).sort((a,b)=>a.at-b.at||a.id-b.id)[0];if(!next)break;
        assert.ok(++count<10000,'Unexpected timer loop');current=next.at;pending.delete(next.id);await next.callback(...next.args);await flush();
      }current=until;await flush();
    }
  };
}
function runtime(fixtures={},options={}){const clock=options.clock,doc=documentDouble(),calls=[],copied=[],storage=new Map(),location={hash:'#/agents',pathname:'/beta',search:'',origin:'https://example.test'},window={events:{},addEventListener(event,handler){(this.events[event]||=[]).push(handler);},async dispatch(event){for(const handler of this.events[event]||[])await handler({type:event,target:this,preventDefault(){}});},scrollTo(){},getSelection:()=>({removeAllRanges(){},addRange(){}})};doc.body.dataset.hosted=options.hosted?'true':'false';const responses={'/v1/admin/overview':overview,'/v1/workspace/release':{enabled:true},'/v1/agents/claude/collaboration':config,'/v1/agents/claude/activation':{activation:null},'/v1/admin/agents/claude/setup?surface=chat':{guide},'/v1/admin/agents/claude/setup?surface=cloud':{guide},...fixtures};const context=createContext({document:doc,window,location,history:{replaceState(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},navigator:{clipboard:{writeText:async text=>{copied.push(text);}}},URL,URLSearchParams,AbortController,Blob,crypto:{randomUUID},Date:clock?.Date||Date,setTimeout:clock?.setTimeout||(()=>1),clearTimeout:clock?.clearTimeout||(()=>{}),confirm:()=>true,fetch:async(path,opts)=>{calls.push({path,opts,at:clock?.now??Date.now()});const body=responses[path],value=typeof body==='function'?await body(opts):body||{};return {ok:!value.__status||(value.__status>=200&&value.__status<300),status:value.__status||200,headers:{get:name=>Object.entries(value.__headers||{}).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1]??null},json:async()=>JSON.parse(JSON.stringify(value.__body||value))};}});const injected=source.replace('  boot();','  window.test={el,sharedContext,requestControls,setupCopyLabel,conversationState,agentsPage,setupPage,configurationPage,connectPage,signOut,clearLegacyDrafts,instructionEditor,backgroundGuideSection,peerExchange,setupReady,updateSetupEvidence,fetchOverview,refresh,schedule,boot,setSession:s=>session=s,activityPage,conversationPage,copybox,readiness,testVerified,parseRoute,openWorkspace,setState:(o,c)=>{overview=o;configs=new Map(c);signedIn=true;},render,api};');new Script(injected).runInContext(context);window.test.setState(JSON.parse(JSON.stringify(overview)),[['claude',JSON.parse(JSON.stringify(config))]]);return {doc,context,api:window.test,calls,copied,storage,location,clock};}
await check('shell escapes names, uses dedicated page routes, readable viewport and named settings',()=>{assert.match(html,/QA &lt;script&gt;/);assert.match(html,/viewport-fit=cover/);assert.match(html,/aria-label="Workspace settings"/);assert.doesNotMatch(html,/<dialog|aria-modal/);assert.match(html,/min-height:44px/);assert.match(html,/font-size:16px/);});
await check('untrusted agent content stays text and does not become HTML',()=>{const r=runtime();const data=structuredClone(overview);data.agents[0].name='<img src=x onerror=alert(1)>';r.api.setState(data,[['claude',config]]);const nodes=r.api.agentsPage();assert.ok(nodes.map(n=>n.textContent).join('').includes('<img src=x onerror=alert(1)>'));assert.equal(nodes.flatMap(n=>n.querySelectorAll('img')).length,0);});
await check('authenticated contact and a marker do not imply a peer exchange or verified background',()=>{const r=runtime();const c=structuredClone(config);c.readiness.access.verified=true;r.api.setState(overview,[['claude',c]]);assert.equal(r.api.readiness(agent).text,'Access confirmed');c.readiness.collaboration.verified=true;assert.equal(r.api.readiness(agent).text,'Access confirmed');c.readiness.peer_collaboration.verified=true;assert.equal(r.api.readiness(agent).text,'Exchange verified');assert.equal(r.api.readiness(agent).detail,'Background not verified');});
await check('provider setup uses selected guide, recovery, selectable exact endpoint',async()=>{const r=runtime();const nodes=await r.api.setupPage('claude','connect');const text=nodes.map(n=>n.textContent).join('');assert.match(text,/Add custom connector/);assert.match(text,/https:\/\/api.example.test\/mcp/);assert.match(text,/Check your account/);assert.match(text,/Continue/);});
await check('Grok setup renders installation followed by one identity-first introduction including its schedule',async()=>{
  const bundle=await build({entryPoints:['src/platforms.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
  const {setupGuide}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  for(const conversationTools of [false,true]) {
    const grok={...agent,id:'grok',name:'Grok',platform:'grok',platform_label:'Grok'},c=structuredClone(config);
    c.agent_id='grok';c.onboarding.provider='grok';c.release.enabled=conversationTools;
    const generated=setupGuide({agentId:'grok',name:'Grok',token:'',relayUrl:'https://api.example.test',canWork:true,canRequest:true,workTypes:['task'],pollMinutes:null,platform:'grok',surface:'chat',hosted:true,conversationTools});
    const r=runtime({'/v1/agents/grok/collaboration':c,'/v1/admin/agents/grok/setup?surface=chat':{guide:generated}},{hosted:true});
    r.api.setState({...overview,agents:[grok]},[['grok',c]]);
    const connect=await r.api.setupPage('grok','connect'),copies=connect.flatMap(node=>node.querySelectorAll('pre'));
    assert.equal(copies.length,1);assert.equal(copies[0].textContent,'https://api.example.test/mcp/connections/grok');
    assert.doesNotMatch(connect.map(node=>node.textContent).join(''),/Send tasks and get results|Receive a task|check_inbox|get_next_job|acknowledge_results/);
    const instructions=await r.api.setupPage('grok','instructions'),introduction=instructions.flatMap(node=>node.querySelectorAll('.instruction-copy'))[0];await introduction.querySelectorAll('button').find(node=>node.textContent==='Copy').click();const prompt=r.copied.at(-1);
    assert.match(prompt,/Use Hitchhike as "Grok" \(grok\)/);
    assert.match(prompt,/connection_status matches this ID/);
    assert.match(prompt,/Stop on an identity mismatch/);
    assert.ok(prompt.indexOf('connection_status')<prompt.indexOf('Create an hourly scheduled task'));
    assert.match(prompt,/Create an hourly scheduled task.*Reuse a matching active task/);
    assert.equal(prompt.split(generated.backgroundSchedulePrompt).length,2,'one copied introduction contains the scheduling request exactly once');
    assert.equal(r.calls.some(call=>call.opts.method!=='GET'),false);
  }
});
await check('finishing setup is allowed independently of access and peer exchange evidence',async()=>{for(const [access,peer]of [[false,false],[true,false],[false,true],[true,true]]){const c=structuredClone(config);c.readiness.access.verified=access;c.readiness.peer_collaboration.verified=peer;c.readiness.collaboration.verified=true;c.onboarding.step='exchange';const before=structuredClone(c.readiness);const r=runtime({'/v1/agents/claude/collaboration':c,'/v1/agents/claude/onboarding':c}),nodes=await r.api.setupPage('claude','exchange'),done=nodes.flatMap(n=>n.querySelectorAll('button')).find(n=>n.textContent==='Finish setup');assert.equal(r.api.setupReady(c),access&&peer);assert.equal(done.disabled,false);await done.click();const writes=r.calls.filter(c=>c.opts.method!=='GET');assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].opts.body),{step:'done'});assert.deepEqual(c.readiness,before);assert.ok(nodes.map(n=>n.textContent).join('').includes('Background checks are not verified yet.'));}});
await check('test verification requires exact expected marker plus validation',()=>{const r=runtime();assert.equal(r.api.testVerified({status:'completed',inputs:{expected_response:'expected'},result:{summary:'wrong',validation:{ok:true}}}),false);assert.equal(r.api.testVerified({status:'completed',inputs:{expected_response:'expected'},result:{summary:'expected',validation:{ok:true}}}),true);});
await check('beta requires explicit enabling and does not mutate just by opening',async()=>{const r=runtime({'/v1/workspace/release':{enabled:false}});await r.api.openWorkspace();assert.ok(r.doc.querySelector('#boot').textContent.includes('Try the new workspace'));assert.equal(r.calls.some(c=>c.opts.method!=='GET'),false);});
await check('configuration page exposes collaborator, category, source and approval rules',async()=>{const r=runtime();const nodes=await r.api.configurationPage('claude');const text=nodes.map(n=>n.textContent).join('');for(const value of ['Available collaborators','May request','May perform','Approved sources','Actions requiring further authorization','Background behavior'])assert.ok(text.includes(value),value);});
await check('conversation pagination appends full messages and reading does not acknowledge another consumer',async()=>{const first={conversation:{id:'conv',title:'Review',participants:['owner','claude'],last_message_at:now,outstanding_requests:0,requests_used:1,request_limit:10,retention_days:30,expires_at:now},messages:[{id:1,from:'owner',kind:'request',text:'Original question',created_at:now}],requests:[],has_more:true,next_cursor:1},second={...first,messages:[{id:2,from:'claude',kind:'answer',text:'Full earlier answer',created_at:now}],has_more:false,next_cursor:2};const r=runtime({'/v1/conversations/conv?limit=20':first,'/v1/conversations/conv?limit=20&after=1':second});const nodes=await r.api.conversationPage('conv');const more=nodes.flatMap(n=>n.querySelectorAll('button')).find(n=>n.textContent==='Load more history');await more.click();const text=nodes.map(n=>n.textContent).join('');assert.match(text,/Original question/);assert.match(text,/Full earlier answer/);assert.equal(r.calls.some(c=>c.path.includes('acknowledge')),false);});

await check('empty optional routine credentials do not block saving ordinary Claude preferences',async()=>{const r=runtime();const nodes=await r.api.configurationPage('claude');const form=nodes.flatMap(n=>n.querySelectorAll('form'))[0];assert.ok(form.reportValidity());const save=form.querySelectorAll('button').find(n=>n.textContent==='Save preferences');await save.click();assert.ok(r.calls.some(c=>c.path==='/v1/agents/claude/collaboration'&&c.opts.method==='PUT'));assert.equal(r.calls.some(c=>c.path.endsWith('/activation')&&c.opts.method==='PUT'),false);});
await check('drafts are isolated by workspace and obsolete unscoped drafts are removed',()=>{const r=runtime();r.storage.set('hitchhike:new-connection:A:claude',JSON.stringify({id:'prior',name:'Private draft A',surface:'chat'}));r.storage.set('hitchhike:new-connection:claude','old leaked draft');r.api.clearLegacyDrafts();assert.equal(r.storage.has('hitchhike:new-connection:claude'),false);r.api.setSession({workspace:{id:'A'}});const a=r.api.connectPage('claude');assert.equal(a.flatMap(n=>n.querySelectorAll('input')).find(n=>n.id==='agent-name').value,'Private draft A');r.api.setSession({workspace:{id:'B'}});const b=r.api.connectPage('claude');assert.equal(b.flatMap(n=>n.querySelectorAll('input')).find(n=>n.id==='agent-name').value,'Claude');});
await check('sign out removes private forms and secrets from the document',()=>{const r=runtime();const secret=r.doc.createElement('input');secret.value='secret-token';r.doc.querySelector('#main').append(secret);r.api.signOut();assert.equal(r.doc.querySelector('#main').childNodes.length,0);assert.equal(r.doc.querySelector('#workspace').hidden,true);});


await check('activity uses actual queued, claimed, failed and retrieved request states',()=>{const r=runtime();for(const [status,label] of [['queued','Waiting for pickup'],['claimed','Picked up'],['failed','Failed'],['expired','Expired'],['input_required','Needs clarification']])assert.equal(r.api.conversationState({id:'old',latest_request:{status}}).label,label);assert.equal(r.api.conversationState({id:'old',latest_request:{status:'completed',retrieved_at:now}}).label,'Retrieved');});
await check('render omits absent sections instead of inserting literal null text',async()=>{const r=runtime({'/v1/conversations?limit=100':{conversations:[]}});r.location.hash='#/activity';await r.api.render();assert.doesNotMatch(r.doc.querySelector('#main').textContent,/null|undefined/);});
await check('completed conversation loads full request for revision without impersonating requester acknowledgement',async()=>{const conversation={id:'done',title:'Review',participants:['cleo','claude'],last_message_at:now,outstanding_requests:0,requests_used:1,request_limit:10,retention_days:30,expires_at:now};const summary={id:'job1',from:'cleo',to:'claude',status:'completed',title:'Review',created_at:now};const r=runtime({'/v1/conversations/done?limit=20':{conversation,messages:[],requests:[summary],has_more:false,next_cursor:0},'/v1/jobs/job1?full=1':{job:{...summary,result:{summary:'Full answer',body:'Complete body',validation:{ok:true}}}}});const nodes=await r.api.conversationPage('done'),text=nodes.map(n=>n.textContent).join('');assert.match(text,/Request a revision/);assert.doesNotMatch(text,/Acknowledge result/);assert.ok(r.calls.some(c=>c.path==='/v1/jobs/job1?full=1'));});
await check('core text and control colors meet WCAG AA contrast targets',()=>{const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};const ratio=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(values[0]+0.05)/(values[1]+0.05);};const token=name=>html.match(new RegExp('--'+name+':(#[a-f0-9]{6})'))[1];for(const name of ['ink','muted','orange','green','warning','danger'])assert.ok(ratio(token(name),'#ffffff')>=4.5,name);assert.ok(ratio(token('muted'),token('paper'))>=4.5);assert.ok(ratio(token('strong'),'#ffffff')>=3);assert.ok(ratio(token('strong'),token('paper'))>=3);assert.match(html,/max-height:none;overflow:visible/);assert.match(html,/\.main:focus\{outline:none\}/);});


await check('reply fields retain visible associated labels and setup snippets name their content',()=>{const r=runtime();for(const [status,label] of [['input_required','Your answer'],['completed','Specific revision feedback']]){const nodes=r.api.requestControls({id:'label-test',status,from:'cleo'},r.doc.createElement('p'));const area=nodes.querySelector('textarea'),visible=nodes.querySelector('label');assert.equal(visible.textContent,label);assert.equal(visible.getAttribute('for'),area.id);assert.ok(area.id);}assert.equal(r.api.setupCopyLabel('https://api.example.test/mcp'),'MCP server URL');assert.equal(r.api.setupCopyLabel('claude mcp add hitchhike https://example.test/mcp'),'Setup command');assert.equal(r.api.setupCopyLabel('codex mcp add hitchhike --url https://example.test/mcp'),'Setup command');assert.equal(r.api.setupCopyLabel('Ask your assistant to confirm access.'),'Copy for your assistant');});


await check('shared text context saves its version and never persists private drafts in browser storage',async()=>{const r=runtime({'/v1/conversations/shared/context':{conversation:{id:'shared',pinned_context:'Approved https://example.test/reference',context_version:4},message:{kind:'context'}}});const node=r.api.sharedContext({id:'shared',pinned_context:'Earlier brief',context_version:3}),area=node.querySelector('textarea');area.value='Approved https://example.test/reference';await area.dispatch('input');await node.querySelectorAll('button').find(n=>n.textContent==='Save shared context').click();const call=r.calls.find(c=>c.path==='/v1/conversations/shared/context');assert.equal(call.opts.method,'PATCH');assert.deepEqual(JSON.parse(call.opts.body),{pinned_context:'Approved https://example.test/reference',expected_version:3});assert.equal([...r.storage.values()].some(v=>v.includes('Approved https://')),false);assert.match(node.textContent,/deliberately approve/);});
await check('shared-context conflicts preserve draft and original version across re-render until explicit discard',async()=>{const r=runtime({'/v1/conversations/shared/context':{__status:409,__body:{error:{code:'context_changed',message:'Changed elsewhere.'}}}});let node=r.api.sharedContext({id:'shared',pinned_context:'Original',context_version:3}),area=node.querySelector('textarea');area.value='My pending draft';await area.dispatch('input');await node.querySelectorAll('button').find(n=>n.textContent==='Save shared context').click();assert.match(node.textContent,/Your draft is kept here/);node=r.api.sharedContext({id:'shared',pinned_context:'Changed remotely',context_version:4});assert.equal(node.querySelector('textarea').value,'My pending draft');await node.querySelectorAll('button').find(n=>n.textContent==='Save shared context').click();assert.equal(JSON.parse(r.calls.at(-1).opts.body).expected_version,3);r.api.signOut();assert.equal(r.api.sharedContext({id:'shared',pinned_context:'Changed remotely',context_version:4}).querySelector('textarea').value,'Changed remotely');});

// Exercise the emitted UI against stateful endpoint fixtures, including persistence across runtimes.
const collaborationPath='/v1/agents/claude/collaboration',onboardingPath='/v1/agents/claude/onboarding';
const profileGuide={...guide,instructionProfiles:[
  {id:'judgment',label:'Use your judgment',description:'Choose whether useful work needs help and which peer fits.',prompt:'JUDGMENT: First confirm connection_status identifies claude. Use your judgment about whether and whom to ask.'},
  {id:'available',label:'Be available to help',description:'Receive useful requests within existing permissions.',prompt:'AVAILABLE: First confirm connection_status identifies claude. Help connected assistants when asked within saved permissions.'},
  {id:'delegate',label:'Delegate work',description:'Delegate suitable parts and combine checked results.',prompt:'DELEGATE: Assign suitable parts to peers and verify the combined result.'},
  {id:'offload',label:'Offload routine work',description:'Hand off one bounded task and track its result.',prompt:'OFFLOAD: Send one bounded task and avoid duplicating the work.'},
  {id:'collaborate',label:'Work as a team',description:'Exchange questions and work within saved responsibilities.',prompt:'COLLABORATE: Exchange useful questions and work in both directions.'},
  {id:'second_opinion',label:'Get a second opinion',description:'Request an independent check and retain judgment.',prompt:'SECOND OPINION: Ask for independent critique, then decide what to use.'}
]};
const query=(nodes,selector)=>[nodes].flat().flatMap(node=>node.querySelectorAll(selector));
const content=nodes=>[nodes].flat().map(node=>node.textContent).join('');
const button=(nodes,label)=>{const found=query(nodes,'button').find(node=>node.textContent===label);assert.ok(found,'Missing button: '+label);return found;};
const promptArea=nodes=>{const found=query(nodes,'textarea').find(node=>node.id==='collaboration-prompt');assert.ok(found,'Missing instruction textarea');return found;};
const writes=r=>r.calls.filter(call=>call.opts.method!=='GET');
const selectedProfile=nodes=>query(nodes,'input').find(node=>node.getAttribute('type')==='radio'&&node.checked)?.value;
async function chooseProfile(nodes,id){const choice=query(nodes,'input').find(node=>node.getAttribute('type')==='radio'&&node.value===id);assert.ok(choice,'Missing profile: '+id);for(let parent=choice.parentNode;parent;parent=parent.parentNode)if(parent.tagName==='DETAILS')parent.open=true;choice.checked=true;await choice.dispatch('change');}
async function editPrompt(nodes,text){const area=promptArea(nodes);area.value=text;await area.dispatch('input');return area;}
function savedConfiguration(initial=config){
  let current=structuredClone(initial);
  return {get current(){return structuredClone(current);},replace(value){current=structuredClone(value);},fixtures:{
    [collaborationPath]:opts=>{if(opts.method==='PUT'){const body=JSON.parse(opts.body);assert.equal(body.expected_version,current.version);current={...current,version:current.version+1,settings:{...current.settings,...(body.instructions?{instructions:body.instructions}:{}),...('setup_background' in body?{setup_background:body.setup_background}:{})}};}return current;},
    [onboardingPath]:opts=>{const body=JSON.parse(opts.body);current={...current,onboarding:{...current.onboarding,...body}};return current;},
    '/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}
  }};
}

async function pollingRuntime(route='#/agents',overrides={}){
  const clock=mockClock(),agents=[agent,...Array.from({length:5},(_,index)=>({...agent,id:'peer-'+index,name:'Peer '+index}))];
  const fixtures={'/v1/admin/overview':{...overview,agents},'/v1/conversations?limit=100':{conversations:[]}};
  for(const a of agents)fixtures['/v1/agents/'+a.id+'/collaboration']={...structuredClone(config),agent_id:a.id};
  const r=runtime({...fixtures,...overrides},{clock});r.location.hash=route;
  await r.api.openWorkspace();await clock.flush();r.calls.length=0;return r;
}
const pollingRounds=r=>r.calls.filter(call=>call.path==='/v1/admin/overview');
function assertBoundedPolling(r){
  const rounds=new Map();for(const call of r.calls){assert.equal(call.opts.method,'GET');const round=rounds.get(call.at)||[];round.push(call);rounds.set(call.at,round);}
  for(const calls of rounds.values()){
    assert.ok(calls.length<=3,'An automatic round used '+calls.length+' reads: '+calls.map(call=>call.path).join(', '));
    assert.ok(calls.filter(call=>call.path.endsWith('/collaboration')).length<=1,'Automatic polling fanned out across configurations');
  }
}

await check('automatic polling backs off over 30 minutes without per-agent read fanout',async()=>{
  for(const route of ['#/agents','#/activity','#/setup/claude/exchange']){
    const r=await pollingRuntime(route),started=r.clock.now;
    await r.clock.advance(30*60000);
    assert.deepEqual(pollingRounds(r).map(call=>(call.at-started)/1000),[15,45,105,225,525,1425]);
    assertBoundedPolling(r);
    if(route.includes('/setup/'))assert.ok(r.calls.filter(call=>call.path.endsWith('/collaboration')).every(call=>call.path===collaborationPath));
    else{const fetched=new Map();for(const call of r.calls.filter(call=>call.path.endsWith('/collaboration'))){if(fetched.has(call.path))assert.ok(call.at-fetched.get(call.path)>=300000,'Fresh configurations should be reused for five minutes');fetched.set(call.path,call.at);}}
    if(route==='#/activity')assert.equal(r.calls.filter(call=>call.path==='/v1/conversations?limit=100').length,6);
  }
});

await check('automatic polling stays within 100 rounds in each rolling 24 hours',async()=>{
  const day=24*60*60000,r=await pollingRuntime('#/activity');
  await r.clock.advance(day);
  assert.ok(pollingRounds(r).length>90,'The poller stopped instead of continuing at the idle cadence');
  assert.ok(pollingRounds(r).length<=100);assert.ok(r.calls.length<=300);assertBoundedPolling(r);
  await r.clock.advance(day);
  const rounds=pollingRounds(r);assert.ok(rounds.length>100,'Polling did not resume as the rolling budget became available');
  for(const round of rounds)assert.ok(rounds.filter(other=>other.at<=round.at&&other.at>round.at-day).length<=100,'More than 100 rounds in a rolling day');
  assertBoundedPolling(r);
});

await check('429 Retry-After seconds and dates suspend automatic reads for the full 13 hours',async()=>{
  for(const headerType of ['seconds','date'])for(const endpoint of ['overview','configuration','activity']){
    let limited=false,blockedAt=null,blockedCalls=0,r;
    const path={overview:'/v1/admin/overview',configuration:collaborationPath,activity:'/v1/conversations?limit=100'}[endpoint];
    const normal={overview:{...overview,agents:[agent,...Array.from({length:5},(_,index)=>({...agent,id:'peer-'+index,name:'Peer '+index}))]},configuration:config,activity:{conversations:[]}}[endpoint];
    r=await pollingRuntime(endpoint==='configuration'?'#/setup/claude/exchange':'#/activity',{[path]:()=>{
      if(limited){limited=false;blockedAt=r.clock.now;blockedCalls=r.calls.length;return {__status:429,__headers:{'rEtRy-AfTeR':headerType==='seconds'?'46800':new Date(blockedAt+13*3600000).toUTCString()},__body:{error:{code:'rate_limited',message:'Read budget exhausted.'}}};}
      return normal;
    }});
    limited=true;await r.clock.advance(15000);assert.equal(blockedAt,r.clock.now);assert.equal(r.calls.length,blockedCalls,'An automatic round continued reading after 429');
    const count=r.calls.length,deadline=blockedAt+13*3600000;
    for(let i=0;i<40;i++){await r.context.window.dispatch('focus');r.doc.hidden=true;await r.doc.dispatch('visibilitychange');r.doc.hidden=false;await r.doc.dispatch('visibilitychange');}
    await r.clock.advance(deadline-r.clock.now-1);assert.equal(r.calls.length,count,'Automatic reads resumed before Retry-After');
    await r.clock.advance(15*60000+1);assert.ok(r.calls.length>count,'Automatic polling did not recover after Retry-After');
    assert.ok(r.calls.slice(count).every(call=>call.at>=deadline));assertBoundedPolling(r);
  }
});

await check('new-work POST quota errors do not pause dashboard reads or automatic polling',async()=>{
  for(const path of ['/v1/jobs','/v1/conversations']){
    const r=await pollingRuntime('#/activity',{[path]:{__status:429,__headers:{'Retry-After':'46800'},__body:{error:{code:'quota_exceeded',message:'New-work quota exhausted.'}}}});
    await assert.rejects(r.api.api(path,{method:'POST',body:{to:'peer-0',type:'task',...(path==='/v1/jobs'?{title:'Fixture task',goal:'Fixture only'}:{message:'Fixture only',response_requested:true})}}),error=>error.status===429&&error.code==='quota_exceeded');
    assert.equal(writes(r).length,1);
    const fresh=await r.api.api('/v1/admin/overview');assert.equal(fresh.agents.length,6);
    r.calls.length=0;await r.clock.advance(15000);
    assert.equal(pollingRounds(r).length,1);assert.ok(r.calls.some(call=>call.path==='/v1/conversations?limit=100'));
    assertBoundedPolling(r);assert.equal(writes(r).length,0);
  }
});

await check('focus and visibility storms are debounced and hidden tabs stop automatic polling',async()=>{
  const r=await pollingRuntime();
  r.doc.hidden=true;await r.doc.dispatch('visibilitychange');await r.clock.advance(61000);assert.equal(r.calls.length,0);
  const storm=async()=>{for(let i=0;i<80;i++){r.doc.hidden=false;await r.doc.dispatch('visibilitychange');await r.context.window.dispatch('focus');r.doc.hidden=true;await r.doc.dispatch('visibilitychange');}r.doc.hidden=false;await r.doc.dispatch('visibilitychange');await r.clock.advance(200);r.doc.hidden=true;await r.doc.dispatch('visibilitychange');};
  await storm();assert.equal(pollingRounds(r).length,1);
  await r.clock.advance(59000);await storm();assert.equal(pollingRounds(r).length,1);
  await r.clock.advance(1000);await storm();assert.equal(pollingRounds(r).length,2);
  assert.ok(pollingRounds(r)[1].at-pollingRounds(r)[0].at>=60000);assertBoundedPolling(r);
  await r.clock.advance(24*60*60000);assert.equal(pollingRounds(r).length,2);
});

await check('automatic setup evidence refresh preserves the mounted instruction draft',async()=>{
  let current=structuredClone(config);const r=await pollingRuntime('#/setup/claude/instructions',{[collaborationPath]:()=>current});
  const area=await editPrompt(r.doc.querySelector('#main'),'Private draft survives automatic evidence checks');
  current={...current,readiness:{...current.readiness,access:{verified:true,last_seen_at:now},peer_collaboration:{verified:true}}};
  await r.clock.advance(15000);
  assert.ok(promptArea(r.doc.querySelector('#main'))===area);assert.equal(area.value,'Private draft survives automatic evidence checks');
  assert.equal(r.api.readiness(agent).text,'Exchange verified');assertBoundedPolling(r);
  r.location.hash='#/setup/claude/exchange';await r.api.render();assert.equal(button(r.doc.querySelector('#main'),'Finish setup').disabled,false);
  r.location.hash='#/setup/claude/instructions';await r.api.render();assert.equal(promptArea(r.doc.querySelector('#main')).value,'Private draft survives automatic evidence checks');
});

await check('Check now honors its cooldown and works afterward without focus or remounting',async()=>{
  const r=await pollingRuntime();await r.clock.advance(30*60000);
  const checkNow=r.doc.querySelector('#refresh-now');assert.ok(checkNow);assert.equal(checkNow.disabled,false);
  let before=r.calls.length;await checkNow.click();assert.ok(r.calls.length>before);
  const sameControl=r.doc.querySelector('#refresh-now');before=r.calls.length;
  await sameControl.click();assert.equal(r.calls.length,before);assert.match(r.doc.querySelector('#toast').textContent,/recently|minute/i);
  await r.clock.advance(60000);assert.ok(r.doc.querySelector('#refresh-now')===sameControl);assert.equal(sameControl.disabled,false);
  await sameControl.click();assert.ok(r.calls.length>before);
});

await check('read pauses stay with the same verified identity and reset on account change or signout',async()=>{
  const original={user:{id:'owner-A',email:'original@example.test'},workspace:{id:'workspace-A'}};
  for(const mode of ['same','different-owner','different-workspace','signout']){
    const clock=mockClock(),r=runtime({'/v1/fixture-rate-limit':{__status:429,__headers:{'Retry-After':'46800'},__body:{error:{code:'rate_limited',message:'Read budget exhausted.'}}}},{clock,hosted:true});
    r.api.setSession(structuredClone(original));await r.api.openWorkspace();await clock.flush();
    await assert.rejects(r.api.api('/v1/fixture-rate-limit'),error=>error.status===429);const count=r.calls.length;
    if(mode==='signout')r.api.signOut();
    r.api.setSession({...original,user:{id:mode==='different-owner'?'owner-B':'owner-A',email:'changed@example.test'},workspace:{id:mode==='different-workspace'?'workspace-B':'workspace-A'}});
    if(mode==='same'){
      await assert.rejects(r.api.api('/v1/admin/overview'),error=>error.status===429);assert.equal(r.calls.length,count);
      await clock.advance(60*60000);assert.equal(r.calls.length,count);
    }else{
      await r.api.openWorkspace();await clock.flush();r.calls.length=0;
      await clock.advance(15000);assert.equal(pollingRounds(r).length,1,'A previous identity pause must not block the fresh polling cycle');
    }
  }
});

await check('each instruction profile saves only versioned instructions and persists across reload',async()=>{
  for(const profile of profileGuide.instructionProfiles){
    const initial=structuredClone(config);initial.version=7;initial.settings.initiative=false;initial.settings.permitted_collaborators=[];
    const server=savedConfiguration(initial),r=runtime(server.fixtures),nodes=await r.api.setupPage('claude','instructions');
    await chooseProfile(nodes,profile.id);
    assert.equal(promptArea(nodes).value,profile.prompt);
    await button(nodes,profile.id==='judgment'?'Copy':'Copy draft').click();
    assert.equal(r.copied.at(-1),profile.prompt);assert.equal(writes(r).length,0);
    await button(nodes,'Save instructions').click();
    assert.equal(writes(r).length,1);
    assert.deepEqual(JSON.parse(writes(r)[0].opts.body),{expected_version:7,instructions:{profile:profile.id,custom_prompt:null}});
    assert.equal(server.current.settings.initiative,false);assert.deepEqual(server.current.settings.permitted_collaborators,[]);
    assert.equal(query(nodes,'.instruction-state')[0].textContent,'Saved');
    assert.ok(button(nodes,'Copy'));
    r.location.hash='#/setup/claude/instructions';await r.api.render();
    assert.equal(selectedProfile(r.doc.querySelector('#main')),profile.id);
    const reloaded=runtime(server.fixtures),fresh=await reloaded.api.setupPage('claude','instructions');
    assert.equal(selectedProfile(fresh),profile.id);assert.equal(promptArea(fresh).value,profile.prompt);
    assert.equal(r.storage.size,0);assert.equal(reloaded.storage.size,0);
  }
});

await check('Finish saves the exact edited instructions before completing setup',async()=>{
  const server=savedConfiguration(),r=runtime(server.fixtures),nodes=await r.api.setupPage('claude','instructions');
  await chooseProfile(nodes,'offload');await editPrompt(nodes,'My durable instructions: return a concise reviewed draft.');
  assert.equal(query(nodes,'.instruction-state')[0].textContent,'Unsaved changes');
  await button(nodes,'Finish setup').click();
  assert.deepEqual(writes(r).map(call=>[call.path,call.opts.method]),[[collaborationPath,'PUT'],[onboardingPath,'PATCH']]);
  assert.deepEqual(JSON.parse(writes(r)[0].opts.body),{expected_version:0,instructions:{profile:'offload',custom_prompt:'My durable instructions: return a concise reviewed draft.'}});
  assert.deepEqual(JSON.parse(writes(r)[1].opts.body),{step:'done'});
  assert.equal(r.location.hash,'#/agents');
  const fresh=await runtime(server.fixtures).api.setupPage('claude','instructions');
  assert.equal(promptArea(fresh).value,'My durable instructions: return a concise reviewed draft.');
  assert.equal(r.storage.size,0);
});

await check('saved profile changes refresh the background guide before configuration is shown',async()=>{
  const server=savedConfiguration(),guidePath='/v1/admin/agents/claude/setup?surface=chat';
  const r=runtime({...server.fixtures,[guidePath]:()=>({guide:{...profileGuide,backgroundGuide:{title:'Profile-specific background',summary:'Saved profile: '+server.current.settings.instructions.profile,runPrompt:'SAVED '+server.current.settings.instructions.profile.toUpperCase()+' TASK BODY'}}})});
  const nodes=await r.api.setupPage('claude','instructions');await chooseProfile(nodes,'offload');await button(nodes,'Save instructions').click();
  const page=await r.api.configurationPage('claude');
  assert.match(content(page),/SAVED OFFLOAD TASK BODY/);assert.doesNotMatch(content(page),/SAVED DELEGATE TASK BODY/);
  assert.equal(r.calls.filter(call=>call.path===guidePath).length,2);
});

await check('instruction save freezes editing until the accepted response arrives',async()=>{
  let complete,started;
  const began=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{complete=resolve;});
  const r=runtime({[collaborationPath]:async opts=>{if(opts.method==='GET')return config;started();return pending;},'/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}});
  const nodes=await r.api.setupPage('claude','instructions');await editPrompt(nodes,'Accepted text A');
  const save=button(nodes,'Save instructions').click();await began;
  assert.equal(promptArea(nodes).disabled,true);
  assert.ok(query(nodes,'input').filter(node=>node.getAttribute('type')==='radio').every(node=>node.disabled));
  assert.equal(button(nodes,'Reset to generated instructions').disabled,true);
  const accepted=structuredClone(config);accepted.version=1;accepted.settings.instructions={profile:'judgment',custom_prompt:'Accepted text A'};
  complete(accepted);await save;
  assert.equal(promptArea(nodes).disabled,false);assert.equal(button(nodes,'Reset to generated instructions').disabled,false);
  assert.equal(promptArea(nodes).value,'Accepted text A');assert.equal(query(nodes,'.instruction-state')[0].textContent,'Saved');
});

await check('an earlier save response preserves newer drafts edited after navigating back',async()=>{
  for(const newerText of ['Draft B edited after navigation','Original saved instructions','Revert after acceptance']){
  let accept,started,saveCount=0,current=structuredClone(config);
  current.version=3;current.settings.instructions.custom_prompt='Original saved instructions';
  const began=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{accept=resolve;});
  const r=runtime({[collaborationPath]:async opts=>{
    if(opts.method==='GET')return current;
    const body=JSON.parse(opts.body);assert.equal(body.expected_version,current.version);
    if(++saveCount===1){started();await pending;}
    current={...current,version:current.version+1,settings:{...current.settings,instructions:body.instructions}};
    return current;
  },'/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}});
  const navigate=async hash=>{r.location.hash=hash;await r.api.render();return r.doc.querySelector('#main');};
  const first=await navigate('#/setup/claude/instructions');await editPrompt(first,'Draft A submitted');
  const firstSave=button(first,'Save instructions').click();await began;
  await navigate('#/agents');const second=await navigate('#/setup/claude/instructions');
  assert.equal(promptArea(second).disabled,false);assert.equal(promptArea(second).value,'Draft A submitted');
  await editPrompt(second,newerText==='Revert after acceptance'?'Draft before accepted response':newerText);
  await button(second,'Save instructions').click();assert.equal(writes(r).length,1);
  accept();await firstSave;
  const expectedText=newerText==='Revert after acceptance'?'Original saved instructions':newerText;
  if(newerText==='Revert after acceptance')await editPrompt(second,expectedText);
  assert.equal(current.settings.instructions.custom_prompt,'Draft A submitted');
  assert.equal(promptArea(second).value,expectedText);
  await navigate('#/agents');const third=await navigate('#/setup/claude/instructions');
  assert.equal(promptArea(third).value,expectedText);
  assert.equal(query(third,'.instruction-state')[0].textContent,'Unsaved changes');
  await button(third,'Save instructions').click();
  assert.deepEqual(writes(r).map(call=>JSON.parse(call.opts.body).expected_version),[3,4]);
  assert.equal(current.settings.instructions.custom_prompt,expectedText);
  assert.equal(query(third,'.instruction-state')[0].textContent,'Saved');assert.equal(r.storage.size,0);
  }
});

await check('late save completion after sign out cannot resurrect a newer private draft',async()=>{
  let accept,started,current=structuredClone(config);
  const began=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{accept=resolve;});
  const r=runtime({[collaborationPath]:async opts=>{
    if(opts.method==='GET')return current;
    const body=JSON.parse(opts.body);started();await pending;
    current={...current,version:current.version+1,settings:{...current.settings,instructions:body.instructions}};
    return current;
  },'/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}});
  r.api.setSession({workspace:{id:'private-workspace'}});
  const navigate=async hash=>{r.location.hash=hash;await r.api.render();return r.doc.querySelector('#main');};
  const first=await navigate('#/setup/claude/instructions');await editPrompt(first,'Draft A already submitted');
  const firstSave=button(first,'Save instructions').click();await began;
  await navigate('#/agents');const second=await navigate('#/setup/claude/instructions');
  await editPrompt(second,'Private B must clear on sign out');r.api.signOut();accept();await firstSave;
  assert.equal(r.doc.querySelector('#main').childNodes.length,0);assert.equal(r.doc.querySelector('#workspace').hidden,true);
  r.api.setSession({workspace:{id:'private-workspace'}});r.api.setState(overview,[['claude',current]]);
  const restored=await navigate('#/setup/claude/instructions');
  assert.equal(promptArea(restored).value,'Draft A already submitted');
  assert.equal(query(restored,'.instruction-state')[0].textContent,'Saved');
  assert.equal(writes(r).length,1);assert.equal(r.storage.size,0);
});

await check('prior-session save responses cannot replace a fresh same-workspace draft',async()=>{
  for(const status of [200,409]){
    let accept,started,current=structuredClone(config);
    const began=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{accept=resolve;});
    const r=runtime({[collaborationPath]:async opts=>{
      if(opts.method==='GET')return current;
      const body=JSON.parse(opts.body);started();await pending;
      if(status===409)return {__status:409,__body:{error:{code:'configuration_changed',message:'Old-session save conflicted.'}}};
      current={...current,version:current.version+1,settings:{...current.settings,instructions:body.instructions}};
      return current;
    },'/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}});
    const navigate=async hash=>{r.location.hash=hash;await r.api.render();return r.doc.querySelector('#main');};
    r.api.setSession({workspace:{id:'same-workspace'}});
    const first=await navigate('#/setup/claude/instructions');await editPrompt(first,'Old-session A');
    const oldSave=button(first,'Save instructions').click();await began;r.api.signOut();
    r.api.setSession({workspace:{id:'same-workspace'}});r.api.setState(overview,[['claude',current]]);
    const fresh=await navigate('#/setup/claude/instructions');await editPrompt(fresh,'Fresh-session B');
    accept();await oldSave;assert.equal(promptArea(fresh).value,'Fresh-session B');
    await navigate('#/agents');const restored=await navigate('#/setup/claude/instructions');
    assert.equal(promptArea(restored).value,'Fresh-session B');assert.equal(query(restored,'.instruction-state')[0].textContent,'Unsaved changes');
    assert.equal(writes(r).length,1);assert.equal(r.storage.size,0);
  }
});

await check('finishing an earlier step save does not navigate away from the user current page',async()=>{
  for(const action of ['Finish setup','Return to your agents']){
    let accept,started;
    const began=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{accept=resolve;});
    const r=runtime({[collaborationPath]:async opts=>{if(opts.method==='GET')return config;const body=JSON.parse(opts.body);started();await pending;return {...config,version:1,settings:{...settings,instructions:body.instructions}};},'/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}});
    r.location.hash='#/setup/claude/instructions';await r.api.render();const page=r.doc.querySelector('#main');await editPrompt(page,'Saved without stealing navigation');
    const saving=button(page,action).click();await began;r.location.hash='#/agents';await r.api.render();accept();await saving;
    assert.equal(r.location.hash,'#/agents');assert.equal(writes(r).length,1);assert.equal(writes(r)[0].path,collaborationPath);
    assert.equal(r.doc.querySelector('#main').querySelector('h1').textContent,'Your agents');
  }
});

await check('instruction conflicts keep the original draft version through re-render and explicit reload',async()=>{
  let current=structuredClone(config);current.version=3;
  const r=runtime({[collaborationPath]:opts=>opts.method==='PUT'?{__status:409,__body:{error:{code:'configuration_changed',message:'Changed elsewhere.'}}}:current,'/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}});
  let nodes=await r.api.setupPage('claude','instructions');await editPrompt(nodes,'Private conflicting draft');
  await button(nodes,'Finish setup').click();
  assert.equal(writes(r).length,1);assert.equal(r.location.hash,'#/agents');
  assert.match(content(nodes),/Your draft is kept here/);
  await button(nodes,'Copy draft').click();assert.equal(r.copied.at(-1),'Private conflicting draft');
  current=structuredClone(config);current.version=4;current.settings.instructions={profile:'second_opinion',custom_prompt:'Saved elsewhere'};
  nodes=await r.api.setupPage('claude','instructions');
  assert.equal(promptArea(nodes).value,'Private conflicting draft');assert.equal(selectedProfile(nodes),'judgment');
  await button(nodes,'Save instructions').click();
  assert.deepEqual(writes(r).map(call=>JSON.parse(call.opts.body).expected_version),[3,3]);
  assert.equal(r.storage.size,0);
  r.location.hash='#/setup/claude/instructions';r.context.confirm=()=>false;
  await button(nodes,'Reload saved instructions').click();assert.equal(promptArea(nodes).value,'Private conflicting draft');
  r.context.confirm=()=>true;await button(nodes,'Reload saved instructions').click();
  const restored=r.doc.querySelector('#main');assert.equal(promptArea(restored).value,'Saved elsewhere');assert.equal(selectedProfile(restored),'second_opinion');
});

await check('instruction drafts rebase other preference changes but retain genuine instruction conflicts',async()=>{
  for(const instructionChanged of [false,true]){
    let current=structuredClone(config);current.version=5;
    const r=runtime({[collaborationPath]:opts=>{
      if(opts.method==='GET')return current;
      const body=JSON.parse(opts.body);
      if(body.expected_version!==current.version)return {__status:409,__body:{error:{code:'configuration_changed',message:'Changed elsewhere.'}}};
      current={...current,version:current.version+1,settings:{...current.settings,instructions:body.instructions}};
      return current;
    },'/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}});
    let nodes=await r.api.setupPage('claude','instructions');await editPrompt(nodes,'My pending instruction draft');
    current={...current,version:6,settings:{...current.settings,purpose:'Description saved in another tab',...(instructionChanged?{instructions:{profile:'available',custom_prompt:'Instructions changed in another tab'}}:{})}};
    nodes=await r.api.setupPage('claude','instructions');assert.equal(promptArea(nodes).value,'My pending instruction draft');
    await button(nodes,'Save instructions').click();
    assert.equal(JSON.parse(writes(r)[0].opts.body).expected_version,instructionChanged?5:6);
    assert.equal(current.settings.purpose,'Description saved in another tab');
    if(instructionChanged){assert.match(content(nodes),/Your draft is kept here/);assert.equal(promptArea(nodes).value,'My pending instruction draft');assert.equal(current.settings.instructions.custom_prompt,'Instructions changed in another tab');}
    else{assert.equal(current.settings.instructions.custom_prompt,'My pending instruction draft');assert.equal(query(nodes,'.instruction-state')[0].textContent,'Saved');}
  }
});

await check('denied and storage-limited saves preserve drafts and prevent setup advancement',async()=>{
  for(const [status,code]of [[403,'forbidden'],[413,'storage_limit']]){
    const r=runtime({[collaborationPath]:opts=>opts.method==='PUT'?{__status:status,__body:{error:{code,message:'Instructions could not be saved.'}}}:config});
    let nodes=await r.api.setupPage('claude','instructions');await editPrompt(nodes,'Keep this after '+code);await button(nodes,'Finish setup').click();
    assert.equal(writes(r).length,1);assert.equal(writes(r)[0].path,collaborationPath);
    assert.match(content(nodes),/Instructions could not be saved/);
    nodes=await r.api.setupPage('claude','instructions');assert.equal(promptArea(nodes).value,'Keep this after '+code);
    assert.equal(query(nodes,'.instruction-state')[0].textContent,'Unsaved changes');assert.equal(r.storage.size,0);
  }
});

await check('private instruction drafts are scoped by workspace and agent and cleared on sign out',async()=>{
  const r=runtime(),other={...agent,id:'other'};
  r.api.setSession({workspace:{id:'A'}});
  let editor=r.api.instructionEditor(agent,config,profileGuide);await editPrompt(editor.node,'Workspace A private draft');
  assert.notEqual(promptArea(r.api.instructionEditor(other,config,profileGuide).node).value,'Workspace A private draft');
  r.api.setSession({workspace:{id:'B'}});assert.notEqual(promptArea(r.api.instructionEditor(agent,config,profileGuide).node).value,'Workspace A private draft');
  r.api.setSession({workspace:{id:'A'}});assert.equal(promptArea(r.api.instructionEditor(agent,config,profileGuide).node).value,'Workspace A private draft');
  assert.equal(r.storage.size,0);r.api.signOut();r.api.setSession({workspace:{id:'A'}});
  assert.equal(promptArea(r.api.instructionEditor(agent,config,profileGuide).node).value,profileGuide.instructionProfiles[0].prompt);
});

await check('profile changes and reset preserve edited text until an explicit inline replacement',async()=>{
  const r=runtime(),{node}=r.api.instructionEditor(agent,config,profileGuide);
  r.context.confirm=()=>{assert.fail('Instruction replacement must use the inline choice, not a native dialog.');};
  const reset=button(node,'Reset to generated instructions');
  assert.equal(reset.hidden,true);assert.equal(reset.parentNode,node.querySelector('.instruction-preview'));
  assert.ok(button(node,'Save instructions').className.split(' ').includes('quiet'));
  await editPrompt(node,'Edited text to preserve');
  assert.equal(reset.hidden,false);
  await chooseProfile(node,'second_opinion');assert.equal(selectedProfile(node),'judgment');assert.equal(promptArea(node).value,'Edited text to preserve');
  await button(node,'Save instructions').click();assert.equal(writes(r).length,0);assert.equal(promptArea(node).value,'Edited text to preserve');
  await button(node,'Keep my text').click();assert.equal(selectedProfile(node),'judgment');assert.equal(promptArea(node).value,'Edited text to preserve');
  await chooseProfile(node,'second_opinion');await button(node,'Use selected starter').click();assert.equal(selectedProfile(node),'second_opinion');
  assert.equal(promptArea(node).value,profileGuide.instructionProfiles.find(profile=>profile.id==='second_opinion').prompt);
  await editPrompt(node,'Another private draft');
  await button(node,'Reset to generated instructions').click();assert.equal(promptArea(node).value,'Another private draft');
  await button(node,'Keep my text').click();assert.equal(promptArea(node).value,'Another private draft');
  await button(node,'Reset to generated instructions').click();await button(node,'Use selected starter').click();
  assert.equal(promptArea(node).value,profileGuide.instructionProfiles.find(profile=>profile.id==='second_opinion').prompt);assert.equal(reset.hidden,true);assert.equal(writes(r).length,0);
});

await check('clipboard failure reveals and selects the complete introduction without saving the editable draft',async()=>{
  const r=runtime(),{node}=r.api.instructionEditor(agent,config,profileGuide);
  await editPrompt(node,'Copy this exact private draft');r.context.navigator.clipboard.writeText=async()=>{throw new Error('Unavailable');};
  await button(node,'Copy draft').click();
  const area=promptArea(node),manual=node.querySelector('.manual-introduction');
  assert.equal(r.doc.activeElement,manual);assert.equal(manual.selected,true);assert.equal(manual.value,'Copy this exact private draft');
  assert.notEqual(manual.getAttribute('readonly'),null);assert.equal(area.value,'Copy this exact private draft');
  assert.equal(area.style.height,'240px');assert.equal(writes(r).length,0);assert.equal(r.storage.size,0);
});

await check('one shared resize handler regrows only current expanded instruction previews',async()=>{
  const r=runtime(),main=r.doc.querySelector('#main'),first=r.api.instructionEditor(agent,config,profileGuide,{paired:true}).node;
  main.replaceChildren(first);
  const preview=first.querySelector('.instruction-preview'),area=promptArea(first);
  preview.open=true;await preview.dispatch('toggle');assert.equal(area.style.height,'240px');
  area.scrollHeight=480;await r.context.window.dispatch('resize');assert.equal(area.style.height,'480px');
  preview.open=false;area.scrollHeight=640;await r.context.window.dispatch('resize');assert.equal(area.style.height,'480px');
  const second=r.api.instructionEditor(agent,config,profileGuide).node;main.replaceChildren(second);
  preview.open=true;area.scrollHeight=960;
  const currentPreview=second.querySelector('.instruction-preview'),currentArea=promptArea(second);
  assert.equal(currentPreview.tagName,'DIV');currentArea.scrollHeight=720;await r.context.window.dispatch('resize');
  assert.equal(currentArea.style.height,'720px');assert.equal(area.style.height,'480px');assert.equal(first.isConnected,false);
  assert.equal(r.context.window.events.resize.length,1);assert.equal(writes(r).length,0);
});

await check('legacy guides retain their supplied tools and background fallback without assuming beta',async()=>{
  const legacy={steps:[{title:'Legacy connection',text:'Use the existing installation.',copy:'https://legacy.example.test/mcp'}],recovery:['Reconnect the existing authorization.'],prompts:[{copy:'Use send_job, check_inbox, get_job and acknowledge_results.'}],backgroundPrompt:'Legacy runner: check_inbox once and stop.'};
  const legacyConfig=structuredClone(config);legacyConfig.release={enabled:false};delete legacyConfig.settings.instructions;
  const r=runtime({[collaborationPath]:legacyConfig,'/v1/admin/agents/claude/setup?surface=chat':{guide:legacy}});
  const connect=await r.api.setupPage('claude','connect');assert.match(content(connect),/Legacy connection/);assert.match(content(connect),/Reconnect the existing authorization/);
  const instructions=await r.api.setupPage('claude','instructions');assert.equal(selectedProfile(instructions),'judgment');
  assert.ok(promptArea(instructions).value.endsWith(legacy.prompts[0].copy));
  assert.doesNotMatch(promptArea(instructions).value,/send_message|get_collaboration_config|check_conversation_inbox|acknowledge_conversation/);
  const background=r.api.backgroundGuideSection(agent,legacyConfig,legacy);await button(background,'Copy').click();
  assert.equal(r.copied.at(-1),legacy.backgroundPrompt);assert.equal(writes(r).length,0);
});

await check('peer prompts copy exact identities and return protocol without dispatching work',async()=>{
  const c=structuredClone(config);c.roster=[{id:'claude',name:'Self',work_categories:['task']},{id:'unavailable',name:'No shared work',last_seen_at:now,work_categories:[]},{id:'cold',name:'Not contacted',last_seen_at:null,work_categories:['task']},{id:'builder',name:'Build only',last_seen_at:now,work_categories:['build']},{id:'reviewer',name:'Reviewer',last_seen_at:now,work_categories:['review']},{id:'worker',name:'Worker',last_seen_at:now,work_categories:['task']}];
  const r=runtime({[collaborationPath]:c}),nodes=await r.api.setupPage('claude','exchange'),peer=query(nodes,'.peer-exchange')[0];
  const select=peer.querySelector('select');assert.deepEqual(select.children.map(node=>node.value),['reviewer','worker']);
  await button(peer,'Copy').click();const prompt=r.copied.at(-1);
  for(const expected of ['Claude (claude)','Reviewer (reviewer)','work category review','request.id','conversation.id','conversation_id','next_cursor','THIS originating conversation','call acknowledge_conversation','cursor set to the page’s next_cursor','only after reading','hitchhike-claude-interactive','check_conversation_inbox with limit=3','sent, answered, and retrieved timestamps','Do not create acknowledgment messages or a schedule','Retry-After'])assert.ok(prompt.includes(expected),expected);
  select.value='worker';await select.dispatch('change');await button(peer,'Copy').click();assert.match(r.copied.at(-1),/Worker \(worker\), work category task/);
  assert.equal(writes(r).length,0);assert.equal(r.storage.size,0);
});

await check('legacy peer prompts use legacy send and retrieval tools only',async()=>{
  const c=structuredClone(config);c.release={enabled:false};c.roster=[{id:'reviewer',name:'Reviewer',last_seen_at:now,work_categories:['task']}];
  const r=runtime(),node=r.api.peerExchange(agent,c);await button(node,'Copy').click();
  const prompt=r.copied.at(-1);for(const tool of ['send_job','get_next_job','submit_result','check_inbox (limit: 3) and get_job','acknowledge_results','delivery_cursor'])assert.ok(prompt.includes(tool),tool);
  assert.match(prompt,/task=/);assert.doesNotMatch(prompt,/goal=/);
  assert.doesNotMatch(prompt,/send_message|get_collaboration_config|check_conversation_inbox|acknowledge_conversation/);assert.equal(writes(r).length,0);
});

await check('routine peer prompts use authenticated HTTP with the permitted category and stable retry key',async()=>{
  const bot={...agent,id:'bot',name:'Grok Bot',platform:'grok-bot',connects:'routine'},c=structuredClone(config);
  c.agent_id='bot';c.roster=[{id:'reviewer',name:'Reviewer',last_seen_at:now,work_categories:['review']},{id:'worker',name:'Worker',last_seen_at:now,work_categories:['task']}];
  const r=runtime(),node=r.api.peerExchange(bot,c);await button(node,'Copy').click();const prompt=r.copied.at(-1);
  for(const expected of ['Grok Bot (bot)','Reviewer (reviewer)','GET /v1/me','GET /v1/configuration','POST /v1/conversations','GET /v1/conversations/inbox?consumer_id=hitchhike-bot-interactive&limit=3','GET /v1/conversations/:id?after=0&limit=20','POST /v1/conversations/:id/acknowledge','next_cursor','Idempotency-Key'])assert.ok(prompt.includes(expected),expected);
  assert.match(prompt,/"to"\s*:\s*"reviewer"/);assert.match(prompt,/"type"\s*:\s*"review"/);assert.match(prompt,/"response_requested"\s*:\s*true/);
  assert.match(prompt,/"consumer_id"\s*:\s*"hitchhike-bot-interactive"/);assert.match(prompt,/"cursor"\s*:/);
  assert.match(prompt,/bearer credential/i);assert.match(prompt,/Reuse this exact key and body only for retries/);
  const key=prompt.match(/Idempotency-Key: (peer-check-[\w-]+)/)?.[1];assert.ok(key);
  await button(node,'Copied').click();assert.equal(r.copied.at(-1),prompt);
  const select=node.querySelector('select');select.value='worker';await select.dispatch('change');await button(node,'Copy').click();
  assert.notEqual(r.copied.at(-1).match(/Idempotency-Key: (peer-check-[\w-]+)/)?.[1],key);
  select.value='reviewer';await select.dispatch('change');await button(node,'Copy').click();
  assert.equal(r.copied.at(-1).match(/Idempotency-Key: (peer-check-[\w-]+)/)?.[1],key);
  assert.doesNotMatch(prompt,/connection_status|get_collaboration_config|send_message|check_conversation_inbox|acknowledge_conversation|send_job/);
  assert.equal(writes(r).length,0);assert.equal(r.storage.size,0);
});

await check('legacy routine peer prompts use job HTTP and delivery cursors without beta tools',async()=>{
  const bot={...agent,id:'bot',name:'Grok Bot',platform:'grok-bot',connects:'routine'},c=structuredClone(config);
  c.agent_id='bot';c.release={enabled:false};c.roster=[{id:'reviewer',name:'Reviewer',last_seen_at:now,work_categories:['review']}];
  const r=runtime(),node=r.api.peerExchange(bot,c);await button(node,'Copy').click();const prompt=r.copied.at(-1);
  for(const expected of ['GET /v1/me','POST /v1/jobs','GET /v1/jobs/:id?full=1','GET /v1/inbox?limit=3','GET /v1/inbox?cursor=<next_cursor>&limit=3','POST /v1/inbox/ack','delivery_cursor','Idempotency-Key'])assert.ok(prompt.includes(expected),expected);
  assert.match(prompt,/"to"\s*:\s*"reviewer"/);assert.match(prompt,/"type"\s*:\s*"review"/);
  assert.match(prompt,/bearer credential/i);assert.match(prompt,/Reuse this exact key and body only for retries/);
  assert.match(prompt,/Idempotency-Key: peer-check-[\w-]+/);
  assert.doesNotMatch(prompt,/\/v1\/conversations|\/v1\/configuration|\/collaboration|connection_status|send_job|get_next_job|submit_result|check_inbox|acknowledge_results/);
  assert.equal(writes(r).length,0);
});

await check('missing eligible peers and denied sending offer recovery without a dispatch prompt',()=>{
  const r=runtime(),empty=r.api.peerExchange(agent,config);assert.match(empty.textContent,/No contacted collaborator is eligible/);
  assert.equal(empty.querySelector('a').getAttribute('href'),'#/agents');assert.equal(empty.querySelectorAll('pre').length,0);
  const c=structuredClone(config);c.roster=[{id:'worker',name:'Worker',last_seen_at:now,work_categories:['task']}];
  const denied=r.api.peerExchange({...agent,can_request:false},c);assert.match(denied.textContent,/cannot send requests/);
  assert.equal(denied.querySelector('a').getAttribute('href'),'#/agents/claude');assert.equal(denied.querySelectorAll('pre').length,0);
  assert.equal(writes(r).length,0);
});

await check('website marker completion remains distinct from peer and background readiness',async()=>{
  const c=structuredClone(config);c.readiness.access.verified=true;c.readiness.collaboration.verified=true;
  const marker={id:'marker',to:'claude',status:'completed',inputs:{connection_test:true,expected_response:'EXPECTED'},result:{summary:'EXPECTED',validation:{ok:true}},retrieved_at:now};
  const r=runtime({[collaborationPath]:c});r.api.setState({...overview,jobs:[marker]},[['claude',c]]);
  const nodes=await r.api.setupPage('claude','exchange');assert.equal(r.api.testVerified(marker),true);
  assert.match(content(nodes),/Website-to-agent connection test/);assert.match(content(nodes),/does not prove a peer exchange or background execution/);
  assert.equal(button(nodes,'Finish setup').disabled,false);assert.equal(r.api.readiness(agent).text,'Access confirmed');
  assert.equal(writes(r).length,0);
});

const chatBackground={title:'Claude chat scheduled task',summary:'Use a supported hourly Claude chat task.',where:'Claude chat → Scheduled tasks',intervalLabel:'Hourly, plus provider delay.',setupPrompt:'SETUP CHAT TASK: Create or reuse an hourly scheduled task.',runPrompt:'SAVED CHAT TASK BODY: Confirm identity, process at most three requests, then stop.',recovery:['Verify Hitchhike tool access in an actual scheduled run.']};
await check('background recovery offers one manual task body without changing evidence',async()=>{
  const r=runtime(),g={...guide,backgroundGuide:chatBackground},node=r.api.backgroundGuideSection(agent,config,g),boxes=node.querySelectorAll('.copybox');
  assert.equal(boxes.length,1);assert.match(boxes[0].textContent,/Task instructions.*manual schedule setup/);
  await button(boxes[0],'Copy').click();assert.deepEqual(r.copied,[chatBackground.runPrompt]);
  assert.doesNotMatch(node.textContent,/SETUP CHAT TASK/);
  assert.match(node.textContent,/Claude chat → Scheduled tasks/);assert.match(node.textContent,/Hourly, plus provider delay/);
  assert.equal(writes(r).length,0);assert.equal(r.api.setupReady(config),false);
});

await check('Claude chat configuration keeps hourly tasks separate from Code cloud activation',async()=>{
  const r=runtime({'/v1/admin/agents/claude/setup?surface=chat':{guide:{...guide,backgroundGuide:chatBackground}}}),nodes=await r.api.configurationPage('claude');
  assert.match(content(nodes),/Claude chat scheduled task/);assert.doesNotMatch(content(nodes),/Claude Code routine adapter|Routine API URL|Scoped routine token/);
  assert.equal(r.calls.some(call=>call.path.endsWith('surface=cloud')),false);
  assert.equal(r.calls.some(call=>call.path.endsWith('/activation')&&call.opts.method!=='GET'),false);
  assert.equal(query(nodes,'option').some(node=>node.value==='claude_routine'),false);assert.equal(writes(r).length,0);
  for(const surface of ['terminal','cloud']){
    const c=structuredClone(config);c.onboarding={provider:'claude-code',surface,step:'connect'};
    const code={...agent,platform:'claude-code',platform_label:'Claude Code'},data={...overview,agents:[code]};
    const codeGuide={...guide,surface,backgroundGuide:{...chatBackground,title:'Code '+surface},routinePrompt:'Directed API payload: keep the current request and fresh execution owner.'};
    const other=runtime({[collaborationPath]:c,['/v1/admin/agents/claude/setup?surface='+surface]:{guide:codeGuide}});other.api.setState(data,[['claude',c]]);
    const page=await other.api.configurationPage('claude');
    assert.equal(content(page).includes('Routine API URL'),surface==='cloud');
    if(surface==='cloud'){assert.match(content(page),/Directed API payload/);assert.ok(query(page,'option').some(node=>node.value==='claude_routine'));}
    assert.equal(writes(other).length,0);
  }
});

await check('polling updates observed evidence without gating Finish or replacing the introduction',async()=>{
  let current=structuredClone(config);const r=runtime({[collaborationPath]:()=>current});r.location.hash='#/setup/claude/exchange';
  const nodes=await r.api.setupPage('claude','exchange');r.doc.querySelector('#main').replaceChildren(...nodes);
  const finish=r.doc.querySelector('#finish-setup'),old=r.doc.querySelector('#setup-evidence'),introduction=promptArea(nodes);assert.equal(finish.disabled,false);
  current.readiness.access.verified=true;current.readiness.peer_collaboration.verified=true;await r.api.fetchOverview();r.api.updateSetupEvidence('claude');
  assert.equal(finish.disabled,false);assert.equal(r.doc.querySelector('#finish-requirement'),null);assert.equal(promptArea(nodes),introduction);
  assert.equal(old.isConnected,false);assert.match(r.doc.querySelector('#setup-evidence').textContent,/two distinct connections was answered and retrieved/);
  current.readiness.peer_collaboration.verified=false;await r.api.fetchOverview();r.api.updateSetupEvidence('claude');
  assert.equal(finish.disabled,false);assert.equal(promptArea(nodes),introduction);assert.match(r.doc.querySelector('#setup-evidence').textContent,/No completed and retrieved peer exchange yet/);assert.equal(writes(r).length,0);
});

await check('server rejection of Finish keeps the setup visible and reports the failed progress save',async()=>{
  const c=structuredClone(config);c.readiness.access.verified=true;c.readiness.peer_collaboration.verified=true;
  const r=runtime({[collaborationPath]:c,[onboardingPath]:{__status:403,__body:{error:{code:'owner_required',message:'Your current session cannot save setup progress.'}}}});r.location.hash='#/setup/claude/exchange';
  const nodes=await r.api.setupPage('claude','exchange');await button(nodes,'Finish setup').click();
  assert.equal(r.location.hash,'#/setup/claude/exchange');assert.match(content(nodes),/Your current session cannot save setup progress/);
  assert.deepEqual(JSON.parse(writes(r)[0].opts.body),{step:'done'});
});

await check('Return preserves Ready progress and saves an edited prompt before leaving either route alias',async()=>{
  for(const step of ['instructions','exchange']){
    const server=savedConfiguration(),r=runtime(server.fixtures),nodes=await r.api.setupPage('claude',step);
    if(step==='instructions')await editPrompt(nodes,'Draft saved before leaving setup.');
    await button(nodes,'Return to your agents').click();
    const progress=writes(r).filter(call=>call.path===onboardingPath);assert.equal(progress.length,1);assert.deepEqual(JSON.parse(progress[0].opts.body),{step:'exchange'});
    if(step==='instructions'){assert.equal(writes(r)[0].path,collaborationPath);assert.equal(server.current.settings.instructions.custom_prompt,'Draft saved before leaving setup.');}
    assert.equal(server.current.onboarding.step,'exchange');assert.equal(r.location.hash,'#/agents');assert.equal(r.api.setupReady(server.current),false);
  }
});

await check('MCP setup has one working prompt with the connection check and compatible older routes',async()=>{
  const server=savedConfiguration(),completeGuide=structuredClone(profileGuide);
  completeGuide.surfaces[0].steps.push({title:'Confirm access',text:'Old separate check',copy:guide.accessPrompt});
  const r=runtime({...server.fixtures,'/v1/admin/agents/claude/setup?surface=chat':{guide:completeGuide}});
  let nodes=await r.api.setupPage('claude','connect');
  assert.deepEqual(query(nodes,'.steps')[0].querySelectorAll('li').map(node=>node.textContent),['1Connect','2Ready']);
  assert.doesNotMatch(content(nodes),/Old separate check/);assert.equal(query(nodes,'.instruction-editor').length,0);
  await button(nodes,'Continue').click();assert.deepEqual(JSON.parse(writes(r)[0].opts.body),{step:'exchange'});
  nodes=await r.api.setupPage('claude','instructions');assert.equal(query(nodes,'.instruction-copy').length,1);
  assert.match(promptArea(nodes).value,/connection_status identifies claude/);assert.match(content(nodes),/Paste this introduction/);
  const diagnostics=query(nodes,'.setup-diagnostics')[0];assert.equal(diagnostics.open,false);assert.equal(diagnostics.querySelectorAll('.copybox').length,1,'the separate identity check remains optional troubleshooting');
  assert.equal(query(nodes,'.background-guide').length,0);assert.equal(query(nodes,'.instruction-preview')[0].tagName,'DIV');
  const access=await r.api.setupPage('claude','access');assert.equal(query(access,'h1')[0].textContent,'Ready when you are');assert.equal(query(access,'.instruction-copy').length,1);
  const choose=await r.api.setupPage('claude','choose');assert.equal(query(choose,'h1')[0].textContent,'Connect Claude');assert.equal(query(choose,'.instruction-editor').length,0);
});

await check('routine setup goes directly to Ready with only optional saved preferences on Connect',async()=>{
  const routine={...agent,name:'Grok Bot',platform:'grok-bot',connects:'routine'},data={...overview,agents:[routine]},server=savedConfiguration();
  const r=runtime(server.fixtures,{hosted:true});r.api.setState(data,[['claude',server.current]]);
  const nodes=await r.api.setupPage('claude','connect'),preferences=query(nodes,'.pairing-preferences')[0];
  assert.equal(preferences.open,false);assert.match(preferences.querySelector('summary').textContent,/optional/);
  assert.deepEqual(query(nodes,'.steps')[0].querySelectorAll('li').map(node=>node.textContent),['1Connect','2Ready']);
  assert.equal(query(preferences,'.instruction-copy').length,0);assert.equal(query(preferences,'button').some(node=>['Copy','Copy draft'].includes(node.textContent)),false);
  assert.equal(writes(r).length,0);await button(nodes,'Continue').click();
  assert.deepEqual(writes(r).map(call=>[call.path,JSON.parse(call.opts.body)]),[[onboardingPath,{step:'exchange'}]]);
  assert.equal(r.location.hash,'#/setup/claude/exchange');
  const oldInstructions=await r.api.setupPage('claude','instructions');assert.equal(query(oldInstructions,'h1')[0].textContent,'Ready when you are');assert.equal(query(oldInstructions,'.instruction-editor').length,0);
  const oldAccess=await r.api.setupPage('claude','access');assert.equal(query(oldAccess,'h1')[0].textContent,'Ready when you are');assert.equal(query(oldAccess,'.instruction-editor').length,0);
});

await check('routine pairing saves changed preferences first and never pairs after a failed save',async()=>{
  for(const failSave of [false,true]){
    const routine={...agent,name:'Grok Bot',platform:'grok-bot',connects:'routine'},data={...overview,agents:[routine]},server=savedConfiguration(),pairPath='/v1/admin/agents/claude/pairing';
    const fixtures={...server.fixtures,[pairPath]:()=>{assert.equal(server.current.settings.instructions.custom_prompt,'Only accept reviewed research tasks.');return {instructions:'PRIVATE ONE-USE PAIRING INSTRUCTION',expires_at:new Date(Date.now()+60000).toISOString()};}};
    if(failSave)fixtures[collaborationPath]=opts=>opts.method==='PUT'?{__status:409,__body:{error:{code:'configuration_changed',message:'Changed elsewhere.'}}}:server.current;
    const r=runtime(fixtures,{hosted:true});r.api.setState(data,[['claude',server.current]]);
    const nodes=await r.api.setupPage('claude','connect'),preferences=query(nodes,'.pairing-preferences')[0];preferences.open=true;
    await chooseProfile(preferences,'available');await editPrompt(preferences,'Only accept reviewed research tasks.');
    await button(nodes,'Create pairing instructions').click();
    assert.deepEqual(writes(r).map(call=>call.path),failSave?[collaborationPath]:[collaborationPath,pairPath]);
    assert.deepEqual(JSON.parse(writes(r)[0].opts.body),{expected_version:0,instructions:{profile:'available',custom_prompt:'Only accept reviewed research tasks.'}});
    if(failSave){assert.doesNotMatch(content(nodes),/PRIVATE ONE-USE/);assert.match(content(nodes),/Your draft is kept here/);assert.equal(promptArea(preferences).value,'Only accept reviewed research tasks.');}
    else assert.match(content(nodes),/PRIVATE ONE-USE PAIRING INSTRUCTION/);
    assert.equal(r.storage.size,0);
  }
});

await check('routine pairing without edited preferences performs only the explicit pairing request',async()=>{
  const routine={...agent,platform:'grok-bot',connects:'routine'},pairPath='/v1/admin/agents/claude/pairing';
  const r=runtime({[pairPath]:{instructions:'ONE-USE PAIR',expires_at:new Date(Date.now()+60000).toISOString()}},{hosted:true});r.api.setState({...overview,agents:[routine]},[['claude',config]]);
  const nodes=await r.api.setupPage('claude','connect');assert.equal(writes(r).length,0);
  await button(nodes,'Create pairing instructions').click();assert.deepEqual(writes(r).map(call=>call.path),[pairPath]);
});

await check('Ready keeps diagnostics optional and returning does not mark setup done',async()=>{
  const server=savedConfiguration(),r=runtime(server.fixtures),nodes=await r.api.setupPage('claude','exchange');
  const diagnostics=query(nodes,'.setup-diagnostics')[0],evidence=query(nodes,'#setup-evidence')[0];
  assert.equal(diagnostics.open,false);assert.equal(evidence.querySelectorAll('.milestone').length,2);assert.equal(evidence.parentNode,diagnostics);
  assert.ok(diagnostics.querySelector('.peer-exchange'));assert.ok(button(diagnostics,'Send website connection test'));
  assert.equal(query(nodes,'.background-guide').length,0);assert.match(content(nodes),/Background checks are not verified yet/);
  assert.equal(button(nodes,'Finish setup').disabled,false);assert.equal(writes(r).length,0);
  await button(nodes,'Return to your agents').click();assert.deepEqual(JSON.parse(writes(r)[0].opts.body),{step:'exchange'});
  assert.equal(r.location.hash,'#/agents');assert.equal(server.current.onboarding.step,'exchange');assert.equal(r.api.setupReady(server.current),false);
  assert.doesNotMatch(content(r.api.agentsPage()),/Continue connecting Claude|Continue setup/);
});

await check('completed onboarding remains complete after peer evidence expires and its route opens Ready',async()=>{
  const c=structuredClone(config);c.onboarding.step='done';c.readiness.access.verified=true;
  const r=runtime({[collaborationPath]:c});r.api.setState(overview,[['claude',c]]);
  assert.equal(r.api.setupReady(c),false);assert.equal(r.api.readiness(agent).text,'Set up');assert.equal(r.api.readiness(agent).detail,'No recent peer exchange on record');
  assert.doesNotMatch(content(r.api.agentsPage()),/Continue connecting Claude|Continue setup/);
  const nodes=await r.api.setupPage('claude','done');assert.equal(query(nodes,'h1')[0].textContent,'Ready when you are');
  assert.equal(query(nodes,'.instruction-editor').length,1);assert.equal(writes(r).length,0);
  assert.equal(query(nodes,'button').some(node=>node.textContent==='Finish setup'),false);
  await button(nodes,'Return to your agents').click();assert.equal(writes(r).length,0);
  assert.equal(query(nodes,'.steps')[0].querySelectorAll('li').find(node=>node.getAttribute('aria-current')==='step').textContent,'2Ready');
});

await check('configuration and recovery controls remain usable when its setup guide returns 409',async()=>{
  const r=runtime({'/v1/admin/agents/claude/setup?surface=chat':{__status:409,__body:{error:{code:'setup_unavailable',message:'Connection instructions need refreshed authorization.'}}}});
  const nodes=await r.api.configurationPage('claude');
  assert.ok(query(nodes,'form').length);assert.ok(button(nodes,'Save preferences'));assert.ok(button(nodes,'Replace credentials'));assert.ok(button(nodes,'Disconnect agent'));
  assert.ok(r.calls.some(call=>call.path==='/v1/admin/agents/claude/setup?surface=chat'));assert.equal(writes(r).length,0);
});

await check('an existing routine can be disabled and removed outside Code cloud without exposing new setup',async()=>{
  for(const [platform,surface]of [['claude','chat'],['claude-code','terminal']]){
    const a={...agent,platform},c=structuredClone(config),activationPath='/v1/agents/claude/activation';
    c.onboarding={...c.onboarding,provider:platform,surface};c.settings.background.method='claude_routine';
    let activation={configured:true,enabled:true,routine_hint:'existing-routine',latest_dispatch:{status:'pending'}};
    const r=runtime({[collaborationPath]:c,['/v1/admin/agents/claude/setup?surface='+surface]:{guide:{...guide,routinePrompt:'CLOUD SETUP MUST STAY HIDDEN'}},[activationPath]:opts=>{if(opts.method==='DELETE'){activation={configured:false,enabled:false};return {ok:true};}return {activation};}});
    r.api.setState({...overview,agents:[a]},[['claude',c]]);const nodes=await r.api.configurationPage('claude');
    assert.doesNotMatch(content(nodes),/Routine API URL|Scoped routine token|Save routine connection|CLOUD SETUP MUST STAY HIDDEN/);
    assert.equal(query(nodes,'input').some(node=>node.getAttribute('type')==='password'),false);
    assert.equal(r.calls.some(call=>call.path.endsWith('surface=cloud')),false);assert.equal(writes(r).length,0);
    await button(nodes,'Disable and remove saved routine credentials').click();
    assert.deepEqual(writes(r).map(call=>[call.path,call.opts.method]),[[activationPath,'DELETE']]);
    assert.equal(activation.enabled,false);assert.equal(activation.configured,false);
  }
});

await check('off-page private drafts do not freeze Agents or Activity refreshes',async()=>{
  let currentOverview=structuredClone(overview),conversations=[];
  const r=runtime({'/v1/admin/overview':()=>currentOverview,'/v1/conversations?limit=100':()=>({conversations})});
  const instruction=r.api.instructionEditor(agent,config,profileGuide).node;await editPrompt(instruction,'Keep this off-page draft');
  const context=r.api.sharedContext({id:'draft-context',pinned_context:'Saved context',context_version:0});
  context.querySelector('textarea').value='Keep this off-page context';await context.querySelector('textarea').dispatch('input');
  r.location.hash='#/agents';await r.api.render();currentOverview={...currentOverview,agents:[{...agent,name:'Freshly renamed assistant'}]};
  await r.api.refresh();assert.match(r.doc.querySelector('#main').textContent,/Freshly renamed assistant/);
  r.location.hash='#/activity';await r.api.render();
  conversations=[{id:'fresh-conversation',title:'Fresh activity after polling',participants:['owner','claude'],last_message_at:now,outstanding_requests:0,requests_used:1,request_limit:10,retention_days:30,expires_at:now,latest_request:{status:'completed'}}];
  await r.api.refresh();assert.match(r.doc.querySelector('#main').textContent,/Fresh activity after polling/);
  assert.equal(promptArea(r.api.instructionEditor(agent,config,profileGuide).node).value,'Keep this off-page draft');
  assert.equal(r.api.sharedContext({id:'draft-context',pinned_context:'Saved context',context_version:0}).querySelector('textarea').value,'Keep this off-page context');
  assert.equal(writes(r).length,0);
});

await check('refresh preserves the actively edited configuration form',async()=>{
  let currentOverview=structuredClone(overview);
  const r=runtime({'/v1/admin/overview':()=>currentOverview});r.location.hash='#/agents/claude';await r.api.render();
  const form=r.doc.querySelector('#main').querySelector('form'),name=form.querySelectorAll('input').find(node=>node.value==='Claude');
  name.value='Unsaved connection name';await form.dispatch('input');currentOverview={...currentOverview,agents:[{...agent,name:'Different saved name'}]};
  await r.api.refresh();assert.ok(r.doc.querySelector('#main').querySelector('form')===form,'Refresh must preserve the mounted configuration form');assert.equal(name.value,'Unsaved connection name');
});

await check('disconnect clears only that agent instruction draft',async()=>{
  const other={...agent,id:'other',name:'Other assistant'},otherConfig={...structuredClone(config),agent_id:'other'};
  let data={...overview,agents:[agent,other]};
  const r=runtime({'/v1/admin/overview':()=>data,'/v1/agents/other/collaboration':otherConfig,'/v1/admin/agents/claude':()=>{data={...data,agents:[other]};return {ok:true};}});
  r.api.setState(data,[['claude',config],['other',otherConfig]]);
  await editPrompt(r.api.instructionEditor(agent,config,profileGuide).node,'Discard disconnected assistant draft');
  await editPrompt(r.api.instructionEditor(other,otherConfig,profileGuide).node,'Preserve other assistant draft');
  const nodes=await r.api.configurationPage('claude');await button(nodes,'Disconnect agent').click();
  assert.equal(writes(r).length,1);assert.equal(writes(r)[0].opts.method,'DELETE');assert.equal(writes(r)[0].path,'/v1/admin/agents/claude');
  assert.equal(promptArea(r.api.instructionEditor(agent,config,profileGuide).node).value,profileGuide.instructionProfiles[0].prompt);
  assert.equal(promptArea(r.api.instructionEditor(other,otherConfig,profileGuide).node).value,'Preserve other assistant draft');
});

await check('expired hosted sessions restore drafts only for the same verified owner and workspace',async()=>{
  const original={authenticated:true,user:{id:'owner-A',email:'shared-address@example.test'},workspace:{id:'workspace-A'},csrfToken:'initial-csrf'};
  for(const mode of ['same','different-owner','different-workspace','explicit-signout']){
    let auth=structuredClone(original);
    const r=runtime({'/auth/session':()=>auth,'/fixture/expired-session':{__status:401,__body:{error:{code:'unauthorized',message:'Session expired.'}}},'/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}},{hosted:true});
    r.location.hash='#/setup/claude/instructions';await r.api.boot();await r.api.render();
    await editPrompt(r.doc.querySelector('#main'),'PRIVATE INSTRUCTION '+mode);
    const shared=r.api.sharedContext({id:'held-context',pinned_context:'Saved shared context',context_version:2});
    shared.querySelector('textarea').value='PRIVATE CONTEXT '+mode;await shared.querySelector('textarea').dispatch('input');
    await assert.rejects(r.api.api('/fixture/expired-session'),error=>error.status===401);
    assert.equal(r.doc.querySelector('#main').childNodes.length,0);assert.equal(r.doc.querySelector('#workspace').hidden,true);
    assert.equal([...r.storage.values()].some(value=>value.includes('PRIVATE')),false);
    if(mode==='different-owner')auth={...auth,user:{id:'owner-B',email:original.user.email}};
    if(mode==='different-workspace')auth={...auth,workspace:{id:'workspace-B'}};
    if(mode==='same')auth={...auth,user:{...auth.user,email:'updated-address@example.test'}};
    if(mode==='explicit-signout')r.api.signOut();
    await r.api.boot();await r.api.render();
    assert.equal(promptArea(r.doc.querySelector('#main')).value,mode==='same'?'PRIVATE INSTRUCTION '+mode:profileGuide.instructionProfiles[0].prompt);
    assert.equal(r.api.sharedContext({id:'held-context',pinned_context:'Saved shared context',context_version:2}).querySelector('textarea').value,mode==='same'?'PRIVATE CONTEXT '+mode:'Saved shared context');
    assert.equal([...r.storage.values()].some(value=>value.includes('PRIVATE')),false);
  }
});

await check('expired self-hosted sessions restore drafts only with the same owner key and workspace',async()=>{
  for(const mode of ['same','different-key','different-workspace','explicit-signout']){
    let currentOverview={...overview,workspace:{id:'selfhost-A'}};
    const r=runtime({'/v1/admin/overview':()=>currentOverview,'/fixture/expired-session':{__status:401,__body:{error:{code:'unauthorized',message:'Session expired.'}}},'/v1/admin/agents/claude/setup?surface=chat':{guide:profileGuide}});
    const signIn=async key=>{r.doc.querySelector('#owner-key').value=key;await r.doc.querySelector('#gate-form').dispatch('submit');await r.api.render();};
    r.location.hash='#/setup/claude/instructions';await signIn('fixture-owner-A');
    await editPrompt(r.doc.querySelector('#main'),'PRIVATE SELFHOST '+mode);
    await assert.rejects(r.api.api('/fixture/expired-session'),error=>error.status===401);
    assert.equal(r.doc.querySelector('#workspace').hidden,true);assert.equal(r.doc.querySelector('#main').childNodes.length,0);
    if(mode==='different-workspace')currentOverview={...currentOverview,workspace:{id:'selfhost-B'}};
    if(mode==='explicit-signout')r.api.signOut();
    await signIn(mode==='different-key'?'fixture-owner-B':'fixture-owner-A');
    assert.equal(promptArea(r.doc.querySelector('#main')).value,mode==='same'?'PRIVATE SELFHOST '+mode:profileGuide.instructionProfiles[0].prompt);
    assert.equal([...r.storage.values()].some(value=>value.includes('PRIVATE')),false);
  }
});

await check('two primary instruction choices use native radios and legacy starters remain optional',()=>{
  const r=runtime(),{node}=r.api.instructionEditor(agent,config,profileGuide),choices=node.querySelectorAll('.instruction-choice');
  assert.equal(choices.length,6);const fieldset=node.querySelector('fieldset');assert.ok(fieldset.querySelector('legend').textContent);
  const primary=fieldset.children.filter(child=>child.tagName==='LABEL');assert.deepEqual(primary.map(row=>row.querySelector('input').value),['judgment','available']);
  const more=node.querySelector('.instruction-more');assert.equal(more.open,false);assert.match(more.querySelector('summary').textContent,/More starting points/);
  assert.deepEqual(more.querySelectorAll('input').map(input=>input.value),['delegate','offload','collaborate','second_opinion']);
  for(const choice of choices){const input=choice.querySelector('input');assert.equal(choice.tagName,'LABEL');assert.equal(input.getAttribute('type'),'radio');assert.equal(input.getAttribute('name'),'instruction-profile');assert.ok(choice.querySelector('strong').textContent);}
  assert.equal(selectedProfile(node),'judgment');assert.match(choices[0].textContent,/Recommended/);
  for(const profile of profileGuide.instructionProfiles.slice(2)){
    const legacy=structuredClone(config);legacy.settings.instructions={profile:profile.id,custom_prompt:'Existing '+profile.id+' instructions'};
    const kept=r.api.instructionEditor(agent,legacy,profileGuide).node;
    assert.equal(selectedProfile(kept),profile.id);assert.equal(promptArea(kept).value,'Existing '+profile.id+' instructions');
    assert.equal(kept.querySelector('.instruction-more').open,false);assert.ok(kept.querySelector('.instruction-more').querySelector('summary').textContent.includes(profile.label+' selected'));
  }
  assert.equal(promptArea(node).getAttribute('maxlength'),'16000');assert.equal(query(node,'.instruction-state')[0].getAttribute('aria-live'),'polite');
  assert.match(html,/\.instruction-preview textarea\{[^}]*overflow:hidden;max-height:none/);
  assert.match(html,/\.setup-content \.copybox pre,\.background-guide \.copybox pre\{max-height:none;overflow:visible\}/);
  assert.match(html,/@media\(max-width:700px\)\{[^\n]*\.instruction-preview textarea\{font-size:16px\}/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.instruction-choice\{transition:none\}\}/);
  assert.doesNotMatch(html,/\.instruction-(?:preview|profiles|save-row)[^{]*\{[^}]*position:(?:fixed|sticky)/);
});


await check('single introduction copies the selected schedule once without silently saving it',async()=>{
  const suffix='Create an hourly scheduled task. Reuse an existing active task.',body='Use Hitchhike with judgment.';
  const g={...profileGuide,backgroundSelection:{enabled:true,intervalMinutes:60},backgroundSchedulePrompt:suffix,instructionProfiles:profileGuide.instructionProfiles.map(p=>({...p,prompt:body+'\n\n'+suffix}))};
  const server=savedConfiguration(),r=runtime(server.fixtures),editor=r.api.instructionEditor(agent,config,g);
  assert.equal(promptArea(editor.node).value,body);assert.equal(editor.node.querySelector('.intro-schedule').textContent,suffix);assert.match(editor.node.querySelector('.intro-background').textContent,/Background request · included when copying/);
  assert.equal(editor.node.querySelector('.working-preferences').open,false);assert.equal(editor.node.querySelector('.background-choice').open,false);
  await button(editor.node,'Copy').click();assert.equal(r.copied[0],body+'\n\n'+suffix);assert.equal(writes(r).length,0);
  assert.equal(editor.needsSave(),true);await editor.save();
  assert.deepEqual(JSON.parse(writes(r)[0].opts.body),{expected_version:0,instructions:{profile:'judgment',custom_prompt:null},setup_background:{enabled:true,interval_minutes:60}});
  assert.equal(server.current.readiness.background.verified,false);assert.deepEqual(server.current.settings.background,settings.background);assert.equal(server.current.settings.initiative,false);
  assert.equal(editor.needsSave(),false);
});

await check('background preview preserves custom text, uses a read-only request and saves explicit off only on request',async()=>{
  const suffix='Create an hourly scheduled task.',g={...profileGuide,backgroundSelection:{enabled:true,intervalMinutes:60},backgroundSchedulePrompt:suffix};
  const c=structuredClone(config);c.settings.instructions.custom_prompt='My personal introduction.';c.settings.setup_background={enabled:true,interval_minutes:60};
  const server=savedConfiguration(c),off={...g,backgroundSelection:{enabled:false,intervalMinutes:null},backgroundSchedulePrompt:''};
  const r=runtime({...server.fixtures,'/v1/admin/agents/claude/setup?surface=chat&background_enabled=false':{guide:off}}),editor=r.api.instructionEditor(agent,c,g);
  await editPrompt(editor.node,'Keep this newer wording.');const toggle=editor.node.querySelector('#setup-background-enabled');toggle.checked=false;await toggle.dispatch('change');
  assert.equal(promptArea(editor.node).value,'Keep this newer wording.');assert.equal(writes(r).length,0);assert.ok(r.calls.some(call=>call.path.endsWith('background_enabled=false')));
  await button(editor.node,'Copy draft').click();assert.equal(r.copied[0],'Keep this newer wording.');
  await editor.save();assert.deepEqual(server.current.settings.setup_background,{enabled:false,interval_minutes:null});assert.equal(server.current.settings.instructions.custom_prompt,'Keep this newer wording.');
  assert.equal(server.current.readiness.background.verified,false);
});

await check('chat cadence is bounded and a failed background preview keeps the last copy usable',async()=>{
  const g={...profileGuide,backgroundSelection:{enabled:true,intervalMinutes:60},backgroundSchedulePrompt:'Create an hourly scheduled task.'};
  const r=runtime({'/v1/admin/agents/claude/setup?surface=chat&background_enabled=false':{__status:503,__body:{error:{message:'Preview unavailable'}}}}),editor=r.api.instructionEditor(agent,config,g);
  const interval=editor.node.querySelector('#setup-background-interval');assert.equal(interval.getAttribute('min'),'60');interval.value='5';await interval.dispatch('change');
  assert.equal(r.calls.length,0);assert.match(editor.node.textContent,/whole number from 60/);
  const toggle=editor.node.querySelector('#setup-background-enabled');toggle.checked=false;await toggle.dispatch('change');
  assert.equal(toggle.checked,true);assert.match(editor.node.textContent,/Preview unavailable/);assert.equal(writes(r).length,0);
  await button(editor.node,'Copy').click();assert.match(r.copied[0],/Create an hourly/);
});

await check('background drafts survive route changes without rewriting personal wording or permission settings',async()=>{
  const initial={...profileGuide,backgroundSelection:{enabled:false,intervalMinutes:null},backgroundSchedulePrompt:''};
  const enabled={...initial,backgroundSelection:{enabled:true,intervalMinutes:120},backgroundSchedulePrompt:'Create a scheduled task every120 minutes.'};
  const server=savedConfiguration(),r=runtime({...server.fixtures,'/v1/admin/agents/claude/setup?surface=chat':{guide:initial},'/v1/admin/agents/claude/setup?surface=chat&background_enabled=true&background_interval=120':{guide:enabled}});
  let nodes=await r.api.setupPage('claude','instructions');await editPrompt(nodes,'Keep my route draft.');
  const interval=query(nodes,'#setup-background-interval')[0],toggle=query(nodes,'#setup-background-enabled')[0];interval.value='120';toggle.checked=true;await toggle.dispatch('change');
  nodes=await r.api.setupPage('claude','exchange');assert.equal(promptArea(nodes).value,'Keep my route draft.');assert.equal(Number(query(nodes,'#setup-background-interval')[0].value),120);
  assert.equal(writes(r).length,0);await button(nodes,'Finish setup').click();
  assert.equal(server.current.onboarding.step,'done');assert.equal(server.current.settings.instructions.custom_prompt,'Keep my route draft.');assert.deepEqual(server.current.settings.setup_background,{enabled:true,interval_minutes:120});
  assert.equal(server.current.readiness.access.verified,false);assert.equal(server.current.readiness.peer_collaboration.verified,false);assert.equal(server.current.readiness.background.verified,false);
});


await check('returning to setup refreshes cached introduction after another device changes scheduling',async()=>{
  const initial=structuredClone(config);initial.version=1;initial.settings.setup_background={enabled:true,interval_minutes:60};
  const server=savedConfiguration(initial);let guideReads=0;
  const currentGuide=()=>{guideReads++;const enabled=server.current.settings.setup_background.enabled;return {guide:{...profileGuide,backgroundSelection:{enabled,intervalMinutes:enabled?60:null},backgroundSchedulePrompt:enabled?'Create an hourly scheduled task.':''}};};
  const r=runtime({...server.fixtures,'/v1/admin/agents/claude/setup?surface=chat':currentGuide});
  let nodes=await r.api.setupPage('claude','exchange');await button(nodes,'Copy').click();assert.match(r.copied.at(-1),/Create an hourly scheduled task/);
  const updated=server.current;updated.version++;updated.settings.setup_background={enabled:false,interval_minutes:null};server.replace(updated);
  nodes=await r.api.setupPage('claude','exchange');assert.equal(query(nodes,'#setup-background-enabled')[0].checked,false);
  assert.equal(query(nodes,'.intro-background')[0].hidden,true);await button(nodes,'Copy').click();
  assert.doesNotMatch(r.copied.at(-1),/Create an hourly scheduled task/);assert.equal(guideReads,2);assert.equal(writes(r).length,0);
});

await check('self-hosted pairing preview and its single copy follow edited scheduling and saved wording',async()=>{
  const routine={...agent,name:'Muse',platform:'muse',connects:'routine'},c=structuredClone(config);c.version=1;c.settings.setup_background={enabled:true,interval_minutes:10};
  const server=savedConfiguration(c),makeGuide=selection=>{
    const text='PRIVATE SYNTHETIC CONNECTION KEY. Load my saved preferences.'+(selection.enabled?' Create a task every '+selection.interval_minutes+' minutes.':'');
    return {...profileGuide,backgroundSelection:{enabled:selection.enabled,intervalMinutes:selection.interval_minutes},backgroundSchedulePrompt:selection.enabled?'Create a task every '+selection.interval_minutes+' minutes.':'',surfaces:[{id:'chat',steps:[{title:'Pair this agent',copy:text}]}],steps:[{title:'Pair this agent',copy:text}]};
  };
  const r=runtime({...server.fixtures,'/v1/admin/agents/claude/setup?surface=chat':()=>({guide:makeGuide(server.current.settings.setup_background)}),'/v1/admin/agents/claude/setup?surface=chat&background_enabled=false':{guide:makeGuide({enabled:false,interval_minutes:null})}});
  r.api.setState({...overview,agents:[routine]},[['claude',server.current]]);
  const nodes=await r.api.setupPage('claude','connect');assert.equal(query(nodes,'.selfhost-pairing')[0].querySelectorAll('.copybox').length,1);
  assert.match(query(nodes,'.selfhost-pairing')[0].textContent,/every 10 minutes/);
  await editPrompt(nodes,'My unchanged personal wording.');const toggle=query(nodes,'#setup-background-enabled')[0];toggle.checked=false;await toggle.dispatch('change');
  assert.doesNotMatch(query(nodes,'.selfhost-pairing')[0].textContent,/every 10 minutes/);assert.equal(writes(r).length,0);
  await button(query(nodes,'.selfhost-pairing')[0],'Save and copy').click();assert.equal(r.copied.length,1);assert.doesNotMatch(r.copied[0],/every 10 minutes/);assert.match(r.copied[0],/PRIVATE SYNTHETIC/);
  assert.equal(server.current.settings.instructions.custom_prompt,'My unchanged personal wording.');assert.deepEqual(server.current.settings.setup_background,{enabled:false,interval_minutes:null});
  assert.deepEqual(writes(r).map(call=>[call.path,call.opts.method]),[[collaborationPath,'PUT']]);assert.equal(r.storage.size,0);
});

await check('self-hosted pairing never copies stale instructions when changed preferences fail to save',async()=>{
  const routine={...agent,platform:'muse',connects:'routine'},g={...profileGuide,surfaces:[{id:'chat',steps:[{title:'Pair this agent',copy:'PRIVATE SYNTHETIC KEY. Read saved preferences.'}]}]};
  const r=runtime({[collaborationPath]:opts=>opts.method==='PUT'?{__status:409,__body:{error:{code:'configuration_changed',message:'Changed elsewhere.'}}}:config,'/v1/admin/agents/claude/setup?surface=chat':{guide:g}});
  r.api.setState({...overview,agents:[routine]},[['claude',config]]);const nodes=await r.api.setupPage('claude','connect');await editPrompt(nodes,'New personal wording.');
  await button(query(nodes,'.selfhost-pairing')[0],'Save and copy').click();assert.equal(r.copied.length,0);assert.match(content(nodes),/Your draft is kept here/);assert.equal(promptArea(nodes).value,'New personal wording.');
});

await check('connection creation hides a single implicit surface and the unrelated polling controls',async()=>{
  for(const platform of ['claude','grok','muse']){
    const r=runtime(),data={...overview,agents:[],platforms:[{...overview.platforms[0],id:platform,label:platform}]};r.api.setState(data,[]);r.location.hash='#/connect/'+platform;await r.api.render();
    const page=r.doc.querySelector('#main');assert.ok(page.querySelector('#agent-name'));assert.equal(page.querySelector('#agent-surface'),null);assert.equal(page.querySelector('#refresh-status'),null);assert.equal(writes(r).length,0);
  }
  const r=runtime();r.api.setState({...overview,agents:[],platforms:[{...overview.platforms[0],id:'codex',label:'Codex'}]},[]);
  assert.ok(query(r.api.connectPage('codex'),'#agent-surface')[0]);
});


await check('Ready measures the introduction after mounting and preserves its draft during resize',async()=>{
  const r=runtime(),create=r.doc.createElement;let visibleHeight=262;
  r.doc.createElement=tag=>{const node=create(tag);if(tag==='textarea'){
    Object.defineProperty(node,'scrollHeight',{get(){return this.isConnected?visibleHeight:0;}});
    Object.defineProperty(node,'offsetHeight',{get(){return this.isConnected?164:0;}});
    Object.defineProperty(node,'clientHeight',{get(){return this.isConnected?162:0;}});
  }return node;};
  r.location.hash='#/setup/claude/exchange';await r.api.render();
  const area=r.doc.querySelector('#collaboration-prompt');assert.equal(area.style.height,'264px','mounted layout plus border is measured without a window resize');
  area.value='Keep my edited introduction.';await area.dispatch('input');visibleHeight=522;await r.context.window.dispatch('resize');
  assert.equal(area.style.height,'524px');assert.equal(area.value,'Keep my edited introduction.');
  await r.api.render(false);const remounted=r.doc.querySelector('#collaboration-prompt');
  assert.notEqual(remounted,area);assert.equal(remounted.style.height,'524px');assert.equal(remounted.value,'Keep my edited introduction.');assert.equal(writes(r).length,0);
});

console.log('\n'+passed+' workspace UI tests passed. Layout and physical Safari remain separate checks.');
