import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, notify } from "herdr";
import { loadConfig, configure, api, ApiError } from "./api.js";

const POLL_MS = 5000;

const DONE = new Set(["succeeded", "done", "merged", "approved"]);
const FAIL = new Set(["failed", "lost", "rejected", "cancelled"]);
const ACTIVE = new Set(["dispatched", "running", "shipping"]);
const QUIET_TASK = new Set(["succeeded", "failed", "cancelled"]);

function statusColor(t, s) {
	if (DONE.has(s)) return t.done;
	if (FAIL.has(s)) return t.ansi9;
	if (s === "blocked" || s === "approval_stale") return t.blocked;
	if (ACTIVE.has(s)) return t.working;
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

export default class ZurbitFactory extends View {
	init(p, cx) {
		this.cfg = null;
		this.err = null;
		this.data = { plans: [], tasks: [], runs: [], ships: [] };
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

	row(t, key, title, sub, status, buttons) {
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

		const recentTasks = tasks.filter((tk) => !QUIET_TASK.has(tk.status));
		const shownTasks = (recentTasks.length ? recentTasks : tasks).slice(0, 30);
		list.child(this.section(t, "TASKS", shownTasks.length));
		for (const tk of shownTasks) {
			list.child(
				this.row(
					t,
					`task-${tk.id}`,
					tk.title ?? tk.id,
					`${tk.project ?? ""} · ${ago(tk.updated_at)}${tk.queue_reason ? ` · ${tk.queue_reason}` : ""}`,
					tk.status,
					[],
				),
			);
		}

		return root.child(list);
	}
}
