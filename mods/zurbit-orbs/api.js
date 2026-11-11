// Data layer for the Zurbit orbs mod — a read-only mirror of the runtime
// plane (machines + terminals) against the same control plane the
// sessions mod polls. The strip steers nothing, so only GETs live here.

import { appHome, readTextFile } from "herdr";

export class ApiError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

/**
 * Config resolution: pane props → localStorage → zurbit.json in app home.
 *   { "base": "https://…", "token": "acp_vt_…", "cookie": "acp_session=…" }
 * `token` is the planned viewer credential; `cookie` works today.
 */
export async function loadConfig(p) {
	let file = {};
	try {
		file = JSON.parse(await readTextFile(`${appHome()}/zurbit.json`)) ?? {};
	} catch {}
	const puckRaw =
		p?.puck ?? localStorage.getItem("zurbit.puck") ?? file.puck ?? null;
	let puck = puckRaw;
	if (typeof puckRaw === "string") {
		try {
			puck = JSON.parse(puckRaw);
		} catch {
			puck = puckRaw === "false" || puckRaw === "0" ? false : null;
		}
	}
	return {
		base: p?.base ?? localStorage.getItem("zurbit.base") ?? file.base ?? null,
		token:
			p?.token ??
			localStorage.getItem("zurbit.token") ??
			file.token ??
			null,
		cookie: localStorage.getItem("zurbit.cookie") ?? file.cookie ?? null,
		puck,
	};
}

let cfg = null;

export function configure(c) {
	cfg = c?.base ? c : null;
}

function authHeaders() {
	if (cfg.token) return { authorization: `Bearer ${cfg.token}` };
	if (cfg.cookie) {
		const c = cfg.cookie.startsWith("acp_session=")
			? cfg.cookie
			: `acp_session=${cfg.cookie}`;
		return { cookie: c };
	}
	return {};
}

async function get(path) {
	const res = await fetch(`${cfg.base}${path}`, {
		method: "GET",
		headers: authHeaders(),
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		throw new ApiError(`bad_json (${res.status})`, res.status);
	}
	if (!res.ok) {
		throw new ApiError(data?.error ?? `http_${res.status}`, res.status);
	}
	return data;
}

// The runtime-plane read surface — mirrors the Worker's
// /api/work/{machines,terminals} routes.
export const api = {
	machines: () => get("/api/work/machines"),
	terminals: () => get("/api/work/terminals"),
};
