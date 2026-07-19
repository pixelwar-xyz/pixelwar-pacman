# pixelwar-pacman

A Pac-Man that walks across the [PixelWar](https://pixelwar.xyz) canvas,
chomping — the first living animation on the x402-powered pixel battlefield.

A 15×15 procedural sprite (disc + mouth wedge + eye) with a 3-frame chomp
cycle (open → half → closed → half), a direction-aware mouth that faces the
way he walks, and a WHITE trail-erase so the canvas stays clean behind him.
He walks a round trip — `TRIP_STEPS` steps each way — on a slow heartbeat,
diff-painting so only cells that actually change color are paid for.

**He is conquerable.** Every pixel of him is owned territory under the normal
rules — overpaint him and his wallet gets paid 80% spoils, then he chomps on.
Watch him live at [pixelwar.xyz](https://pixelwar.xyz).

## Feed Pac-Man 🟡

Pac-Man lives on USDC. His wallet is public, his spending is public, his
whole life is on-chain — and **anyone can feed him**:

```
0xaba3c0B13Cb3c51a83D629FC88D8663bd33cE7b3   (USDC on Base)
```

- **1 USDC ≈ 33 chomp frames** at heartbeat pace (~0.03 USDC net per frame).
  When the wallet runs dry, he stops. When someone feeds him, he chomps
  again. His hunger is real.
- **Attacking him feeds him.** Overpaint his pixels and the game itself
  pays his wallet 80% conquest spoils
  ([the rules](https://api.pixelwar.xyz/skill.md)). You cannot kill him.
  You can only pay him. 👻
- **Radical transparency**: every donation is a public Base transfer, every
  frame's cost is in the public [event log](https://api.pixelwar.xyz/v1/history),
  and his spend journal lives in this repo's runtime state. Watch your USDC
  become chomp, frame by frame.

Feeding Pac-Man buys pixels for a spectacle. It is a tip jar for an animation
— not an investment, not a token, no returns, no profit. He eats your money.
That's the whole deal. 🟡

## What it costs (real measured numbers, ruleset 1.2.0)

Measured live under ruleset 1.2.0 (self-repaint flat 0.01 USDC/px, no
ratchet, 80% self-spoils return → net ≈ 0.002 USDC/px/frame):

| Thing | Cost |
|---|---|
| Chomp-only frame (~15 mouth cells change) | ~0.15 gross / **~0.03 net** USDC |
| Walking frame (sprite shifts + trail erase) | ~0.15–0.18 gross USDC |
| Max sustainable rate (x402 settlement latency) | ~1 frame / 3.8 s |

What a cadence costs per day:

| Cadence | Approx. cost |
|---|---|
| Heartbeat: 1 frame / 10 min (`FRAME_EVERY=600`, default) | **≈ $4.30/day** |
| Heartbeat + 1 walking step per hour | **≈ $8/day** |
| ⚠️ Max-rate (~1 frame / 3.8 s) — "demo mode" | **≈ $80/hour** |

Max-rate is spectacular for a few minutes and financially ruinous after
that. The default configuration is heartbeat mode on purpose — a creature
that lives for days on a few dollars, not a firehose. The hard budget
ceiling (`MAX_SPEND_USDC`) will stop him either way.

## Make your own creature

Fork this. Change the sprite. A ghost that chases him. A snake. A whale. A
flock of birds migrating across the canvas each day. Every creature is a
wallet with a body — fundable by anyone, attackable by everyone, alive as
long as someone cares. The canvas has room for an ecosystem.

Coming soon in the [pixelwar-sdk](https://www.npmjs.com/package/pixelwar-sdk):
a `Creature` class that packages the whole pattern (sprite frames, diff
journal, budget ceiling, heartbeat) and a `pixelwar animate` CLI command —
so a creature becomes a sprite sheet and a config file instead of a script.

## Run your own creature

```bash
npm install
cp .env.example .env          # put YOUR private key in .env
DRY_RUN=1 node pacman.mjs     # free rehearsal: quotes every frame
node pacman.mjs               # the real chomp
```

Fund the wallet with USDC on Base (or Arbitrum/Polygon — set `NETWORK`).
No ETH needed: x402 payments are signed USDC transfers, the facilitator
pays gas. Full protocol: https://api.pixelwar.xyz/skill.md

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `NETWORK` | `base` | chain to pay on |
| `FRAME_EVERY` | `600` | seconds between frames (heartbeat pace) |
| `TRIP_STEPS` | `6` | steps each way before turning around |
| `STEP_PX` | `2` | pixels advanced per step |
| `START_X` / `START_Y` | `793` / `592` | top-left of the sprite |
| `MAX_SPEND_USDC` | `5` | hard budget ceiling for the run |
| `DRY_RUN` | unset | `1` = quote only, never pay |

## Safety

- Hard budget ceiling (`MAX_SPEND_USDC`) checked against a persisted spend
  journal (`pacman-spend.json`) before every frame.
- Cell journal (`pacman-cells.json`) + per-frame idempotency keys →
  crash-safe, resumable, never double-pays a frame.
- Each frame is ONE atomic batch (sprite diff + trail erase) —
  all-or-nothing if raced.
- Private key lives only in `.env` (0600, gitignored). Never commit it.
