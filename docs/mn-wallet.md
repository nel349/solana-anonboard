# Using the mn CLI wallet (via `mn serve`)

anonboard's browser Join needs a Midnight wallet to prove membership and **pay the Midnight
fee (dust)**. Two environments make that hard:

- **`undeployed` (local):** browser wallet connect currently has open issues here
  ([#1](https://github.com/nel349/solana-anonboard/issues/1)) — no reliable browser path yet.
- **`preprod`:** the chain's dust history is huge (~1.4M events); a browser wallet's built-in
  dust sync lags, so it balances the Join against **stale dust** and the node rejects it.

The **mn CLI wallet** fixes both. `mn serve` exposes your `mn` wallet to the browser over
WebSocket (same API as Lace), and its dust is synced the fast way — so it can pay a Join where a
browser wallet can't. anonboard offers it in the connect dialog as **"mn CLI wallet (local)"**.

## Prerequisites

- `mn` (midnight-wallet-cli) **≥ 0.5** — `npm install -g midnight-wallet-cli`, then `mn --version`.
  (`mn` prints a wall of `@polkadot/util has multiple versions` dedup warnings to stderr before its output — these are benign and exit 0; ignore them.)
- A wallet **funded on the target network** (steps below).

## Undeployed (local demo)

The local Midnight chain runs inside anonboard, so start it first.

```bash
bun run dev                 # brings up the local node/indexer/proof (9944/8088/6300)
```

> Make sure nothing else is holding those ports. If you have a Docker localnet up, stop it first
> (`mn localnet down`) so anonboard's own proof server can bind 6300.

In a second terminal, create + fund a wallet on that localnet, then serve it:

```bash
mn wallet generate demo
mn airdrop 1000 --wallet demo --network undeployed
mn dust register --wallet demo --network undeployed     # lets it pay fees
mn serve --wallet demo --network undeployed --approve-all
```

Then open http://localhost:5173 → **Connect wallet → "mn CLI wallet (local)" → Join**.

## Preprod (hosted)

Fund a wallet on preprod once (full walkthrough: [networks & accounts](networks-and-accounts.md#funding-the-payer-wallet-on-a-hosted-net)):

```bash
mn wallet generate demo
mn address --wallet demo --network preprod              # fund this address at the preprod faucet
mn dust register --wallet demo --network preprod        # then wait for dust to accrue
mn dust status --wallet demo --network preprod          # confirm dust > 0 before serving
```

Serve it and run the app against preprod:

```bash
mn serve --wallet demo --network preprod --approve-all
bun run dev:preprod
```

Then **Connect wallet → "mn CLI wallet (local)" → Join**.

## How the app finds it

The frontend offers "mn CLI wallet (local)" whenever `MN_SERVE_URL` is set — default
`ws://localhost:9932`. Override with `VITE_MN_SERVE_URL`, or set it empty to hide the option. It
speaks the same connector API as a browser wallet, so Join / balance / submit work unchanged.

## Approvals

- `--approve-all` auto-approves everything — smoothest for a demo.
- Without it, reads auto-approve but every **write** (balancing + submitting the Join) waits for
  you to approve **in the `mn serve` terminal**; the app shows "Approve … in the mn serve terminal…".

## Troubleshooting

- **Port 9932 already in use** — another `mn serve` is running. Stop it, or pick a port
  (`mn serve --port 9933 …`) and point the app at it (`VITE_MN_SERVE_URL=ws://localhost:9933`).
- **Undeployed: proof/node errors at boot** — a Docker localnet (or another stack) holds
  9944/8088/6300. Stop it (`mn localnet down`) so anonboard's native localnet owns them.
- **"wallet is on network X, expected Y"** — the `mn serve --network` must match the app's network
  (`VITE_MIDNIGHT_NETWORK_ID`).
- **Join still fails on preprod** — the served wallet isn't funded or its dust hasn't accrued.
  Check `mn balance --wallet demo --network preprod` and `mn dust status --wallet demo --network preprod`.
