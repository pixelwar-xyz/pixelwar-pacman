#!/usr/bin/env node
// pixelwar-pacman — a Pac-Man that walks across the PixelWar canvas, chomping.
//
// Mechanics (per skill.md "Moving shapes"):
//   - Leading edge lands on virgin/decayed land (~0.01/px).
//   - Trailing edge is erased by self-overpainting to the background color
//     (net ~0.3x of own stake) — leaving a clean trail behind.
//   - Alternates open/closed mouth frames while moving → chomp animation.
//
// Safety:
//   - MAX_SPEND_USDC hard budget ceiling; the agent stops when reached.
//   - DRY_RUN=1 quotes instead of painting (free).
//   - State journal (state.json) → resumable, never double-paints a step.
//
// Env: PIXELWAR_PRIVATE_KEY (from .env), NETWORK (default base),
//      START_X/START_Y/STEPS/STEP_PX/SLEEP_MS/MAX_SPEND_USDC/DRY_RUN

import { PixelWarClient } from "pixelwar-sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ---- config ----------------------------------------------------------------
for (const line of existsSync(".env") ? readFileSync(".env", "utf8").split("\n") : [])
  if (line.includes("=") && !line.startsWith("#")) {
    const [k, ...v] = line.split("=");
    process.env[k.trim()] ??= v.join("=").trim();
  }

const CFG = {
  network: process.env.NETWORK || "base",
  startX: +(process.env.START_X ?? 40),
  y: +(process.env.START_Y ?? 600),
  steps: +(process.env.STEPS ?? 100),        // how many steps to walk this run
  stepPx: +(process.env.STEP_PX ?? 3),       // pixels advanced per step
  sleepMs: +(process.env.SLEEP_MS ?? 15000), // pause between steps (be a spectacle, not a blur)
  maxSpend: +(process.env.MAX_SPEND_USDC ?? 5), // hard budget for this run, USDC
  dryRun: process.env.DRY_RUN === "1",
  size: 13,                                   // sprite is 13x13
};

const YELLOW = "#ffe600";
const BG = "#0f0f14"; // trail color: near-black "eaten" corridor
const CANVAS_W = 1600;

// ---- sprite ----------------------------------------------------------------
// 13x13 Pac-Man, facing right. '#'=yellow, '.'=skip (transparent)
const FRAME_OPEN = `
....#####....
..#########..
.###########.
.###########.
#############
#########....
######.......
#########....
#############
.###########.
.###########.
..#########..
....#####....`.trim().split("\n");

const FRAME_CLOSED = `
....#####....
..#########..
.###########.
.###########.
#############
#############
#############
#############
#############
.###########.
.###########.
..#########..
....#####....`.trim().split("\n");

function spritePixels(frame, ox, oy) {
  const px = [];
  frame.forEach((row, dy) =>
    [...row].forEach((c, dx) => {
      if (c === "#") px.push({ x: ox + dx, y: oy + dy, color: YELLOW });
    })
  );
  return px;
}

// Cells occupied at offset ox (set of "dx,dy" that are yellow in EITHER frame —
// union, so erasing covers both frames' footprints).
function footprint(ox, oy) {
  const s = new Set();
  for (const f of [FRAME_OPEN, FRAME_CLOSED])
    f.forEach((row, dy) => [...row].forEach((c, dx) => { if (c === "#") s.add(`${ox + dx},${oy + dy}`); }));
  return s;
}

// ---- state journal ----------------------------------------------------------
const STATE = "state.json";
const state = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, "utf8"))
  : { x: CFG.startX, spentUsdc: 0, step: 0 };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

// ---- run --------------------------------------------------------------------
const client = new PixelWarClient({
  baseUrl: "https://api.pixelwar.xyz",
  privateKey: process.env.PIXELWAR_PRIVATE_KEY,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function payStep(pixels, label) {
  if (!pixels.length) return 0;
  const quote = await client.quote(pixels);
  const cost = +quote.totalUsdc || quote.total / 1e6;
  if (state.spentUsdc + cost > CFG.maxSpend) {
    console.log(`[budget] step would cost ${cost} → total ${state.spentUsdc + cost} > ceiling ${CFG.maxSpend}. Stopping.`);
    return -1;
  }
  if (CFG.dryRun) {
    console.log(`[dry] ${label}: ${pixels.length}px would cost ${cost} USDC`);
    return 0;
  }
  const res = await client.paint(pixels, {
    network: CFG.network,
    idempotencyKey: `pacman-step${state.step}-${label}`,
  });
  const paid = +res.totalPaidUsdc || 0;
  state.spentUsdc += paid;
  console.log(`[paint] ${label}: ${pixels.length}px paid ${paid} USDC (total ${state.spentUsdc.toFixed(4)})`);
  return paid;
}

async function main() {
  console.log(`Pac-Man @ (${state.x},${CFG.y}) net=${CFG.network} budget=${CFG.maxSpend} USDC dry=${CFG.dryRun}`);
  for (let i = 0; i < CFG.steps; i++) {
    const frame = state.step % 2 === 0 ? FRAME_OPEN : FRAME_CLOSED;
    const newX = state.x + CFG.stepPx;
    if (newX + CFG.size >= CANVAS_W) { console.log("Reached right edge. A hero's journey complete."); break; }

    // Desired end-state: sprite at newX; everything from the previous
    // footprint not covered by the new sprite becomes trail (BG).
    // We paint ONLY cells whose color actually changes vs what we last painted
    // (state.cells) — repainting owned pixels compounds 1.5x per repaint,
    // the "money bonfire" skill.md warns about. Diff-painting avoids it.
    const want = new Map(); // "x,y" -> color
    for (const p of spritePixels(frame, newX, CFG.y)) want.set(`${p.x},${p.y}`, YELLOW);
    for (const k of footprint(state.x, CFG.y)) if (!want.has(k)) want.set(k, BG);

    state.cells ??= {}; // "x,y" -> color we last painted there
    const batch = [];
    for (const [k, color] of want) {
      if (state.cells[k] === color) continue; // already that color — skip, save money
      const [x, y] = k.split(",").map(Number);
      batch.push({ x, y, color });
    }

    // one atomic batch (all-or-nothing on races)
    const rc = await payStep(batch, `x=${newX}`);
    if (rc === -1) break;

    // journal what we now believe each cell looks like
    for (const [k, color] of want) state.cells[k] = color;
    state.x = newX;
    state.step++;
    save();
    await sleep(CFG.sleepMs);
  }
  console.log(`Done. Position x=${state.x}, lifetime spend ${state.spentUsdc.toFixed(4)} USDC.`);
}

main().catch((e) => { console.error("FATAL", e?.message || e); save(); process.exit(1); });
