import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, notify } from "herdr";
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

const DONE = new Set(["on", "created_task", "dispatched"]);
const FAIL = new Set(["denied", "failed"]);
const HOLD = new Set(["held", "budget_hold"]);

function statusColor(t, s) {
	if (DONE.has(s)) return t.done;
	if (FAIL.has(s)) return t.ansi9;
	if (HOLD.has(s)) return t.blocked;
	return t.muted;
}

function ago(ts) {
	if (!ts) return "";
	const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
	if (s < 60) return `${Math.floor(s)}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

// cost_ledger column names aren't pinned — surface whichever of these
// fields a row actually carries, labelled by key so nothing is invented.
const LEDGER_KEYS = [
	"rule_id",
	"fire_id",
	"task_id",
	"kind",
	"model",
	"provider",
	"units",
	"tokens",
	"tokens_in",
	"tokens_out",
	"amount",
	"cost",
	"cost_usd",
];

function ledgerText(r) {
	const title = r.scope ?? r.rule_id ?? "entry";
	const bits = LEDGER_KEYS.filter(
		(k) => r?.[k] != null && r[k] !== "",
	).map((k) => `${k} ${r[k]}`);
	const when = ago(r.created_at);
	if (when) bits.push(when);
	const sub = bits.length ? bits.join(" · ") : JSON.stringify(r).slice(0, 80);
	return { title, sub };
}

export default class ZurbitAutomation extends View {
	init(p, cx) {
		this.cfg = null;
		this.err = null;
		this.data = { rules: [], fires: [], approvals: [], ledger: [] };
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
			const [rules, fires, approvals, ledger] = await Promise.all([
				api.rules(),
				api.fires(),
				api.approvals(),
				api.ledger(),
			]);
			this.data = {
				rules: rules.rules ?? [],
				fires: fires.fires ?? [],
				approvals: approvals.approvals ?? [],
				ledger: ledger.ledger ?? [],
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
					.px(5)
					.py(2)
					.text_size(11)
					.text_color(fg)
					.child(armed ? `${label}?` : label)
					.on_click((_e, cx) => this.act(cx, key, label, fn)),
				armed
					? div()
							.id(`${key}-no`)
							.bg(t.surface)
							.rounded(4)
							.px(5)
							.py(2)
							.text_size(11)
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

	row(t, key, title, sub, status, buttons) {
		return h_flex()
			.id(key)
			.gap(8)
			.p(6)
			.rounded(6)
			.bg(t.raised)
			.items_center()
			.children([
				v_flex().flex_1().min_w_0().gap(2).children([
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
				div()
					.text_size(11)
					.text_color(statusColor(t, status))
					.child(status ?? "—"),
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
					div().text_size(14).font_semibold().child("Automation"),
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

		const { rules, fires, approvals, ledger } = this.data;
		const list = v_flex().flex_1().gap(6).overflow_y_scrollbar();

		// RULES header shows even when empty — it's the pane's anchor.
		list.child(this.section(t, "RULES", rules.length));
		if (!rules.length) {
			list.child(
				div().text_size(11).text_color(t.muted).child("no rules"),
			);
		}
		for (const r of rules) {
			// PATCH re-stamps approved_by/approved_at — toggling enabled is
			// itself an approval, so no separate approve step is needed.
			const trig =
				r.trigger_kind === "cron"
					? `cron every ${r.interval_minutes}m`
					: `${r.event ?? "?"} on ${r.repo ?? "?"}`;
			const sub = [
				trig,
				r.project,
				`cap ${r.cap}`,
				r.approved_by ? `approved ${r.approved_by}` : null,
				!r.enabled ? "off" : null,
			]
				.filter(Boolean)
				.join(" · ");
			list.child(
				this.row(
					t,
					`rule-${r.id}`,
					r.name ?? r.id,
					sub,
					r.enabled ? "on" : "off",
					[
						this.btn(cx, `rt-${r.id}`, r.enabled ? "Disable" : "Enable", () =>
							api.patchRule(r.id, { enabled: !r.enabled }), t),
						this.btn(cx, `rd-${r.id}`, "Delete", () =>
							api.deleteRule(r.id), t, true),
					],
				),
			);
		}

		const shownFires = fires.slice(0, 20);
		if (shownFires.length) {
			list.child(this.section(t, "FIRES", shownFires.length));
			for (const f of shownFires) {
				const sub = [f.source, f.reason || f.outcome, ago(f.created_at)]
					.filter(Boolean)
					.join(" · ");
				list.child(
					this.row(
						t,
						`fire-${f.id}`,
						`${f.rule_id} · ${f.kind}`,
						sub,
						f.outcome,
						[],
					),
				);
			}
		}

		if (approvals.length) {
			list.child(this.section(t, "APPROVALS", approvals.length));
			for (const a of approvals) {
				const sub = [
					a.cap != null ? `cap ${a.cap}` : null,
					a.approved_by ? `by ${a.approved_by}` : null,
					a.note,
					ago(a.created_at),
				]
					.filter(Boolean)
					.join(" · ");
				list.child(
					this.row(
						t,
						`appr-${a.id}`,
						a.scope ?? a.id,
						sub,
						null,
						[
							this.btn(cx, `ar-${a.id}`, "Revoke", () =>
								api.revokeApproval(a.id), t, true),
						],
					),
				);
			}
		}

		const shownLedger = ledger.slice(0, 20);
		if (shownLedger.length) {
			list.child(this.section(t, "LEDGER", shownLedger.length));
			for (const [i, r] of shownLedger.entries()) {
				const { title, sub } = ledgerText(r);
				list.child(
					this.row(
						t,
						`led-${r.id ?? i}`,
						title,
						sub,
						r.kind ?? null,
						[],
					),
				);
			}
		}

		return root.child(list);
	}
}
