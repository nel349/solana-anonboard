import { useRef, useState } from "react";
import { loadOrCreateBadge } from "./session.ts";
import { useFeed } from "./hooks/useFeed.ts";
import { useSponsorBalance } from "./hooks/useSponsorBalance.ts";
import { useTheme } from "./hooks/useTheme.ts";
import { useAppStatus } from "./hooks/useAppStatus.ts";
import { useWalletConnection } from "./hooks/useWalletConnection.ts";
import { useJoin } from "./hooks/useJoin.ts";
import { usePost } from "./hooks/usePost.ts";
import { SolanaPanel } from "./components/SolanaPanel.tsx";
import { Hero } from "./components/Hero.tsx";
import { BadgeHeader } from "./components/BadgeHeader.tsx";
import { Composer } from "./components/Composer.tsx";
import { StatusLine } from "./components/StatusLine.tsx";
import { JoinRow } from "./components/JoinRow.tsx";
import { Feed } from "./components/Feed.tsx";

export function App() {
  const badge = useRef(loadOrCreateBadge()).current;
  const badgePk = badge.publicKey.toBase58();

  const feed = useFeed(badgePk);
  const sponsorSol = useSponsorBalance();
  const [theme, setTheme] = useTheme();
  const { status, setStatus } = useAppStatus();

  const conn = useWalletConnection(setStatus);
  const joinFlow = useJoin({
    wallet: conn.wallet,
    walletName: conn.walletName,
    badge,
    secret: conn.secret,
    isMember: feed.isMember,
    setStatus,
  });
  const composer = usePost({
    badge,
    optimistic: feed.optimistic,
    addOptimistic: feed.addOptimistic,
    dropOptimistic: feed.dropOptimistic,
    setStatus,
  });

  const [solanaOpen, setSolanaOpen] = useState(false);
  const busy = conn.busy || joinFlow.busy;
  const member = joinFlow.joined || feed.isMember === true;

  return (
    <div className="wrap">
      <SolanaPanel sponsorSol={sponsorSol} open={solanaOpen} onToggle={() => setSolanaOpen((o) => !o)} />

      <Hero theme={theme} onTheme={setTheme} />

      <div className="stage">
        <div className="card console">
          <BadgeHeader badgePk={badgePk} member={member} isMember={feed.isMember} />
          <Composer draft={composer.draft} onDraft={composer.setDraft} onPost={composer.post} busy={busy} />
          <StatusLine status={status} />
          {!member && feed.isMember !== null && (
            <JoinRow
              wallet={conn.wallet}
              pickList={conn.pickList}
              busy={busy}
              onConnect={conn.connect}
              onJoin={joinFlow.join}
              onPick={conn.doConnect}
            />
          )}
        </div>

        <Feed posts={feed.posts} optimistic={feed.optimistic} badgePk={badgePk} />

        <footer>Solana + Midnight, one EffectStream state machine.</footer>
      </div>
    </div>
  );
}
