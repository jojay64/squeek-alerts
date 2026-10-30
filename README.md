# Squeek Alerts

Real push alerts for the [Squeekchain](https://docs.squeekchain.com) hamster wheel (Sepolia testnet). Unlike in-page notifications, you do not need to keep a browser tab open.

> Unofficial community project, not affiliated with the Squeekchain team. Read-only: it never signs or sends a transaction. Testnet only.

## What it announces

| Alert | When |
|---|---|
| **The hamster is running!** | The wheel goes from idle to active. |
| **The hamster fell asleep** | The wheel stays idle for 3 checks in a row (about 15 minutes), so a short pause is not announced. |
| **Checkpoint is ready** | `checkpointStatus()` on SqueekMining changes to `corePaused = false` and `roundSettled = true`. This is the moment to call `checkpoint()`, for example with the [step-by-step helper](https://jojay64.github.io/squeek-dashboard/). |
| **Squeek block N reached** | The settled block height passes a multiple of 100. |

Unknown data (API or RPC down) is never treated as "asleep" or "not ready": nothing is announced and the previous state is kept.

## How to get the alerts

1. **GitHub notifications (no account elsewhere, no secret).** Click **Watch > Custom > Issues** on this repository. Each alert is opened as an issue labelled `alert` and closed after a day. Turn on push notifications in the GitHub mobile app.
2. **RSS.** Add `feed.xml` (raw file URL of this repo) to any feed reader.
3. **Your own Telegram or Discord channel.** Fork the repository and add secrets (below).

## Run your own copy

1. Fork this repository and enable GitHub Actions.
2. Optional, in *Settings > Secrets and variables > Actions*, add any of:
   - `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (create a bot with @BotFather)
   - `DISCORD_WEBHOOK_URL` (create a webhook in a server you administer)
3. The workflow `alerts` runs every 5 minutes. Secrets are only ever read by the workflow, never printed.

Settings through environment variables: `SLEEP_CONFIRM` (default 3), `BLOCK_STEP` (default 100), `ISSUE_ALERTS=0` to disable issues, `DRY_RUN=1` to print instead of sending.

## Limits to know

- GitHub schedules are best effort: alerts can arrive a few minutes late, and GitHub may pause scheduled workflows in repositories with no recent activity.
- It polls every 5 minutes, so a very short sprint can be missed.
- Chain reads use the public RPC `https://ethereum-sepolia-rpc.publicnode.com` and the contract address from the [official deployment record](https://docs.squeekchain.com/assets/deployments/sepolia.json).

## Develop

No dependencies, Node 20 or newer.

```bash
node --test test.mjs
DRY_RUN=1 node alert.mjs
```

The decision logic is a pure function (`decide` in `alert.mjs`), covered by `test.mjs`.
