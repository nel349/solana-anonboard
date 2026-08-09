-- Anonymous member badges, mirrored from Midnight's public ledger.
-- A row here means: some roster member proved membership and bound this
-- Solana key. Which member, nobody knows, including this database.
CREATE TABLE IF NOT EXISTS badges (
  pubkey TEXT PRIMARY KEY,
  block_height INTEGER NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Posts observed on Solana. `accepted` is the whole point of the project:
-- it records whether the signer held a Midnight badge at the time the post
-- was folded in. Rejected posts are kept so the demo can show the check
-- doing real work rather than silently dropping rows.
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  slot BIGINT NOT NULL,
  block_height INTEGER NOT NULL,
  accepted BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_accepted ON posts (accepted, id DESC);
