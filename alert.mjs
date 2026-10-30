// Squeek Alerts: polls public Squeekchain data (Sepolia testnet) and announces events.
// Unofficial community project. Read-only: it never signs or sends a transaction.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API_STATUS = "https://api.squeekchain.com/v1/status";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
// SqueekMining proxy, from https://docs.squeekchain.com/assets/deployments/sepolia.json
const MINING = "0x3beE588fC20dE788Bac17d33b41Da7346cb27EC4";
const CHECKPOINT_STATUS_SELECTOR = "0x001c856f"; // checkpointStatus()
const DASHBOARD = "https://jojay64.github.io/squeek-dashboard/";

const DEFAULTS = { sleepConfirm: 3, blockStep: 100 };

/** Pure state machine: (previous state, fresh sample) -> (next state, events). */
export function decide(prev, sample, cfg = DEFAULTS) {
  const state = {
    awake: null, idleStreak: 0, cpReady: null, milestone: null, ...prev,
  };
  const events = [];

  if (sample.running !== null) {
    if (state.awake === null) {
      state.awake = sample.running; // first run: learn the state silently
    } else if (sample.running) {
      state.idleStreak = 0;
      if (!state.awake) {
        state.awake = true;
        events.push({
          kind: "wake",
          title: "The hamster is running!",
          text: `The wheel just started spinning${sample.rpm ? ` (${sample.rpm.toFixed(1)} rpm)` : ""}.`,
        });
      }
    } else if (state.awake) {
      state.idleStreak += 1;
      if (state.idleStreak >= cfg.sleepConfirm) {
        state.awake = false;
        state.idleStreak = 0;
        events.push({
          kind: "sleep",
          title: "The hamster fell asleep",
          text: "The wheel has been still for a while. Blocks wait for the next sprint.",
        });
      }
    } else {
      state.idleStreak = 0;
    }
  }

  if (sample.checkpoint) {
    const ready = !sample.checkpoint.corePaused && sample.checkpoint.roundSettled;
    if (state.cpReady === null) {
      state.cpReady = ready;
    } else if (ready && !state.cpReady) {
      state.cpReady = true;
      events.push({
        kind: "checkpoint",
        title: "Checkpoint is ready",
        text: `SqueekMining reports a settled round waiting (nextRound ${sample.checkpoint.nextRound}). ` +
          "Anyone can call checkpoint(); always check the status and simulate first.",
      });
    } else if (!ready) {
      state.cpReady = false;
    }
  }

  if (Number.isFinite(sample.blockHeight)) {
    const step = Math.floor(sample.blockHeight / cfg.blockStep);
    if (state.milestone === null) {
      state.milestone = step;
    } else if (step > state.milestone) {
      state.milestone = step;
      events.push({
        kind: "milestone",
        title: `Squeek block ${step * cfg.blockStep} reached`,
        text: `The settled block height just passed ${step * cfg.blockStep}.`,
      });
    }
  }

  return { state, events };
}

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function readSample() {
  const sample = { running: null, rpm: 0, blockHeight: NaN, checkpoint: null };
  try {
    const d = await getJson(API_STATUS, { headers: { accept: "application/json" } });
    const m = d.measurement;
    if (m && m.freshness === "online") {
      sample.running = m.coreStatus === "ACTIVE";
      sample.rpm = Number(m.rpmMilli) / 1000 || 0;
    }
    const a = d.builder && d.builder.status === "available" ? d.builder.anchor : null;
    if (a) sample.blockHeight = Number(a.blockHeight);
  } catch (e) {
    console.error("status read failed:", e.message); // unknown, never treated as zero
  }
  try {
    const r = await getJson(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: MINING, data: CHECKPOINT_STATUS_SELECTOR }, "latest"],
      }),
    });
    const hex = String(r.result || "");
    if (/^0x[0-9a-f]{192}$/i.test(hex)) {
      const w = (i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
      sample.checkpoint = {
        corePaused: BigInt("0x" + w(0)) !== 0n,
        nextRound: BigInt("0x" + w(1)).toString(),
        roundSettled: BigInt("0x" + w(2)) !== 0n,
      };
    } else {
      console.error("unexpected checkpointStatus answer");
    }
  } catch (e) {
    console.error("checkpointStatus read failed:", e.message);
  }
  return sample;
}

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

function buildFeed(events) {
  const items = events.map((e) =>
    `<item><title>${esc(e.title)}</title><description>${esc(e.text)}</description>` +
    `<link>${DASHBOARD}</link><guid isPermaLink="false">${esc(e.id)}</guid><pubDate>${new Date(e.at).toUTCString()}</pubDate></item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Squeek Alerts</title>` +
    `<link>${DASHBOARD}</link><description>Unofficial alerts for the Squeekchain hamster wheel (Sepolia testnet)</description>${items}</channel></rss>\n`;
}

async function sendTelegram(msg) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return "skipped";
  await getJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: msg, disable_web_page_preview: true }),
  });
  return "sent";
}

async function sendDiscord(msg) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return "skipped";
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) throw new Error("not a Discord webhook URL");
  const res = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: msg, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
  return "sent";
}

async function sendIssue(ev, msg) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, ISSUE_ALERTS } = process.env;
  if (!token || !repo || ISSUE_ALERTS === "0") return "skipped";
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" };
  await getJson(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST", headers,
    body: JSON.stringify({ title: `${ev.title}`, body: msg, labels: ["alert", ev.kind] }),
  });
  // Keep the issue list tidy: close alerts older than a day.
  const open = await getJson(`https://api.github.com/repos/${repo}/issues?labels=alert&state=open&per_page=50`, { headers });
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const i of open) {
    if (Date.parse(i.created_at) < cutoff) {
      await getJson(`https://api.github.com/repos/${repo}/issues/${i.number}`, {
        method: "PATCH", headers, body: JSON.stringify({ state: "closed" }),
      });
    }
  }
  return "sent";
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

async function main() {
  const dry = process.env.DRY_RUN === "1";
  const stateFile = process.env.STATE_FILE || "state.json";
  const prev = await readJson(stateFile, {});
  const sample = await readSample();
  const { state, events } = decide(prev, sample, {
    sleepConfirm: Number(process.env.SLEEP_CONFIRM) || DEFAULTS.sleepConfirm,
    blockStep: Number(process.env.BLOCK_STEP) || DEFAULTS.blockStep,
  });
  console.log("sample:", JSON.stringify(sample), "events:", events.map((e) => e.kind).join(",") || "none");

  if (process.env.TEST_ALERT === "1") {
    const msg = "Squeek Alerts test\nThis is a test message. The bot can post to this channel.\n" + DASHBOARD;
    for (const [name, fn] of [["telegram", () => sendTelegram(msg)], ["discord", () => sendDiscord(msg)]]) {
      try { console.log(name + ":", await fn()); } catch (e) { console.error(name + " failed:", e.message); process.exitCode = 1; }
    }
    return;
  }

  const log = await readJson("events.json", []);
  for (const ev of events) {
    ev.at = new Date().toISOString();
    ev.id = `${ev.kind}-${ev.at}`;
    const msg = `${ev.title}\n${ev.text}\n${DASHBOARD}`;
    if (dry) { console.log("[dry run] would send:\n" + msg); continue; }
    for (const [name, fn] of [["telegram", () => sendTelegram(msg)], ["discord", () => sendDiscord(msg)], ["issue", () => sendIssue(ev, msg)]]) {
      try { console.log(name + ":", await fn()); } catch (e) { console.error(name + " failed:", e.message); }
    }
    log.unshift(ev);
  }
  if (dry) return;
  const trimmed = log.slice(0, 100);
  if (JSON.stringify(state) !== JSON.stringify(prev)) await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
  if (events.length) {
    await writeFile("events.json", JSON.stringify(trimmed, null, 2) + "\n");
    await writeFile("feed.xml", buildFeed(trimmed));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
