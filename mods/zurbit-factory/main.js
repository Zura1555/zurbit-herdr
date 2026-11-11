import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, notify } from "herdr";
import { loadConfig, configure, api, ApiError } from "./api.js";

const POLL_MS = 5000;

const ION = { working: "#A78BFA", waiting: "#FBBF24", failed: "#FF5C4D", done: "#34D399" };
const alpha = (c, a) => c + Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0");

const DONE = new Set(["succeeded", "done", "merged", "approved"]);
const FAIL = new Set(["failed", "lost", "rejected", "cancelled"]);
const ACTIVE = new Set(["dispatched", "running", "shipping"]);
const QUIET_TASK = new Set(["succeeded", "failed", "cancelled"]);
const TERMINAL_TASK = new Set(["done", "cancelled"]);

function statusColor(t, s) {
	if (DONE.has(s)) return ION.done;
	if (FAIL.has(s)) return ION.failed;
	if (s === "blocked" || s === "approval_stale") return ION.waiting;
	if (ACTIVE.has(s)) return ION.working;
	return t.muted;
}

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

function ago(ts) {
	if (!ts) return "";
	const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
	if (s < 60) return `${Math.floor(s)}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

export default class ZurbitFactory extends View {
	init(p, cx) {
		this.cfg = null;
		this.err = null;
		this.data = { plans: [], tasks: [], runs: [], ships: [] };
		this.confirming = null;
		this.expanded = null;
		this.detail = null;
		this.known = null;
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
			const [plans, tasks, runs, ships] = await Promise.all([
				api.plans(),
				api.tasks(),
				api.runs(),
				api.ships(),
			]);
			this.data = {
				plans: plans.plans ?? [],
				tasks: tasks.tasks ?? [],
				runs: runs.runs ?? [],
				ships: ships.ships ?? [],
			};
			this.err = null;
		} catch (e) {
			this.err = e instanceof ApiError ? `${e.message}` : String(e);
		}
		if (!this.err) this.noticeNew();
		if (
			this.expanded &&
			!this.data.tasks.some((tk) => tk.id === this.expanded)
		) {
			this.expanded = null;
			this.detail = null;
		}
		if (this.expanded) {
			try {
				this.detail = await api.task(this.expanded);
			} catch {}
		}
		cx.notify();
	}

	/** First successful poll seeds the set silently; later polls notify
	 * once per newly-actionable plan (awaiting decision) or ship
	 * (awaiting merge approval). Resolved items dropping out re-arm the
	 * key, so a re-proposed plan notifies again. */
	noticeNew() {
		const { plans, ships } = this.data;
		const actionable = new Set([
			...plans
				.filter((p) => p.status !== "approved" && p.status !== "rejected")
				.map((p) => `plan:${p.id}`),
			...ships
				.filter(
					(s) =>
						s.pr_state !== "merged" &&
						s.pr_state !== "closed" &&
						(!s.approval || s.approval.stale),
				)
				.map((s) => `ship:${s.id}`),
		]);
		if (this.known !== null) {
			const fresh = [...actionable].filter((k) => !this.known.has(k));
			const nPlans = fresh.filter((k) => k.startsWith("plan:")).length;
			const nShips = fresh.length - nPlans;
			if (nPlans) {
				notify({
					title: "Zurbit",
					body: `${nPlans} plan${nPlans === 1 ? "" : "s"} awaiting approval`,
					level: "info",
				});
			}
			if (nShips) {
				notify({
					title: "Zurbit",
					body: `${nShips} ship${nShips === 1 ? "" : "s"} awaiting merge approval`,
					level: "info",
				});
			}
		}
		this.known = actionable;
	}

	/** Tap a task row → expand its spec + run history; tap again → collapse. */
	toggleTask(cx, id) {
		if (this.expanded === id) {
			this.expanded = null;
			this.detail = null;
			cx.notify();
			return;
		}
		this.expanded = id;
		this.detail = null;
		cx.notify();
		cx.spawn(async (cx) => {
			try {
				this.detail = await api.task(id);
			} catch (e) {
				this.detail = {
					error: e instanceof ApiError ? e.message : String(e),
				};
			}
			cx.notify();
		});
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

	taskButtons(cx, tk, t) {
		const btns = [];
		if (tk.status === "ready") {
			btns.push(this.btn(cx, `td-${tk.id}`, "Dispatch", () =>
				api.dispatchTask(tk.id), t));
		}
		if (tk.status === "review") {
			btns.push(this.btn(cx, `tn-${tk.id}`, "Done", () =>
				api.doneTask(tk.id), t));
		}
		if (tk.status === "failed" || tk.escalation) {
			btns.push(this.btn(cx, `tq-${tk.id}`, "Requeue", () =>
				api.requeueTask(tk.id), t));
		}
		if (!TERMINAL_TASK.has(tk.status)) {
			btns.push(this.btn(cx, `tc-${tk.id}`, "Cancel", () =>
				api.cancelTask(tk.id), t, true));
		}
		return btns;
	}

	taskDetail(t, tk) {
		const box = v_flex().gap(6).p(8).rounded(6).bg(t.raised);
		const d = this.detail;
		if (!d) {
			return box.child(
				div().text_size(11).text_color(t.muted).child("loading…"),
			);
		}
		if (d.error) {
			return box.child(
				div().text_size(11).text_color(ION.failed).child(`⚠ ${d.error}`),
			);
		}
		if (tk.spec) {
			box.child(
				div()
					.text_size(11)
					.text_color(t.muted)
					.child(tk.spec.slice(0, 280)),
			);
		}
		if (tk.escalation || tk.failure_count) {
			box.child(
				div()
					.text_size(11)
					.text_color(ION.waiting)
					.child(
						[
							tk.escalation,
							tk.failure_count
								? `${tk.failure_count} failure${tk.failure_count === 1 ? "" : "s"}`
								: null,
						]
							.filter(Boolean)
							.join(" · "),
					),
			);
		}
		const runs = d.runs ?? [];
		if (!runs.length) {
			box.child(div().text_size(11).text_color(t.muted).child("no runs"));
		}
		for (const r of runs.slice(0, 8)) {
			box.child(
				h_flex()
					.gap(8)
					.items_center()
					.children([
						div()
							.text_size(11)
							.text_color(t.foreground)
							.child(`#${r.attempt}`),
						div()
							.text_size(11)
							.text_color(statusColor(t, r.status))
							.child(r.status ?? "—"),
						div()
							.text_size(11)
							.text_color(t.muted)
							.flex_1()
							.truncate()
							.child(
								`${r.machine ?? r.worker_id ?? "?"}${r.result_flag ? ` · ${r.result_flag}` : ""}`,
							),
						div()
							.text_size(11)
							.text_color(t.muted)
							.child(
								ago(r.finished_at ?? r.started_at ?? r.dispatched_at),
							),
					]),
			);
		}
		return box;
	}

	row(t, key, title, sub, status, buttons, onToggle) {
		const titleDiv = div()
			.text_size(13)
			.text_color(t.foreground)
			.truncate()
			.child(title);
		const subDiv = div()
			.text_size(11)
			.text_color(t.muted)
			.truncate()
			.child(sub);
		if (onToggle) {
			titleDiv.on_click((_e, cx) => onToggle(cx));
			subDiv.on_click((_e, cx) => onToggle(cx));
		}
		return h_flex()
			.id(key)
			.gap(8)
			.p(6)
			.rounded(6)
			.bg(t.raised)
			.items_center()
			.children([
				v_flex().flex_1().min_w_0().gap(2).children([titleDiv, subDiv]),
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
					div().text_size(14).font_semibold().child("Factory"),
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

		const { plans, tasks, runs, ships } = this.data;
		const list = v_flex().flex_1().gap(6).overflow_y_scrollbar();

		const pendingPlans = plans.filter(
			(p) => p.status !== "approved" && p.status !== "rejected",
		);
		if (pendingPlans.length) {
			list.child(this.section(t, "PLANS", pendingPlans.length));
			for (const p of pendingPlans) {
				list.child(
					this.row(
						t,
						`plan-${p.id}`,
						p.title ?? p.id,
						`${p.proposer ?? "?"} · ${p.task_count ?? "?"} tasks · ${ago(p.created_at)}`,
						p.status,
						[
							this.btn(cx, `pa-${p.id}`, "Approve", () =>
								api.approvePlan(p.id), t),
							this.btn(cx, `pr-${p.id}`, "Reject", () =>
								api.rejectPlan(p.id), t, true),
						],
					),
				);
			}
		}

		const pendingShips = ships.filter(
			(s) => s.pr_state !== "merged" && s.pr_state !== "closed",
		);
		if (pendingShips.length) {
			list.child(this.section(t, "SHIPS", pendingShips.length));
			for (const s of pendingShips) {
				const needsApproval = !s.approval || s.approval.stale;
				const sub = [
					s.pr_number ? `PR #${s.pr_number}` : "no PR",
					s.branch ?? "",
					s.merge_ready ? "merge-ready" : (s.merge_blocked ?? []).join(","),
				]
					.filter(Boolean)
					.join(" · ");
				list.child(
					this.row(
						t,
						`ship-${s.id}`,
						`${s.base_branch ?? "?"} ← ${s.branch ?? "?"}`,
						sub,
						s.merge_ready ? "ready" : "blocked",
						[
							...(needsApproval
								? [
										this.btn(cx, `sa-${s.id}`, "Approve merge", () =>
											api.approveShip(s.run_id, s.head_sha), t),
									]
								: []),
							...(!s.merge_ready
								? [
										this.btn(cx, `sr-${s.id}`, "Reconcile", () =>
											api.reconcileShip(s.run_id), t),
									]
								: []),
						],
					),
				);
			}
		}

		const activeRuns = runs.filter((r) => ACTIVE.has(r.status));
		if (activeRuns.length) {
			list.child(this.section(t, "RUNS", activeRuns.length));
			for (const r of activeRuns) {
				list.child(
					this.row(
						t,
						`run-${r.id}`,
						`${r.id.slice(0, 8)} · attempt ${r.attempt}`,
						`${r.machine ?? r.worker_id ?? "?"} · ${r.terminal_id ?? "no terminal"}`,
						r.status,
						[
							this.btn(cx, `rc-${r.id}`, "Cancel", () =>
								api.cancelRun(r.id), t, true),
						],
					),
				);
			}
		}

		const recentTasks = tasks.filter(
			(tk) => !QUIET_TASK.has(tk.status) || tk.escalation,
		);
		const shownTasks = (recentTasks.length ? recentTasks : tasks).slice(0, 30);
		list.child(this.section(t, "TASKS", shownTasks.length));
		for (const tk of shownTasks) {
			const cell = v_flex().gap(4);
			cell.child(
				this.row(
					t,
					`task-${tk.id}`,
					tk.title ?? tk.id,
					`${tk.project ?? ""} · ${ago(tk.updated_at)}${tk.queue_reason ? ` · ${tk.queue_reason}` : ""}`,
					tk.status,
					this.taskButtons(cx, tk, t),
					(cx) => this.toggleTask(cx, tk.id),
				),
			);
			if (this.expanded === tk.id) {
				cell.child(this.taskDetail(t, tk));
			}
			list.child(cell);
		}

		return root.child(list);
	}
}
