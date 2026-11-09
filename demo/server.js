/**
 * Agent Research Pass — local demo server.
 *
 * What this IS:
 *  - A real local x402 flow, following internet-court/internet-court-skill
 *    integrations/x402-erc7710/SKILL.md (commit 462bf30) and its
 *    references/demo-blueprints.md, Blueprint A: Agent Research Pass.
 *  - Real agent/provider/delegator EOAs generated at runtime with ethers.
 *  - Real signatures: the agent signs an intent envelope, the provider
 *    signs the payment receipt. Signatures are verified on both sides.
 *  - Real policy validation before every payment (network, amount cap,
 *    payee, route, expiry, weekly budget), client-side and server-side.
 *  - A real dispute evidence bundle and a GenLayer decision payload in
 *    the shape the skill repo documents (continue / warn / constrain /
 *    revoke / escalate).
 *
 * What this is NOT (read before judging the demo):
 *  - There is NO on-chain settlement. The facilitator is a LOCAL
 *    SIMULATED facilitator: no real Base Sepolia USDC moves, no tx hash.
 *    The skill repo documents no live facilitator URL for this demo.
 *  - There is NO live GenLayer jury. The verdict is a LOCAL SIMULATED
 *    jury decision in the documented payload shape. The GenLayer
 *    supervisor address is MISSING (see CONFIG below) — no live
 *    supervisor is deployed, so no real bridge call is made.
 *  - There is NO live ERC-7710 delegation manager. Policy is enforced
 *    in agent code before each payment, exactly as the skill repo says
 *    route allowlists are "initially enforced by the agent policy".
 *    The EVM revocation/constraint controller is NOT wired; the demo
 *    enforces revoke/constrain locally and labels it as such.
 *
 * Testnet only. No mainnet, no real money, no user main wallet.
 * Private keys are generated at runtime, kept in memory only, and never
 * written to disk or to this repo. The exported agent JSON package is a
 * bearer credential in demo form — tiny caps, demo only.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// ---------------------------------------------------------------------------
// CONFIG — only values the skill repo actually documents, plus MISSING items.
// ---------------------------------------------------------------------------
const CONFIG = {
  // Documented in SKILL.md, Default Demo + demo-blueprints.md Blueprint A.
  resource: "/api/evidence/report",
  network: "base-sepolia",
  chainId: 84532, // Base Sepolia
  token: "USDC (Base Sepolia)",
  // NOTE ON PRICE: the skill repo's Default Demo lists the example price as
  // 0.05 USDC per report, with a delegation cap of max 0.25 USDC per
  // request. This demo is locked to the mission brief: price 0.25 USDC per
  // report, which equals the cap. Both numbers are shown here so a reviewer
  // can see the choice instead of finding a silent change.
  priceMicroUsdc: 250000, // 0.25 USDC, 6 decimals
  skillRepoExamplePriceMicroUsdc: 50000, // 0.05 USDC — skill repo example
  maxPerRequestMicroUsdc: 250000, // 0.25 USDC
  maxPerPeriodMicroUsdc: 5000000, // 5 USDC per week
  periodSeconds: 604800, // 7 days
  validDays: 7,
  allowedResourcePattern: "GET /api/evidence/report/*",
  permissionType: "erc20-token-periodic", // skill repo: prefer for recurring
  reviewCadenceSeconds: 60, // skill repo: demo cadence, 1 minute

  // Documented in SKILL.md, "MetaMask Transaction Cards":
  // WalletSpendReporter takes the Base BridgeSender.sol address as
  // initialBridgeSender. Do NOT use the Base BridgeReceiver address or the
  // GenLayer BridgeSender Intelligent Contract there.
  bridgeSenderBase: "0x7AB80AE93246108bd1e80b8215c5F1147Ca56af0",
  bridgeReceiverBase_DO_NOT_USE_AS_SENDER:
    "0xF92d8e5F1620E464eEac5fab5472dA06fbfA5C73",

  // MISSING — not documented anywhere in the skill repo. Do not invent.
  usdcBaseSepoliaAddress: null, // MISSING: set from the Base Sepolia USDC deployment
  genLayerSupervisorAddress: null, // MISSING: GenLayerDecisionReceiver.initialSourceContract
  internetCourtEndpoint: null, // MISSING: no live submission endpoint documented
  facilitatorUrl: null, // MISSING: no live x402 facilitator URL documented
  delegationManagerAddress: null, // MISSING: no live ERC-7710 manager documented
};

const MISSING = [
  "genLayerSupervisorAddress — GenLayerDecisionReceiver.initialSourceContract; no live supervisor is deployed, so the jury verdict in this demo is SIMULATED",
  "usdcBaseSepoliaAddress — Base Sepolia USDC token address; not documented in the skill repo, so settlement is SIMULATED and no on-chain transfer is attempted",
  "facilitatorUrl — no live x402 facilitator URL is documented for this demo",
  "internetCourtEndpoint — no live Internet Court submission endpoint is documented; the dispute is built and shown locally",
  "delegationManagerAddress — no live ERC-7710 delegation manager is documented; policy is enforced in agent code, not on-chain",
];

// ---------------------------------------------------------------------------
// Runtime-generated demo wallets (real EOAs, in memory only, never logged
// with private keys). In a real run the delegator is the user's smart
// account; here it is a runtime-generated DEMO delegator, labelled as such.
// ---------------------------------------------------------------------------
const serviceWallet = ethers.Wallet.createRandom(); // evidence provider
const providerWallet = ethers.Wallet.createRandom(); // payee (merchant)
const delegatorWallet = ethers.Wallet.createRandom(); // DEMO delegator

// ---------------------------------------------------------------------------
// In-memory state (demo only — resets on restart).
// ---------------------------------------------------------------------------
const receipts = new Map(); // receiptId -> { receipt, report, delivery }
const idempotency = new Map(); // idempotencyKey -> receiptId
const usedNonces = new Set(); // agentAddress:nonce
const policies = new Map(); // agentAddress -> policy state
const decisions = []; // GenLayer decision payloads, in order

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") +
    "}"
  );
}
function hashOf(obj) {
  return ethers.keccak256(ethers.toUtf8Bytes(stableStringify(obj)));
}
function nowIso() {
  return new Date().toISOString();
}
function microToUsdc(micro) {
  return (micro / 1e6).toFixed(2);
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}
function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "not found", path: filePath });
      return;
    }
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 256 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function policyFor(agentAddress) {
  const key = agentAddress.toLowerCase();
  if (!policies.has(key)) {
    const now = Math.floor(Date.now() / 1000);
    policies.set(key, {
      // AgentSpendPolicy shape from SKILL.md, Subscription Pattern.
      delegator: delegatorWallet.address,
      delegatorLabel: "DEMO delegator (runtime-generated — in a real run this is the user's smart account)",
      delegate: agentAddress,
      token: CONFIG.token,
      tokenAddress: CONFIG.usdcBaseSepoliaAddress, // null = MISSING
      allowedPayTo: providerWallet.address,
      allowedResourcePattern: CONFIG.allowedResourcePattern,
      maxPerRequest: CONFIG.maxPerRequestMicroUsdc,
      maxPerPeriod: CONFIG.maxPerPeriodMicroUsdc,
      periodSeconds: CONFIG.periodSeconds,
      validAfter: now,
      validUntil: now + CONFIG.validDays * 86400,
      chainId: CONFIG.chainId,
      revocable: true,
      permissionType: CONFIG.permissionType,
      // Runtime accounting (checklist item 6: spent / requestCount snapshot).
      spentMicro: 0,
      requestCount: 0,
      revoked: false,
      constrained: false,
      periodStart: now,
    });
  }
  return policies.get(key);
}

function validateRequirements(req, policy) {
  // Returns { ok: true } or { ok: false, reason }.
  if (!req) return { ok: false, reason: "missing payment requirements" };
  if (req.chainId !== CONFIG.chainId)
    return { ok: false, reason: `wrong network: expected chainId ${CONFIG.chainId}, got ${req.chainId}` };
  if (req.amountMicro == null || req.amountMicro > policy.maxPerRequest)
    return { ok: false, reason: `amount exceeds cap: ${microToUsdc(req.amountMicro || 0)} USDC > max ${microToUsdc(policy.maxPerRequest)} USDC per request` };
  if (!req.payTo || req.payTo.toLowerCase() !== policy.allowedPayTo.toLowerCase())
    return { ok: false, reason: "merchant mismatch: payTo is not the allowed provider wallet" };
  if (!req.resource || !req.resource.startsWith("/api/evidence/report"))
    return { ok: false, reason: "wrong route: resource is outside the allowed pattern GET /api/evidence/report/*" };
  if (req.assetTransferMethod && req.assetTransferMethod !== "erc7710")
    return { ok: false, reason: 'x402 service must advertise extra.assetTransferMethod = "erc7710"' };
  const now = Math.floor(Date.now() / 1000);
  if (now < policy.validAfter || now > policy.validUntil)
    return { ok: false, reason: "permission expired: ask for renewal" };
  if (policy.revoked)
    return { ok: false, reason: "permission revoked by GenLayer decision (local enforcement — EVM controller not wired)" };
  if (policy.constrained)
    return { ok: false, reason: "permission constrained by GenLayer decision (local enforcement — EVM controller not wired)" };
  if (policy.spentMicro + req.amountMicro > policy.maxPerPeriod)
    return { ok: false, reason: `weekly budget exceeded: spent ${microToUsdc(policy.spentMicro)} USDC + ${microToUsdc(req.amountMicro)} USDC > max ${microToUsdc(policy.maxPerPeriod)} USDC per week` };
  return { ok: true };
}

function paymentRequirements(topic) {
  return {
    scheme: "x402",
    network: CONFIG.network,
    chainId: CONFIG.chainId,
    amountMicro: CONFIG.priceMicroUsdc,
    amount: microToUsdc(CONFIG.priceMicroUsdc) + " USDC",
    asset: CONFIG.token,
    assetAddress: CONFIG.usdcBaseSepoliaAddress, // null = MISSING
    assetAddressMissing: CONFIG.usdcBaseSepoliaAddress === null,
    payTo: providerWallet.address,
    resource: `/api/evidence/report?topic=${encodeURIComponent(topic)}`,
    method: "GET",
    extra: { assetTransferMethod: "erc7710" },
    note: "SIMULATED settlement: no on-chain transfer is attempted. Asset address is MISSING — see /api/config.",
  };
}

function buildReport(topic, mode) {
  const reportId = "rep_" + Math.random().toString(36).slice(2, 10);
  const issuedAt = nowIso();
  if (mode === "missing") {
    return { report: null, delivery: { status: "missing", reportId, note: "Provider accepted payment but delivered no report." } };
  }
  if (mode === "late") {
    return {
      report: {
        reportId,
        topic,
        sources: [
          { title: "Internet Court — x402 + ERC-7710 skill", url: "https://github.com/internet-court/internet-court-skill" },
          { title: "GenLayer Portal — Internet Court: Partner Demo Lab", url: "https://portal.genlayer.com" },
        ],
        timestamp: issuedAt,
        deliveredLate: true,
        latencyMs: 95000,
        deadlineMs: 30000,
      },
      delivery: { status: "late", reportId, note: "Report arrived 95s after request; deadline was 30s." },
    };
  }
  if (mode === "malformed") {
    // Deliberately missing sources and timestamp — client validation must catch it.
    return {
      report: { reportId, topic },
      delivery: { status: "malformed", reportId, note: "Report has no sources and no timestamp." },
    };
  }
  return {
    report: {
      reportId,
      topic,
      sources: [
        { title: "Internet Court — x402 + ERC-7710 skill", url: "https://github.com/internet-court/internet-court-skill" },
        { title: "GenLayer Portal — Internet Court: Partner Demo Lab", url: "https://portal.genlayer.com" },
      ],
      timestamp: issuedAt,
      deliveredLate: false,
    },
    delivery: { status: "delivered", reportId },
  };
}

async function processPayment(body) {
  const { topic, mode, requirements, intent, signature, idempotencyKey, agentAddress } = body || {};
  if (!topic || !requirements || !intent || !signature || !idempotencyKey || !agentAddress) {
    return { status: 400, body: { error: "missing fields: topic, requirements, intent, signature, idempotencyKey, agentAddress are all required" } };
  }
  // Idempotency: a duplicate key returns the original receipt, no double spend.
  if (idempotency.has(idempotencyKey)) {
    const receiptId = idempotency.get(idempotencyKey);
    const stored = receipts.get(receiptId);
    return { status: 200, body: { ...stored, duplicate: true, note: "Idempotency key already seen — original receipt returned, no second charge." } };
  }
  // Verify the agent's intent envelope signature.
  let recovered;
  try {
    recovered = ethers.verifyMessage(stableStringify(intent), signature);
  } catch (e) {
    return { status: 400, body: { error: "intent signature does not verify", detail: String(e.message || e) } };
  }
  if (recovered.toLowerCase() !== agentAddress.toLowerCase() || recovered.toLowerCase() !== String(intent.agentAddress || "").toLowerCase()) {
    return { status: 400, body: { error: "intent signature recovered a different address than the claimed agent address" } };
  }
  // Intent must match the requirements it authorises.
  if (intent.route !== requirements.resource || intent.amountMicro !== requirements.amountMicro || intent.payTo.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { status: 400, body: { error: "intent envelope does not match the payment requirements" } };
  }
  // Replay protection: one nonce per agent, ever.
  const nonceKey = agentAddress.toLowerCase() + ":" + intent.nonce;
  if (usedNonces.has(nonceKey)) {
    return { status: 400, body: { error: "replay rejected: intent nonce already used" } };
  }
  usedNonces.add(nonceKey);

  const policy = policyFor(agentAddress);
  const check = validateRequirements(requirements, policy);
  if (!check.ok) {
    return { status: 402, body: { error: "payment refused by policy", reason: check.reason } };
  }

  // Record spend (simulated settlement — no on-chain transfer).
  policy.spentMicro += requirements.amountMicro;
  policy.requestCount += 1;

  const receiptId = "rcpt_" + Math.random().toString(36).slice(2, 10);
  const requestId = "req_" + Math.random().toString(36).slice(2, 10);
  const receiptCore = {
    receiptId,
    requestId,
    agent: agentAddress,
    provider: providerWallet.address,
    route: requirements.resource,
    method: "GET",
    amountMicro: requirements.amountMicro,
    amount: microToUsdc(requirements.amountMicro) + " USDC",
    token: CONFIG.token,
    chainId: CONFIG.chainId,
    timestamp: nowIso(),
    idempotencyKey,
    intentHash: hashOf(intent),
    settlement: {
      mode: "SIMULATED",
      txHash: null,
      note: "No on-chain transfer was attempted. Facilitator URL and USDC address are MISSING (see /api/config).",
    },
  };
  const receiptSignature = await serviceWallet.signMessage(stableStringify(receiptCore));
  const receipt = { ...receiptCore, serviceSigner: serviceWallet.address, serviceSignature: receiptSignature };

  const { report, delivery } = buildReport(topic, mode || "ok");
  const result = { receipt, report, delivery };
  receipts.set(receiptId, result);
  idempotency.set(idempotencyKey, receiptId);
  return { status: 200, body: result };
}

const DECISION_FOR_REASON = {
  missing: { decision: "revoke", outcome: "refund" },
  late: { decision: "constrain", outcome: "refund" },
  malformed: { decision: "warn", outcome: "refund" },
};

async function processDispute(body) {
  const { receiptId, reason } = body || {};
  if (!receiptId || !reason || !DECISION_FOR_REASON[reason]) {
    return { status: 400, body: { error: "missing fields: receiptId and reason (missing | late | malformed) are required" } };
  }
  const stored = receipts.get(receiptId);
  if (!stored) return { status: 404, body: { error: "receipt not found" } };
  const { receipt, report } = stored;
  // Verify the receipt signature before accepting the evidence.
  const { serviceSignature, serviceSigner, ...receiptCore } = receipt;
  let recovered;
  try {
    recovered = ethers.verifyMessage(stableStringify(receiptCore), serviceSignature);
  } catch (e) {
    return { status: 400, body: { error: "receipt signature does not verify", detail: String(e.message || e) } };
  }
  if (recovered.toLowerCase() !== serviceSigner.toLowerCase()) {
    return { status: 400, body: { error: "receipt was not signed by the evidence provider" } };
  }
  const evidenceBundle = {
    receiptId,
    reason,
    receiptHash: hashOf(receiptCore),
    reportHash: report ? hashOf(report) : null,
    intentHash: receipt.intentHash,
    policyHash: hashOf(policyFor(receipt.agent)),
    submittedAt: nowIso(),
    reviewTarget: "controller-tracked permission hash (local demo — no EVM controller wired)",
  };
  const chosen = DECISION_FOR_REASON[reason];
  const genLayerDecision = {
    decision: chosen.decision,
    outcome: chosen.outcome,
    amountRefundMicro: receipt.amountMicro,
    amountRefund: receipt.amount,
    decisionsAvailable: ["continue", "warn", "constrain", "revoke", "escalate"],
    evidenceHash: evidenceBundle.receiptHash,
    jury: "SIMULATED — no live GenLayer supervisor is deployed",
    supervisor: CONFIG.genLayerSupervisorAddress, // null = MISSING
    supervisorMissing: CONFIG.genLayerSupervisorAddress === null,
    effectPath:
      "Base spend reporter -> GenLayer Studio bridge -> GenLayer spend supervisor -> GenLayer Studio bridge -> EVM decision receiver -> revocation/constraint controller (NOT WIRED in this demo — decision is enforced locally only)",
    timestamp: nowIso(),
  };
  // Apply the decision locally (stand-in for the EVM controller).
  const policy = policyFor(receipt.agent);
  if (chosen.decision === "revoke") policy.revoked = true;
  if (chosen.decision === "constrain") policy.constrained = true;
  decisions.push({ ...genLayerDecision, receiptId, reason });
  return { status: 200, body: { evidenceBundle, genLayerDecision } };
}

// ---------------------------------------------------------------------------
// HTTP server.
// ---------------------------------------------------------------------------
function createServer() {
  const publicDir = path.join(__dirname, "public");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === "/") {
        return sendFile(res, path.join(publicDir, "index.html"), "text/html");
      }
      if (req.method === "GET" && pathname === "/app.js") {
        return sendFile(res, path.join(publicDir, "app.js"), "text/javascript");
      }
      if (req.method === "GET" && pathname === "/vendor/ethers.umd.min.js") {
        const vendor = path.join(__dirname, "node_modules", "ethers", "dist", "ethers.umd.min.js");
        if (fs.existsSync(vendor)) return sendFile(res, vendor, "text/javascript");
        return sendJson(res, 404, { error: "ethers UMD not installed — run npm install, or let the page fall back to the CDN" });
      }
      if (req.method === "GET" && pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, service: "internet-court-x402-research-pass demo", mode: "SIMULATED settlement + SIMULATED jury" });
      }
      if (req.method === "GET" && pathname === "/api/config") {
        return sendJson(res, 200, {
          resource: CONFIG.resource,
          network: CONFIG.network,
          chainId: CONFIG.chainId,
          token: CONFIG.token,
          priceMicroUsdc: CONFIG.priceMicroUsdc,
          price: microToUsdc(CONFIG.priceMicroUsdc) + " USDC per report",
          skillRepoExamplePrice: microToUsdc(CONFIG.skillRepoExamplePriceMicroUsdc) + " USDC per report (skill repo example; this demo uses 0.25 per the locked mission brief)",
          maxPerRequestMicroUsdc: CONFIG.maxPerRequestMicroUsdc,
          maxPerPeriodMicroUsdc: CONFIG.maxPerPeriodMicroUsdc,
          periodSeconds: CONFIG.periodSeconds,
          validDays: CONFIG.validDays,
          allowedResourcePattern: CONFIG.allowedResourcePattern,
          permissionType: CONFIG.permissionType,
          reviewCadenceSeconds: CONFIG.reviewCadenceSeconds,
          bridgeSenderBase: CONFIG.bridgeSenderBase,
          bridgeReceiverBase_DO_NOT_USE_AS_SENDER: CONFIG.bridgeReceiverBase_DO_NOT_USE_AS_SENDER,
          providerWallet: providerWallet.address,
          delegatorWallet: delegatorWallet.address,
          delegatorLabel: "DEMO delegator (runtime-generated)",
          serviceWallet: serviceWallet.address,
          missing: MISSING,
          usdcBaseSepoliaAddress: CONFIG.usdcBaseSepoliaAddress,
          genLayerSupervisorAddress: CONFIG.genLayerSupervisorAddress,
          internetCourtEndpoint: CONFIG.internetCourtEndpoint,
          facilitatorUrl: CONFIG.facilitatorUrl,
          delegationManagerAddress: CONFIG.delegationManagerAddress,
        });
      }
      if (req.method === "GET" && pathname === "/api/evidence/report") {
        const topic = url.searchParams.get("topic") || "internet-court-x402";
        return sendJson(res, 402, {
          error: "402 Payment Required",
          requirements: paymentRequirements(topic),
          retry: "POST /api/evidence/pay with the signed intent envelope, or use the demo page",
        });
      }
      if (req.method === "POST" && pathname === "/api/evidence/pay") {
        const body = await readBody(req);
        const result = await processPayment(body);
        return sendJson(res, result.status, result.body);
      }
      if (req.method === "POST" && pathname === "/api/dispute") {
        const body = await readBody(req);
        const result = await processDispute(body);
        return sendJson(res, result.status, result.body);
      }
      if (req.method === "GET" && pathname === "/api/decisions") {
        return sendJson(res, 200, { decisions });
      }
      if (req.method === "GET" && pathname === "/api/spend-snapshot") {
        const agent = url.searchParams.get("agent");
        if (!agent) return sendJson(res, 400, { error: "query param agent is required" });
        const policy = policyFor(agent);
        return sendJson(res, 200, {
          agent,
          spentMicro: policy.spentMicro,
          spent: microToUsdc(policy.spentMicro) + " USDC",
          requestCount: policy.requestCount,
          maxPerPeriod: microToUsdc(policy.maxPerPeriod) + " USDC per week",
          revoked: policy.revoked,
          constrained: policy.constrained,
          validUntil: new Date(policy.validUntil * 1000).toISOString(),
        });
      }
      return sendJson(res, 404, { error: "not found", path: pathname });
    } catch (e) {
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, () => {
    console.log(`Agent Research Pass demo running at http://localhost:${port}`);
    console.log(`Provider (payee): ${providerWallet.address}`);
    console.log(`Evidence service: ${serviceWallet.address}`);
    console.log(`DEMO delegator:   ${delegatorWallet.address}`);
    console.log("SIMULATED settlement + SIMULATED jury — see /api/config for the MISSING list.");
  });
}

module.exports = { createServer, CONFIG, MISSING };
