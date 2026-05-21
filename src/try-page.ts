/**
 * Worker /try route — self-contained interactive demo page
 * 
 * Add this to your causallayer-mcp Worker's src/index.ts fetch handler.
 * When a request comes to GET /try, it serves this HTML page which
 * calls the same Worker's /mcp endpoint for the demo.
 * 
 * Integration:
 *   In src/index.ts, add before the MCP handler:
 *   
 *   if (request.method === 'GET' && url.pathname === '/try') {
 *     return serveTryPage(request, env);
 *   }
 */

export function serveTryPage(request: Request, env: any): Response {
  const origin = new URL(request.url).origin;
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Try FaultKey · Live AI Liability Demo</title>
  <meta name="description" content="Generate a real AI liability certificate in 3 seconds. No login, no install. Call the live MCP endpoint.">
  <meta property="og:title" content="Try FaultKey · Live Demo">
  <meta property="og:description" content="Pick a scenario. Get a signed liability certificate in ~3 seconds.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${origin}/try">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@500;600&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bone: #F7F4EE;
      --bone-deep: #EFEAE0;
      --graphite: #161513;
      --graphite-soft: #3A3833;
      --oxide: #B5301F;
      --cert-blue: #0B3954;
      --rule: #C9C2B3;
      --font-display: 'Crimson Pro', serif;
      --font-body: 'Inter', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bone);
      color: var(--graphite);
      font-family: var(--font-body);
      font-size: 16px;
      line-height: 1.55;
      padding: 24px clamp(20px, 5vw, 64px) 96px;
      max-width: 1280px;
      margin: 0 auto;
    }
    a { color: inherit; }
    code { font-family: var(--font-mono); font-size: 0.9em; background: var(--bone-deep); padding: 1px 6px; border: 1px solid var(--rule); }
    
    .topbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 28px; border-bottom: 1px solid var(--rule); margin-bottom: 36px; font-family: var(--font-mono); font-size: 13px; }
    .topbar a { text-decoration: none; color: var(--graphite-soft); border-bottom: 1px solid transparent; transition: border-color 160ms; }
    .topbar a:hover { border-bottom-color: var(--oxide); color: var(--graphite); }
    
    .stamp { display: inline-block; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--oxide); border: 1px solid var(--oxide); padding: 4px 10px; margin-bottom: 20px; }
    h1 { font-family: var(--font-display); font-weight: 600; font-size: clamp(2.2rem, 5vw, 3.8rem); line-height: 1.05; margin: 0 0 18px; max-width: 24ch; }
    h1 .accent { color: var(--oxide); }
    .lede { max-width: 64ch; font-size: 17px; color: var(--graphite-soft); margin-bottom: 14px; }
    
    .section-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.16em; color: var(--oxide); text-transform: uppercase; margin-bottom: 16px; }
    
    .scenarios { display: flex; flex-wrap: wrap; gap: 10px; margin: 36px 0 48px; }
    .scenario-btn { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: var(--bone-deep); border: 1px solid var(--rule); cursor: pointer; font-family: var(--font-mono); font-size: 12.5px; color: var(--graphite-soft); transition: all 160ms; }
    .scenario-btn:hover { border-color: var(--graphite); color: var(--graphite); }
    .scenario-btn.active { border-color: var(--graphite); background: var(--graphite); color: var(--bone); }
    
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: clamp(28px, 4vw, 64px); border-top: 1px solid var(--rule); padding-top: 36px; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    
    .incident-card { background: var(--bone-deep); border: 1px solid var(--rule); padding: 20px; margin-bottom: 16px; }
    .incident-card h3 { font-family: var(--font-display); font-weight: 600; font-size: 1.1rem; margin-bottom: 8px; }
    .incident-card p { font-size: 14px; color: var(--graphite-soft); margin-bottom: 12px; }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge { font-family: var(--font-mono); font-size: 11px; padding: 3px 8px; border: 1px solid var(--rule); background: var(--bone); text-transform: uppercase; }
    
    .submit-btn { background: var(--graphite); color: var(--bone); border: 1px solid var(--graphite); padding: 12px 22px; font-family: var(--font-mono); font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: all 160ms; margin-top: 20px; }
    .submit-btn:hover:not(:disabled) { background: var(--oxide); border-color: var(--oxide); }
    .submit-btn:active:not(:disabled) { transform: scale(0.97); }
    .submit-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    
    .result-panel { background: linear-gradient(180deg, var(--bone-deep) 0%, var(--bone) 100%); border: 1px solid var(--rule); padding: 28px clamp(20px, 3vw, 32px); position: relative; }
    .result-panel::before { content: ""; position: absolute; top: 0; left: 0; width: 100%; height: 4px; background: var(--graphite); }
    
    .trace { margin-top: 24px; padding: 16px; background: var(--graphite); color: var(--bone-deep); font-family: var(--font-mono); font-size: 12px; }
    .trace-step { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .trace-dot { width: 8px; height: 8px; border-radius: 50%; }
    .trace-dot.pending { background: #f59e0b; animation: pulse 1s infinite; }
    .trace-dot.done { background: #22c55e; }
    .trace-dot.error { background: var(--oxide); }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    
    .verdict { font-family: var(--font-display); font-weight: 600; font-size: 1.3rem; text-transform: uppercase; color: var(--oxide); }
    .liability-bar { display: flex; height: 18px; border: 1px solid var(--rule); margin: 8px 0 12px; overflow: hidden; }
    .bar-vendor { background: var(--oxide); }
    .bar-deployer { background: var(--graphite); }
    .bar-user { background: var(--cert-blue); }
    
    .cert-section { padding: 16px 0; border-bottom: 1px dashed var(--rule); }
    .cert-k { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--graphite-soft); margin-bottom: 8px; }
    .damages { font-family: var(--font-display); font-weight: 600; font-size: 1.6rem; }
    
    #placeholder { text-align: center; padding: 48px 20px; color: var(--graphite-soft); font-size: 14.5px; }
    #loading { display: none; text-align: center; padding: 48px 20px; }
    .spinner { width: 40px; height: 40px; margin: 0 auto 16px; border: 2px solid var(--rule); border-top-color: var(--oxide); border-radius: 50%; animation: spin 800ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <header class="topbar">
    <a href="https://faultkey.com">← FaultKey</a>
    <a href="https://github.com/smq9sn5jck-coder/causallayer-mcp">GitHub →</a>
  </header>
  
  <div class="stamp">LIVE DEMO · NO LOGIN · NO INSTALL</div>
  <h1>Pick a scenario. Get a signed liability certificate in <span class="accent">~3 seconds</span>.</h1>
  <p class="lede">This page calls the <strong>real</strong> <code>mcp.faultkey.com</code> endpoint — the same one Claude Desktop, Cursor, and Cline connect to.</p>
  
  <div class="section-label">01 · CHOOSE A SCENARIO</div>
  <div class="scenarios" id="scenarios"></div>
  
  <div class="grid">
    <div id="left-panel"></div>
    <div class="result-panel">
      <div class="section-label">03 · CAUSAL CERTIFICATE</div>
      <div id="placeholder">
        <p>Select a scenario and hit <strong>Submit</strong> to call the live engine.</p>
        <p style="font-size:13px;margin-top:8px;">Deterministic — same input always produces same output. No LLM in the scoring path.</p>
      </div>
      <div id="loading"><div class="spinner"></div><p>Calling <code>mcp.faultkey.com</code>…</p></div>
      <div id="cert-output" style="display:none;"></div>
    </div>
  </div>
  
  <div id="trace-container" style="display:none;">
    <div class="trace" id="trace"></div>
  </div>

  <script>
    const MCP_URL = '${origin}/mcp';
    
    const SCENARIOS = [
      { id:'loan', icon:'🏦', label:'Loan Approval', title:'AI auto-approved high-risk loan without human review', desc:'Credit scoring model approved a $180,000 mortgage for a borrower with thin credit file. The model bypassed the mandatory human-in-the-loop check for applications exceeding $100k.', severity:'high', jurisdiction:'AU', impact:180000, vendor:'Anthropic Claude 3.5', deployer:'National Credit Corp', user:'Loan Officer (bypassed)', events:[{type:'application_received',desc:'Mortgage application submitted via online portal'},{type:'model_inference',desc:'Credit model scores applicant at 0.73 (borderline)'},{type:'threshold_bypass',desc:'Auto-approval triggered despite >$100k threshold requiring human review'},{type:'loan_disbursed',desc:'Funds transferred without human sign-off'}] },
      { id:'medical', icon:'🏥', label:'Medical Triage', title:'Triage AI downgraded chest pain patient to non-urgent', desc:'Emergency department triage AI classified a 58-year-old male presenting with atypical chest pain as Category 4 (non-urgent). Patient suffered STEMI 45 minutes later.', severity:'critical', jurisdiction:'AU', impact:2500000, vendor:'MedAssist AI v4.2', deployer:"St Vincent's Hospital", user:'Triage Nurse (overridden)', events:[{type:'patient_presentation',desc:'58M presents with left shoulder pain, mild diaphoresis'},{type:'ai_triage',desc:'AI classifies as Category 4 (non-urgent)'},{type:'nurse_override_rejected',desc:'Nurse attempted to escalate but system required supervisor code'},{type:'cardiac_event',desc:'Patient collapses — STEMI confirmed on ECG'}] },
      { id:'content', icon:'🛡️', label:'Content Moderation', title:'Content filter failed to detect coordinated harassment', desc:'Automated content moderation system failed to flag a coordinated harassment campaign. 4,200 abusive posts remained live for 18 hours.', severity:'medium', jurisdiction:'EU', impact:95000, vendor:'OpenAI GPT-4o (moderation)', deployer:'SocialPlatform Inc', user:'Trust & Safety Team', events:[{type:'campaign_start',desc:'Coordinated accounts begin posting using coded language'},{type:'filter_pass',desc:'Content filter scores posts as 0.3 (below threshold)'},{type:'volume_spike',desc:'4,200 posts in 6 hours — anomaly detection silent'},{type:'manual_report',desc:'Target reports harassment; T&S team manually removes content'}] },
      { id:'coding', icon:'💻', label:'Coding Agent', title:'Coding agent dropped production database', desc:'Autonomous coding agent invoked DROP TABLE on production users table after user said "clean up the test data". No confirmation requested.', severity:'high', jurisdiction:'AU', impact:45000, vendor:'OpenAI GPT-5', deployer:'Acme Corp DevOps', user:'Jane Doe (engineer)', events:[{type:'prompt',desc:'User says: clean up the test data'},{type:'tool_call',desc:'Agent calls execute_sql with destructive statement'},{type:'db_drop',desc:'DROP TABLE production.users executed without confirmation'},{type:'alert_fired',desc:'Datadog alert fires; oncall paged'}] },
      { id:'hiring', icon:'👤', label:'Hiring AI', title:'Resume screener systematically rejected candidates over 50', desc:'AI resume screening tool showed statistically significant bias against candidates with graduation dates before 1996. 340 qualified candidates auto-rejected.', severity:'critical', jurisdiction:'EU', impact:890000, vendor:'HireBot AI v2.1', deployer:'TechCorp Recruiting', user:'Head of People', events:[{type:'screening_deployed',desc:'AI screener activated for all engineering roles'},{type:'pattern_emerges',desc:'Internal audit flags 94% rejection rate for 50+ candidates'},{type:'bias_confirmed',desc:'Graduation year is proxy variable for age discrimination'},{type:'regulatory_notice',desc:'EU DPA opens investigation under AI Act Article 10'}] }
    ];
    
    let activeScenario = SCENARIOS[0];
    
    function renderScenarios() {
      const el = document.getElementById('scenarios');
      el.innerHTML = SCENARIOS.map(s => 
        \`<button class="scenario-btn \${s.id === activeScenario.id ? 'active' : ''}" onclick="selectScenario('\${s.id}')">\${s.icon} \${s.label.toUpperCase()}</button>\`
      ).join('');
    }
    
    function selectScenario(id) {
      activeScenario = SCENARIOS.find(s => s.id === id);
      renderScenarios();
      renderLeft();
      document.getElementById('placeholder').style.display = 'block';
      document.getElementById('cert-output').style.display = 'none';
      document.getElementById('trace-container').style.display = 'none';
    }
    
    function renderLeft() {
      const s = activeScenario;
      document.getElementById('left-panel').innerHTML = \`
        <div class="section-label">02 · INCIDENT DETAILS</div>
        <div class="incident-card">
          <h3>\${s.title}</h3>
          <p>\${s.desc}</p>
          <div class="badges">
            <span class="badge">\${s.severity}</span>
            <span class="badge">\${s.jurisdiction}</span>
            <span class="badge">$\${s.impact.toLocaleString()} AUD</span>
          </div>
        </div>
        <button class="submit-btn" id="submit-btn" onclick="runDemo()">Submit & generate certificate</button>
      \`;
    }
    
    function addTrace(label, status) {
      const el = document.getElementById('trace');
      const step = document.createElement('div');
      step.className = 'trace-step';
      step.innerHTML = \`<span class="trace-dot \${status}"></span><span>\${label}</span>\`;
      el.appendChild(step);
      return step;
    }
    
    function updateTrace(step, status) {
      step.querySelector('.trace-dot').className = 'trace-dot ' + status;
    }
    
    async function runDemo() {
      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = 'Scoring…';
      
      document.getElementById('placeholder').style.display = 'none';
      document.getElementById('loading').style.display = 'block';
      document.getElementById('cert-output').style.display = 'none';
      document.getElementById('trace-container').style.display = 'block';
      document.getElementById('trace').innerHTML = '<div class="section-label" style="color:var(--bone-deep);opacity:0.6;margin-bottom:12px;">MCP PROTOCOL TRACE</div>';
      
      const t0 = performance.now();
      const s = activeScenario;
      
      try {
        // Initialize
        const step1 = addTrace('POST /mcp → initialize', 'pending');
        const initResp = await fetch(MCP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-03-26', capabilities:{}, clientInfo:{ name:'faultkey-try', version:'1.0' } } })
        });
        const session = initResp.headers.get('mcp-session-id');
        if (!session) throw new Error('No session ID');
        updateTrace(step1, 'done');
        
        // Initialized notification
        const step2 = addTrace('POST → notifications/initialized', 'pending');
        await fetch(MCP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': session },
          body: JSON.stringify({ jsonrpc:'2.0', method:'notifications/initialized' })
        });
        updateTrace(step2, 'done');
        
        // Call tool
        const step3 = addTrace('POST → tools/call submit_incident', 'pending');
        const now = new Date().toISOString();
        const toolResp = await fetch(MCP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': session },
          body: JSON.stringify({ jsonrpc:'2.0', id:99, method:'tools/call', params:{ name:'submit_incident', arguments:{
            title: s.title, description: s.desc, severity: s.severity, jurisdiction: s.jurisdiction,
            financial_impact_cents: s.impact * 100, currency: 'AUD', deterministic_only: true,
            agents: [
              { id:'vendor-1', name:s.vendor, type:'vendor', vendor_name:s.vendor },
              { id:'deployer-1', name:s.deployer, type:'deployer', operator_role:'deployer' },
              { id:'user-1', name:s.user, type:'user', operator_role:'user' }
            ],
            events: s.events.map((e,i) => ({ id:'e'+(i+1), type:e.type, timestamp: new Date(Date.parse(now) - (s.events.length-i)*60000).toISOString(), description:e.desc }))
          }}})
        });
        
        const text = await toolResp.text();
        const dataLine = text.split('\\n').find(l => l.startsWith('data:'));
        if (!dataLine) throw new Error('Malformed SSE');
        const parsed = JSON.parse(dataLine.slice(5).trim());
        if (parsed.error) throw new Error(parsed.error.message);
        const result = parsed.result;
        const jsonContent = result?.content?.[1]?.text;
        if (result?.isError || !jsonContent) throw new Error(result?.content?.[0]?.text || 'Tool error');
        const cert = JSON.parse(jsonContent);
        updateTrace(step3, 'done');
        
        const elapsed = Math.round(performance.now() - t0);
        addTrace('Certificate signed ✓ ' + elapsed + 'ms', 'done');
        
        // Render certificate
        document.getElementById('loading').style.display = 'none';
        const out = document.getElementById('cert-output');
        out.style.display = 'block';
        const r = cert.result;
        out.innerHTML = \`
          <div class="cert-section">
            <div class="cert-k">VERDICT</div>
            <div class="verdict">\${(r.verdict||'—').replace(/_/g,' ')}</div>
          </div>
          <div class="cert-section">
            <div class="cert-k">LIABILITY ALLOCATION</div>
            <div class="liability-bar">
              <div class="bar-vendor" style="width:\${Math.round((r.liability?.primary_party?.share||0)*100)}%"></div>
              \${(r.liability?.secondary_parties||[]).map((p,i) => '<div class="'+(i%2===0?'bar-deployer':'bar-user')+'" style="width:'+Math.round((p.share||0)*100)+'%"></div>').join('')}
            </div>
            <div style="font-size:13px;">
              <div>■ \${r.liability?.primary_party?.name} — <strong>\${Math.round((r.liability?.primary_party?.share||0)*100)}%</strong></div>
              \${(r.liability?.secondary_parties||[]).map(p => '<div>■ '+p.name+' — <strong>'+Math.round((p.share||0)*100)+'%</strong></div>').join('')}
            </div>
          </div>
          <div class="cert-section">
            <div class="cert-k">DAMAGES ESTIMATE</div>
            <div class="damages">\${(r.damages_estimate_cents/100).toLocaleString('en-AU',{style:'currency',currency:r.currency||'AUD'})}</div>
          </div>
          <div class="cert-section">
            <div class="cert-k">CRYPTOGRAPHIC PROOF</div>
            <div style="font-family:var(--font-mono);font-size:12px;">
              <div>Issuer: \${r.certificate?.issuer}</div>
              <div>Algorithm: \${r.certificate?.signature_alg}</div>
              <div>Signature: \${r.certificate?.signature}</div>
            </div>
          </div>
          <p style="font-size:11px;color:var(--graphite-soft);margin-top:16px;border-top:1px dashed var(--rule);padding-top:14px;font-family:var(--font-mono);">\${r._demo_disclaimer || 'Demo output — production certificates include Bitcoin anchoring.'}</p>
        \`;
      } catch(e) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('cert-output').style.display = 'block';
        document.getElementById('cert-output').innerHTML = '<div style="padding:14px;background:rgba(181,48,31,0.06);border-left:3px solid var(--oxide);"><strong>Error:</strong> '+e.message+'</div>';
        addTrace('Error: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Submit & generate certificate';
      }
    }
    
    renderScenarios();
    renderLeft();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
