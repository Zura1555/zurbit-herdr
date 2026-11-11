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
herdr-app check ~/.config/herdr-app/mods/zurbit-orbs
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

**Send prompts (sessions mod):** add `"prompts": ["…"]` to `zurbit.json`
(same precedence chain, or `localStorage` `zurbit.prompts`) to set the
send palette's preset chips. For arbitrary text, write
`~/.config/herdr-app/zurbit-prompt.txt` — the `file:` chip sends its
verbatim contents.

## Mods

| Mod | What it shows |
| --- | --- |
| `zurbit-orbs` | Compact orb strip across the top of the center column — every machine line and canonical terminal as a small animated orb (full-color nebula sprites via `image()`: violet working/breathing, amber waiting/pulsing, vermilion failed, mint done, hollow-dashed stale/unreachable). Grouped by machine line with a legend and "N connected · M lines" on the right. Click an orb to `terminal.peek` its pane (remote lines pass `machine/address`). Read-only; polls the same runtime-plane feed as `zurbit-sessions`. |
| `zurbit-inbox` | Plain-language "Needs You" queue — everything awaiting a human decision (plan approvals, merge approvals, sign-offs, failures, blocked agents) grouped by urgency. The PM surface; other mods carry the technical detail. |
| `zurbit-factory` | Plans awaiting approval, ships awaiting merge approval, active runs, recent tasks. Full task lifecycle (dispatch / sign-off / cancel / requeue), ship reconcile, notifications on newly actionable items. Inline-confirm before any mutating POST. |
| `zurbit-tabs` | Sidebar tab navigation: every space as a collapsible section — the active space expands to show its tabs with Ion status lamps (violet working / amber blocked / mint done / dim idle), pane counts and settled tabs dimmed. Click a tab to focus it (`tab.select`), a space header to switch (`space.select`), `+ new tab`/`+ new space` to create. Local-only data (no control-plane needed). |
| `zurbit-sessions` | Runtime plane mirror: cores, machine lines, and canonical terminals with verbatim degraded states (`stale`/`unreachable`/`orphaned`/…). Send/interrupt/kill steering on live terminals via `/api/work/commands` with command-outcome polling — send uses preset chips (see `prompts` below) or the `zurbit-prompt.txt` draft file since there is no text-input widget. |
| `zurbit-automation` | Automation rules (enable/disable/delete), recent fires, first-spend approvals (revoke), cost ledger. Read + toggle + delete only — no create forms. |

Status colors follow the **Ion palette** — violet `#A78BFA` working,
amber `#FBBF24` waiting/needs-you, vermilion `#FF5C4D` failed, mint
`#34D399` done — and panel headers show a signal lamp (colored core in a
halo ring) instead of a `live` text label.

## Layouts

`zurbit` — the full board (design A):

```
sidebar          ┃        center         ┃       ops (340px)
zurbit-tabs      ┃  ORBS (48px strip)    ┃  Needs You (zurbit-inbox)
(spaces > tabs)  ┃  work (active tab)    ┃  Factory (zurbit-factory)
agents           ┃                       ┃  [Sessions | Automation] tabs
```

`zurbit-focus` — the collapsed companion: slim sidebar + orb strip +
the work surface, no ops column. Needs You survives as a floating
`peek` drawer on the right edge — a 10 px sliver until hovered, then it
slides out at the inbox's content width. Switch with:

```sh
herdr-app do layout.switch '{"name":"zurbit-focus"}'
herdr-app do layout.switch '{"name":"zurbit"}'   # back — or ctrl-shift-l
```

**Puck.** With [herdr-chat](https://github.com/ChmaraX/herdr-chat)
installed, the orb strip opens a dedicated chat tab named `puck` in the
work surface the first time it loads without one — the orchestrator
session is there by default. Tune it in `zurbit.json` (same precedence as
`base`/`token`, or `localStorage` `zurbit.puck`):

```json
{ "puck": { "chat": "puck", "provider": "claude", "cwd": "~" } }
```

`"puck": false` disables the auto-open entirely. Without herdr-chat the
`tab.new` fails and the strip posts a one-time "needs herdr-chat" toast —
the rest of the layout is unaffected.

## Safety

Approving a plan, approving a ship merge (head-SHA-bound), and cancelling
a run all require a two-tap inline confirm — there is no undo on the
server side. Read-only polling happens every 5 s; mutations re-fetch
immediately.

## Escape hatch

`ctrl-alt-shift-escape` always reverts to the default `main` layout —
nothing in this folder can take the window hostage.
