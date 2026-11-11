import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, notify, appHome, readTextFile } from "herdr";
import { loadConfig, configure, api, ApiError } from "./api.js";


const ION = { working: "#A78BFA", waiting: "#FBBF24", failed: "#FF5C4D", done: "#34D399" };
const alpha = (c, a) => c + Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0");

// Signal lamp: a colored core inside a faint halo — the static stand-in
// for a pulse. Replaces the old textual "live" indicator in headers.
function lamp(color) {
	return div()
		.w(10).h(10).rounded_full().bg(alpha(color, 0.25))
		.flex().items_center().justify_center()
		.child(div().w(5).h(5).rounded_full().bg(color));
}

const POLL_MS = 5000;
const CMD_POLL_MS = 2000;
const CMD_DEADLINE_MS = 60000;

const CMD_FINAL = new Set(["done", "failed", "unknown"]);

// No text-input widget exists in the mod runtime — send prompts come
// from preset chips (configurable via `prompts` in zurbit.json /
// localStorage "zurbit.prompts" / pane props) plus a draft file the
// user edits anywhere: ${appHome}/zurbit-prompt.txt.
const DEFAULT_PROMPTS = [
	"continue",
	"yes — proceed",
	"no — stop and report",
	"status summary",
];

function statusColor(t, s) {
	if (s === "live" || s === "connected" || s === "working") return t.working;
	if (s === "done") return t.done;
	if (s === "failed") return t.ansi9;
	if (s === "blocked" || s === "needs_login" || s === "stale") return t.blocked;
	return t.muted; // unreachable / unknown / orphaned / finished / …
}

// If the mod runtime has no setTimeout, fall back to an immediately
// resolved sleep — the poll loop then just reports the last status
// seen, which steer() already tolerates.
const sleep =
	typeof setTimeout === "function"
		? (ms) => new Promise((r) => setTimeout(r, ms))
		: () => Promise.resolve();

// Addresses arrive already prefixed ("t17"), but tolerate a bare "17"
// so the title never comes out as "tt17".
function termTitle(tm) {
	if (tm.address) {
		const a = String(tm.address);
		return a.startsWith("t") ? a : `t${a}`;
	}
	return tm.id ? tm.id.slice(0, 8) : "?";
}

export default class ZurbitSessions extends View {
	init(p, cx) {
		this.cfg = null;
		this.err = null;
		this.data = { cores: [], machines: [], terminals: [] };
		this.confirming = null;
		this.sending = null;
		this.palette = null;
		this.prompts = DEFAULT_PROMPTS;
		this.loading = true;

		cx.spawn(async (cx) => {
			this.cfg = await loadConfig(p);
			configure(this.cfg);
			if (this.cfg?.prompts?.length) this.prompts = this.cfg.prompts;
			await this.refresh(cx);
			this.loading = false;
			cx.notify();
		});
		cx.timer.every(POLL_MS, (cx) => {
			if (this.cfg?.base) this.refresh(cx);
		});
	}

	async refresh(cx) {
		try {
			const [cores, machines, terminals] = await Promise.all([
				api.cores(),
				api.machines(),
				api.terminals(),
			]);
			this.data = {
				cores: cores.cores ?? [],
				machines: machines.machines ?? [],
				terminals: terminals.terminals ?? [],
			};
			this.err = null;
		} catch (e) {
			this.err = e instanceof ApiError ? `${e.message}` : String(e);
		}
		cx.notify();
	}

	/** Two-tap confirm → run fn → refresh. key makes each row's confirm independent. */
	act(cx, key, label, fn) {
		if (this.confirming !== key) {
			this.confirming = key;
			cx.notify();
			return;
		}
		this.confirming = null;
		cx.spawn(async (cx) => {
			try {
				await fn();
				await this.refresh(cx);
			} catch (e) {
				notify({
					title: `Zurbit: ${label} failed`,
					body: e instanceof ApiError ? e.message : String(e),
					level: "error",
				});
			}
			cx.notify();
		});
	}

	btn(cx, key, label, fn, t, danger = false) {
		const armed = this.confirming === key;
		const bg = armed ? t.ansi9 : danger ? t.surface : t.solid;
		const fg = armed || !danger ? t.solid_foreground : t.foreground;
		return h_flex()
			.id(key)
			.gap(4)
			.items_center()
			.children([
				div()
					.id(`${key}-go`)
					.bg(bg)
					.rounded(4)
					.px(8)
					.py(3)
					.text_color(fg)
					.child(armed ? `${label}?` : label)
					.on_click((_e, cx) => this.act(cx, key, label, fn)),
				armed
					? div()
							.id(`${key}-no`)
							.bg(t.surface)
							.rounded(4)
							.px(8)
							.py(3)
							.text_color(t.muted)
							.child("✕")
							.on_click((_e, cx) => {
								this.confirming = null;
								cx.notify();
							})
					: div(),
			]);
	}

	section(t, title, count) {
		return div()
			.text_size(11)
			.font_semibold()
			.text_color(t.muted)
			.child(`${title} · ${count}`);
	}

	/** M2 steering: POST the op, then follow the command row until it
	 * reaches a terminal status. The Worker's own pick-up deadline is
	 * 90s (→ `unknown`); we stop polling at 60s and report the last
	 * status seen rather than invent one. */
	async steer(tm, op, args = {}) {
		const requestId =
			typeof crypto !== "undefined" && crypto.randomUUID
				? crypto.randomUUID()
				: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		const res = await api.sendCommand(tm.id, op, requestId, args);
		let cmd = res?.command ?? null;
		const deadline = Date.now() + CMD_DEADLINE_MS;
		while (cmd && !CMD_FINAL.has(cmd.status) && Date.now() < deadline) {
			await sleep(CMD_POLL_MS);
			try {
				const poll = await api.command(cmd.id);
				cmd = poll?.command ?? cmd;
			} catch {}
		}
		const status = cmd?.status ?? "unknown";
		const result = cmd?.result;
		const summary =
			typeof result === "string"
				? result
				: result != null
					? JSON.stringify(result)
					: cmd?.picked_at
						? "picked, no result yet"
						: "no result recorded";
		notify({
			title: `Zurbit: ${op} ${status}`,
			body: `${termTitle(tm)} · ${summary}`.slice(0, 200),
			level: status === "done" ? "info" : "error",
		});
	}

	/** Control gate — mirrors the web Sessions bar (sessControlGate):
	 * stale projection / not-live / dead machine line → no controls at
	 * all. `send` additionally refuses `blocked` (never auto-answer,
	 * never force-send — ticket 10 boundary); blocked is reported back
	 * separately so the button can render disabled-but-explanatory. */
	controlGate(tm) {
		if (tm.stale) return { ok: false, why: "bridge offline" };
		if (tm.state !== "live") return { ok: false, why: null };
		if (tm.machine_state && tm.machine_state !== "connected") {
			return { ok: false, why: `${tm.machine} is ${tm.machine_state}` };
		}
		return {
			ok: true,
			blocked: tm.record?.status?.state === "blocked",
		};
	}

	/** Send palette toggle — first tap expands preset chips + the draft
	 * file; the chips themselves still carry the two-tap armed confirm. */
	toggleSend(cx, tm) {
		if (this.sending === tm.id) {
			this.sending = null;
			this.palette = null;
			cx.notify();
			return;
		}
		this.sending = tm.id;
		this.palette = null;
		cx.notify();
		cx.spawn(async (cx) => {
			try {
				const text = await readTextFile(
					`${appHome()}/zurbit-prompt.txt`,
				);
				this.palette = { text };
			} catch (e) {
				this.palette = { err: "no zurbit-prompt.txt" };
			}
			cx.notify();
		});
	}

	termButtons(cx, tm, t) {
		if (!tm.id) return [];
		const gate = this.controlGate(tm);
		if (!gate.ok) return [];
		const btns = [];
		if (gate.blocked) {
			// Disabled-but-explanatory (ticket 09): looks dead, tapping it
			// explains why instead of sending.
			btns.push(
				div()
					.id(`ts-${tm.id}`)
					.bg(t.surface)
					.rounded(4)
					.px(8)
					.py(3)
					.text_color(t.muted)
					.child("Send")
					.on_click((_e, cx) =>
						notify({
							title: "Zurbit: send disabled",
							body: "agent is waiting on an approval — answer it in Desktop or the terminal",
							level: "info",
						}),
					),
			);
		} else {
			btns.push(
				div()
					.id(`ts-${tm.id}`)
					.bg(this.sending === tm.id ? t.solid : t.raised)
					.rounded(4)
					.px(8)
					.py(3)
					.text_color(
						this.sending === tm.id
							? t.solid_foreground
							: t.foreground,
					)
					.child("Send")
					.on_click((_e, cx) => this.toggleSend(cx, tm)),
			);
		}
		btns.push(
			this.btn(cx, `ti-${tm.id}`, "Interrupt", () =>
				this.steer(tm, "interrupt"), t),
			this.btn(cx, `tk-${tm.id}`, "Kill", () =>
				this.steer(tm, "kill"), t, true),
		);
		return btns;
	}

	/** Preset chips + draft file. Each chip's label IS the text sent —
	 * the armed confirm shows exactly what goes out (confirm-everything). */
	sendPalette(cx, t, tm) {
		const box = h_flex().gap(4).items_center().p(4);
		for (const [i, text] of this.prompts.entries()) {
			const label =
				text.length > 28 ? `${text.slice(0, 28)}…` : text;
			box.child(
				this.btn(cx, `sp-${tm.id}-${i}`, label, async () => {
					await this.steer(tm, "send", { text });
					this.sending = null;
					this.palette = null;
				}, t),
			);
		}
		if (!this.palette) {
			box.child(
				div().text_size(11).text_color(t.muted).child("draft…"),
			);
		} else if (this.palette.err) {
			box.child(
				div()
					.text_size(11)
					.text_color(t.muted)
					.child(this.palette.err),
			);
		} else {
			const text = this.palette.text;
			if (!text.trim()) {
				box.child(
					div()
						.text_size(11)
						.text_color(t.muted)
						.child("prompt.txt is empty"),
				);
			} else {
				box.child(
					this.btn(cx, `sf-${tm.id}`, `file:${text.length}c`, async () => {
						await this.steer(tm, "send", { text });
						this.sending = null;
						this.palette = null;
					}, t),
				);
			}
		}
		return box;
	}

	row(t, key, title, sub, status, buttons) {
		// status: string, or {text, suffix} — suffix renders muted so a
		// degraded marker ("·stale", "·needs_login") never changes the
		// primary state colouring.
		const s =
			status && typeof status === "object"
				? status
				: { text: status ?? "—" };
		return h_flex()
			.id(key)
			.gap(8)
			.p(6)
			.rounded(6)
			.bg(t.raised)
			.items_center()
			.children([
				v_flex()
					.flex_1()
					.gap(2)
					.children([
						div()
							.text_size(13)
							.text_color(t.foreground)
							.truncate()
							.child(title),
						div()
							.text_size(11)
							.text_color(t.muted)
							.truncate()
							.child(sub),
					]),
				h_flex()
					.items_center()
					.children([
						div()
							.text_size(11)
							.text_color(statusColor(t, s.text))
							.child(s.text),
						s.suffix
							? div()
									.text_size(11)
									.text_color(t.muted)
									.child(s.suffix)
							: div(),
					]),
				...buttons,
			]);
	}

	render(cx) {
		const t = theme();
		const root = v_flex().size_full().bg(t.surface).p(10).gap(8);

		root.child(
			h_flex()
				.items_center()
				.justify_between()
				.children([
					div().text_size(14).font_semibold().child("Sessions"),
					h_flex()
						.gap(6)
						.items_center()
						.children([
							lamp(
								this.err
									? ION.failed
									: this.loading
										? ION.waiting
										: ION.done,
							),
							this.err
								? div()
										.text_size(11)
										.text_color(t.muted)
										.truncate()
										.child(`⚠ ${this.err}`)
								: div(),
						]),
				]),
		);

		if (!this.cfg?.base && !this.loading) {
			return root.child(
				v_flex()
					.gap(6)
					.p(8)
					.children([
						div()
							.text_size(12)
							.text_color(t.foreground)
							.child("No control-plane configured."),
						div()
							.text_size(11)
							.text_color(t.muted)
							.child(
								`Write zurbit.json next to this mod's home:\n{ "base": "https://…", "cookie": "acp_session=…" }`,
							),
					]),
			);
		}

		const { cores, machines, terminals } = this.data;
		const list = v_flex().flex_1().gap(6).overflow_y_scrollbar();

		if (cores.length) {
			list.child(this.section(t, "CORES", cores.length));
			for (const c of cores) {
				const sub =
					[
						c.namespace ?? "?",
						`v${c.version ?? "?"}`,
						`gen ${c.gen ?? "?"}`,
						`hb ${c.heartbeat_age_s != null ? Math.round(c.heartbeat_age_s) : "?"}s`,
					].join(" · ") + (c.identity_conflict ? " ⚠ id-conflict" : "");
				list.child(
					this.row(
						t,
						`core-${c.core_id}`,
						c.core_name ?? c.core_id?.slice(0, 8) ?? "?",
						sub,
						c.stale ? "stale" : "live",
						[],
					),
				);
			}
		}

		if (machines.length) {
			list.child(this.section(t, "MACHINES", machines.length));
			for (const m of machines) {
				const sub = [
					m.target ?? m.host ?? "?",
					`v${m.version ?? "?"}`,
					m.temporary ? "temp" : null,
					m.via
						? typeof m.via === "string"
							? `via ${m.via.slice(0, 12)}`
							: "via"
						: null,
					m.direct ? "direct" : null,
				]
					.filter(Boolean)
					.join(" · ");
				list.child(
					this.row(
						t,
						`machine-${m.core_id}-${m.name}`,
						m.name ?? m.core_id ?? "?",
						sub,
						{
							text: m.state ?? "unknown",
							suffix: m.why ? `·${m.why}` : null,
						},
						[],
					),
				);
			}
		}

		if (terminals.length) {
			list.child(this.section(t, "TERMINALS", terminals.length));
			for (const tm of terminals) {
				const sub = [
					tm.machine ?? "local",
					tm.claim
						? `claimed ${String(tm.claim).slice(0, 8)}`
						: "unclaimed",
					tm.claim_run?.status ? `run:${tm.claim_run.status}` : null,
					Array.isArray(tm.mirrors) && tm.mirrors.length
						? `${tm.mirrors.length} mirrors`
						: null,
					// record is opaque JSON — surface only its status.state if present
					tm.record?.status?.state
						? `rec:${tm.record.status.state}`
						: null,
				]
					.filter(Boolean)
					.join(" · ");
				const tags = [];
				if (tm.stale) tags.push("stale");
				if (tm.machine_state && tm.machine_state !== "connected") {
					tags.push(tm.machine_state);
				}
				const cell = v_flex().gap(4);
				cell.child(
					this.row(
						t,
						`term-${tm.id}`,
						termTitle(tm),
						sub,
						{
							text: tm.state ?? "unknown",
							suffix: tags.length ? `·${tags.join("·")}` : null,
						},
						this.termButtons(cx, tm, t),
					),
				);
				if (this.sending === tm.id) {
					const gate = this.controlGate(tm);
					if (gate.ok && !gate.blocked) {
						cell.child(this.sendPalette(cx, t, tm));
					} else {
						this.sending = null;
						this.palette = null;
					}
				}
				list.child(cell);
			}
		}

		if (!cores.length && !machines.length && !terminals.length && !this.err) {
			list.child(
				div()
					.text_size(11)
					.text_color(t.muted)
					.child("no cores, machines, or terminals reported"),
			);
		}

		return root.child(list);
	}
}
