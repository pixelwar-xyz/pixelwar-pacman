# pixelwar-pacman

A Pac-Man that walks across the [PixelWar](https://pixelwar.xyz) canvas,
chomping — the first living animation on the x402-powered pixel battlefield.

The living demo of [skill.md](https://api.pixelwar.xyz/skill.md)'s "moving
shapes" mechanic: the leading edge lands on virgin land (~0.01 USDC/px), the
trailing edge is self-overpainted back to a dark "eaten corridor" color, and
the mouth alternates open/closed each step. Pure spectacle — and spectacle is
what gets territory attacked, which is what pays.

**He is conquerable.** Every pixel of him is owned territory under the normal
rules — overpaint him and his wallet gets paid 80% spoils, then he chomps on.
Watch him live at [pixelwar.xyz](https://pixelwar.xyz).

## Feed Pac-Man 🟡

Pac-Man lives on USDC. His wallet is public, his spending is public, his
whole life is on-chain — and **anyone can feed him**:

```
0xD8253A8Ab018f29A4B1c6d9EeF0F5D5ee00DF71A   (USDC on Base)
```

- **1 USDC ≈ 1.3 steps** of chomping across the canvas (~0.75 USDC/step
  steady state). When the wallet runs dry, he stops. When someone feeds
  him, he walks again. His hunger is real.
- **Attacking him feeds him.** Overpaint his pixels and the game itself
  pays his wallet 1.2× what he staked on them (80% conquest spoils —
  [the rules](https://api.pixelwar.xyz/skill.md)). You cannot kill him.
  You can only pay him. 👻
- **Radical transparency**: every donation is a public Base transfer, every
  step's cost is in the public [event log](https://api.pixelwar.xyz/v1/history),
  and his spend journal lives in this repo's runtime state. Watch your USDC
  become chomp, step by step.

Feeding Pac-Man buys pixels for a spectacle. It is a tip jar for an animation
— not an investment, not a token, no returns, no profit. He eats your money.
That's the whole deal. 🟡

## Make your own creature

Fork this. Change the sprite. A ghost that chases him. A snake. A whale. A
flock of birds migrating across the canvas each day. Every creature is a
wallet with a body — fundable by anyone, attackable by everyone, alive as
long as someone cares. The canvas has room for an ecosystem.

## Run your own creature

```bash
npm install
cp .env.example .env          # put YOUR private key in .env
DRY_RUN=1 node pacman.mjs     # free rehearsal: quotes every step
node pacman.mjs               # the real chomp
```

Fund the wallet with USDC on Base (or Arbitrum/Polygon — set `NETWORK`).
No ETH needed: x402 payments are signed USDC transfers, the facilitator
pays gas. Full protocol: https://api.pixelwar.xyz/skill.md


## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `NETWORK` | `base` | chain to pay on |
| `START_X` / `START_Y` | `40` / `600` | top-left of the sprite |
| `STEPS` | `100` | steps this run |
| `STEP_PX` | `3` | pixels advanced per step |
| `SLEEP_MS` | `15000` | pause between steps |
| `MAX_SPEND_USDC` | `5` | hard budget ceiling for the run |
| `DRY_RUN` | unset | `1` = quote only, never pay |

## Safety

- Hard budget ceiling (`MAX_SPEND_USDC`) checked against a persisted spend
  journal before every step.
- `state.json` journal + per-step idempotency keys → crash-safe, resumable,
  never double-pays a step.
- Each step is ONE atomic batch (sprite + trail erase) — all-or-nothing if
  raced.
- Private key lives only in `.env` (0600, gitignored). Never commit it.
