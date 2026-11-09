# Agent Research Pass — x402 payments with Internet Court disputes on GenLayer

Mission: GenLayer Portal — Internet Court: Partner Demo Lab
Start: 9 Nov 2026 / End: 23 Nov 2026
Status: SCAFFOLD — not yet a working submission. Do not submit this as-is.

## What it is, in one line
An agent buys one research report at a time with x402 (0.25 USDC per report).
If the report is missing, late, or wrong, the receipt goes to Internet Court
and a GenLayer jury decides: refund or release.

## Why x402 is the fastest honest choice
- The Internet Court skill repo already documents this exact demo
  (`integrations/x402-erc7710/SKILL.md`, default demo: Agent Research Pass).
- GenLayer is the verdict, not decoration: without the jury there is no
  refund/release decision.
- Scope is small: one payment, one report, one dispute, one verdict.
- Yellow is settlement, not the dispute itself — GenLayer would be less
  central and the demo would be bigger. UMA is an escalation layer — it
  duplicates what GenLayer already does here and adds a second dispute
  system to explain in 45 seconds.

No approval is guaranteed. Review is strict and this work will be shown
to partners.

## Limits, stated plainly
- Network: Base Sepolia (testnet) for the demo, unless the skill repo says
  otherwise at build time.
- Delegation: agent may spend up to 5 USDC per week, max 0.25 USDC per
  request, only to the provider wallet, expiring in 7 days.
- The GenLayer supervisor address and the exact contract / API endpoints
  are NOT in this scaffold. Do not invent them. Fill them only from the
  deployed demo / the internet-court-skill repo at build time, and label
  any temporary placeholder as temporary.
- No real money, no mainnet funds, no user main wallet in the demo.

## Repo layout (planned)
- `demo/` — the working demo page / interface others can run
- `SKILL.md` — reproducible steps: how anyone runs the demo
- `video/` — final 45-second demo video (max 45 seconds)
- `README.md` — this file

## How to run (to be completed at build time)
1. Clone this repo.
2. Follow `SKILL.md`.
3. Run the happy-path test: pay 0.25 USDC, report arrives on time, payment releases.
4. Run the dispute-path test: report missing / late, receipt goes to
   Internet Court, GenLayer jury decides refund or release.
5. Record both runs for the video.

## Video plan — 45 seconds max
- 0–5s: problem — agent paid, no report
- 5–15s: x402 payment, 0.25 USDC, receipt
- 15–30s: dispute — receipt to Internet Court
- 30–40s: GenLayer jury verdict — refund
- 40–45s: end card — Internet Court, GenLayer, x402 logos + repo link

## Submit checklist (do not submit until every box is true)
- [ ] Repo is public
- [ ] Code actually runs, not slides only
- [ ] GenLayer verdict is visible in the demo
- [ ] Video is 45 seconds or less
- [ ] Video shows all three logos: Internet Court, GenLayer, x402
- [ ] A stranger can re-run the demo from the README alone
