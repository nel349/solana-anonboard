// Hero with an overlay bar (tagline + theme toggle).
import { ClawHero } from "./ClawHero.tsx";
import type { Theme } from "../hooks/useTheme.ts";

export function Hero({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  return (
    <div className="hero">
      <ClawHero />
      <div className="hero-bar">
        <p className="eyebrow">Membership on Midnight · Posting on Solana</p>
        <div className="toggle" role="group" aria-label="Theme">
          <button type="button" aria-pressed={theme === "light"} onClick={() => onTheme("light")}>
            Light
          </button>
          <button type="button" aria-pressed={theme === "dark"} onClick={() => onTheme("dark")}>
            Dark
          </button>
        </div>
      </div>
    </div>
  );
}
