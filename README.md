# Zurbit × Herdr app

Herdr desktop-app surface for Zurbit: a layout + mods that render the
factory plane (plans, tasks, runs, ships), the runtime plane (cores,
machine lines, terminals), and the automation plane (rules, fires,
approvals, ledger) inside the Herdr window, next to the terminals they
steer. This repo mirrors the layout of the Herdr app home so `install.sh`
can link it straight in.

## Migration plan — the Worker is being deprecated

The Cloudflare Worker + D1 control plane is going away. Target
architecture (see the migration research): **one `zurbitd` daemon on the
hub box** talking to herdr-core over its local socket, state in
`zurbit.*` core documents + JSONL on hub, mods as the entire UI.

The data layer (`mods/zurbit-factory/api.js`) keeps one HTTP-shaped
surface throughout so the panel code never changes:

- **Interim** — `base` points at the existing Worker
  (`/api/work/dispatch/*`). Use only while zurbitd is being built.
- **Target** — `base` points at `http://127.0.0.1:<port>` on zurbitd
  (loopback, or tailnet via `tailscale serve` from another desktop).
  zurbitd re-exposes the same route shape; alternatively the mod can be
  taught `doc.get`/`doc.set` directly later — either way, only `api.js`
  changes.

## Install

```sh
sh install.sh          # symlinks into ~/.config/herdr-app
herdr-app check ~/.config/herdr-app/mods/zurbit-factory
herdr-app do layout.switch '{"name":"zurbit"}'   # or ctrl-shift-l
```

`$HERDR_APP_HOME` overrides the target home. Symlinks preserve hot-reload
on save; if your platform does not follow them, copy the folders instead.

## Config

The mod needs a base URL and a credential. Resolution order:

1. pane `props` (`{base, token}`) — for a `pane.split`-embedded copy
2. `localStorage` keys `zurbit.base` / `zurbit.token`
3. `~/.config/herdr-app/zurbit.json`:

```json
{
	"base": "http://127.0.0.1:7878",
	"token": "<zurbitd-issued bearer>"
}
```

**Auth after the Worker is gone:** no OAuth, no cookies. zurbitd binds
loopback (trusted by definition) and issues a bearer for tailnet/remote
access. The interim `cookie` field exists only to point at the legacy
Worker during the transition.

## Mods

| Mod | What it shows |
| --- | --- |
| `zurbit-factory` | Plans awaiting approval, ships awaiting merge approval, active runs, recent tasks. Full task lifecycle (dispatch / sign-off / cancel / requeue), ship reconcile, notifications on newly actionable items. Inline-confirm before any mutating POST. |
| `zurbit-sessions` | Runtime plane mirror: cores, machine lines, and canonical terminals with verbatim degraded states (`stale`/`unreachable`/`orphaned`/…). Interrupt/kill steering on live terminals via `/api/work/commands` with command-outcome polling. |
| `zurbit-automation` | Automation rules (enable/disable/delete), recent fires, first-spend approvals (revoke), cost ledger. Read + toggle + delete only — no create forms. |

## Safety

Approving a plan, approving a ship merge (head-SHA-bound), and cancelling
a run all require a two-tap inline confirm — there is no undo on the
server side. Read-only polling happens every 5 s; mutations re-fetch
immediately.

## Escape hatch

`ctrl-alt-shift-escape` always reverts to the default `main` layout —
nothing in this folder can take the window hostage.
