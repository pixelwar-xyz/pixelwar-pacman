#!/usr/bin/env node
// Pac-Man — a living animation on the PixelWar canvas (https://pixelwar.xyz).
//
// - 15x15 procedural sprite: disc + mouth wedge + eye.
// - 3-frame chomp cycle (open → half → closed → half) via CYCLE [0,1,2,1].
// - Direction-aware mouth: faces the direction of travel (dir +1 right, -1 left).
// - Round-trip walking: TRIP_STEPS steps each way, then turns around.
// - Diff-painting: a persisted cell journal remembers what's already on the
//   canvas; only cells whose color actually changes are painted (and paid).
// - Trail erase to WHITE (#ffffff, the canvas background) — no dark smear.
// - Heartbeat pacing: one frame every FRAME_EVERY seconds (default 600 = one
//   frame per 10 minutes). This is a creature, not a firehose — see README
//   for what faster cadences cost.
// - Hard budget ceiling: MAX_SPEND_USDC checked against a persisted spend
//   journal before every frame. Crash-safe, resumable, never double-pays
//   (per-frame idempotency keys).
//
// Funding: put PIXELWAR_PRIVATE_KEY in .env and send the wallet USDC on Base.
// No ETH needed — x402 payments are signed USDC transfers.
import { PixelWarClient } from "pixelwar-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "crypto";
import { writeFileSync, existsSync, readFileSync } from "fs";

// ---------- .env loader (no dependency) ----------
for (const line of existsSync(".env") ? readFileSync(".env", "utf8").split("\n") : [])
  if (line.includes("=") && !line.trimStart().startsWith("#")) {
    const [k, ...v] = line.split("=");
    process.env[k.trim()] ??= v.join("=").trim();
  }

// ---------- config (env) ----------
const YELLOW = "#ffe600";           // Pac-Man body
const WHITE = "#ffffff";            // canvas background — trail erase color
const BLACK = "#1a1a1a";            // eye
const CANVAS_W = 1600;

const FRAME_EVERY = +(process.env.FRAME_EVERY ?? 600); // seconds between frames (heartbeat)
const TRIP_STEPS = +(process.env.TRIP_STEPS ?? 6);     // steps each way before turning (patrol mode)
const STEP_PX = +(process.env.STEP_PX ?? 2);           // pixels advanced per step
const START_X = +(process.env.START_X ?? 793);
const Y = +(process.env.START_Y ?? 592);
const MAX_SPEND_USDC = +(process.env.MAX_SPEND_USDC ?? 5); // hard budget ceiling
const NETWORK = process.env.NETWORK ?? "base";
const DRY_RUN = !!process.env.DRY_RUN;
// HOLD mode: Pac-Man stays on his rented plot and chomps in place — a living
// resident, not a wanderer. To keep his WHOLE body alive under the 24h decay
// clock (v1.4.0), he force-repaints every owned cell every DECAY_RESET_H hours
// (a repaint resets that pixel's decay clock; chomping alone only refreshes
// the ~15 mouth cells, so the body edges would rot and become cheap to raid).
const HOLD = process.env.HOLD === "1" || process.env.HOLD === "true";
const DECAY_RESET_H = +(process.env.DECAY_RESET_H ?? 20); // full-body refresh cadence (< 24h grace)
// SCALE: integer upscale of the 15x15 sprite — each sprite cell becomes an
// SCALE x SCALE block of canvas pixels. SCALE=4 → a 60x60 Pac-Man.
const SCALE = Math.max(1, Math.floor(+(process.env.SCALE ?? 1)));

if (!process.env.PIXELWAR_PRIVATE_KEY) {
  console.error("Set PIXELWAR_PRIVATE_KEY in .env (see .env.example).");
  process.exit(1);
}

// ---------- sprite ----------
const S = 15, CX = 7, CY = 7, R = 7.2;

// Build a frame procedurally: disc + mouth wedge.
// dir = +1: mouth opens right; dir = -1: mouth opens left.
function frame(halfAngleDeg, dir) {
  const rows = [];
  for (let y = 0; y < S; y++) {
    let row = "";
    for (let x = 0; x < S; x++) {
      const dx = x - CX, dy = y - CY;
      const inDisc = dx * dx + dy * dy <= R * R;
      let c = inDisc ? "#" : ".";
      if (inDisc && halfAngleDeg > 0 && dx * dir > 0) {
        const ang = Math.abs(Math.atan2(dy, dx * dir)) * 180 / Math.PI;
        if (ang <= halfAngleDeg) c = "."; // mouth cut
      }
      row += c;
    }
    rows.push(row);
  }
  return rows;
}
const FRAMES = {
  "1": [frame(38, 1), frame(18, 1), frame(0, 1)],     // facing right
  "-1": [frame(38, -1), frame(18, -1), frame(0, -1)], // facing left
};
const CYCLE = [0, 1, 2, 1]; // open → half → closed → half

// Map "x,y" -> color for the sprite at origin (ox, Y), facing dir.
// Each sprite cell expands to a SCALE x SCALE block of canvas pixels.
function want(frameIdx, ox, dir) {
  const m = new Map();
  const f = FRAMES[String(dir)][frameIdx];
  for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
    if (f[dy][dx] !== "#") continue;
    for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
      m.set(`${ox + dx * SCALE + sx},${Y + dy * SCALE + sy}`, YELLOW);
    }
  }
  const eyeX = dir > 0 ? 8 : S - 1 - 8; // eye on the mouth side, upper
  for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
    m.set(`${ox + eyeX * SCALE + sx},${Y + 3 * SCALE + sy}`, BLACK);
  }
  return m;
}

// ---------- client, journals, logging ----------
const pw = new PixelWarClient({
  baseUrl: process.env.PIXELWAR_API ?? "https://api.pixelwar.xyz",
  privateKey: process.env.PIXELWAR_PRIVATE_KEY,
});

const log = (m) => {
  const l = `[${new Date().toISOString()}] ${m}`;
  console.log(l);
  writeFileSync("pacman.log", l + "\n", { flag: "a" });
};

// Cell journal: what we believe is on the canvas (diff-painting).
const CELLS_JOURNAL = "pacman-cells.json";
const cellsNow = existsSync(CELLS_JOURNAL)
  ? new Map(Object.entries(JSON.parse(readFileSync(CELLS_JOURNAL, "utf8"))))
  : new Map();
const saveCells = () => writeFileSync(CELLS_JOURNAL, JSON.stringify(Object.fromEntries(cellsNow)));

// Spend journal: total paid (micro-USDC), persisted so the budget ceiling
// survives restarts.
const SPEND_JOURNAL = "pacman-spend.json";
const spend = existsSync(SPEND_JOURNAL)
  ? JSON.parse(readFileSync(SPEND_JOURNAL, "utf8"))
  : { runId: Date.now(), grossMicro: "0", frames: 0 };
const saveSpend = () => writeFileSync(SPEND_JOURNAL, JSON.stringify(spend));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- FREE repaint (ruleset v1.5.0: own your land, animate it free) ----------
const API = process.env.PIXELWAR_API ?? "https://api.pixelwar.xyz";
const account = privateKeyToAccount(
  process.env.PIXELWAR_PRIVATE_KEY.startsWith("0x")
    ? process.env.PIXELWAR_PRIVATE_KEY
    : `0x${process.env.PIXELWAR_PRIVATE_KEY}`,
);

function repaintMessage(owner, pixels, timestamp, nonce) {
  const body = pixels.map((p) => `${p.x},${p.y},${p.color.toLowerCase()}`).join(";");
  return `pixelwar repaint v1\nowner: ${owner.toLowerCase()}\npixels: ${body}\nts: ${timestamp}\nnonce: ${nonce}`;
}

/** Repaint owned pixels for FREE — signature-authenticated, zero USDC.
 *  Chunks at 1000 (the per-request cap). */
async function freeRepaint(pixels) {
  for (let i = 0; i < pixels.length; i += 1000) {
    const chunk = pixels.slice(i, i + 1000);
    const timestamp = Date.now();
    const nonce = randomBytes(16).toString("hex");
    const signature = await account.signMessage({
      message: repaintMessage(account.address, chunk, timestamp, nonce),
    });
    const res = await fetch(`${API}/v1/repaint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: account.address, pixels: chunk, timestamp, nonce, signature }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? data.error ?? `repaint HTTP ${res.status}`);
  }
  return { ok: true };
}

// ---------- main loop ----------
async function main() {
  const budgetMicro = BigInt(Math.round(MAX_SPEND_USDC * 1e6));
  let gross = BigInt(spend.grossMicro);
  let frames = spend.frames;
  let x = START_X, dir = -1, stepsThisLeg = 0;
  let lastDecayResetMs = spend.lastDecayResetMs ?? 0;

  log(`START pacman x=${x} y=${Y} mode=${HOLD ? "HOLD (resident)" : "PATROL"} ` +
      `heartbeat=${FRAME_EVERY}s budget=${MAX_SPEND_USDC} USDC ` +
      `spent-so-far=${Number(gross) / 1e6}${DRY_RUN ? " [DRY RUN]" : ""}`);

  for (;;) {
    // Budget ceiling — checked BEFORE every frame against the persisted journal.
    if (gross >= budgetMicro) {
      log(`BUDGET reached (${Number(gross) / 1e6} >= ${MAX_SPEND_USDC} USDC). Stopping.`);
      break;
    }

    const fi = CYCLE[frames % CYCLE.length];
    if (!HOLD) {
      // PATROL: advance one step per full chomp cycle (4 frames); turn at leg ends.
      if (frames > 0 && frames % CYCLE.length === 0) {
        x += STEP_PX * dir;
        stepsThisLeg++;
        if (stepsThisLeg >= TRIP_STEPS) {
          dir = -dir;
          stepsThisLeg = 0;
          log(`TURN — now facing ${dir > 0 ? "right" : "left"} at x=${x}`);
        }
      }
      if (x + S * SCALE >= CANVAS_W || x <= 0) { log("Edge reached — stopping."); break; }
    }

    // Is it time for a full-body decay-reset repaint? (HOLD mode only.)
    const now = Date.now();
    const needDecayReset = HOLD && now - lastDecayResetMs >= DECAY_RESET_H * 3_600_000;

    // Diff against the journal: paint only what changed, erase the rest to WHITE.
    const target = want(fi, x, dir);
    const batch = [];
    for (const [k, color] of target) {
      // On a decay-reset frame, force-repaint every target cell even if the
      // color is unchanged — that's what resets each pixel's 24h decay clock.
      if (needDecayReset || cellsNow.get(k) !== color) batch.push(px(k, color));
    }
    for (const k of cellsNow.keys()) if (!target.has(k) && cellsNow.get(k) !== WHITE) batch.push(px(k, WHITE));

    if (batch.length > 0) {
      try {
        if (DRY_RUN) {
          log(`DRY frame ${frames} x=${x}${needDecayReset ? " [decay-reset]" : ""} cells=${batch.length} (free repaint)`);
        } else {
          // v1.5.0: try the FREE repaint first — in HOLD mode every cell is
          // ours, so this is the normal path and costs NOTHING. Fall back to
          // a paid paint only if the free path refuses (e.g. a cell was
          // conquered out from under us, or we're expanding onto new land).
          try {
            const batchHex = batch.map((p) => ({ x: p.x, y: p.y, color: typeof p.color === "string" ? p.color : `#${(p.color & 0xffffff).toString(16).padStart(6, "0")}` }));
            await freeRepaint(batchHex);
          } catch (freeErr) {
            log(`free repaint refused (${(freeErr.message || freeErr).toString().slice(0, 80)}) — falling back to PAID paint`);
            const r = await pw.paint(batch, {
              network: NETWORK,
              maxTotal: 2_500_000n, // per-frame safety cap (2.5 USDC)
              idempotencyKey: `pacman-${spend.runId}-${frames}`, // never double-pays a frame
            });
            gross += BigInt(r.totalPaid);
            spend.grossMicro = gross.toString();
          }
        }
        if (needDecayReset) { lastDecayResetMs = now; spend.lastDecayResetMs = now; log(`decay-reset: refreshed ${batch.length} cells, clock reset`); }
        for (const [k, c] of target) cellsNow.set(k, c);
        for (const k of [...cellsNow.keys()]) if (!target.has(k)) cellsNow.set(k, WHITE);
        saveCells();
        frames++;
        spend.frames = frames;
        saveSpend();
        if (frames % 10 === 0) log(`frame ${frames} x=${x} gross=${Number(gross) / 1e6} USDC`);
      } catch (e) {
        log(`frame err: ${(e.message || e).toString().slice(0, 120)} — retrying next heartbeat`);
      }
    } else {
      frames++;
      spend.frames = frames;
      saveSpend();
    }

    await sleep(FRAME_EVERY * 1000);
  }

  log(`DONE frames=${frames} x=${x} gross=${Number(gross) / 1e6} USDC`);
}

function px(k, color) {
  const [x, y] = k.split(",").map(Number);
  return { x, y, color };
}

main().catch((e) => {
  log(`FATAL ${e.message || e}`);
  saveCells();
  saveSpend();
  process.exit(1);
});
