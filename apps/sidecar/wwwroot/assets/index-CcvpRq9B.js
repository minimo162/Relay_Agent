(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))a(o);new MutationObserver(o=>{for(const r of o)if(r.type==="childList")for(const d of r.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&a(d)}).observe(document,{childList:!0,subtree:!0});function n(o){const r={};return o.integrity&&(r.integrity=o.integrity),o.referrerPolicy&&(r.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?r.credentials="include":o.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function a(o){if(o.ep)return;o.ep=!0;const r=n(o);fetch(o.href,r)}})();const b=new URLSearchParams(window.location.search).get("token")??"",z="relay.workbench.workspace",D="relay.workbench.workspaceHistory",B=document.querySelector("#app");if(!B)throw new Error("Missing app root");B.innerHTML=`
  <section class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Relay Agent</p>
        <h1>Workbench</h1>
      </div>
      <button class="status-pill" id="readiness" type="button">Checking</button>
    </header>

    <main class="workspace-layout">
      <section class="composer-panel" aria-label="Task composer">
        <div class="field-group">
          <div class="field-row">
            <label class="field-label" for="workspace">Workspace</label>
            <span id="workspace-state" class="field-state"></span>
          </div>
          <input id="workspace" class="workspace-input" autocomplete="off" spellcheck="false" placeholder="/path/to/workspace" />
          <div id="workspace-history" class="workspace-history" hidden></div>
        </div>

        <div class="field-group">
          <div class="field-row">
            <label class="field-label" for="instruction">Task</label>
            <span id="run-id" class="field-state"></span>
          </div>
          <textarea id="instruction" class="task-input" rows="3" placeholder="部品売上に関するファイルを探して"></textarea>
        </div>

        <div class="actions">
          <button id="refresh" class="secondary-button" type="button">更新</button>
          <button id="send" class="primary-button" type="button">送信</button>
        </div>
      </section>

      <section id="summary" class="summary-panel" hidden>
        <p id="summary-label" class="summary-label"></p>
        <div id="summary-text" class="summary-text"></div>
      </section>

      <section id="approval" class="approval-panel" hidden></section>

      <section class="run-panel" aria-live="polite">
        <div class="run-header">
          <h2>Activity</h2>
          <span id="run-state" class="run-state">Idle</span>
        </div>
        <ol id="events" class="events"></ol>
      </section>

      <details class="details">
        <summary>Details</summary>
        <pre id="raw"></pre>
      </details>
    </main>
  </section>
`;const s=document.querySelector("#readiness"),i=document.querySelector("#workspace"),x=document.querySelector("#workspace-state"),T=document.querySelector("#workspace-history"),u=document.querySelector("#instruction"),g=document.querySelector("#send"),X=document.querySelector("#refresh"),K=document.querySelector("#events"),c=document.querySelector("#approval"),q=document.querySelector("#raw"),te=document.querySelector("#run-id"),U=document.querySelector("#run-state"),k=document.querySelector("#summary"),W=document.querySelector("#summary-label"),M=document.querySelector("#summary-text");let C=null,N="idle",v=null,p=[],$=new Set;function l(e){const t=new URL(e,window.location.origin);return b&&t.searchParams.set("token",b),t.toString()}function f(e={}){return b?{...e,"X-Relay-Token":b}:e}function ne(e){return e.runId&&e.sequence?`${e.runId}:${e.sequence}`:`${e.type}\0${e.message}\0${e.detail??""}`}function I(e){p=[],$=new Set;for(const t of e)R(t,!1);j(),G()}function R(e,t=!0){const n=ne(e);$.has(n)||($.add(n),p.push(e),t&&(j(),G()))}function j(){if(p.length===0){K.replaceChildren(oe());return}K.replaceChildren(...p.map(e=>{const t=document.createElement("li");t.className=`event event-${e.type}`;const n=document.createElement("span");n.className="event-marker",n.textContent=e.type;const a=document.createElement("div"),o=document.createElement("strong");if(o.textContent=e.message,a.append(o),e.detail){const r=document.createElement("p");r.textContent=e.detail,a.append(r)}return t.append(n,a),t}))}function oe(){const e=document.createElement("li");e.className="event event-empty";const t=document.createElement("span");t.className="event-marker",t.textContent="idle";const n=document.createElement("div"),a=document.createElement("strong");return a.textContent="まだ実行していません",n.append(a),e.append(t,n),e}function G(){const e=[...p].reverse().find(a=>a.type==="final"||a.type==="completed"),t=[...p].reverse().find(a=>a.type==="error"),n=e??(N==="failed"?t:void 0);if(!n){k.hidden=!0,M.textContent="",W.textContent="";return}k.hidden=!1,k.dataset.kind=n.type,W.textContent=n.type==="final"||n.type==="completed"?"Result":"Error",M.textContent=n.detail||n.message}function ae(e){if(c.replaceChildren(),c.hidden=!0,!e.pendingApproval||e.status!=="approval_required")return;c.hidden=!1;const t=e.pendingApproval.toolCall,n=re(t.args),a=String(t.args.operation??t.args.command??t.tool),o=document.createElement("div");o.className="approval-header";const r=document.createElement("strong");r.textContent="確認が必要です";const d=document.createElement("span");d.textContent=t.tool,o.append(r,d);const S=document.createElement("dl");S.className="approval-facts",F(S,"操作",a),F(S,"対象",n);const L=document.createElement("details");L.className="approval-raw";const H=document.createElement("summary");H.textContent="Raw";const J=document.createElement("pre");J.textContent=JSON.stringify(t,null,2),L.append(H,J);const O=document.createElement("div");O.className="approval-actions";const y=document.createElement("button");y.className="secondary-button",y.type="button",y.textContent="実行しない",y.addEventListener("click",()=>void ce(e.runId));const h=document.createElement("button");h.className="primary-button",h.type="button",h.textContent="許可して続行",h.addEventListener("click",()=>void ie(e.runId)),O.append(y,h),c.append(o,S,L,O)}function F(e,t,n){const a=document.createElement("dt");a.textContent=t;const o=document.createElement("dd");o.textContent=n||"-",e.append(a,o)}function re(e){const t=e.filePath??e.path??e.target??e.command??"";return typeof t=="string"?t:JSON.stringify(t)}function m(e,t){N=e,C=t;const n=e==="running";g.textContent=n?"停止":"送信",g.dataset.running=n?"true":"false",X.disabled=n,te.textContent=t||"",U.textContent=e==="approval_required"?"Waiting":se(e),U.dataset.status=e}function se(e){return{idle:"Idle",running:"Running",completed:"Done",failed:"Failed",approval_required:"Waiting",cancelled:"Stopped"}[e]}function E(e){m(e.status,e.runId),I(e.events),ae(e),q.textContent=JSON.stringify(e,null,2)}async function P(){const e=await fetch(l("/api/status"),{headers:f()});if(!e.ok)throw new Error(`Status failed: ${e.status}`);const t=await e.json(),n=t.checks.some(o=>o.name==="copilot-cdp"&&o.ready),a=t.checks.filter(o=>o.required===!1&&!o.ready);t.ready?(s.textContent="Ready",s.dataset.ready="true",s.title=a.length>0?`Optional capability unavailable: ${a.map(o=>o.name).join(", ")}`:""):n?(s.textContent="Limited",s.dataset.ready="partial",s.title="Some required local execution capability is unavailable."):(s.textContent="Not ready",s.dataset.ready="false",s.title="Copilot transport is not available."),q.textContent=JSON.stringify(t,null,2)}async function Q(){if(N==="running"&&C){await le(C);return}A(),c.hidden=!0,k.hidden=!0,m("running",null),I([]),de(i.value);try{const e=await fetch(l("/api/runs"),{method:"POST",headers:f({"Content-Type":"application/json"}),body:JSON.stringify({instruction:u.value,workspace:i.value})});if(!e.ok)throw new Error(await e.text());const t=await e.json();E(t),t.status==="running"&&V(t.runId)}catch(e){m("failed",null),I([{type:"error",message:"完了できませんでした",detail:e instanceof Error?e.message:String(e)}])}}function V(e){A();const t=new EventSource(l(`/api/runs/${encodeURIComponent(e)}/events`));v=t,t.addEventListener("run-event",n=>{const a=n.data;if(!a)return;const o=JSON.parse(a);R(o),(o.type==="final"||o.type==="completed"||o.type==="error"||o.type==="approval_requested")&&window.setTimeout(()=>void _(e),120)}),t.onerror=()=>{t.close(),v===t&&(v=null),C===e&&N==="running"&&window.setTimeout(()=>void _(e),180)}}function A(){v?.close(),v=null}async function _(e){const t=await fetch(l(`/api/runs/${encodeURIComponent(e)}`),{headers:f()});if(!t.ok)return;const n=await t.json();E(n),n.status!=="running"&&A()}async function ie(e){c.hidden=!0,m("running",e);try{const t=await fetch(l(`/api/runs/${encodeURIComponent(e)}/approve`),{method:"POST",headers:f()});if(!t.ok)throw new Error(await t.text());const n=await t.json();E(n),n.status==="running"&&V(n.runId)}catch(t){m("failed",e),R({type:"error",message:"承認後の実行に失敗しました",detail:t instanceof Error?t.message:String(t)})}}async function ce(e){c.hidden=!0;try{const t=await fetch(l(`/api/runs/${encodeURIComponent(e)}/reject`),{method:"POST",headers:f()});if(!t.ok)throw new Error(await t.text());const n=await t.json();E(n)}catch(t){m("failed",e),R({type:"error",message:"却下に失敗しました",detail:t instanceof Error?t.message:String(t)})}}async function le(e){g.disabled=!0;try{const t=await fetch(l(`/api/runs/${encodeURIComponent(e)}/cancel`),{method:"POST",headers:f()});if(t.ok){const n=await t.json();E(n)}}finally{g.disabled=!1}}function Y(){u.style.height="auto",u.style.height=`${Math.min(Math.max(u.scrollHeight,132),320)}px`}function de(e){const t=e.trim();if(!t)return;localStorage.setItem(z,t);const n=Z().filter(a=>a!==t);localStorage.setItem(D,JSON.stringify([t,...n].slice(0,4))),ee(),x.textContent=w(t)}function Z(){try{const e=JSON.parse(localStorage.getItem(D)??"[]");return Array.isArray(e)?e.filter(t=>typeof t=="string"):[]}catch{return[]}}function ee(){const e=Z();T.replaceChildren(),T.hidden=e.length===0;for(const t of e){const n=document.createElement("button");n.type="button",n.textContent=w(t),n.title=t,n.addEventListener("click",()=>{i.value=t,x.textContent=w(t)}),T.append(n)}}function w(e){const n=e.replaceAll("\\","/").split("/").filter(Boolean);return n.length<=3?e:`.../${n.slice(-3).join("/")}`}X.addEventListener("click",()=>{P().catch(e=>{s.textContent="Not ready",s.dataset.ready="false",q.textContent=e instanceof Error?e.message:String(e)})});s.addEventListener("click",()=>void P());g.addEventListener("click",()=>void Q());u.addEventListener("input",Y);u.addEventListener("keydown",e=>{(e.metaKey||e.ctrlKey)&&e.key==="Enter"&&(e.preventDefault(),Q())});i.addEventListener("change",()=>{x.textContent=w(i.value)});i.value=localStorage.getItem(z)??"";x.textContent=i.value?w(i.value):"";ee();j();Y();P().catch(e=>{s.textContent="Not ready",s.dataset.ready="false",q.textContent=e instanceof Error?e.message:String(e)});
