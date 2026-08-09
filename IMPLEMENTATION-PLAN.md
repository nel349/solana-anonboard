# Implementation plan: the anonymous board (Solana + Midnight)

This is the build plan for turning the proven PoC into an intuitive dApp, in the
shape of `example-bboard`. Everything here rests on the four gaps already
verified (real post program, gasless posting, operator-blind join, ordering
backfill). Nothing below is a new architectural unknown; it is UX and wiring.

> Sequencing note: this is the deliverable. Per the bounty rules, don't start
> building it until the DevRel idea-validation and claim are approved. This
> document is planning, which is fine to do now.

---

## 1. What the app is, in one line

A message board where every post is provably from a verified member, no post can
be traced to a person, and the user never installs a wallet, holds a token, or
pays a fee on either chain.

---

## 2. The two decisions that shape everything (settle these first)

### Decision A — where does "membership" come from?

The roster is a set of member identities on Midnight. Someone has to decide who
is a member. This is a product call, not a technical one. Options:

1. **Invite code / allowlist** the organizer uploads. Simplest. The member
   redeems a code, the app registers them.
2. **Discord role / Aliit membership**, checked by a small backend before the
   app registers the member.
3. **Holding a specific token / NFT** on some chain, proven at registration.

The circuit and the whole flow are identical regardless; only the "who gets
added to the roster" step changes. **Recommendation: start with option 1
(invite code)** because it needs no external integration and demonstrates the
privacy mechanism cleanly. The others can layer on later.

### Decision B — walletless, or Lace-funded like bboard?

The membership secret is **app-managed** either way (this is exactly how bboard
works: `BBoardPrivateState = { secretKey }`, fed to the circuit as a witness;
the secret is never taken from Lace). The only question is who pays the fees.

- **Walletless (recommended).** The batcher pays both chains (operator-blind
  join on Midnight, gasless post on Solana). The user installs nothing and holds
  no tokens. This is the seamless story we proved end-to-end, and it is the
  strongest differentiator.
- **Lace-funded (bboard-style).** The user connects Lace and it pays the dust
  for the join. More familiar to Midnight users, but it reintroduces the
  install-a-wallet-and-hold-dust friction the walletless path removes.

**Recommendation: walletless as the default path, with Lace as an optional
"advanced" toggle later.** Rationale below in the wallet section.

---

## 3. The user journey (following bboard's shape)

Four states, mirroring bboard's connect → post flow but with a join step.

### 3a. Read the board (no wallet, no account)

Anyone can open the app and see the feed: posts tagged "verified member," no
names. This is a plain REST read from the sync node (`GET /api/posts`), live via
MQTT. bboard shows one message; we show a feed.

### 3b. Join (become a member, once)

1. User provides their membership proof (an invite code, in the recommended
   option A).
2. The app generates two secrets in the browser: a **Midnight membership secret**
   (the witness) and a **fresh Solana badge keypair** (the session identity).
   Both are stored encrypted in browser storage.
3. The organizer's roster already contains this member (added when the invite was
   issued). The app builds the `join` circuit call, proves it locally, and hands
   the proved transaction to the batcher, which pays and submits. This is the
   operator-blind path: the batcher never sees the membership secret.
4. UI shows "verifying membership…" then "you're in." The badge now exists on
   Midnight's ledger.

Honest UX detail: there is a short lag (Midnight sync catching up) between the
join landing and the badge being visible to the board. The UI should show the
member as "verified" immediately (we know locally the join succeeded) and let
them post right away; the ordering backfill (gap D) handles the case where the
first post lands before the badge syncs. Show that first post as "pending" for a
few seconds rather than "rejected."

### 3c. Post (as many times as you like, free)

1. User types a message, hits Post.
2. The app builds a Solana `post(body)` transaction, fee-payer = the batcher's
   sponsor, signed only by the badge key.
3. It goes to the batcher's `/send-input`; the batcher co-signs as fee payer and
   submits. The user pays 0 SOL.
4. The post appears in the feed once the sync node folds it and the arbiter
   confirms the signer holds a badge.

### 3d. Identity / status

A small panel: "Verified member · anonymous," a way to export/backup the badge
keypair, and (if we add it) a revoke/rotate action. No balances, because there
are none to show.

---

## 4. Wallets: what's needed, honestly

- **Phantom (Solana): not used, and it would hurt the app.** The whole point is
  that posts come from an unlinkable badge key, not the user's real Solana
  identity. Posting through Phantom would tie every post to the user's public
  Solana wallet and defeat the anonymity. The badge is a generated session key,
  and posting is gasless, so Phantom is neither needed nor wanted for the core
  loop. (If a "power user" ever wanted to fund/act with their own wallet, that is
  a separate, non-default path with a clear anonymity warning.)
- **Lace (Midnight): optional, not required in the recommended path.** Because
  the membership secret is app-managed and the batcher funds the join, Lace is
  not needed to join or post. bboard uses Lace to pay dust; our walletless path
  moves that cost to the batcher. Offer Lace only as an optional funding source
  if you want the bboard-style path too.

So the recommended app is **walletless on both chains**. That is the intuitive
experience and the thing that makes it more than a reskin.

---

## 5. Funding model (who actually pays)

The operator runs exactly two funded wallets; every user is free.

- **Solana side:** one sponsor keypair (the batcher's fee payer) holds SOL. Each
  post costs one tx fee (~5000 lamports); posts write no account, so there is no
  rent. Cheap and bounded. Top it up as usage grows.
- **Midnight side:** one operator wallet holds NIGHT registered for dust, and
  pays the dust for each join. Joins are once-per-member, so this cost is small
  and infrequent.

On localnet both are funded by genesis/airdrop automatically. On preview/mainnet
the operator funds them once and monitors balance. This is the standard
EffectStream batcher model; we are not inventing a funding mechanism.

---

## 6. Components to build (and what each is based on)

| Component | Basis | Work |
| --- | --- | --- |
| Compact contract (`join`, roster, nullifier, badges) | PoC `anonboard.compact` | done; may add revoke/rotate |
| Solana `post` program | PoC (real `post(body)`) | done; harden validation |
| EffectStream node: config, grammar, state machine (arbiter + backfill) | PoC | done; productionize |
| Postgres schema + queries | PoC (`badges`, `posts`) | done; add feed pagination |
| REST + MQTT API (`/api/posts`, `/api/badges`, live feed) | PoC + solana-starter | extend |
| Batcher (Solana sponsor + Midnight operator-blind) | solana-starter + PoC scripts | wire the Midnight balancing path into the running batcher |
| Roster admin (issue invite → add to roster) | new | small: an admin action + the off-chain issue step |
| **Frontend (React)** | bboard-ui + solana-starter frontend | the main new build: feed, join, post, status |

The only genuinely new build is the **frontend** and the **roster-admin step**.
Everything under them is proven.

---

## 7. Build phases (fits the 14-day window)

1. **Stand up the standalone repo clean.** Real name, real README, the four
   bug-fixes from `INVESTIGATION.md` applied up front (WASM dedupe, link paths,
   launch-midnight export, ledger retention). Boot green.
2. **Wire the batcher's Midnight operator-blind path** into the running stack (the
   PoC did this in a script; move it into the batcher/adapter so the frontend can
   call it).
3. **Frontend read path:** the live feed from `/api/posts` over MQTT. No wallet.
4. **Frontend join flow:** invite code → generate identity → operator-blind join
   → "verified" state, with the pending handling.
5. **Frontend post flow:** gasless post → optimistic "pending" → confirmed.
6. **Roster admin:** issue an invite and add the member to the roster.
7. **README tutorial + Awesome dApps listing PR + the two metadata steps**
   (GitHub topic `midnightntwrk`, attribution sentence).

Cut order if time runs short: revoke/rotate first, then reduce to a single
invite type, then the admin UI can be a script instead of a screen.

---

## 8. Honest risks and how they're handled

- **Ordering lag** (post before badge syncs): handled by gap D backfill; the UI
  shows "pending," never a false "rejected." Already proven.
- **Ledger pruning wedging the Solana sync on a long run** (finding #4): fix by
  configuring validator retention / starting the sync near tip; do not rely on a
  fresh boot in production.
- **Anonymity is protocol-level, not network-level.** The badge→member link
  never touches either chain, but the batcher sees that *some* request arrived
  (timing/IP). For a strong claim, note this; if it matters, add basic request
  mixing. Say so plainly rather than overclaiming "untraceable."
- **Roster trust.** Whoever controls the roster controls who can post. That is
  inherent and fine, but state it: the operator is trusted to gate membership,
  not to see who posted.

---

## 9. What to confirm with DevRel before building

- The idea and the "not a reskin" framing (Part 2 of `submission/CLAIM.md`).
- Which roster source (Decision A).
- That walletless-via-batcher is acceptable, or whether they expect Lace in the
  flow (Decision B).
- Target network for the submission (localnet is enough to demo; preview if they
  want it live).
