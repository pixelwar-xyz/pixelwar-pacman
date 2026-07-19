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
