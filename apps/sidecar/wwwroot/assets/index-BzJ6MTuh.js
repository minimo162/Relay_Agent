(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))i(n);new MutationObserver(n=>{for(const s of n)if(s.type==="childList")for(const l of s.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&i(l)}).observe(document,{childList:!0,subtree:!0});function r(n){const s={};return n.integrity&&(s.integrity=n.integrity),n.referrerPolicy&&(s.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?s.credentials="include":n.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function i(n){if(n.ep)return;n.ep=!0;const s=r(n);fetch(n.href,s)}})();const o=new URLSearchParams(window.location.search).get("token")??"",f=document.querySelector("#app");if(!f)throw new Error("Missing app root");f.innerHTML=`
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
    </section>

    <details class="details">
      <summary>Details</summary>
      <pre id="raw"></pre>
    </details>
  </section>
`;const a=document.querySelector("#readiness"),g=document.querySelector("#workspace"),w=document.querySelector("#instruction"),d=document.querySelector("#send"),v=document.querySelector("#refresh"),y=document.querySelector("#events"),c=document.querySelector("#raw"),u=document.querySelector("#run-id");function m(e){const t=new URL(e,window.location.origin);return o&&t.searchParams.set("token",o),t.toString()}function p(e){y.replaceChildren(...e.map(t=>{const r=document.createElement("li");r.className=`event event-${t.type}`;const i=document.createElement("strong");if(i.textContent=t.message,r.append(i),t.detail){const n=document.createElement("p");n.textContent=t.detail,r.append(n)}return r}))}async function h(){const e=await fetch(m("/api/status"),{headers:o?{"X-Relay-Token":o}:{}});if(!e.ok)throw new Error(`Status failed: ${e.status}`);const t=await e.json();a.textContent=t.ready?"Ready":"Not ready",a.dataset.ready=String(t.ready),c.textContent=JSON.stringify(t,null,2)}async function S(){d.disabled=!0,y.replaceChildren(),u.textContent="";try{const t=await(await fetch(m("/api/runs"),{method:"POST",headers:{"Content-Type":"application/json",...o?{"X-Relay-Token":o}:{}},body:JSON.stringify({instruction:w.value,workspace:g.value})})).json();u.textContent=t.runId,p(t.events),c.textContent=JSON.stringify(t,null,2)}catch(e){p([{type:"error",message:"完了できませんでした",detail:e instanceof Error?e.message:String(e)}])}finally{d.disabled=!1}}v.addEventListener("click",()=>{h().catch(e=>{a.textContent="Not ready",a.dataset.ready="false",c.textContent=e instanceof Error?e.message:String(e)})});d.addEventListener("click",()=>void S());h().catch(e=>{a.textContent="Not ready",a.dataset.ready="false",c.textContent=e instanceof Error?e.message:String(e)});
