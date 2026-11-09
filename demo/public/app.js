/* Agent Research Pass — browser client.
 *
 * Follows internet-court/internet-court-skill, integrations/x402-erc7710:
 *  - 402 flow: GET the protected resource, get x402 requirements, validate
 *    them against the AgentSpendPolicy, sign an intent envelope, pay, and
 *    verify the service-signed receipt.
 *  - Signed Evidence Pattern: intent envelope + service-signed receipt,
 *    stable JSON canonicalisation, payload hashes.
 *  - Dispute: receipt + report go to Internet Court / GenLayer; the
 *    decision payload is continue / warn / constrain / revoke / escalate.
 *
 * The jury verdict and the settlement in this demo are SIMULATED (see the
 * banner on the page and /api/config). Nothing here touches mainnet.
 */
"use strict";

let config = null;
let agentWallet = null;
let agentPackage = null;
let lastReceipt = null;

const $ = (id) => document.getElementById(id);

function log(msg) {
  const el = $("log");
  el.textContent += new Date().toISOString() + "  " + msg + "\n";
  el.scrollTop = el.scrollHeight;
}
function show(id, html, cls) {
  const el = $(id);
  el.innerHTML = html;
  el.className = "card" + (cls ? " " + cls : "");
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}
async function api(path, opts) {
  const res = await fetch(path, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* keep raw text */ }
  return { status: res.status, json, text };
}

async function loadConfig() {
  const r = await api("/api/config");
  config = r.json;
  $("policy").innerHTML =
    "<b>Network:</b> " + esc(config.network) + " (chainId " + config.chainId + ")<br>" +
    "<b>Token:</b> " + esc(config.token) + " — address: <b>" + (config.usdcBaseSepoliaAddress || "MISSING") + "</b><br>" +
    "<b>Price:</b> " + esc(config.price) + " per report<br>" +
    "<b>Cap:</b> " + (config.maxPerRequestMicroUsdc / 1e6).toFixed(2) + " USDC per request, " +
    (config.maxPerPeriodMicroUsdc / 1e6).toFixed(2) + " USDC per week, " +
    config.validDays + "-day expiry<br>" +
    "<b>Route:</b> " + esc(config.allowedResourcePattern) + "<br>" +
    "<b>Permission type:</b> " + esc(config.permissionType) + "<br>" +
    "<b>Provider (payee):</b> " + esc(config.providerWallet) + "<br>" +
    "<b>BridgeSender (Base, documented):</b> " + esc(config.bridgeSenderBase) + "<br>" +
    "<b>GenLayer supervisor:</b> <b>" + (config.genLayerSupervisorAddress || "MISSING") + "</b><br>" +
    "<b>Missing:</b><br>" + config.missing.map((m) => "• " + esc(m)).join("<br>");
  log("Config loaded. Missing items: " + config.missing.length);
}

// Policy validation, mirrored from the server (SKILL.md, Subscription Pattern).
function validateRequirements(req, policy) {
  if (!req) return { ok: false, reason: "missing payment requirements" };
  if (req.chainId !== config.chainId) return { ok: false, reason: "wrong network: expected chainId " + config.chainId };
  if (req.amountMicro > config.maxPerRequestMicroUsdc) return { ok: false, reason: "amount exceeds cap: " + (req.amountMicro / 1e6).toFixed(2) + " USDC > max " + (config.maxPerRequestMicroUsdc / 1e6).toFixed(2) + " USDC per request" };
  if (req.payTo.toLowerCase() !== policy.allowedPayTo.toLowerCase()) return { ok: false, reason: "merchant mismatch: payTo is not the allowed provider wallet" };
  if (!req.resource.startsWith("/api/evidence/report")) return { ok: false, reason: "wrong route: outside GET /api/evidence/report/*" };
  if (req.extra && req.extra.assetTransferMethod !== "erc7710") return { ok: false, reason: 'x402 service must advertise extra.assetTransferMethod = "erc7710"' };
  const now = Math.floor(Date.now() / 1000);
  if (now < policy.validAfter || now > policy.validUntil) return { ok: false, reason: "permission expired: ask for renewal" };
  return { ok: true };
}

function buildPolicy(agentAddress) {
  const now = Math.floor(Date.now() / 1000);
  return {
    delegator: config.delegatorWallet,
    delegatorLabel: "DEMO delegator (runtime-generated)",
    delegate: agentAddress,
    token: config.token,
    tokenAddress: config.usdcBaseSepoliaAddress,
    allowedPayTo: config.providerWallet,
    allowedResourcePattern: config.allowedResourcePattern,
    maxPerRequest: config.maxPerRequestMicroUsdc,
    maxPerPeriod: config.maxPerPeriodMicroUsdc,
    periodSeconds: config.periodSeconds,
    validAfter: now,
    validUntil: now + config.validDays * 86400,
    chainId: config.chainId,
    revocable: true,
    permissionType: config.permissionType,
  };
}

$("btnWallet").onclick = async () => {
  if (typeof ethers === "undefined") {
    show("wallet", "ethers library did not load. Run <code>npm install</code> in demo/ so /vendor/ethers.umd.min.js is served, or check your network for the CDN fallback.", "bad");
    return;
  }
  agentWallet = ethers.Wallet.createRandom();
  const policy = buildPolicy(agentWallet.address);
  agentPackage = {
    agentAddress: agentWallet.address,
    agentPrivateKey: agentWallet.privateKey, // DEMO ONLY — bearer credential, tiny caps
    permissionContext: { type: "erc20-token-periodic", policy },
    permissionManager: "MISSING — no live ERC-7710 delegation manager is documented",
    x402Policy: policy,
    genLayerControl: {
      reviewCadenceSeconds: config.reviewCadenceSeconds,
      decisionsAvailable: ["continue", "warn", "constrain", "revoke", "escalate"],
      supervisor: config.genLayerSupervisorAddress,
      supervisorMissing: config.genLayerSupervisorAddress === null,
      bridgeSenderBase: config.bridgeSenderBase,
    },
    warning: "DEMO ONLY. This JSON contains a private key. Never use a production key here.",
  };
  $("wallet").innerHTML =
    "<b>Agent EOA:</b> " + esc(agentWallet.address) + "<br>" +
    "<b>Delegation:</b> max " + (policy.maxPerRequest / 1e6).toFixed(2) + " USDC/request, " +
    (policy.maxPerPeriod / 1e6).toFixed(2) + " USDC/week, only to " + esc(policy.allowedPayTo) + ", expires " +
    new Date(policy.validUntil * 1000).toISOString() + "<br>" +
    "Agent JSON package is ready to download (contains the demo private key — keep it private).";
  ["btnHappy", "btnMissing", "btnLate", "btnMalformed", "btnGuards", "btnSnapshot", "btnExport"].forEach((id) => { $(id).disabled = false; });
  log("Agent wallet generated: " + agentWallet.address);
};

$("btnExport").onclick = () => {
  const blob = new Blob([JSON.stringify(agentPackage, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "agent-research-pass-package.json";
  a.click();
  log("Agent JSON package downloaded (contains demo private key — demo only).");
};

async function requestReport(mode) {
  const topic = $("topic").value || "internet-court-x402";
  const outId = mode === "ok" ? "happy" : "dispute";
  try {
    // Step 1: the protected resource answers 402 with x402 requirements.
    const first = await api("/api/evidence/report?topic=" + encodeURIComponent(topic));
    if (first.status !== 402) throw new Error("expected HTTP 402, got " + first.status);
    const reqs = first.json.requirements;
    log("402 received: " + reqs.amount + " on " + reqs.network + ", payTo " + reqs.payTo);
    // Step 2: validate against the policy before signing anything.
    const policy = buildPolicy(agentWallet.address);
    const check = validateRequirements(reqs, policy);
    if (!check.ok) {
      show(outId, "<b>Payment refused by policy:</b> " + esc(check.reason), "bad");
      log("Payment refused: " + check.reason);
      return null;
    }
    // Step 3: sign the intent envelope (SKILL.md, Signed Evidence Pattern).
    const intent = {
      agentAddress: agentWallet.address,
      serviceOrigin: window.location.origin,
      route: reqs.resource,
      method: "GET",
      requestParameters: { topic },
      instructionHash: ethers.keccak256(ethers.toUtf8Bytes("research-report:" + topic)),
      permissionContextHash: ethers.keccak256(ethers.toUtf8Bytes(stableStringify(policy))),
      userMandate: "Agent Research Pass: pay per report, bounded delegation, dispute via Internet Court",
      timestamp: Math.floor(Date.now() / 1000),
      nonce: Math.random().toString(36).slice(2, 10),
      amountMicro: reqs.amountMicro,
      payTo: reqs.payTo,
    };
    const signature = await agentWallet.signMessage(stableStringify(intent));
    // Step 4: pay (explicit POST in this demo — see README transport note).
    const pay = await api("/api/evidence/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic, mode, requirements: reqs, intent, signature,
        idempotencyKey: "idem_" + intent.nonce, agentAddress: agentWallet.address,
      }),
    });
    if (pay.status !== 200) throw new Error("pay failed (" + pay.status + "): " + esc(pay.text.slice(0, 300)));
    const { receipt, report, delivery } = pay.json;
    lastReceipt = receipt;
    // Step 5: verify the service-signed receipt.
    const { serviceSignature, serviceSigner, ...receiptCore } = receipt;
    const recovered = ethers.verifyMessage(stableStringify(receiptCore), serviceSignature);
    if (recovered.toLowerCase() !== serviceSigner.toLowerCase()) throw new Error("receipt signature does not verify");
    log("Receipt verified: " + receipt.receiptId + ", settlement " + receipt.settlement.mode + ", txHash " + receipt.settlement.txHash);
    if (mode === "ok") {
      if (!report || !report.sources || !report.timestamp) throw new Error("happy-path report failed validation");
      show(outId,
        "<b>Happy path — payment released.</b><br>" +
        "Receipt: " + esc(receipt.receiptId) + " — " + esc(receipt.amount) + " (settlement: " + esc(receipt.settlement.mode) + ", txHash: " + esc(String(receipt.settlement.txHash)) + ")<br>" +
        "Report: " + esc(report.reportId) + " — " + esc(report.topic) + ", sources: " + report.sources.length + ", timestamp " + esc(report.timestamp) + "<br>" +
        "GenLayer decision: <b>continue</b> (report valid, no dispute).", "ok");
      log("Happy path complete: report " + report.reportId);
      return pay.json;
    }
    // Dispute path: route receipt + report to Internet Court / GenLayer.
    const dispute = await api("/api/dispute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiptId: receipt.receiptId, reason: mode }),
    });
    if (dispute.status !== 200) throw new Error("dispute failed (" + dispute.status + "): " + esc(dispute.text.slice(0, 300)));
    const d = dispute.json.genLayerDecision;
    show(outId,
      "<b>Dispute path — " + esc(mode) + ".</b><br>" +
      "Receipt: " + esc(receipt.receiptId) + " — " + esc(receipt.amount) + "<br>" +
      "Delivery: " + esc(delivery.status) + " — " + esc(delivery.note || "") + "<br>" +
      "Evidence bundle hash: " + esc(dispute.json.evidenceBundle.receiptHash.slice(0, 18)) + "…<br>" +
      "GenLayer decision (SIMULATED jury): <b>" + esc(d.decision) + "</b>, outcome <b>" + esc(d.outcome) + "</b>, refund " + esc(d.amountRefund) + "<br>" +
      "Supervisor: " + (d.supervisor || "MISSING — no live supervisor deployed") + "<br>" +
      "<pre>" + esc(JSON.stringify(d, null, 2)) + "</pre>", "ok");
    log("Dispute complete: " + mode + " -> " + d.decision + " / " + d.outcome + " (SIMULATED jury)");
    return pay.json;
  } catch (e) {
    show(outId, "<b>Error:</b> " + esc(e.message), "bad");
    log("Error: " + e.message);
    return null;
  }
}

$("btnHappy").onclick = () => requestReport("ok");
$("btnMissing").onclick = () => requestReport("missing");
$("btnLate").onclick = () => requestReport("late");
$("btnMalformed").onclick = () => requestReport("malformed");

$("btnGuards").onclick = async () => {
  const policy = buildPolicy(agentWallet.address);
  const base = { chainId: config.chainId, amountMicro: config.priceMicroUsdc, payTo: config.providerWallet, resource: "/api/evidence/report?topic=x", extra: { assetTransferMethod: "erc7710" } };
  const cases = [
    ["over-budget (0.26 USDC)", { ...base, amountMicro: 260000 }],
    ["wrong merchant", { ...base, payTo: "0x0000000000000000000000000000000000000001" }],
    ["wrong network", { ...base, chainId: 1 }],
    ["wrong route", { ...base, resource: "/api/other" }],
    ["wrong assetTransferMethod", { ...base, extra: { assetTransferMethod: "other" } }],
    ["expired permission", { ...base }],
  ];
  const expiredPolicy = { ...policy, validUntil: Math.floor(Date.now() / 1000) - 10 };
  const results = cases.map(([name, req]) => {
    const p = name === "expired permission" ? expiredPolicy : policy;
    const c = validateRequirements(req, p);
    return { name, refused: !c.ok, reason: c.reason || "passed validation (unexpected for a guard case)" };
  });
  const allRefused = results.every((r) => r.refused);
  show("guards",
    (allRefused ? "<b>All guard tests refused as expected — no payment made.</b><br>" : "<b>WARNING: a guard case passed validation.</b><br>") +
    results.map((r) => "• " + esc(r.name) + ": " + (r.refused ? "REFUSED — " + esc(r.reason) : "PASSED (unexpected)")).join("<br>"),
    allRefused ? "ok" : "bad");
  log("Guard tests: " + results.filter((r) => r.refused).length + "/" + results.length + " refused");
};

$("btnSnapshot").onclick = async () => {
  const s = await api("/api/spend-snapshot?agent=" + agentWallet.address);
  const d = await api("/api/decisions");
  $("snapshot").innerHTML =
    "<b>Spent:</b> " + esc(s.json.spent) + " (" + s.json.requestCount + " requests, max " + esc(s.json.maxPerPeriod) + ")<br>" +
    "<b>Revoked:</b> " + s.json.revoked + " — <b>Constrained:</b> " + s.json.constrained + "<br>" +
    "<b>Decisions so far:</b> " + d.json.decisions.length + "<br>" +
    "<pre>" + esc(JSON.stringify(d.json.decisions, null, 2)) + "</pre>";
  log("Snapshot refreshed.");
};

loadConfig().catch((e) => {
  $("policy").innerHTML = "Could not load /api/config: " + esc(e.message) + ". Is the demo server running?";
  log("Config load failed: " + e.message);
});
