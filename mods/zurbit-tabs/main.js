import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, spaces, run } from "herdr";

const MOD = "zurbit-tabs";

// Ion status lamp for a tab/space: the same signal language as the orb
// strip — violet working, amber blocked, mint done, dim hollow idle.
const ION = {
	working: "#A78BFA",
	blocked: "#FBBF24",
	done: "#34D399",
};

const alpha = (c, a) =>
	c + Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0");

function lamp(status) {
	const color = ION[status];
	if (!color) {
		// idle / no agents: quiet dim dot — the "at rest" orb
		return div()
			.w(10)
			.h(10)
			.flex()
			.items_center()
			.justify_center()
			.child(div().w(5).h(5).rounded_full().bg("#5A5A64"));
	}
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


export default class ZurbitTabs extends View {
	tabRow(t, sp, tab) {
		const sub = tab.settled
			? "settled"
			: `${tab.panes} ${tab.panes === 1 ? "pane" : "panes"}`;
		return h_flex()
			.id(`tab-${tab.id}`)
			.gap(8)
			.items_center()
			.px(6)
			.py(4)
			.rounded(6)
			.when(tab.active, (d) => d.bg(t.raised))
			.when(!tab.active, (d) => d.hover((s) => s.bg(t.hover)))
			.cursor_pointer()
			.on_click((_e, cx) => {
				run("tab.select", { id: tab.id });
				cx.notify();
			})
			.children([
				lamp(tab.status),
				v_flex()
					.flex_1()
					.min_w_0()
					.gap(1)
					.children([
						div()
							.text_size(12)
							.text_color(
								tab.settled
									? t.muted
									: tab.active
										? t.foreground
										: t.foreground,
							)
							.truncate()
							.child(tab.name),
						div()
							.text_size(10)
							.text_color(t.muted)
							.truncate()
							.child(sub),
					]),
				tab.zoomed
					? div()
							.text_size(10)
							.text_color(t.accent)
							.child("⌕")
					: div(),
			]);
	}

	spaceSection(t, sp) {
		const sect = v_flex().gap(2);
		const machineSuffix = sp.machine ? ` · ${sp.machine}` : "";
		sect.child(
			h_flex()
				.id(`space-${sp.id}`)
				.gap(8)
				.items_center()
				.px(6)
				.py(4)
				.rounded(6)
				.when(sp.active, (d) => d.bg(t.surface))
				.when(!sp.active, (d) => d.hover((s) => s.bg(t.hover)))
				.cursor_pointer()
				.on_click((_e, cx) => {
					if (!sp.active) run("space.select", { id: sp.id });
					cx.notify();
				})
				.children([
					lamp(sp.status),
					div()
						.flex_1()
						.min_w_0()
						.text_size(12)
						.font_semibold()
						.text_color(sp.active ? t.foreground : t.muted)
						.truncate()
						.child(`${sp.name}${machineSuffix}`),
					div()
						.text_size(10)
						.text_color(t.muted)
						.child(`${sp.tabs.length}`),
				]),
		);
		if (sp.active) {
			const settled = sp.tabs.filter((tb) => tb.settled);
			const open = sp.tabs.filter((tb) => !tb.settled);
			for (const tb of [...open, ...settled]) {
				sect.child(div().pl(4).child(this.tabRow(t, sp, tb)));
			}
			sect.child(
				div()
					.id(`newtab-${sp.id}`)
					.pl(4)
					.pr(6)
					.py(2)
					.rounded(6)
					.text_size(11)
					.text_color(t.muted)
					.hover((s) => s.bg(t.hover).text_color(t.foreground))
					.cursor_pointer()
					.on_click((_e, cx) => {
						run("tab.new", { space: sp.id });
						cx.notify();
					})
					.child("+ new tab"),
			);
		}
		return sect;
	}

	render(cx) {
		const t = theme();
		const root = v_flex().size_full().bg(t.surface).p(8).gap(6);

		const sps = spaces();
		const list = v_flex().flex_1().gap(8).overflow_y_scrollbar();

		for (const sp of sps) list.child(this.spaceSection(t, sp));
		if (!sps.length) {
			list.child(
				div()
					.text_size(11)
					.text_color(t.muted)
					.child("no spaces yet"),
			);
		}
		root.child(list);

		root.child(
			div()
				.id("newspace")
				.py(3)
				.px(6)
				.rounded(6)
				.text_size(11)
				.text_color(t.muted)
				.hover((s) => s.bg(t.hover).text_color(t.foreground))
				.cursor_pointer()
				.on_click((_e, cx) => {
					run("space.new", {});
					cx.notify();
				})
				.child("+ new space"),
		);
		return root;
	}
}
