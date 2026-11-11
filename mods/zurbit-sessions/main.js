import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, notify } from "herdr";
import { loadConfig, configure, api, ApiError } from "./api.js";

const POLL_MS = 5000;
const CMD_POLL_MS = 2000;
const CMD_DEADLINE_MS = 60000;

const CMD_FINAL = new Set(["done", "failed", "unknown"]);

function statusColor(t, s) {
	if (s === "live" || s === "connected" || s === "working") return t.working;
	if (s === "done") return t.done;
	if (s === "failed") return t.ansi9;
	if (s === "blocked" || s === "needs_login" || s === "stale") return t.blocked;
	return t.muted; // unreachable / unknown / orphaned / finished / …
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
		this.loading = true;

		cx.spawn(async (cx) => {
			this.cfg = await loadConfig(p);
			configure(this.cfg);
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
	async steer(tm, op) {
		const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		const res = await api.sendCommand(tm.id, op, requestId, {});
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

	termButtons(cx, tm, t) {
		if (tm.state !== "live" || !tm.id) return [];
		return [
			this.btn(cx, `ti-${tm.id}`, "Interrupt", () =>
				this.steer(tm, "interrupt"), t),
			this.btn(cx, `tk-${tm.id}`, "Kill", () =>
				this.steer(tm, "kill"), t, true),
		];
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
					div()
						.text_size(11)
						.text_color(this.err ? t.ansi9 : t.muted)
						.child(this.err ? `⚠ ${this.err}` : "live"),
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
				list.child(
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
