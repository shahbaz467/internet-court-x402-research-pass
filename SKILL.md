# Agent Research Pass — reproducible demo skill

Based on: `internet-court/internet-court-skill`,
`integrations/x402-erc7710/SKILL.md` (commit `462bf30`) and
`references/demo-blueprints.md`, Blueprint A: Agent Research Pass.

This file alone must be enough to re-run the demo. If a step below does
not work, the demo is broken — do not work around it silently, report it.

## What you need
- Node.js 18 or newer and npm.
- No wallet, no funds, no account. The demo generates its own test EOAs
  at runtime. Never use a main wallet here.
- This repo, checked out locally.

## Delegation (do not change without a reason)
- Network: Base Sepolia, chainId 84532.
- Token: USDC (Base Sepolia). Token address: MISSING — see README.
- Price: 0.25 USDC per report. (Skill repo example price is 0.05 USDC;
  this demo uses 0.25 per the locked mission brief. Cap is 0.25.)
- Max 0.25 USDC per request, max 5 USDC per week, only to the provider
  wallet, only for `GET /api/evidence/report/*`, expiring in 7 days.
- Permission type: `erc20-token-periodic` (skill repo preference for
  recurring agent spend).
- Review cadence: 1 minute in the demo (skill repo demo cadence).

## Run it
```bash
cd demo
npm install
npm test
npm start
```
Then open http://localhost:3000 in a browser.

Expected: `npm test` prints `28 passed, 0 failed`. `npm start` prints
`Agent Research Pass demo running at http://localhost:3000`.

## Test case 1 — happy path (in the browser)
1. Click **Generate agent wallet**. A real agent EOA is created in your
   browser. Note its address.
2. Click **Download agent JSON package** (optional). It contains the demo
   private key, the ERC-7710 permission context, the permission manager,
   the x402 policy, and GenLayer control metadata. Keep it private —
   it is a bearer credential in demo form, tiny caps, demo only.
3. Click **Pay 0.25 USDC and request report**.
4. Expected: the page shows “Happy path — payment released”, a receipt id,
   `0.25 USDC`, settlement `SIMULATED` with `txHash: null`, and a report
   with sources and a timestamp. The GenLayer decision is `continue`.
5. Click **Refresh snapshot**. Expected: spent `0.25 USDC`, 1 request.

## Test case 2 — dispute path (in the browser)
Run all three, one at a time (each pays 0.25 USDC from the weekly budget;
a fresh agent wallet resets the budget):
1. Click **Dispute: report missing**. Expected: delivery `missing`, evidence
   bundle hash shown, GenLayer decision (SIMULATED jury) `revoke`,
   outcome `refund`, refund `0.25 USDC`.
2. Click **Dispute: report late**. Expected: delivery `late` (95s vs a 30s
   deadline), decision `constrain`, outcome `refund`.
3. Click **Dispute: report malformed**. Expected: delivery `malformed`
   (no sources, no timestamp), decision `warn`, outcome `refund`.
4. After the `revoke` decision, any further payment from that agent is
   refused by the server (“permission revoked by GenLayer decision”).
   This is local enforcement — the EVM controller is not wired (see
   MISSING in the README).

## Guard tests (in the browser)
Click **Run guard tests**. Expected: all five cases refused, no payment
made — over-budget (0.26 USDC), wrong merchant, wrong network, wrong
route, expired permission.

## Automated tests (no browser needed)
`npm test` runs the same flows plus server-side defence-in-depth,
idempotency (duplicate key returns the original receipt, no double
spend), replay rejection (reused intent nonce), and revoke enforcement.
28 checks. Exit code 0 means all pass.

## What the demo does NOT do
- No on-chain settlement. There is no tx hash because no transfer is made.
- No live GenLayer jury. The verdict payload is built in the documented
  shape and labelled SIMULATED.
- No live ERC-7710 redemption. Policy is enforced in agent code.
- The GenLayer supervisor address, the Base Sepolia USDC address, the
  facilitator URL, the Internet Court endpoint, and the delegation
  manager address are all MISSING. Do not invent them. If you deploy or
  obtain one, put it in `demo/server.js` under `CONFIG`, remove it from
  the MISSING list, and re-run `npm test`.

## Files
- `demo/server.js` — local x402 resource server + simulated facilitator + dispute endpoint.
- `demo/public/index.html` — demo page.
- `demo/public/app.js` — browser client: 402 flow, intent signing, receipt verification, dispute UI.
- `demo/test.js` — automated tests (28 checks).
- `demo/package.json` — one dependency: `ethers` (real keys and signatures).
