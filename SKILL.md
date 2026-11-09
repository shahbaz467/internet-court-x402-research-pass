# Agent Research Pass — reproducible demo skill (draft)

Based on: internet-court/internet-court-skill, integrations/x402-erc7710

## What you need
- A test wallet (demo only, never a main wallet)
- Base Sepolia testnet USDC for the demo amounts below
- This repo, public

## Delegation (do not change without a reason)
- Max 5 USDC per week
- Max 0.25 USDC per request
- Only to the provider wallet
- Expires in 7 days

## Run it
1. Open the demo page in `demo/`.
2. The page creates a real agent EOA for the demo and exports a JSON
   package with the agent key, ERC-7710 permission context, permission
   manager, x402 policy, and GenLayer control metadata.
   Keep that JSON private — it contains a demo private key.
3. Request one research report. Pay 0.25 USDC with x402.
4. Happy path: report arrives on time and in the right format — payment releases.
5. Dispute path: report is missing, malformed, late, or source-incompatible
   — route the receipt and report to Internet Court / GenLayer for
   refund / release.

## GenLayer decision payload
Build a decision payload for one of: continue, warn, constrain, revoke,
or escalate. The demo must show the verdict, not just claim it.

## Do not invent
- Do not invent a GenLayer supervisor address, contract address, or API
  endpoint. Use only the address / endpoint from the deployed demo or
  the skill repo, and label any temporary placeholder as temporary.
