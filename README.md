# Zurbit × Herdr app

Herdr desktop-app surface for Zurbit: a layout + mods that render the
factory plane (plans, tasks, runs, ships) inside the Herdr window, next to
the terminals they steer. This repo mirrors the layout of the Herdr app
home so `install.sh` can link it straight in.

## Phase plan

- **Phase 1 (this folder, now)** — mods are a second frontend for the
  existing Cloudflare control plane. They call the same REST API the web
  SPA uses (`/api/work/dispatch/*`) over `fetch`. Nothing on the backend
  changes.
- **Phase 2 (later, if the hub-daemon migration happens)** — the same mods
  read `zurbit.*` documents on the hub herdr-core and write
  `zurbit.cmd.*` command docs instead of HTTP. Keep the data layer in
  `mods/zurbit-factory/api.js`; only that file swaps.

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
	"base": "https://your-zurbit-worker.example.com",
	"cookie": "acp_session=<paste from browser devtools>",
	"token": "acp_vt_<not yet implemented>"
}
```

**Auth gap, known:** the REST API today authenticates humans only via the
`acp_session` GitHub-OAuth cookie (30-day expiry — works, but rots). The
planned fix is a viewer credential (`acp_vt_`) minted in the web UI,
scoped read vs. act — same pattern as `acp_mt_`/`acp_bt_`/`acp_co_`.

## Mods

| Mod | What it shows |
| --- | --- |
| `zurbit-factory` | Plans awaiting approval, ships awaiting merge approval, active runs, recent tasks. Inline-confirm before any mutating POST. |

## Safety

Approving a plan, approving a ship merge (head-SHA-bound), and cancelling
a run all require a two-tap inline confirm — there is no undo on the
server side. Read-only polling happens every 5 s; mutations re-fetch
immediately.

## Escape hatch

`ctrl-alt-shift-escape` always reverts to the default `main` layout —
nothing in this folder can take the window hostage.
