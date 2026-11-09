# Agent Research Pass — x402 payments with Internet Court disputes on GenLayer

Mission: GenLayer Portal — Internet Court: Partner Demo Lab
Start: 9 Nov 2026 / End: 23 Nov 2026
Status: WORKING LOCAL DEMO — not a submission yet. No video, no Portal submit.

## What it is, in one line
An agent buys one research report at a time with x402 (0.25 USDC per report).
If the report is missing, late, or wrong, the receipt goes to Internet Court
and a GenLayer jury decides: refund or release.

## What is actually built
A small Node demo in `demo/` that runs locally with no external services:

- **Real x402 flow:** `GET /api/evidence/report` answers HTTP 402 with payment
  requirements (Base Sepolia, chainId 84532, 0.25 USDC, `extra.assetTransferMethod
  = "erc7710"`). The agent validates the requirements against its
  `AgentSpendPolicy`, signs an intent envelope, pays, and verifies the
  service-signed receipt.
- **Real keys and signatures:** agent, provider, service, and demo-delegator
  EOAs are generated at runtime with ethers. The agent signs the intent
  envelope; the provider signs the receipt. Both signatures are verified.
  Private keys live in memory only and are never written to disk or to
  this repo.
- **Real policy enforcement:** network, amount cap (0.25 USDC/request),
  payee (provider wallet only), route (`GET /api/evidence/report/*`),
  expiry (7 days), weekly budget (5 USDC) — checked client-side before
  signing and server-side before payment.
- **Dispute path:** a missing, late, or malformed report routes the receipt
  and report to Internet Court / GenLayer. The demo builds the evidence
  bundle (canonical JSON, payload hashes) and a GenLayer decision payload
  (`continue` / `warn` / `constrain` / `revoke` / `escalate`).
- **Guard tests:** over-budget, wrong merchant, wrong network, wrong route,
  expired permission, idempotency (duplicate key = original receipt, no
  double spend), replay (reused intent nonce rejected), and revoke
  enforcement (after a revoke decision the next payment is refused).
- **Automated tests:** `npm test` — 28 checks, all passing at build time
  (2026-11-09). See `demo/test.js`.

## What is SIMULATED — read this before judging the demo
- **Settlement is simulated.** No on-chain transfer is attempted, no tx hash
  exists. No live x402 facilitator URL is documented in the skill repo.
- **The GenLayer jury verdict is simulated.** The decision payload is in the
  exact shape the skill repo documents, but no live supervisor is deployed,
  so no real bridge call is made.
- **Policy is enforced in agent code, not on-chain.** No live ERC-7710
  delegation manager is documented. The EVM revocation/constraint controller
  is not wired; revoke/constrain are enforced locally and labelled as such.

## MISSING — required for a live version, not in the skill repo
- `genLayerSupervisorAddress` — `GenLayerDecisionReceiver.initialSourceContract`.
  The skill repo says: if the supervisor is not deployed yet, ask for an
  explicit temporary nonzero placeholder and label it as temporary. This
  demo sets it to `null` and marks the verdict SIMULATED instead of
  inventing a placeholder.
- `usdcBaseSepoliaAddress` — Base Sepolia USDC token address.
- `facilitatorUrl` — live x402 facilitator URL.
- `internetCourtEndpoint` — live Internet Court submission endpoint.
- `delegationManagerAddress` — live ERC-7710 delegation manager.
- See `GET /api/config` in the running demo for the live list.

## Price note (a real discrepancy, not hidden)
The skill repo's Default Demo lists the example price as **0.05 USDC** per
report, with a delegation cap of max **0.25 USDC** per request. This demo is
locked to the mission brief: price **0.25 USDC** per report, which equals
the cap. Both numbers are shown in `GET /api/config` so a reviewer can see
the choice.

## Documented addresses (from the skill repo, not invented)
- Base `BridgeSender.sol` for `WalletSpendReporter.initialBridgeSender`:
  `0x7AB80AE93246108bd1e80b8215c5F1147Ca56af0`
- Base `BridgeReceiver` (`0xF92d8e5F1620E464eEac5fab5472dA06fbfA5C73`) and the
  GenLayer `BridgeSender` Intelligent Contract are **not** used as the
  supervisor — the skill repo explicitly forbids that.

## Sources
- `internet-court/internet-court-skill`, `integrations/x402-erc7710/SKILL.md`
  (commit `462bf30`) and `references/demo-blueprints.md`, Blueprint A:
  Agent Research Pass.
- No other contract address, API endpoint, or message format is used. Anything
  not in that repo is marked MISSING above.

## How to run
Follow `SKILL.md` — it is the reproducible runbook. Short version:

```bash
cd demo
npm install
npm test     # 28 automated checks
npm start    # http://localhost:3000
```

Then open the page, generate an agent wallet, run the happy path, then run
one dispute path. Testnet only. No real money. Never use a main wallet.

## Video plan — 45 seconds max (not recorded yet)
- 0–5s: problem — agent paid, no report
- 5–15s: x402 payment, 0.25 USDC, receipt
- 15–30s: dispute — receipt to Internet Court
- 30–40s: GenLayer jury verdict — refund
- 40–45s: end card — Internet Court, GenLayer, x402 logos + repo link

## Submit checklist (do NOT submit until every box is true)
- [x] Repo is public
- [x] Code actually runs, not slides only
- [ ] GenLayer verdict is visible in the demo — visible as a SIMULATED payload; a live verdict needs a deployed supervisor (see MISSING)
- [ ] Video is 45 seconds or less — not recorded yet
- [ ] Video shows all three logos: Internet Court, GenLayer, x402 — not recorded yet
- [x] A stranger can re-run the demo from SKILL.md alone
