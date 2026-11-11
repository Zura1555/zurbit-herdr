import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, notify, panes, run, settings } from "herdr";
import { loadConfig, configure, api, ApiError } from "./api.js";

const POLL_MS = 5000;
const MOD = "zurbit-orbs";

const FAILED = "#FF5C4D";

// The legend: one dot + label per live state. The hollow "stale" orb is
// its own picture and needs no swatch.
const LEGEND = [
	["working", "#A78BFA", "run"],
	["waiting", "#FBBF24", "wait"],
	["failed", FAILED, "fail"],
	["done", "#34D399", "ok"],
];

function monoFont() {
	const s = settings() ?? {};
	return s.font_family ?? s.font ?? "JetBrains Mono";
}

// "#rrggbb" + alpha (0..1) → "#rrggbbaa".
function alpha(color, a) {
	if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}/.test(color))
		return color;
	const base = color.length >= 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1;
	return (
		color.slice(0, 7) +
		Math.round(Math.max(0, Math.min(1, a * base)) * 255)
			.toString(16)
			.padStart(2, "0")
	);
}

// Addresses arrive already prefixed ("t17"), but tolerate a bare "17"
// so the label never comes out as "tt17".
function termTitle(tm) {
	if (tm.address) {
		const a = String(tm.address);
		return a.startsWith("t") ? a : `t${a}`;
	}
	return tm.id ? tm.id.slice(0, 8) : "?";
}

// Terminal → orb state, mirroring zurbit-sessions' statusColor: live
// lines glow violet, blocked/needs_login pulse amber, done mint, failed
// vermilion; stale projections, dead machine lines and anything else
// render as the hollow outline.
function orbState(tm) {
	if (tm.stale) return "stale";
	if (tm.machine_state && tm.machine_state !== "connected") return "stale";
	const s = tm.state;
	if (s === "live" || s === "connected" || s === "working")
		return "working";
	if (s === "done") return "done";
	if (s === "failed") return "failed";
	if (s === "blocked" || s === "needs_login") return "waiting";
	return "stale"; // stale / unreachable / orphaned / unknown
}

// Machine line first, then the numeric terminal address.
function byMachineThenAddr(a, b) {
	const am = a.machine ?? "";
	const bm = b.machine ?? "";
	if (am !== bm) return am.localeCompare(bm);
	const an = Number(String(a.address ?? "").replace(/^t/, ""));
	const bn = Number(String(b.address ?? "").replace(/^t/, ""));
	if (Number.isNaN(an) || Number.isNaN(bn))
		return termTitle(a).localeCompare(termTitle(b));
	return an - bn;
}

export default class ZurbitOrbs extends View {
	init(p, cx) {
		this.cfg = null;
		this.err = null;
		this.data = { machines: [], terminals: [] };
		this.loading = true;

		cx.spawn(async (cx) => {
			this.cfg = await loadConfig(p);
			configure(this.cfg);
			this.ensurePuck();
			await this.refresh(cx);
			this.loading = false;
			cx.notify();
		});
		cx.timer.every(POLL_MS, (cx) => {
			if (this.cfg?.base) this.refresh(cx);
		});
	}

	// The work surface's dedicated Puck tab: a herdr-chat chat named
	// "puck" the strip opens once when it isn't already on screen.
	// "puck": false in zurbit.json/props opts out; an object
	// {chat, provider, cwd, name} retargets it. Without herdr-chat the
	// tab.new just fails and the strip says so once.
	ensurePuck() {
		const p = this.cfg?.puck;
		if (p === false) return;
		const want = typeof p === "object" && p ? p : {};
		const name = want.name ?? want.chat ?? "puck";
		const exists = panes().some(
			(x) =>
				x.mod === "chat" &&
				(x.title ?? "").toLowerCase() === name.toLowerCase(),
		);
		if (exists) return;
		const provider = want.provider ?? "pi";
		// Oh My Pi is the default pi harness: herdr-chat picks the agent
		// binary via HERDR_CHAT_<PROVIDER>, so `omp` rides the pi adapter.
		const command = want.command ?? (provider === "pi" ? "omp" : null);
		try {
			run("tab.new", {
				name,
				mod: "chat",
				props: {
					chat: want.chat ?? "puck",
					provider,
					...(want.cwd ? { cwd: want.cwd } : {}),
					...(command
						? {
								hostEnv: {
									[`HERDR_CHAT_${provider.toUpperCase()}`]: command,
								},
							}
						: {}),
				},
			});
		} catch (e) {
			notify({
				title: "Zurbit: Puck needs herdr-chat",
				body: `couldn't open the ${name} chat tab: ${e}`,
				level: "warning",
			});
		}
	}

	async refresh(cx) {
		try {
			const [machines, terminals] = await Promise.all([
				api.machines(),
				api.terminals(),
			]);
			this.data = {
				machines: machines.machines ?? [],
				terminals: terminals.terminals ?? [],
			};
			this.err = null;
		} catch (e) {
			this.err = e instanceof ApiError ? `${e.message}` : String(e);
		}
		cx.notify();
	}

	orb(tm, t, mono) {
		const state = orbState(tm);
		const addr = termTitle(tm);
		// svg() paints a one-color alpha mask — image() keeps the nebula's
		// colors. spin() is svg-only, so liveness shows as an opacity loop:
		// a gentle breathe for working, a stronger pulse for waiting.
		let ball = image(`mods/${MOD}/icons/orb-${state}.svg`)
			.size(22)
			.flex_none();
		if (state === "working") {
			ball = ball.loop("opacity", { from: 0.7, to: 1, period: 2000 });
		}
		if (state === "waiting") {
			ball = ball.loop("opacity", { from: 0.55, to: 1, period: 1400 });
		}
		return v_flex()
			.id(`orb-${tm.id ?? addr}`)
			.items_center()
			.gap(2)
			.cursor_pointer()
			.tooltip(
				`${addr} · ${tm.machine ?? "local"} · ${tm.state ?? "unknown"}${tm.stale ? " · stale" : ""}`,
			)
			.children([
				ball,
				div()
					.font_family(mono)
					.text_size(9.5)
					.text_color(t.dim)
					.child(addr),
			])
			.on_click((_e, cx) => {
				try {
					// Bare addresses mean "this machine"; other lines need
					// the machine-qualified form.
					const target =
						tm.machine && tm.machine !== "local"
							? `${tm.machine}/${addr}`
							: addr;
					run("terminal.peek", { terminal: target });
				} catch (e) {
					notify({
						title: "Zurbit: peek failed",
						body: String(e),
						level: "error",
					});
				}
			});
	}

	legend(t) {
		const box = h_flex().gap(7).items_center().flex_none();
		for (const [, color, label] of LEGEND) {
			box.child(
				h_flex()
					.gap(3)
					.items_center()
					.children([
						div().size(6).rounded_full().bg(color),
						div().text_size(9).text_color(t.dim).child(label),
					]),
			);
		}
		return box;
	}

	// The api error signal lamp: a vermilion core in a soft halo.
	signalLamp() {
		return div()
			.w(10)
			.h(10)
			.rounded_full()
			.bg(alpha(FAILED, 0.25))
			.flex()
			.items_center()
			.justify_center()
			.child(div().w(5).h(5).rounded_full().bg(FAILED));
	}

	render(cx) {
		const t = theme();
		const mono = monoFont();
		const strip = h_flex()
			.size_full()
			.items_center()
			.gap(9)
			.px(12)
			.overflow_hidden()
			.bg(t.surface)
			.border_b_1()
			.border_color(t.border);

		strip.child(
			div()
				.text_size(10.5)
				.font_semibold()
				.text_color(t.dim)
				.child("ORBS"),
		);

		if (!this.cfg?.base && !this.loading) {
			return strip.child(
				div()
					.text_size(10.5)
					.text_color(t.dim)
					.child("no control-plane — zurbit.json { base, cookie }"),
			);
		}

		if (this.err) {
			return strip
				.child(this.signalLamp())
				.child(
					div()
						.text_size(10.5)
						.text_color(t.dim)
						.truncate()
						.child(this.err),
				);
		}

		if (this.loading) {
			return strip.child(
				div().text_size(10.5).text_color(t.dim).child("connecting…"),
			);
		}

		const terminals = this.data.terminals.slice().sort(byMachineThenAddr);
		let lastMachine = null;
		for (const tm of terminals) {
			const m = tm.machine ?? "local";
			if (lastMachine !== null && m !== lastMachine) {
				strip.child(div().w(1).h(14).bg(t.border).flex_none());
			}
			strip.child(this.orb(tm, t, mono));
			lastMachine = m;
		}
		if (!terminals.length) {
			strip.child(
				div()
					.text_size(10.5)
					.text_color(t.dim)
					.child("no terminals reported"),
			);
		}

		// A machine line with zero terminals still counts: prefer the
		// machines feed, fall back to the distinct lines seen on terminals.
		const lines =
			this.data.machines.length ||
			new Set(terminals.map((tm) => tm.machine ?? "local")).size;
		strip.child(div().flex_1());
		strip.child(this.legend(t));
		strip.child(
			div()
				.text_size(10.5)
				.text_color(t.dim)
				.whitespace_nowrap()
				.child(
					`${terminals.length} connected · ${lines} ${lines === 1 ? "line" : "lines"}`,
				),
		);
		return strip;
	}
}
