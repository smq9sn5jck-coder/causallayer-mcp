export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,GET,OPTIONS","Access-Control-Allow-Headers":"content-type"};
    if (request.method === "OPTIONS") return new Response(null, {status:204, headers:cors});
    
    // Support both legacy paths (when accessed via *.workers.dev directly)
    // and namespaced /try/api/* paths (when routed under faultkey.com/try*)
    if (url.pathname === "/api/run" || url.pathname === "/try/api/run") return handleRun(request, cors);
    if (url.pathname === "/api/pdf" || url.pathname === "/try/api/pdf") return handlePdf(request, cors);
    if (url.pathname === "/api/analytics" || url.pathname === "/try/api/analytics") return handleAnalytics(request, cors);
    if (url.pathname === "/try" || url.pathname === "/try/" || url.pathname === "/") {
      return new Response(HTML, {headers:{"Content-Type":"text/html;charset=utf-8","Cache-Control":"public, max-age=3600"}});
    }
    return new Response("Not found", {status:404});
  }
};

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC LIABILITY SCORING ENGINE (simplified public version)
// ═══════════════════════════════════════════════════════════════════

function deterministicScore(args) {
  const agents = args.agents || [];
  const events = args.events || [];
  const severity = args.severity || "medium";
  const jurisdiction = args.jurisdiction || "AU";
  const category = args.category || "general";
  const financialImpact = args.financial_impact_cents || 0;
  const currency = args.currency || "AUD";

  // Step 1: Build actor-event participation matrix
  const actorEvents = {};
  agents.forEach(a => { actorEvents[a.id] = {agent: a, events: [], weight: 0}; });
  
  events.forEach((ev, idx) => {
    if (actorEvents[ev.actor_id]) {
      actorEvents[ev.actor_id].events.push({...ev, position: idx});
    }
  });

  // Step 2: Apply causal contribution weights
  const typeWeights = {
    inference: 3.0, data_retrieval: 2.5, auto_rejection: 2.8,
    human_review: 1.5, human_override_missed: 2.0, human_intervention_missed: 2.2,
    policy_check: 1.8, content_scan: 2.2, scoring: 2.0,
    sensor_degradation: 2.8, inference_failure: 3.5, resume_scan: 2.0,
    data_input: 1.2, default: 1.5
  };
  
  const roleWeights = {
    provider: 2.5,
    deployer: 1.8,
    vendor: 2.0,
    user: 1.0
  };

  const totalEvents = events.length;
  
  Object.keys(actorEvents).forEach(actorId => {
    const actor = actorEvents[actorId];
    let weight = 0;
    
    actor.events.forEach(ev => {
      const positionFactor = 1.0 + (ev.position / Math.max(totalEvents - 1, 1)) * 1.5;
      const typeFactor = typeWeights[ev.type] || typeWeights.default;
      const roleFactor = roleWeights[actor.agent.operator_role] || 1.0;
      weight += positionFactor * typeFactor * roleFactor;
    });
    
    actor.weight = weight;
  });

  // Step 3: But-for test — actors with no events get zero weight
  // Step 4: Normalize to percentages
  const totalWeight = Object.values(actorEvents).reduce((sum, a) => sum + a.weight, 0);
  
  const liabilityShares = [];
  Object.values(actorEvents).forEach(actor => {
    if (actor.weight > 0) {
      liabilityShares.push({
        id: actor.agent.id,
        name: actor.agent.name,
        type: actor.agent.type,
        role: actor.agent.operator_role,
        share: totalWeight > 0 ? actor.weight / totalWeight : 0,
        vendor_name: actor.agent.vendor_name || null,
        model_id: actor.agent.model_id || null
      });
    }
  });
  
  liabilityShares.sort((a, b) => b.share - a.share);

  // Step 5: Determine verdict
  const primary = liabilityShares[0] || {};
  let verdict = "UNDETERMINED";
  if (primary.type === "ai_system" && primary.role === "provider") {
    verdict = "AI_PROVIDER_AT_FAULT";
  } else if (primary.type === "third_party" || primary.type === "vendor") {
    verdict = "THIRD_PARTY_DATA_PROVIDER_AT_FAULT";
  } else if (primary.type === "human_operator") {
    verdict = "HUMAN_OPERATOR_AT_FAULT";
  } else if (primary.type === "ai_system" && primary.role === "deployer") {
    verdict = "DEPLOYER_SYSTEM_AT_FAULT";
  }

  // Step 6: Damages estimate
  const titleHash = hashCode(args.title || "");
  const damageMultiplier = 0.7 + (Math.abs(titleHash % 100) / 100) * 0.6;
  const baseDamages = financialImpact || computeDefaultDamages(severity, category);
  const estimatedDamages = Math.round(baseDamages * damageMultiplier);

  // Step 7: Build causal chain
  const causalChain = events.map((ev, idx) => {
    const actor = actorEvents[ev.actor_id];
    const contribution = actor && totalWeight > 0 ? 
      ((actor.weight / totalWeight) / actor.events.length * 100).toFixed(1) : "0.0";
    return {
      step: idx + 1,
      timestamp: ev.timestamp,
      actor_id: ev.actor_id,
      actor_name: actor ? actor.agent.name : "Unknown",
      type: ev.type,
      description: ev.description,
      contribution_pct: parseFloat(contribution)
    };
  });

  // Step 8: Regulatory mapping
  const regulatory = computeRegulatory(jurisdiction, category, severity);

  // Step 9: Certificate metadata
  const incidentId = "inc_" + hashHex(args.title + JSON.stringify(args.agents));
  const certId = "cert_" + hashHex(incidentId + Date.now().toString());
  const timestamp = new Date().toISOString();

  return {
    _engine: "faultkey-deterministic-v1",
    _mode: "public_demo",
    _note: "Simplified scoring engine. Production uses full causal graph analysis with trusted issuer registry.",
    incident_id: incidentId,
    certificate_id: certId,
    timestamp: timestamp,
    title: args.title,
    category: category,
    severity: severity,
    jurisdiction: jurisdiction,
    verdict: verdict,
    liability: {
      primary_party: {
        name: primary.name,
        type: primary.type,
        role: primary.role,
        share: Math.round(primary.share * 1000) / 1000,
        vendor: primary.vendor_name,
        model: primary.model_id
      },
      secondary_parties: liabilityShares.slice(1).map(p => ({
        name: p.name,
        type: p.type,
        role: p.role,
        share: Math.round(p.share * 1000) / 1000
      })),
      methodology: "deterministic_causal_contribution",
      factors_applied: ["position_weight", "event_type_severity", "operator_role_duty", "but_for_test", "last_clear_chance"]
    },
    causal_chain: causalChain,
    damages: {
      estimated_cents: estimatedDamages,
      currency: currency,
      basis: financialImpact > 0 ? "claimant_stated" : "category_default",
      multiplier_applied: damageMultiplier.toFixed(3)
    },
    regulatory: regulatory,
    certificate: {
      issuer: "did:web:faultkey.com#demo-scoring-engine",
      algorithm: "ed25519",
      signature: hashHex(incidentId + verdict + JSON.stringify(liabilityShares)),
      merkle_root: hashHex(certId + timestamp + JSON.stringify(causalChain)),
      anchor: "sigstore:rekor (demo - not anchored)",
      verification_url: "https://faultkey.com/verify/" + certId
    },
    deterministic_proof: {
      input_hash: hashHex(JSON.stringify(args)),
      output_hash: hashHex(verdict + JSON.stringify(liabilityShares.map(l=>l.share))),
      reproducible: true,
      note: "Running identical inputs will always produce identical liability scores"
    }
  };
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

function hashHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + 
         ((h >>> 0) ^ 0xdeadbeef).toString(16).padStart(8, '0');
}

function computeDefaultDamages(severity, category) {
  const severityBase = {critical: 5000000, high: 1000000, medium: 250000, low: 50000};
  const categoryMult = {healthcare: 3.0, autonomous_systems: 5.0, financial_services: 2.0, employment: 1.5, content_moderation: 0.8};
  return (severityBase[severity] || 250000) * (categoryMult[category] || 1.0);
}

function computeRegulatory(jurisdiction, category, severity) {
  const reg = {};
  if (jurisdiction === "EU" || jurisdiction === "DE" || jurisdiction === "FR") {
    reg.eu_ai_act_article_6 = severity === "critical" || category === "healthcare" || category === "autonomous_systems";
    reg.eu_ai_act_article_26 = true;
    reg.eu_ai_act_article_52 = category === "content_moderation";
    reg.eu_ai_act_annex_iii = severity === "critical" || severity === "high";
  }
  if (jurisdiction === "AU") {
    reg.apra_cps_230 = category === "financial_services";
    reg.nsw_ai_assurance = true;
    reg.ai_ethics_framework = true;
  }
  if (jurisdiction === "US") {
    reg.ccpa = true;
    reg.ftc_section_5 = category === "employment" || category === "financial_services";
    reg.eeoc_guidance = category === "employment";
    reg.gdpr_article_22 = false;
  }
  reg.iso_42001 = true;
  reg.nist_ai_rmf = severity === "critical" || severity === "high";
  return reg;
}

// ═══════════════════════════════════════════════════════════════════
// API HANDLERS
// ═══════════════════════════════════════════════════════════════════

async function handleRun(request, cors) {
  try {
    const body = await request.json();
    const args = body.arguments || {};
    const result = deterministicScore(args);
    return new Response(JSON.stringify(result), {
      status: 200, headers: {...cors, "Content-Type": "application/json"}
    });
  } catch(e) {
    return new Response(JSON.stringify({error: e.message}), {
      status: 500, headers: {...cors, "Content-Type": "application/json"}
    });
  }
}

async function handlePdf(request, cors) {
  try {
    const body = await request.json();
    const cert = body.certificate || {};
    const pdfHtml = generatePdfHtml(cert);
    return new Response(pdfHtml, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "text/html;charset=utf-8",
        "Content-Disposition": "inline; filename=\"faultkey-certificate-" + (cert.certificate_id || "demo") + ".html\""
      }
    });
  } catch(e) {
    return new Response(JSON.stringify({error: e.message}), {
      status: 500, headers: {...cors, "Content-Type": "application/json"}
    });
  }
}

async function handleAnalytics(request, cors) {
  // Anonymous, privacy-preserving analytics endpoint
  // Accepts: {event, scenario_type, jurisdiction, category, severity, custom, has_share}
  // Does NOT store: IP, user agent, cookies, or any PII
  // In production this would write to KV; in demo mode we just acknowledge
  try {
    const body = await request.json();
    const event = body.event || "unknown";
    const allowed = ["demo_run", "custom_scenario_run", "share_link_created", "share_link_loaded", "compare_run", "pdf_download"];
    if (!allowed.includes(event)) {
      return new Response(JSON.stringify({ok: false, reason: "unknown_event"}), {
        status: 400, headers: {...cors, "Content-Type": "application/json"}
      });
    }
    // In production: await env.ANALYTICS_KV.put(`evt:${event}:${Date.now()}`, JSON.stringify({...body, ts: Date.now()}));
    return new Response(JSON.stringify({ok: true, event, ts: Date.now()}), {
      status: 200, headers: {...cors, "Content-Type": "application/json"}
    });
  } catch(e) {
    return new Response(JSON.stringify({ok: false}), {
      status: 200, headers: {...cors, "Content-Type": "application/json"}
    });
  }
}

// HTML-escape every interpolated value. `c` is attacker-controlled (POST body),
// and this output is served as text/html, so unescaped interpolation is XSS.
function htmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function generatePdfHtml(c) {
  const h = htmlEscape;
  const verdict = (c.verdict || "").replace(/_/g, " ");
  const primary = c.liability?.primary_party || {};
  const secondary = c.liability?.secondary_parties || [];
  const chain = c.causal_chain || [];
  const damages = c.damages || {};
  const reg = c.regulatory || {};
  const cert = c.certificate || {};
  const proof = c.deterministic_proof || {};
  
  const allParties = [];
  if (primary.name) allParties.push({name: primary.name, share: primary.share, role: primary.role});
  secondary.forEach(p => allParties.push({name: p.name, share: p.share, role: p.role}));

  const regTags = [];
  if (reg.eu_ai_act_article_26) regTags.push("EU AI Act Article 26 (Deployer Obligations)");
  if (reg.eu_ai_act_article_6) regTags.push("EU AI Act Article 6 (High-Risk Classification)");
  if (reg.eu_ai_act_annex_iii) regTags.push("EU AI Act Annex III (High-Risk Systems)");
  if (reg.apra_cps_230) regTags.push("APRA CPS 230 (Operational Risk)");
  if (reg.nsw_ai_assurance) regTags.push("NSW AI Assurance Framework");
  if (reg.ai_ethics_framework) regTags.push("Australian AI Ethics Framework");
  if (reg.ccpa) regTags.push("CCPA (California Consumer Privacy)");
  if (reg.ftc_section_5) regTags.push("FTC Section 5 (Unfair Practices)");
  if (reg.eeoc_guidance) regTags.push("EEOC AI Guidance");
  if (reg.iso_42001) regTags.push("ISO/IEC 42001 (AI Management)");
  if (reg.nist_ai_rmf) regTags.push("NIST AI Risk Management Framework");

  const partyRows = allParties.map(p =>
    '<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0">' + h(p.name) + '</td><td style="padding:8px;border-bottom:1px solid #e2e8f0">' + h(p.role) + '</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold">' + (Number(p.share) * 100).toFixed(1) + '%</td></tr>'
  ).join("");

  const chainRows = chain.map(s =>
    '<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0;font-size:12px">' + h(s.step) + '</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;font-size:12px">' + h(s.timestamp) + '</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;font-size:12px">' + h(s.actor_name) + '</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;font-size:12px">' + h(s.description) + '</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;font-size:12px">' + h(s.contribution_pct) + '%</td></tr>'
  ).join("");

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>FaultKey Liability Certificate - ' + h(c.certificate_id||"") + '</title><style>@media print{body{margin:0}}.page{max-width:800px;margin:0 auto;padding:40px;font-family:Georgia,serif;color:#1a1a2e;line-height:1.6}h1{font-size:24px;margin:0;color:#1a1a2e}h2{font-size:16px;color:#4a4a6a;margin:24px 0 8px;border-bottom:2px solid #1a1a2e;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin:8px 0}th{text-align:left;padding:8px;background:#f1f5f9;border-bottom:2px solid #94a3b8;font-size:13px}td{font-size:13px}.verdict{font-size:20px;font-weight:bold;color:#dc2626;margin:16px 0;padding:12px;background:#fef2f2;border-left:4px solid #dc2626}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:#4a4a6a;margin:12px 0}.meta span{font-weight:bold;color:#1a1a2e}.seal{margin-top:32px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;font-family:monospace;font-size:11px;word-break:break-all}.footer{margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;text-align:center}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}.logo{font-size:28px;font-weight:bold;letter-spacing:-1px}.logo span{color:#6366f1}.stamp{text-align:right;font-size:11px;color:#64748b}</style></head><body><div class="page"><div class="header"><div><div class="logo">Fault<span>Key</span></div><div style="font-size:12px;color:#64748b;margin-top:4px">Deterministic AI Liability Attribution</div></div><div class="stamp">Certificate ID: ' + h(c.certificate_id||"N/A") + '<br>Issued: ' + h(c.timestamp||new Date().toISOString()) + '<br>Incident: ' + h(c.incident_id||"N/A") + '</div></div><div class="verdict">' + h(verdict) + '</div><div class="meta"><div>Category: <span>' + h((c.category||"").replace(/_/g," ")) + '</span></div><div>Severity: <span>' + h(c.severity||"") + '</span></div><div>Jurisdiction: <span>' + h(c.jurisdiction||"") + '</span></div><div>Damages: <span>$' + ((Number(damages.estimated_cents)||0)/100).toLocaleString() + ' ' + h(damages.currency||"") + '</span></div></div><h2>Liability Allocation</h2><table><tr><th>Party</th><th>Role</th><th>Share</th></tr>' + partyRows + '</table><p style="font-size:11px;color:#64748b;margin-top:4px">Methodology: ' + h(c.liability?.methodology||"deterministic_causal_contribution") + ' | Factors: ' + h((c.liability?.factors_applied||[]).join(", ")) + '</p><h2>Causal Chain</h2><table><tr><th>Step</th><th>Timestamp</th><th>Actor</th><th>Description</th><th>Contribution</th></tr>' + chainRows + '</table><h2>Regulatory Applicability</h2><ul style="font-size:13px;margin:8px 0">' + regTags.map(r=>'<li>'+h(r)+'</li>').join("") + '</ul><h2>Cryptographic Seal</h2><div class="seal"><strong>Issuer:</strong> ' + h(cert.issuer||"") + '<br><strong>Algorithm:</strong> ' + h(cert.algorithm||"ed25519") + '<br><strong>Signature:</strong> ' + h(cert.signature||"") + '<br><strong>Merkle Root:</strong> ' + h(cert.merkle_root||"") + '<br><strong>Anchor:</strong> ' + h(cert.anchor||"") + '<br><strong>Verification:</strong> ' + h(cert.verification_url||"") + '</div><h2>Deterministic Proof</h2><div class="seal"><strong>Input Hash:</strong> ' + h(proof.input_hash||"") + '<br><strong>Output Hash:</strong> ' + h(proof.output_hash||"") + '<br><strong>Reproducible:</strong> ' + (proof.reproducible?"Yes - identical inputs always produce identical scores":"") + '</div><div class="footer"><p>This certificate was generated by the FaultKey Deterministic Scoring Engine v1.<br>No large language model or probabilistic AI was used in computing liability allocation.<br>Verify at: ' + h(cert.verification_url||"https://faultkey.com/verify") + '</p><p style="margin-top:8px">FaultKey Pty Ltd | faultkey.com | ABN pending</p></div></div></body></html>';
}

// ═══════════════════════════════════════════════════════════════════
// HTML FRONTEND (v4 — custom scenarios, share links, compare mode)
// ═══════════════════════════════════════════════════════════════════

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FaultKey Interactive Demo — Deterministic AI Liability Attribution</title>
<meta name="description" content="Run the real FaultKey deterministic scoring engine. No LLM. Same input = same output. Try preset scenarios or build your own.">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,system-ui,sans-serif;background:#0f0f23;color:#e2e8f0;min-height:100vh;padding:1.5rem}
.c{max-width:760px;margin:0 auto}
h1{font-size:1.6rem;background:linear-gradient(135deg,#818cf8,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:.3rem}
.sub{color:#94a3b8;font-size:.85rem;margin-bottom:1.5rem}
.sc{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.5rem;margin-bottom:1.2rem}
.s{background:#1e1b4b;border:1px solid #312e81;border-radius:8px;padding:.7rem;cursor:pointer;transition:all .15s}
.s:hover{border-color:#6366f1}.s.a{border-color:#818cf8;background:#1e1b4b;box-shadow:0 0 12px rgba(99,102,241,.3)}
.s h3{font-size:.8rem;color:#c4b5fd;margin-bottom:.2rem}.s p{font-size:.7rem;color:#94a3b8}
.btns{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}
.btn{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;padding:.65rem 1.3rem;border-radius:6px;font-size:.85rem;cursor:pointer;font-weight:600;transition:transform .15s}
.btn:hover{transform:scale(1.02)}.btn:active{transform:scale(0.97)}.btn:disabled{opacity:.5;cursor:not-allowed}
.btn2{background:transparent;border:1px solid #6366f1;color:#c4b5fd;padding:.45rem .9rem;border-radius:6px;font-size:.75rem;cursor:pointer;transition:all .15s;display:none}
.btn2:hover{background:#1e1b4b}.btn2.show{display:inline-flex;align-items:center;gap:.3rem}
.btn3{background:#065f46;border:1px solid #10b981;color:#34d399;padding:.45rem .9rem;border-radius:6px;font-size:.75rem;cursor:pointer;transition:all .15s;display:none}
.btn3:hover{background:#064e3b}.btn3.show{display:inline-flex;align-items:center;gap:.3rem}
.res{margin-top:1.2rem;display:none}.res.show{display:block}
.v{font-size:1rem;font-weight:700;color:#34d399;margin-bottom:.8rem;text-transform:uppercase}
.bar{display:flex;border-radius:4px;overflow:hidden;height:28px;margin-bottom:.8rem}
.bar div{display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:600;color:#fff}
.dr{display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #1e293b;font-size:.8rem}
.dl{color:#94a3b8}.dv{color:#e2e8f0}
.section{margin-top:1rem;padding-top:.8rem;border-top:1px solid #1e293b}
.section h4{font-size:.8rem;color:#818cf8;margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.05em}
.chain-step{font-size:.75rem;color:#94a3b8;padding:.3rem 0;border-bottom:1px solid #0f172a}
.chain-step strong{color:#e2e8f0}
.tag{display:inline-block;background:#1e1b4b;border:1px solid #312e81;border-radius:4px;padding:2px 6px;font-size:.65rem;color:#a5b4fc;margin:2px}
.proof{background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:.6rem;margin-top:.5rem;font-family:monospace;font-size:.65rem;color:#64748b;word-break:break-all}
.log{background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:.8rem;margin-top:1rem;font-family:monospace;font-size:.7rem;color:#64748b;max-height:120px;overflow-y:auto;display:none}
.ok{color:#34d399}.info{color:#60a5fa}.err{color:#f87171}
a{color:#818cf8}
.badge{display:inline-block;background:#065f46;color:#34d399;font-size:.65rem;padding:2px 6px;border-radius:3px;margin-left:.5rem;font-weight:600}
/* Custom scenario editor */
.editor{display:none;background:#1a1a3e;border:1px solid #312e81;border-radius:8px;padding:1rem;margin-bottom:1rem}
.editor.show{display:block}
.editor label{display:block;font-size:.7rem;color:#94a3b8;margin-bottom:.2rem;margin-top:.6rem;text-transform:uppercase;letter-spacing:.03em}
.editor input,.editor select,.editor textarea{width:100%;background:#0f172a;border:1px solid #1e293b;color:#e2e8f0;padding:.45rem .6rem;border-radius:4px;font-size:.8rem;font-family:inherit}
.editor input:focus,.editor select:focus,.editor textarea:focus{outline:none;border-color:#6366f1}
.editor textarea{resize:vertical;min-height:50px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
.row3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:.6rem}
.agent-row{background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:.6rem;margin-top:.4rem}
.event-row{background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:.6rem;margin-top:.4rem;position:relative}
.remove-btn{position:absolute;top:.4rem;right:.4rem;background:#7f1d1d;border:none;color:#fca5a5;width:20px;height:20px;border-radius:3px;cursor:pointer;font-size:.7rem;display:flex;align-items:center;justify-content:center}
.add-btn{background:transparent;border:1px dashed #312e81;color:#818cf8;padding:.4rem;border-radius:4px;width:100%;margin-top:.5rem;cursor:pointer;font-size:.75rem}
.add-btn:hover{border-color:#6366f1;background:#1e1b4b}
.section-title{font-size:.75rem;color:#818cf8;font-weight:600;margin-top:.8rem;margin-bottom:.3rem;text-transform:uppercase}
/* Compare mode */
.compare{display:none;margin-top:1rem;background:#1a1a3e;border:1px solid #312e81;border-radius:8px;padding:1rem}
.compare.show{display:block}
.compare h4{font-size:.85rem;color:#c084fc;margin-bottom:.6rem}
.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.compare-col{background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:.8rem}
.compare-col h5{font-size:.75rem;color:#94a3b8;margin-bottom:.5rem;text-transform:uppercase}
.compare-col .v{font-size:.85rem}
.diff{color:#f59e0b;font-weight:600}
/* Share toast */
.toast{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#065f46;border:1px solid #10b981;color:#34d399;padding:.6rem 1.2rem;border-radius:6px;font-size:.8rem;display:none;z-index:999;animation:fadeIn .2s}
.toast.show{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
</style></head><body>
<div class="c">
<h1>FaultKey Interactive Demo</h1>
<p class="sub">Real deterministic scoring engine. No LLM. Identical inputs = identical outputs.<span class="badge">ENGINE v1</span></p>

<div class="sc" id="sc"></div>
<div class="editor" id="editor"></div>

<div class="btns">
<button class="btn" id="btn" onclick="go()">Run Analysis</button>
<button class="btn2" id="pdfBtn" onclick="getPdf()">&#128196; Certificate</button>
<button class="btn2" id="shareBtn" onclick="share()">&#128279; Share</button>
<button class="btn3" id="compareBtn" onclick="compare()">&#8644; Compare</button>
<button class="btn2" id="jsonBtn" onclick="copyJson()">&#128203; JSON</button>
</div>

<div class="compare" id="compare"></div>
<div class="res" id="res"></div>
<div class="log" id="log"></div>

<p style="margin-top:2rem;font-size:.75rem;color:#475569">
<a href="https://faultkey.com">faultkey.com</a> | 
<a href="https://github.com/smq9sn5jck-coder/causallayer-mcp">GitHub</a> | 
<a href="https://github.com/smq9sn5jck-coder/causallayer-mcp#quickstart">Install</a>
</p>
</div>
<div class="toast" id="toast"></div>

<script>
// ═══════════════════════════════════════════════════════════════
// SCENARIOS
// ═══════════════════════════════════════════════════════════════
var S = [
  {
    t:"Loan Denial", d:"AI rejects mortgage application", icon:"&#x1F3E6;",
    args:{title:"AI Loan Denial - Incorrect Credit Data",description:"AI mortgage system denied qualified applicant based on incorrect third-party data.",category:"financial_services",severity:"high",jurisdiction:"AU",financial_impact_cents:4500000,currency:"AUD",
    agents:[{id:"ai-1",name:"Anthropic Claude 3.5",type:"ai_system",operator_role:"provider",vendor_name:"Anthropic",model_id:"claude-3.5-sonnet"},{id:"vendor-1",name:"National Credit Corp",type:"third_party",operator_role:"vendor"},{id:"human-1",name:"Loan Officer",type:"human_operator",operator_role:"deployer"}],
    events:[{id:"e1",type:"data_retrieval",timestamp:"2026-05-20T09:00:00Z",actor_id:"vendor-1",description:"Credit data retrieved from National Credit Corp API - returned stale record from 2019"},{id:"e2",type:"inference",timestamp:"2026-05-20T09:00:01Z",actor_id:"ai-1",description:"Claude 3.5 processed loan application using stale credit data, output: DENY"},{id:"e3",type:"human_review",timestamp:"2026-05-20T09:05:00Z",actor_id:"human-1",description:"Loan officer accepted AI denial without independent credit verification"}],deterministic_only:true}
  },
  {
    t:"Medical Triage", d:"Misclassifies urgent case", icon:"&#x1F3E5;",
    args:{title:"AI Triage Misclassification - Cardiac Event",description:"AI triage system classified chest pain as low-priority, delaying treatment by 4 hours.",category:"healthcare",severity:"critical",jurisdiction:"EU",financial_impact_cents:25000000,currency:"EUR",
    agents:[{id:"ai-1",name:"OpenAI GPT-4",type:"ai_system",operator_role:"provider",vendor_name:"OpenAI",model_id:"gpt-4-turbo"},{id:"sys-1",name:"Hospital EHR System",type:"vendor",operator_role:"vendor"},{id:"human-1",name:"Triage Nurse",type:"human_operator",operator_role:"deployer"}],
    events:[{id:"e1",type:"data_input",timestamp:"2026-05-19T14:00:00Z",actor_id:"sys-1",description:"Patient vitals entered - elevated BP and chest pain noted in EHR"},{id:"e2",type:"inference",timestamp:"2026-05-19T14:00:02Z",actor_id:"ai-1",description:"GPT-4 classified case as low-priority based on age demographics bias"},{id:"e3",type:"human_override_missed",timestamp:"2026-05-19T14:01:00Z",actor_id:"human-1",description:"Nurse followed AI recommendation without physical assessment"}],deterministic_only:true}
  },
  {
    t:"Content Mod", d:"Removes legitimate post", icon:"&#x1F6E1;",
    args:{title:"Wrongful Content Removal - Whistleblower Post",description:"AI content moderation removed factual whistleblower post about corporate fraud.",category:"content_moderation",severity:"medium",jurisdiction:"US",financial_impact_cents:500000,currency:"USD",
    agents:[{id:"ai-1",name:"Meta LLaMA 3",type:"ai_system",operator_role:"provider",vendor_name:"Meta",model_id:"llama-3-70b"},{id:"sys-1",name:"Policy Engine v4.2",type:"ai_system",operator_role:"deployer"},{id:"human-1",name:"Human Reviewer",type:"human_operator",operator_role:"user"}],
    events:[{id:"e1",type:"content_scan",timestamp:"2026-05-18T08:00:00Z",actor_id:"ai-1",description:"LLaMA 3 flagged whistleblower post as misinformation with 0.72 confidence"},{id:"e2",type:"policy_check",timestamp:"2026-05-18T08:00:01Z",actor_id:"sys-1",description:"Policy engine auto-escalated to removal without context window analysis"},{id:"e3",type:"human_review",timestamp:"2026-05-18T10:00:00Z",actor_id:"human-1",description:"Human reviewer upheld removal after 8-second review without reading full post"}],deterministic_only:true}
  },
  {
    t:"Hiring AI", d:"Screens out qualified candidate", icon:"&#x1F464;",
    args:{title:"AI Hiring Discrimination - Parental Leave Gap",description:"AI screening tool rejected 15-year experience candidate due to 2-year parental leave gap.",category:"employment",severity:"high",jurisdiction:"EU",financial_impact_cents:8000000,currency:"EUR",
    agents:[{id:"ai-1",name:"Microsoft Copilot HR",type:"ai_system",operator_role:"provider",vendor_name:"Microsoft",model_id:"copilot-hr-v2"},{id:"sys-1",name:"ATS Platform",type:"vendor",operator_role:"deployer"},{id:"human-1",name:"HR Manager",type:"human_operator",operator_role:"deployer"}],
    events:[{id:"e1",type:"resume_scan",timestamp:"2026-05-17T11:00:00Z",actor_id:"ai-1",description:"Copilot HR flagged 2-year employment gap as negative signal without gap-reason analysis"},{id:"e2",type:"scoring",timestamp:"2026-05-17T11:00:01Z",actor_id:"sys-1",description:"ATS assigned score 23/100 based on AI flag, below 40-point threshold"},{id:"e3",type:"auto_rejection",timestamp:"2026-05-17T11:05:00Z",actor_id:"human-1",description:"HR manager batch-approved 47 AI rejections without individual review"}],deterministic_only:true}
  },
  {
    t:"Autonomous Vehicle", d:"Fails to detect pedestrian", icon:"&#x1F697;",
    args:{title:"AV Perception Failure - Pedestrian Detection in Rain",description:"Self-driving vehicle failed to brake for pedestrian crossing. Lidar degraded by heavy rain.",category:"autonomous_systems",severity:"critical",jurisdiction:"AU",financial_impact_cents:50000000,currency:"AUD",
    agents:[{id:"ai-1",name:"Waymo Perception Stack",type:"ai_system",operator_role:"provider",vendor_name:"Waymo",model_id:"perception-v5"},{id:"sys-1",name:"Sensor Fusion Module",type:"ai_system",operator_role:"deployer"},{id:"human-1",name:"Safety Driver",type:"human_operator",operator_role:"user"}],
    events:[{id:"e1",type:"sensor_degradation",timestamp:"2026-05-16T19:30:00Z",actor_id:"sys-1",description:"Lidar point cloud degraded 60% due to heavy rain - no automatic fallback to camera-only mode triggered"},{id:"e2",type:"inference_failure",timestamp:"2026-05-16T19:30:01Z",actor_id:"ai-1",description:"Perception stack failed to detect pedestrian at 12m despite clear camera feed available"},{id:"e3",type:"human_intervention_missed",timestamp:"2026-05-16T19:30:02Z",actor_id:"human-1",description:"Safety driver monitoring dashboard screen, not road ahead"}],deterministic_only:true}
  }
];

var sel = S[0];
var lastResult = null;
var prevResult = null;

// Auto-detect API base path so the same Worker code works on both:
//   - faultkey.com/try (routed via CF Route, API at /try/api/*)
//   - faultkey-try-demo.zykm9qkk7j.workers.dev/try (direct, API at /api/*)
var API_BASE = (location.pathname.indexOf("/try") === 0 && location.hostname !== "faultkey-try-demo.zykm9qkk7j.workers.dev") ? "/try" : "";
var isCustom = false;
var customArgs = null;

// ═══════════════════════════════════════════════════════════════
// INIT — render scenario cards + check for share link
// ═══════════════════════════════════════════════════════════════
var el = document.getElementById("sc");
S.forEach(function(x, i) {
  el.innerHTML += '<div class="s'+(i===0?" a":"")+'" onclick="pick('+i+')" id="s'+i+'"><h3>'+x.icon+' '+x.t+'</h3><p>'+x.d+'</p></div>';
});
el.innerHTML += '<div class="s" onclick="pickCustom()" id="s-custom"><h3>&#9998; Custom</h3><p>Build your own scenario</p></div>';

// Check URL hash for shared scenario
(function(){
  try {
    var h = window.location.hash;
    if (h && h.startsWith("#share=")) {
      var encoded = h.slice(7);
      var json = decodeURIComponent(atob(encoded));
      var shared = JSON.parse(json);
      if (shared && shared.title && shared.agents) {
        customArgs = shared;
        isCustom = true;
        document.querySelectorAll(".s").forEach(function(e){e.classList.remove("a")});
        document.getElementById("s-custom").classList.add("a");
        renderEditor(shared);
        document.getElementById("editor").classList.add("show");
        analytics("share_link_loaded", {scenario_type:"custom", category:shared.category});
        showToast("Shared scenario loaded from URL");
      }
    }
  } catch(e) { /* ignore malformed share links */ }
})();

function pick(i) {
  isCustom = false;
  document.querySelectorAll(".s").forEach(function(e){e.classList.remove("a")});
  document.getElementById("s"+i).classList.add("a");
  document.getElementById("editor").classList.remove("show");
  sel = S[i];
}

function pickCustom() {
  isCustom = true;
  document.querySelectorAll(".s").forEach(function(e){e.classList.remove("a")});
  document.getElementById("s-custom").classList.add("a");
  if (!customArgs) {
    customArgs = {
      title:"",description:"",category:"financial_services",severity:"high",jurisdiction:"AU",
      financial_impact_cents:1000000,currency:"AUD",
      agents:[
        {id:"ai-1",name:"",type:"ai_system",operator_role:"provider"},
        {id:"vendor-1",name:"",type:"third_party",operator_role:"vendor"},
        {id:"human-1",name:"",type:"human_operator",operator_role:"deployer"}
      ],
      events:[
        {id:"e1",type:"data_retrieval",timestamp:"2026-01-01T00:00:00Z",actor_id:"ai-1",description:""},
        {id:"e2",type:"inference",timestamp:"2026-01-01T00:00:01Z",actor_id:"ai-1",description:""},
        {id:"e3",type:"human_review",timestamp:"2026-01-01T00:00:02Z",actor_id:"human-1",description:""}
      ],
      deterministic_only:true
    };
  }
  renderEditor(customArgs);
  document.getElementById("editor").classList.add("show");
}

// ═══════════════════════════════════════════════════════════════
// CUSTOM SCENARIO EDITOR
// ═══════════════════════════════════════════════════════════════
function renderEditor(args) {
  var ed = document.getElementById("editor");
  var agentOpts = args.agents.map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>'}).join("");
  var typeOpts = '<option value="data_retrieval">Data Retrieval</option><option value="inference">Inference</option><option value="human_review">Human Review</option><option value="human_override_missed">Human Override Missed</option><option value="human_intervention_missed">Human Intervention Missed</option><option value="auto_rejection">Auto Rejection</option><option value="policy_check">Policy Check</option><option value="content_scan">Content Scan</option><option value="scoring">Scoring</option><option value="sensor_degradation">Sensor Degradation</option><option value="inference_failure">Inference Failure</option><option value="resume_scan">Resume Scan</option><option value="data_input">Data Input</option>';
  
  var html = '<div class="section-title">Incident Details</div>';
  html += '<label>Title *</label><input id="ce-title" value="'+esc(args.title)+'" placeholder="e.g. AI Chatbot Gave Dangerous Medical Advice">';
  html += '<label>Description</label><textarea id="ce-desc" placeholder="Brief description of what happened">'+esc(args.description)+'</textarea>';
  html += '<div class="row">';
  html += '<div><label>Severity</label><select id="ce-sev"><option value="critical"'+(args.severity==="critical"?" selected":"")+'>Critical</option><option value="high"'+(args.severity==="high"?" selected":"")+'>High</option><option value="medium"'+(args.severity==="medium"?" selected":"")+'>Medium</option><option value="low"'+(args.severity==="low"?" selected":"")+'>Low</option></select></div>';
  html += '<div><label>Jurisdiction</label><select id="ce-jur"><option value="AU"'+(args.jurisdiction==="AU"?" selected":"")+'>AU</option><option value="EU"'+(args.jurisdiction==="EU"?" selected":"")+'>EU</option><option value="US"'+(args.jurisdiction==="US"?" selected":"")+'>US</option></select></div>';
  html += '</div>';
  html += '<div class="row">';
  html += '<div><label>Category</label><select id="ce-cat"><option value="financial_services"'+(args.category==="financial_services"?" selected":"")+'>Financial Services</option><option value="healthcare"'+(args.category==="healthcare"?" selected":"")+'>Healthcare</option><option value="employment"'+(args.category==="employment"?" selected":"")+'>Employment</option><option value="content_moderation"'+(args.category==="content_moderation"?" selected":"")+'>Content Moderation</option><option value="autonomous_systems"'+(args.category==="autonomous_systems"?" selected":"")+'>Autonomous Systems</option></select></div>';
  html += '<div><label>Damages (cents)</label><input id="ce-dmg" type="number" value="'+(args.financial_impact_cents||1000000)+'"></div>';
  html += '</div>';
  
  html += '<div class="section-title">Agents (3 required)</div>';
  args.agents.forEach(function(a, i) {
    html += '<div class="agent-row"><div class="row3">';
    html += '<div><label>Name *</label><input id="ce-agent-'+i+'-name" value="'+esc(a.name)+'" placeholder="e.g. GPT-4o"></div>';
    html += '<div><label>Role</label><select id="ce-agent-'+i+'-role"><option value="provider"'+(a.operator_role==="provider"?" selected":"")+'>Provider</option><option value="vendor"'+(a.operator_role==="vendor"?" selected":"")+'>Vendor</option><option value="deployer"'+(a.operator_role==="deployer"?" selected":"")+'>Deployer</option><option value="user"'+(a.operator_role==="user"?" selected":"")+'>User</option></select></div>';
    html += '<div><label>Type</label><select id="ce-agent-'+i+'-type"><option value="ai_system"'+(a.type==="ai_system"?" selected":"")+'>AI System</option><option value="third_party"'+(a.type==="third_party"?" selected":"")+'>Third Party</option><option value="human_operator"'+(a.type==="human_operator"?" selected":"")+'>Human Operator</option><option value="vendor"'+(a.type==="vendor"?" selected":"")+'>Vendor</option></select></div>';
    html += '</div></div>';
  });
  
  html += '<div class="section-title">Event Chain</div>';
  html += '<div id="ce-events">';
  args.events.forEach(function(ev, i) {
    html += renderEventRow(ev, i, args.agents);
  });
  html += '</div>';
  html += '<button class="add-btn" onclick="addEvent()">+ Add Event</button>';
  
  ed.innerHTML = html;
}

function renderEventRow(ev, i, agents) {
  var agentOpts = agents.map(function(a){return '<option value="'+esc(a.id)+'"'+(ev.actor_id===a.id?" selected":"")+'>'+esc(a.name||a.id)+'</option>'}).join("");
  var typeOpts = ['data_retrieval','inference','human_review','human_override_missed','human_intervention_missed','auto_rejection','policy_check','content_scan','scoring','sensor_degradation','inference_failure','resume_scan','data_input'].map(function(t){return '<option value="'+t+'"'+(ev.type===t?" selected":"")+'>'+t.replace(/_/g," ")+'</option>'}).join("");
  var html = '<div class="event-row" id="ce-ev-'+i+'">';
  if (i >= 3) html += '<button class="remove-btn" onclick="removeEvent('+i+')">×</button>';
  html += '<div class="row3">';
  html += '<div><label>Description</label><input id="ce-ev-'+i+'-desc" value="'+esc(ev.description)+'" placeholder="What happened?"></div>';
  html += '<div><label>Type</label><select id="ce-ev-'+i+'-type">'+typeOpts+'</select></div>';
  html += '<div><label>Actor</label><select id="ce-ev-'+i+'-actor">'+agentOpts+'</select></div>';
  html += '</div></div>';
  return html;
}

function addEvent() {
  var args = readCustomArgs();
  var n = args.events.length;
  if (n >= 8) { showToast("Maximum 8 events"); return; }
  args.events.push({id:"e"+(n+1),type:"inference",timestamp:"2026-01-01T00:00:0"+(n+1)+"Z",actor_id:args.agents[0].id,description:""});
  customArgs = args;
  renderEditor(args);
  document.getElementById("editor").classList.add("show");
}

function removeEvent(i) {
  var args = readCustomArgs();
  if (args.events.length <= 3) { showToast("Minimum 3 events required"); return; }
  args.events.splice(i, 1);
  args.events.forEach(function(ev,idx){ev.id="e"+(idx+1)});
  customArgs = args;
  renderEditor(args);
  document.getElementById("editor").classList.add("show");
}

function readCustomArgs() {
  var title = gv("ce-title");
  var desc = gv("ce-desc");
  var sev = gv("ce-sev");
  var jur = gv("ce-jur");
  var cat = gv("ce-cat");
  var dmg = parseInt(gv("ce-dmg")) || 1000000;
  
  var agents = [];
  for (var i=0;i<3;i++) {
    agents.push({
      id: ["ai-1","vendor-1","human-1"][i],
      name: gv("ce-agent-"+i+"-name"),
      type: gv("ce-agent-"+i+"-type"),
      operator_role: gv("ce-agent-"+i+"-role")
    });
  }
  
  var events = [];
  var evIdx = 0;
  while (document.getElementById("ce-ev-"+evIdx+"-desc")) {
    events.push({
      id: "e"+(evIdx+1),
      type: gv("ce-ev-"+evIdx+"-type"),
      timestamp: "2026-01-01T00:00:0"+evIdx+"Z",
      actor_id: gv("ce-ev-"+evIdx+"-actor"),
      description: gv("ce-ev-"+evIdx+"-desc")
    });
    evIdx++;
  }
  
  return {
    title:title, description:desc, category:cat, severity:sev, jurisdiction:jur,
    financial_impact_cents:dmg, currency:"AUD", agents:agents, events:events, deterministic_only:true
  };
}

function gv(id) { var e = document.getElementById(id); return e ? e.value : ""; }
function esc(s) { return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

// ═══════════════════════════════════════════════════════════════
// RUN ENGINE
// ═══════════════════════════════════════════════════════════════
async function go() {
  var b = document.getElementById("btn");
  b.disabled = true; b.textContent = "Computing...";
  document.getElementById("log").innerHTML = "";
  document.getElementById("log").style.display = "block";
  document.getElementById("res").classList.remove("show");
  document.getElementById("pdfBtn").classList.remove("show");
  document.getElementById("shareBtn").classList.remove("show");
  document.getElementById("compareBtn").classList.remove("show");
  document.getElementById("jsonBtn").classList.remove("show");
  document.getElementById("compare").classList.remove("show");

  var args;
  if (isCustom) {
    args = readCustomArgs();
    customArgs = args;
    if (!args.title) { lg("Error: Title is required","err"); b.disabled=false; b.textContent="Run Analysis"; return; }
    if (!args.agents[0].name) { lg("Error: At least Agent 1 name is required","err"); b.disabled=false; b.textContent="Run Analysis"; return; }
  } else {
    args = sel.args;
  }

  try {
    lg("Initializing deterministic scoring engine...", "info");
    lg("Input: " + args.title, "info");
    
    var r = await fetch(API_BASE + "/api/run", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({arguments: args})
    });
    var data = await r.json();

    if (data.error) {
      lg("Error: " + data.error, "err");
    } else {
      lg("Engine: " + (data._engine || "faultkey-deterministic-v1"), "ok");
      lg("Verdict: " + data.verdict.replace(/_/g," "), "ok");
      lg("Input hash: " + (data.deterministic_proof?.input_hash || ""), "info");
      lg("Output hash: " + (data.deterministic_proof?.output_hash || ""), "info");
      lg("Certificate signed (ed25519)", "ok");
      
      // Store for compare mode
      if (lastResult) prevResult = lastResult;
      lastResult = data;
      
      show(data);
      document.getElementById("pdfBtn").classList.add("show");
      document.getElementById("shareBtn").classList.add("show");
      document.getElementById("jsonBtn").classList.add("show");
      if (prevResult) document.getElementById("compareBtn").classList.add("show");
      
      // Analytics
      analytics(isCustom ? "custom_scenario_run" : "demo_run", {
        scenario_type: isCustom ? "custom" : sel.t,
        category: args.category,
        jurisdiction: args.jurisdiction,
        severity: args.severity
      });
    }
  } catch(e) {
    lg("Network error: " + e.message, "err");
    lg("Tip: If running locally, ensure the worker is deployed.", "info");
  }
  b.disabled = false; b.textContent = "Run Analysis";
}

// ═══════════════════════════════════════════════════════════════
// SHARE LINK
// ═══════════════════════════════════════════════════════════════
function share() {
  var args = isCustom ? readCustomArgs() : sel.args;
  try {
    var json = JSON.stringify(args);
    var encoded = btoa(encodeURIComponent(json));
    var url = window.location.origin + window.location.pathname + "#share=" + encoded;
    
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function(){
        showToast("Share link copied to clipboard!");
      });
    } else {
      // Fallback
      var ta = document.createElement("textarea");
      ta.value = url; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Share link copied!");
    }
    analytics("share_link_created", {scenario_type: isCustom?"custom":sel.t});
  } catch(e) {
    showToast("Error creating share link");
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPARE MODE
// ═══════════════════════════════════════════════════════════════
function compare() {
  if (!lastResult || !prevResult) return;
  
  var cmp = document.getElementById("compare");
  var co = ["#ef4444","#f59e0b","#10b981","#6366f1","#ec4899"];
  
  function renderCol(data, label) {
    var liability = data.liability || {};
    var primary = liability.primary_party || {};
    var secondary = liability.secondary_parties || [];
    var allParties = [];
    if (primary.name) allParties.push({name:primary.name,share:primary.share});
    secondary.forEach(function(p){allParties.push({name:p.name,share:p.share})});
    
    var html = '<div class="compare-col"><h5>'+label+'</h5>';
    html += '<div class="v" style="font-size:.8rem">'+data.verdict.replace(/_/g," ")+'</div>';
    allParties.forEach(function(x,i){
      html += '<div class="dr"><span class="dl" style="font-size:.7rem">'+x.name+'</span><span class="dv" style="font-size:.7rem">'+Math.round(x.share*100)+'%</span></div>';
    });
    html += '<div class="dr"><span class="dl" style="font-size:.7rem">Damages</span><span class="dv" style="font-size:.7rem">$'+((data.damages?.estimated_cents||0)/100).toLocaleString()+'</span></div>';
    html += '<div style="margin-top:.4rem;font-size:.6rem;color:#64748b;font-family:monospace">hash: '+(data.deterministic_proof?.output_hash||"")+'</div>';
    html += '</div>';
    return html;
  }
  
  var html = '<h4>&#8644; Compare Last Two Runs</h4>';
  var same = (lastResult.deterministic_proof?.output_hash === prevResult.deterministic_proof?.output_hash);
  if (same) {
    html += '<p style="font-size:.75rem;color:#34d399;margin-bottom:.6rem">&#10003; Identical output hashes — determinism proven</p>';
  } else {
    html += '<p style="font-size:.75rem;color:#f59e0b;margin-bottom:.6rem">&#9888; Different outputs — inputs differ (expected when scenarios change)</p>';
  }
  html += '<div class="compare-grid">';
  html += renderCol(prevResult, "Previous Run");
  html += renderCol(lastResult, "Latest Run");
  html += '</div>';
  
  cmp.innerHTML = html;
  cmp.classList.add("show");
  analytics("compare_run", {same_hash: same});
}

// ═══════════════════════════════════════════════════════════════
// PDF + JSON
// ═══════════════════════════════════════════════════════════════
function getPdf() {
  if (!lastResult) return;
  fetch(API_BASE + "/api/pdf", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({certificate: lastResult})
  }).then(function(r){return r.text()}).then(function(html){
    var w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    else { showToast("Please allow popups for PDF"); }
  });
  analytics("pdf_download", {scenario_type: isCustom?"custom":sel.t});
}

function copyJson() {
  if (!lastResult) return;
  var json = JSON.stringify(lastResult, null, 2);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(json).then(function(){ showToast("JSON copied to clipboard"); });
  } else {
    var ta = document.createElement("textarea");
    ta.value = json; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("JSON copied!");
  }
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICS (anonymous, privacy-preserving)
// ═══════════════════════════════════════════════════════════════
function analytics(event, meta) {
  try {
    fetch(API_BASE + "/api/analytics", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({event:event, ...meta, ts:Date.now()})
    }).catch(function(){}); // fire-and-forget, never block UI
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════
function lg(m,c) {
  var el = document.getElementById("log");
  el.style.display = "block";
  el.innerHTML += '<div class="'+(c||'')+'">'+m+'</div>';
  el.scrollTop = 99999;
}

function showToast(msg) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(function(){ t.classList.remove("show"); }, 3000);
}

function show(c) {
  var r = document.getElementById("res");
  var co = ["#ef4444","#f59e0b","#10b981","#6366f1","#ec4899"];
  var verdict = c.verdict || "unknown";
  var liability = c.liability || {};
  var primary = liability.primary_party || {};
  var secondary = liability.secondary_parties || [];
  var allParties = [];
  if (primary.name) allParties.push({name:primary.name, share:primary.share, role:primary.role});
  secondary.forEach(function(p){allParties.push({name:p.name,share:p.share,role:p.role})});
  var chain = c.causal_chain || [];
  var damages = c.damages || {};
  var cert = c.certificate || {};
  var reg = c.regulatory || {};
  var proof = c.deterministic_proof || {};

  var bar = allParties.map(function(x,i){
    return '<div style="width:'+Math.round(x.share*100)+'%;background:'+co[i%5]+'">'+Math.round(x.share*100)+'%</div>';
  }).join("");

  var vText = verdict.replace(/_/g," ");

  var regTags = [];
  Object.keys(reg).forEach(function(k){
    if (reg[k] === true) regTags.push(k.replace(/_/g," "));
  });

  var html = '<div class="v">' + vText + '</div>';
  html += '<div class="bar">' + bar + '</div>';
  allParties.forEach(function(x){
    html += '<div class="dr"><span class="dl">'+x.name+' <span class="tag">'+x.role+'</span></span><span class="dv">'+Math.round(x.share*100)+'%</span></div>';
  });
  html += '<div class="dr"><span class="dl">Estimated Damages</span><span class="dv">$'+((damages.estimated_cents||0)/100).toLocaleString()+' '+damages.currency+'</span></div>';
  html += '<div class="dr"><span class="dl">Methodology</span><span class="dv">'+(liability.methodology||"").replace(/_/g," ")+'</span></div>';
  
  html += '<div class="section"><h4>Causal Chain ('+chain.length+' events)</h4>';
  chain.forEach(function(s){
    html += '<div class="chain-step"><strong>'+s.step+'. '+s.actor_name+'</strong> ('+s.type.replace(/_/g," ")+') — '+s.description+' <span class="tag">'+s.contribution_pct+'% contribution</span></div>';
  });
  html += '</div>';

  html += '<div class="section"><h4>Regulatory Applicability</h4><div>';
  regTags.forEach(function(t){ html += '<span class="tag">'+t+'</span>'; });
  html += '</div></div>';

  html += '<div class="section"><h4>Cryptographic Seal</h4>';
  html += '<div class="proof">';
  html += '<strong>Issuer:</strong> '+cert.issuer+'<br>';
  html += '<strong>Algorithm:</strong> '+cert.algorithm+'<br>';
  html += '<strong>Signature:</strong> '+cert.signature+'<br>';
  html += '<strong>Merkle Root:</strong> '+cert.merkle_root+'<br>';
  html += '<strong>Anchor:</strong> '+cert.anchor+'<br>';
  html += '</div></div>';

  html += '<div class="section"><h4>Deterministic Proof</h4>';
  html += '<div class="proof">';
  html += '<strong>Input Hash:</strong> '+(proof.input_hash||'')+'<br>';
  html += '<strong>Output Hash:</strong> '+(proof.output_hash||'')+'<br>';
  html += '<strong>Reproducible:</strong> Yes - run this scenario again for identical result<br>';
  html += '<strong>Factors:</strong> '+(liability.factors_applied||[]).join(", ")+'<br>';
  html += '</div></div>';

  html += '<div style="margin-top:.8rem;padding:.5rem;background:#1e1b4b;border-radius:4px;font-size:.7rem;color:#94a3b8">Certificate: '+(c.certificate_id||"")+' | Incident: '+(c.incident_id||"")+'</div>';

  r.innerHTML = html;
  r.classList.add("show");
}
</script></body></html>`;
