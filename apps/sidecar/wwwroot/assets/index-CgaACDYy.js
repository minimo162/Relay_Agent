(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))r(n);new MutationObserver(n=>{for(const o of n)if(o.type==="childList")for(const p of o.addedNodes)p.tagName==="LINK"&&p.rel==="modulepreload"&&r(p)}).observe(document,{childList:!0,subtree:!0});function s(n){const o={};return n.integrity&&(o.integrity=n.integrity),n.referrerPolicy&&(o.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?o.credentials="include":n.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function r(n){if(n.ep)return;n.ep=!0;const o=s(n);fetch(n.href,o)}})();const i=new URLSearchParams(window.location.search).get("token")??"",y=document.querySelector("#app");if(!y)throw new Error("Missing app root");y.innerHTML=`
  <section class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Relay Agent</p>
        <h1>Workbench</h1>
      </div>
      <div class="status-pill" id="readiness">Checking</div>
    </header>

    <section class="composer-panel">
      <label class="field-label" for="workspace">Workspace</label>
      <input id="workspace" class="workspace-input" placeholder="/path/to/workspace" />

      <label class="field-label" for="instruction">Task</label>
      <textarea id="instruction" class="task-input" rows="5" placeholder="部品売上に関するファイルを探して"></textarea>

      <div class="actions">
        <button id="send" class="primary-button">送信</button>
        <button id="refresh" class="secondary-button">状態を更新</button>
      </div>
    </section>

    <section class="run-panel" aria-live="polite">
      <div class="run-header">
        <h2>Run</h2>
        <span id="run-id"></span>
      </div>
      <ol id="events" class="events"></ol>
      <div id="approval" class="approval-panel" hidden></div>
    </section>

    <details class="details">
      <summary>Details</summary>
      <pre id="raw"></pre>
    </details>
  </section>
`;const a=document.querySelector("#readiness"),w=document.querySelector("#workspace"),E=document.querySelector("#instruction"),l=document.querySelector("#send"),S=document.querySelector("#refresh"),h=document.querySelector("#events"),c=document.querySelector("#approval"),d=document.querySelector("#raw"),f=document.querySelector("#run-id");function m(t){const e=new URL(t,window.location.origin);return i&&e.searchParams.set("token",i),e.toString()}function u(t){h.replaceChildren(...t.map(e=>{const s=document.createElement("li");s.className=`event event-${e.type}`;const r=document.createElement("strong");if(r.textContent=e.message,s.append(r),e.detail){const n=document.createElement("p");n.textContent=e.detail,s.append(n)}return s}))}function v(t){if(c.replaceChildren(),c.hidden=!0,!t.pendingApproval)return;c.hidden=!1;const e=document.createElement("strong");e.textContent="実行前に確認してください";const s=document.createElement("pre");s.textContent=JSON.stringify(t.pendingApproval.toolCall,null,2);const r=document.createElement("div");r.className="approval-actions";const n=document.createElement("button");n.className="primary-button",n.textContent="実行",n.addEventListener("click",()=>void C(t.runId)),r.append(n),c.append(e,s,r)}async function g(){const t=await fetch(m("/api/status"),{headers:i?{"X-Relay-Token":i}:{}});if(!t.ok)throw new Error(`Status failed: ${t.status}`);const e=await t.json(),s=e.checks.some(r=>r.name==="copilot-cdp"&&r.ready);e.ready?(a.textContent="Ready",a.dataset.ready="true"):s?(a.textContent="Limited",a.dataset.ready="partial"):(a.textContent="Not ready",a.dataset.ready="false"),d.textContent=JSON.stringify(e,null,2)}async function b(){l.disabled=!0,h.replaceChildren(),f.textContent="";try{const e=await(await fetch(m("/api/runs"),{method:"POST",headers:{"Content-Type":"application/json",...i?{"X-Relay-Token":i}:{}},body:JSON.stringify({instruction:E.value,workspace:w.value})})).json();f.textContent=e.runId,u(e.events),v(e),d.textContent=JSON.stringify(e,null,2)}catch(t){u([{type:"error",message:"完了できませんでした",detail:t instanceof Error?t.message:String(t)}])}finally{l.disabled=!1}}async function C(t){l.disabled=!0,c.hidden=!0;try{const s=await(await fetch(m(`/api/runs/${encodeURIComponent(t)}/approve`),{method:"POST",headers:i?{"X-Relay-Token":i}:{}})).json();f.textContent=s.runId,u(s.events),v(s),d.textContent=JSON.stringify(s,null,2)}catch(e){u([{type:"error",message:"承認後の実行に失敗しました",detail:e instanceof Error?e.message:String(e)}])}finally{l.disabled=!1}}S.addEventListener("click",()=>{g().catch(t=>{a.textContent="Not ready",a.dataset.ready="false",d.textContent=t instanceof Error?t.message:String(t)})});l.addEventListener("click",()=>void b());g().catch(t=>{a.textContent="Not ready",a.dataset.ready="false",d.textContent=t instanceof Error?t.message:String(t)});
