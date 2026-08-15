# anonboard — Design System

Internal reference. Gitignored. The visual language for the anonboard frontend
(and any anonboard surface). Source of truth for tokens, type, the signature
motif, and components. Live references live beside this file:

- `claw-solana.html` — **the canonical hero** (full 1200×680, big tear marks). This is the approved look.
- `design-system.html` — the showcase (tokens + components, light/dark).
- `claw-gallery.html` — early claw-language explorations (archive).

## The idea in one line

A sheet is torn open to reveal the two chains beneath — **membership on
Midnight, posting on Solana**. The tear is a raptor claw. It's used **once**, as
a hero; everything else stays quiet so the one gesture lands.

Principles:
- **One saturated thing on screen** — the Solana gradient. Everything else is
  neutral (kraft in light, near-black indigo in dark).
- **Midnight is monochrome** — black & white. It's the surface/night.
- **The brand shows as light coming *through* a torn surface**, never stamped on top.
- **Restraint** — the claw-reveal is a hero-only move. UI chrome is calm.

## Color tokens

Theme-aware. Defined as CSS custom properties on `:root`, redefined under
`@media (prefers-color-scheme: dark)` and overridable via
`:root[data-theme="light"|"dark"]`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#e7e4dc` | `#080711` | page background |
| `--bg-2` | `#efece5` | `#0f0c1a` | elevated bg / insets |
| `--surface` | `#d8d4c7` | `#191622` | cards, the "paper" |
| `--surface-2` | `#cbc6b8` | `#100e18` | paper grain / secondary |
| `--ink` | `#221f2b` | `#e7e3f2` | primary text |
| `--muted` | `#6b6577` | `#8f89a6` | labels, captions |
| `--word` | `#211d17` | `#efe7d3` | the display wordmark (warm; distinct from Midnight's cool white) |
| `--lip` | `#f7f4ec` | `#3d3856` | torn-paper edge highlight |
| `--recess` | `#0a0812` | `#020106` | the dark space behind the tear |
| `--hair` | `#00000016` | `#ffffff14` | hairline borders |

**Brand accent — the Solana gradient (the only saturated element):**
`linear-gradient(120deg, #9945FF, #8752F3, #5497D5, #43B4CA, #28E0B9, #19FB9B)`
Stops (from the official Color logomark): `#9945FF #8752F3 #5497D5 #43B4CA #28E0B9 #19FB9B`.

**Midnight — monochrome:** black `#0b0b12` / white `#ffffff`. (Midnight's official
brand blue is `#0000fe`, from the docs `--ifm-color-primary`, but the mark itself
is used in black & white.)

**Semantic (separate from the accent):**
- verified / accepted → `#19c586` (Solana-green family)
- rejected / not-a-member → `#ff5c7a`
- pending → `--muted`

## Typography

Three roles. No web fonts on the published PoC page (CSP blocks CDNs); use system
stacks now, embed real files when the frontend ships (see "Fonts" below).

| Role | Stack | Use |
|---|---|---|
| Display | `'Futura','Trebuchet MS',sans-serif`, **700** | wordmark, hero, headings, button labels |
| Body | `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif` | reading text |
| Mono | `ui-monospace,'SF Mono',Menlo,Consolas,monospace` | eyebrows, labels, data, on-chain addresses |

- **Futura is the brand.** Bold, geometric, minimalist. Wordmark: uppercase or
  lowercase, letter-spacing ~1–2.
- Mono uppercase eyebrows carry `letter-spacing: .24em`.
- Rough scale: hero wordmark ~118px; H2 24–34; body 16; small 14; mono labels 11–13.

## The signature motif — the claw reveal

**Proportions matter.** The canonical frame is **1200×680** with large tears
(`claw-solana.html`). A short/wide crop shrinks the tears and weakens it — always
give the claw room; scale the rake up with the frame.

How it's built (layers, back to front):
1. **Recess** — a `--recess` rect: the dark space behind the surface.
2. **The reveal** — on the dark recess, both logos in their original colors:
   - Midnight mark **white**, left.
   - Solana logomark in the **Solana gradient** (`url(#sol)`), right, rotated to
     the claw angle (~−19°) so the rips can frame its bars.
3. **The paper** — a `--surface` rect with grain (`feTurbulence` alpha noise),
   masked by the claw shapes so the tears become holes; a `drop-shadow`
   (`feDropShadow`) recesses the torn edges.
4. **Torn lip** — the claw paths stroked in `--lip`, roughened, for the paper edge.
5. **Wordmark on top** — Futura, `--word` fill, with a `--surface` "moat"
   (`paint-order:stroke`) + soft shadow so it reads over both the dark tear and
   the bright reveal, and never blends into Midnight's white. The tear reads
   *behind* the letters.

Ragged edges: a `feTurbulence` + `feDisplacementMap` filter (`baseFrequency`
~0.024–0.05, `scale` ~14–20) applied to the claw shapes. Bigger `scale` = more
savage tear.

Claw rake: 3 tapered lens paths (`M -L 0 C … Z`), roughly parallel, rotated
~−19°, spaced to align with the three Solana bars.

## Co-branding

The sheet is jointly issued: **MIDNIGHT** letterhead top-left, **SOLANA**
top-right (mono label + mark). Represents both chains without a background wash.

Assets (embedded inline as SVG paths in the design files — never linked, CSP):
- **Solana logomark (Color):** `~/Downloads/Logos/Solana Logomark/SVG/Solana Logomark - Color.svg` — single compound path, viewBox 313×281, the 6-stop gradient above.
- **Midnight mark:** `midnight-libraries/midnight-docs/static/img/midnight-logo.svg` — circle ring + three stacked bars (first 4 paths of the logotype), viewBox ~36×36, monochrome.

## Shape, depth, motion

- Radius: cards `16px`, controls `11px`, pills `999px`.
- Shadow: soft, long, low-opacity (`0 24–30px 60–80px -34px` black).
- Hairlines via `--hair`, not solid borders.
- Motion: minimal. A slow ambient "breathe" on the reveal is fine; respect
  `prefers-reduced-motion`. No claw-scratch animation — the marks are static.

## Components (see `design-system.html`)

- **Buttons** — primary (Solana gradient fill, dark ink label, Futura), secondary
  (hairline outline), ghost (mono uppercase, muted).
- **State badges (pills)** — verified member (green), not-a-member (rose),
  pending (muted); mono uppercase, tinted background via `color-mix`.
- **Post card** — mono author (truncated address), body, a state pill; rejected
  cards drop to ~0.72 opacity. Footer: mono reason + slot.
- **Composer** — inset textarea (`--bg-2`), mono cost line ("you pay 0 SOL"),
  primary Post button.
- **Transparency stats** — 3-up grid: cost/post, you pay, sponsor balance;
  Futura numerals, `tabular-nums`.
- **Header** — brand lockup (gradient chip + Futura wordmark) + theme toggle
  (mono pill segment).

## Applying to the frontend (`packages/frontend`)

Planned, not yet done:
1. **`tokens.css`** — the tables above as `:root` custom properties (light) +
   dark overrides. Single source of truth the React app imports.
2. **Components** — Button, Pill/StateBadge, PostCard, Composer, StatRow, Header,
   styled through the tokens.
3. **`<ClawHero>`** — the canonical 1200×680 SVG from `claw-solana.html` as a
   component (props for wordmark + theme).
4. **Fonts** — embed **Futura** (licensed) or a close open substitute
   (**Jost** is the usual free Futura-alike) as a self-hosted `@font-face` so it
   renders identically off a Mac. Keep the mono/sans as system stacks.
5. Wire the existing UI states (member/not-member, accepted/rejected, gasless
   cost, sponsor balance) onto these components.

## Lessons captured

- Each logo in **its own original colors**: Midnight = black & white; Solana =
  its gradient. Don't invent a Midnight color.
- **Dark background** behind both logos in the reveal.
- Wordmark is **Futura** (the approved font), **solid** `--word` — not a gradient.
- The claw needs a **big frame**; small crops kill it.
