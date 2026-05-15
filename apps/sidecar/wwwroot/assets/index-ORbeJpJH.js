(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))r(e);new MutationObserver(e=>{for(const s of e)if(s.type==="childList")for(const p of s.addedNodes)p.tagName==="LINK"&&p.rel==="modulepreload"&&r(p)}).observe(document,{childList:!0,subtree:!0});function a(e){const s={};return e.integrity&&(s.integrity=e.integrity),e.referrerPolicy&&(s.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?s.credentials="include":e.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function r(e){if(e.ep)return;e.ep=!0;const s=a(e);fetch(e.href,s)}})();const i=new URLSearchParams(window.location.search).get("token")??"",y=document.querySelector("#app");if(!y)throw new Error("Missing app root");y.innerHTML=`
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
`;const o=document.querySelector("#readiness"),b=document.querySelector("#workspace"),w=document.querySelector("#instruction"),c=document.querySelector("#send"),E=document.querySelector("#refresh"),h=document.querySelector("#events"),l=document.querySelector("#approval"),d=document.querySelector("#raw"),f=document.querySelector("#run-id");function m(n){const t=new URL(n,window.location.origin);return i&&t.searchParams.set("token",i),t.toString()}function u(n){h.replaceChildren(...n.map(t=>{const a=document.createElement("li");a.className=`event event-${t.type}`;const r=document.createElement("strong");if(r.textContent=t.message,a.append(r),t.detail){const e=document.createElement("p");e.textContent=t.detail,a.append(e)}return a}))}function v(n){if(l.replaceChildren(),l.hidden=!0,!n.pendingApproval)return;l.hidden=!1;const t=document.createElement("strong");t.textContent="実行前に確認してください";const a=document.createElement("pre");a.textContent=JSON.stringify(n.pendingApproval.toolCall,null,2);const r=document.createElement("div");r.className="approval-actions";const e=document.createElement("button");e.className="primary-button",e.textContent="実行",e.addEventListener("click",()=>void C(n.runId)),r.append(e),l.append(t,a,r)}async function g(){const n=await fetch(m("/api/status"),{headers:i?{"X-Relay-Token":i}:{}});if(!n.ok)throw new Error(`Status failed: ${n.status}`);const t=await n.json(),a=t.checks.some(e=>e.name==="copilot-cdp"&&e.ready),r=t.checks.filter(e=>e.required===!1&&!e.ready);t.ready?(o.textContent="Ready",o.dataset.ready="true",o.title=r.length>0?`Optional capability unavailable: ${r.map(e=>e.name).join(", ")}`:""):a?(o.textContent="Limited",o.dataset.ready="partial",o.title="Some required local execution capability is unavailable."):(o.textContent="Not ready",o.dataset.ready="false",o.title="Copilot transport is not available."),d.textContent=JSON.stringify(t,null,2)}async function S(){c.disabled=!0,h.replaceChildren(),f.textContent="";try{const t=await(await fetch(m("/api/runs"),{method:"POST",headers:{"Content-Type":"application/json",...i?{"X-Relay-Token":i}:{}},body:JSON.stringify({instruction:w.value,workspace:b.value})})).json();f.textContent=t.runId,u(t.events),v(t),d.textContent=JSON.stringify(t,null,2)}catch(n){u([{type:"error",message:"完了できませんでした",detail:n instanceof Error?n.message:String(n)}])}finally{c.disabled=!1}}async function C(n){c.disabled=!0,l.hidden=!0;try{const a=await(await fetch(m(`/api/runs/${encodeURIComponent(n)}/approve`),{method:"POST",headers:i?{"X-Relay-Token":i}:{}})).json();f.textContent=a.runId,u(a.events),v(a),d.textContent=JSON.stringify(a,null,2)}catch(t){u([{type:"error",message:"承認後の実行に失敗しました",detail:t instanceof Error?t.message:String(t)}])}finally{c.disabled=!1}}E.addEventListener("click",()=>{g().catch(n=>{o.textContent="Not ready",o.dataset.ready="false",d.textContent=n instanceof Error?n.message:String(n)})});c.addEventListener("click",()=>void S());g().catch(n=>{o.textContent="Not ready",o.dataset.ready="false",d.textContent=n instanceof Error?n.message:String(n)});
