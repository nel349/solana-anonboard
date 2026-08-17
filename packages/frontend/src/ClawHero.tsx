// The signature: a kraft sheet torn by a raptor claw, revealing the two chains
// beneath — Midnight (white, left) and Solana (its gradient, right). Used once, as
// the hero. Ported from docs/internal/design/claw-solana.html; theme-aware via the
// .t-*/.s-* CSS classes (fill/stroke bound to tokens in index.css).
export function ClawHero() {
  return (
    <div className="hero">
      <svg
        viewBox="0 0 1200 680"
        role="img"
        aria-label="ANONBOARD on a kraft sheet; claw marks tear the paper behind the letters, revealing the Solana logomark glowing beneath."
      >
        <defs>
          <linearGradient id="sol" x1="26.4" y1="287" x2="283.7" y2="-2.5" gradientUnits="userSpaceOnUse">
            <stop offset=".08" stopColor="#9945FF" /><stop offset=".3" stopColor="#8752F3" /><stop offset=".5" stopColor="#5497D5" />
            <stop offset=".6" stopColor="#43B4CA" /><stop offset=".72" stopColor="#28E0B9" /><stop offset=".97" stopColor="#19FB9B" />
          </linearGradient>
          <filter id="torn" x="-20%" y="-40%" width="140%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022 0.045" numOctaves="3" seed="11" result="t" />
            <feDisplacementMap in="SourceGraphic" in2="t" scale="20" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="recess" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="2" dy="3" stdDeviation="4.5" floodColor="#000" floodOpacity="0.62" />
          </filter>
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="5" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .45 0" />
          </filter>
          <filter id="wordShadow" x="-15%" y="-40%" width="130%" height="180%">
            <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#000" floodOpacity="0.4" />
          </filter>

          {/* official Solana logomark (viewBox 313 x 281) */}
          <path
            id="sol-logo"
            d="M311.318 221.057L259.66 276.558C258.537 277.764 257.178 278.725 255.669 279.382C254.159 280.039 252.53 280.378 250.884 280.377H5.99719C4.8287 280.377 3.68568 280.035 2.70855 279.393C1.73143 278.751 0.962771 277.837 0.49702 276.764C0.0312691 275.69 -0.111286 274.504 0.0868712 273.35C0.285028 272.196 0.815265 271.126 1.61243 270.27L53.3099 214.769C54.4299 213.566 55.7843 212.607 57.2893 211.95C58.7943 211.293 60.4178 210.953 62.0595 210.95H306.933C308.101 210.95 309.244 211.292 310.221 211.934C311.199 212.576 311.967 213.49 312.433 214.564C312.899 215.637 313.041 216.824 312.843 217.977C312.645 219.131 312.115 220.201 311.318 221.057ZM259.66 109.294C258.537 108.088 257.178 107.127 255.669 106.47C254.159 105.813 252.53 105.474 250.884 105.475H5.99719C4.8287 105.475 3.68568 105.817 2.70855 106.459C1.73143 107.101 0.962771 108.015 0.49702 109.088C0.0312691 110.162 -0.111286 111.348 0.0868712 112.502C0.285028 113.656 0.815265 114.726 1.61243 115.582L53.3099 171.083C54.4299 172.286 55.7843 173.245 57.2893 173.902C58.7943 174.559 60.4178 174.899 62.0595 174.902H306.933C308.101 174.902 309.244 174.56 310.221 173.918C311.199 173.276 311.967 172.362 312.433 171.288C312.899 170.215 313.041 169.028 312.843 167.875C312.645 166.721 312.115 165.651 311.318 164.795L259.66 109.294ZM5.99719 69.4267H250.884C252.53 69.4275 254.159 69.089 255.669 68.432C257.178 67.7751 258.537 66.8139 259.66 65.6082L311.318 10.1069C312.115 9.25107 312.645 8.18056 312.843 7.02695C313.041 5.87334 312.899 4.68686 312.433 3.6133C311.967 2.53974 311.199 1.62586 310.221 0.983941C309.244 0.342026 308.101 3.95314e-05 306.933 0L62.0595 0C60.4178 0.00279866 58.7943 0.34314 57.2893 0.999953C55.7843 1.65677 54.4299 2.61607 53.3099 3.81847L1.62576 59.3197C0.829361 60.1748 0.299359 61.244 0.100752 62.3964C-0.0978539 63.5488 0.0435698 64.7342 0.507679 65.8073C0.971789 66.8803 1.73841 67.7943 2.71352 68.4372C3.68863 69.0802 4.82984 69.424 5.99719 69.4267Z"
          />

          {/* official Midnight mark (circle + three bars) */}
          <g id="mn-mark">
            <path d="M17.5597 0.790039C7.88697 0.790039 0.0472412 8.62417 0.0472412 18.29C0.0472412 27.9559 7.88697 35.79 17.5597 35.79C27.2325 35.79 35.0722 27.9559 35.0722 18.29C35.0722 8.62417 27.2325 0.790039 17.5597 0.790039ZM17.5597 32.5623C9.68306 32.5623 3.27725 26.1586 3.27725 18.29C3.27725 10.4214 9.68306 4.01774 17.5597 4.01774C25.4364 4.01774 31.8422 10.4214 31.8422 18.29C31.8422 26.1586 25.434 32.5623 17.5597 32.5623Z" />
            <path d="M19.2033 16.6482H15.9166V19.9325H19.2033V16.6482Z" />
            <path d="M19.2033 11.4609H15.9166V14.7453H19.2033V11.4609Z" />
            <path d="M19.2033 6.27539H15.9166V9.55972H19.2033V6.27539Z" />
          </g>

          {/* big claw rake — spaced to frame the three Solana bars */}
          <g id="rake" transform="translate(600 344) rotate(-19)">
            <path d="M -348 0 C -174 -40 174 -40 348 0 C 174 40 -174 40 -348 0 Z" transform="translate(0 -180)" />
            <path d="M -394 0 C -197 -46 197 -46 394 0 C 197 46 -197 46 -394 0 Z" transform="translate(0 0)" />
            <path d="M -336 0 C -168 -40 168 -40 336 0 C 168 40 -168 40 -336 0 Z" transform="translate(0 180)" />
          </g>
          <mask id="claws"><rect width="1200" height="680" fill="#fff" /><use href="#rake" fill="#000" filter="url(#torn)" /></mask>
        </defs>

        {/* 0 · dark recessed space behind the paper */}
        <rect width="1200" height="680" className="t-recess" />

        {/* 1 · both logos on the dark reveal, each in its ORIGINAL colors */}
        <g className="breathe">
          <g transform="translate(302 340) scale(9) translate(-17.56 -18.29)" fill="#ffffff"><use href="#mn-mark" /></g>
          <g transform="translate(902 340) rotate(-19) scale(1.2) translate(-156.5 -140.5)"><use href="#sol-logo" fill="url(#sol)" /></g>
        </g>

        {/* 2 · the paper, torn — mask punches the claw holes; drop-shadow recesses them */}
        <g mask="url(#claws)" filter="url(#recess)">
          <rect width="1200" height="680" className="t-surface" />
          <rect width="1200" height="680" className="t-surface2" opacity=".38" filter="url(#grain)" />
          <rect x="24" y="24" width="1152" height="632" rx="6" fill="none" stroke="#00000018" strokeWidth="48" />
        </g>

        {/* 3 · torn paper lip */}
        <use href="#rake" fill="none" className="s-lip" strokeWidth="3" filter="url(#torn)" opacity=".85" />

        {/* 4 · the wordmark — Futura, solid ink, moat + shadow so it reads over both */}
        <g filter="url(#wordShadow)" fontFamily="'Futura','Trebuchet MS',sans-serif" fontWeight="700" fontSize="118" letterSpacing="2" textAnchor="middle">
          <text x="600" y="388" className="t-surface s-surface" paintOrder="stroke" strokeWidth="9" strokeLinejoin="round">ANONBOARD</text>
          <text x="600" y="388" className="t-word">ANONBOARD</text>
        </g>

        {/* co-branding: MIDNIGHT (surface) × SOLANA (revealed) */}
        <g fontFamily="ui-monospace,Menlo,Consolas,monospace" fontSize="18" letterSpacing="3">
          <g className="t-ink" opacity=".72">
            <g transform="translate(74 52) scale(0.92)"><use href="#mn-mark" /></g>
            <text x="118" y="80">MIDNIGHT</text>
          </g>
          <text x="1058" y="80" textAnchor="end" className="t-ink" opacity=".72">SOLANA</text>
          <g transform="translate(1072 52) scale(0.107)"><use href="#sol-logo" fill="url(#sol)" /></g>
        </g>
      </svg>
    </div>
  );
}
