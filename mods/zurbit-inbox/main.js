import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, notify } from "herdr";
import { loadConfig, configure, api, ApiError } from "./api.js";

const POLL_MS = 5000;

const ION = { working: "#A78BFA", waiting: "#FBBF24", failed: "#FF5C4D", done: "#34D399" };
const alpha = (c, a) => c + Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0");

const ACTIVE_RUN = new Set(["dispatched", "running", "shipping"]);

function ago(ts) {
	if (!ts) return "";
	const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
	if (s < 60) return `${Math.floor(s)}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

// Newest-first by whichever timestamp the record carries — different
// item kinds expose created_at / updated_at / dispatched_at.
function stamp(x, fields) {
	for (const f of fields) {
		const v = Date.parse(x[f]);
		if (!Number.isNaN(v)) return v;
	}
	return 0;
}

function newest(items, ...fields) {
	return items.sort((a, b) => stamp(b, fields) - stamp(a, fields));
}

// Addresses arrive already prefixed ("t17"), but tolerate a bare "17"
// so the title never comes out as "tt17".
function termTitle(tm) {
	if (tm.address) {
		const a = String(tm.address);
		return a.startsWith("t") ? a : `t${a}`;
	}
	return tm.id ? tm.id.slice(0, 8) : "?";
}

// Escalation codes ("consecutive_run_failures") read as plain words.
const words = (s) => String(s).replace(/_/g, " ");

function lamp(color) {
	return div()
		.w(10)
		.h(10)
		.rounded_full()
		.bg(alpha(color, 0.25))
		.flex()
		.items_center()
		.justify_center()
		.child(div().w(5).h(5).rounded_full().bg(color));
}

export default class ZurbitInbox extends View {
	init(p, cx) {
		this.cfg = null;
		this.err = null;
		this.data = {
			plans: [],
			tasks: [],
			runs: [],
			ships: [],
			terminals: [],
			fires: [],
		};
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
			const [plans, tasks, runs, ships, terminals, fires] =
				await Promise.all([
					api.plans(),
					api.tasks(),
					api.runs(),
					api.ships(),
					api.terminals(),
					api.fires(),
				]);
			this.data = {
				plans: plans.plans ?? [],
				tasks: tasks.tasks ?? [],
				runs: runs.runs ?? [],
				ships: ships.ships ?? [],
				terminals: terminals.terminals ?? [],
				fires: fires.fires ?? [],
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

	row(t, key, title, sub, badge, buttons) {
		// badge: string, or {text, color} — every group pins its own
		// plain-language tag + colour instead of echoing a raw status.
		const s =
			badge && typeof badge === "object"
				? badge
				: { text: badge ?? "—" };
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
					.min_w_0()
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
				div()
					.text_size(11)
					.text_color(s.color ?? t.muted)
					.child(s.text),
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
					div().text_size(14).font_semibold().child("Needs You"),
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

		const { plans, tasks, runs, ships, terminals, fires } = this.data;
		const list = v_flex().flex_1().gap(6).overflow_y_scrollbar();
		let shown = 0;

		// ── STOPPED ON YOU — failures + agents parked on an approval ──
		const stuckTasks = newest(
			tasks.filter((tk) => tk.status === "failed" || tk.escalation),
			"updated_at",
			"created_at",
		);
		const blockedTerms = newest(
			terminals.filter(
				(tm) =>
					tm.state === "live" &&
					!tm.stale &&
					tm.record?.status?.state === "blocked",
			),
			"updated_at",
			"created_at",
		);
		if (stuckTasks.length || blockedTerms.length) {
			const badge = { text: "stopped", color: ION.failed };
			list.child(
				this.section(
					t,
					"STOPPED ON YOU",
					stuckTasks.length + blockedTerms.length,
				),
			);
			shown += stuckTasks.length + blockedTerms.length;
			for (const tk of stuckTasks) {
				const sub = [
					tk.project ?? "?",
					tk.status === "failed"
						? `failed${tk.failure_count > 1 ? ` ${tk.failure_count}×` : ""}`
						: (tk.status ?? "stopped"),
					tk.escalation ? words(tk.escalation) : null,
				]
					.filter(Boolean)
					.join(" · ");
				list.child(
					this.row(
						t,
						`stuck-${tk.id}`,
						tk.title ?? tk.id.slice(0, 8),
						sub,
						badge,
						[
							this.btn(cx, `rq-${tk.id}`, "Retry", () =>
								api.requeueTask(tk.id), t),
							this.btn(cx, `xc-${tk.id}`, "Cancel", () =>
								api.cancelTask(tk.id), t, true),
						],
					),
				);
			}
			for (const tm of blockedTerms) {
				// No button: approvals are never answered through send —
				// the human resolves them in Desktop or the terminal.
				list.child(
					this.row(
						t,
						`blocked-${tm.id}`,
						`${termTitle(tm)} · agent waiting on an approval`,
						"answer it in Desktop or the terminal",
						badge,
						[],
					),
				);
			}
		}

		// ── HOLDING UP WORK — merges waiting on the human's approval ──
		const pendingShips = newest(
			ships.filter(
				(s) => s.pr_state !== "merged" && s.pr_state !== "closed",
			),
			"updated_at",
			"created_at",
		);
		if (pendingShips.length) {
			const badge = { text: "holds up", color: ION.waiting };
			list.child(this.section(t, "HOLDING UP WORK", pendingShips.length));
			shown += pendingShips.length;
			for (const s of pendingShips) {
				const needsApproval = !s.approval || s.approval.stale;
				list.child(
					this.row(
						t,
						`ship-${s.id}`,
						`${s.pr_number ? `PR #${s.pr_number}` : "no PR"} — merge ${s.branch ?? "?"} → ${s.base_branch ?? "?"}`,
						s.merge_ready
							? "ready to merge"
							: `blocked: ${(s.merge_blocked ?? []).join(", ")}`,
						badge,
						needsApproval
							? [
									this.btn(cx, `sa-${s.id}`, "Approve merge", () =>
										api.approveShip(s.run_id, s.head_sha), t),
								]
							: [],
					),
				);
			}
		}

		// ── WAITING ON YOU — decisions only the human can make ──
		const openPlans = newest(
			plans.filter(
				(p) => p.status !== "approved" && p.status !== "rejected",
			),
			"created_at",
		);
		const reviewTasks = newest(
			tasks.filter((tk) => tk.status === "review"),
			"updated_at",
			"created_at",
		);
		if (openPlans.length || reviewTasks.length) {
			const badge = { text: "decision", color: ION.waiting };
			list.child(
				this.section(
					t,
					"WAITING ON YOU",
					openPlans.length + reviewTasks.length,
				),
			);
			shown += openPlans.length + reviewTasks.length;
			for (const p of openPlans) {
				list.child(
					this.row(
						t,
						`plan-${p.id}`,
						p.title ?? p.id,
						`${p.proposer ?? "?"} proposes ${p.task_count ?? "?"} tasks · ${ago(p.created_at)}`,
						badge,
						[
							this.btn(cx, `pa-${p.id}`, "Approve", () =>
								api.approvePlan(p.id), t),
							this.btn(cx, `pr-${p.id}`, "Reject", () =>
								api.rejectPlan(p.id), t, true),
						],
					),
				);
			}
			for (const tk of reviewTasks) {
				list.child(
					this.row(
						t,
						`review-${tk.id}`,
						tk.title ?? tk.id.slice(0, 8),
						`${tk.project ?? "?"} · finished — sign off?`,
						badge,
						[
							this.btn(cx, `dn-${tk.id}`, "Done", () =>
								api.doneTask(tk.id), t),
							this.btn(cx, `rc-${tk.id}`, "Cancel", () =>
								api.cancelTask(tk.id), t, true),
						],
					),
				);
			}
		}

		// ── NEW SINCE YOU LOOKED — context, nothing to press ──
		const activeRuns = newest(
			runs.filter((r) => ACTIVE_RUN.has(r.status)),
			"dispatched_at",
		);
		const heldFires = newest(
			fires.filter(
				(f) => f.outcome === "held" || f.reason === "budget_hold",
			),
			"created_at",
		).slice(0, 3);
		if (activeRuns.length || heldFires.length) {
			const badge = { text: "fyi", color: t.muted };
			list.child(
				this.section(
					t,
					"NEW SINCE YOU LOOKED",
					activeRuns.length + heldFires.length,
				),
			);
			shown += activeRuns.length + heldFires.length;
			for (const r of activeRuns) {
				list.child(
					this.row(
						t,
						`run-${r.id}`,
						`${r.task_id ? r.task_id.slice(0, 8) : "?"} attempt ${r.attempt ?? "?"}`,
						`${r.machine ?? "?"} · ${r.status ?? "?"}`,
						badge,
						[],
					),
				);
			}
			for (const f of heldFires) {
				list.child(
					this.row(
						t,
						`fire-${f.rule_id}-${f.created_at}`,
						`automation ${f.rule_id ?? "?"}`,
						"held — budget approval needed in the web UI",
						badge,
						[],
					),
				);
			}
		}

		if (!shown && !this.err && !this.loading) {
			list.child(
				v_flex()
					.flex_1()
					.items_center()
					.justify_center()
					.child(
						div()
							.text_size(12)
							.text_color(t.muted)
							.child("All clear — nothing needs you."),
					),
			);
		}

		return root.child(list);
	}
}
