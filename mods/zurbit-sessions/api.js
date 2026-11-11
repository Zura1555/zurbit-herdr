// Data layer for the Zurbit sessions mod. Phase 1: REST against the
// Cloudflare control plane (same endpoints the web SPA uses). Phase 2:
// swap this file for `zurbit.*` doc reads/writes on the hub herdr-core —
// keep the exported surface identical so main.js does not change.

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
		file = JSON.parse(await readTextFile(`${appHome()}/zurbit.json`));
	} catch {}
	return {
		base: p?.base ?? localStorage.getItem("zurbit.base") ?? file.base ?? null,
		token:
			p?.token ??
			localStorage.getItem("zurbit.token") ??
			file.token ??
			null,
		cookie: localStorage.getItem("zurbit.cookie") ?? file.cookie ?? null,
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

async function call(method, path, body) {
	const res = await fetch(`${cfg.base}${path}`, {
		method,
		headers: {
			...authHeaders(),
			...(body ? { "content-type": "application/json" } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
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

const get = (path) => call("GET", path);
const post = (path, body) => call("POST", path, body);
const enc = encodeURIComponent;

// The runtime-plane read surface + M2 steering — mirrors the Worker's
// /api/work/{cores,machines,terminals,commands} routes.
export const api = {
	cores: () => get("/api/work/cores"),
	machines: () => get("/api/work/machines"),
	terminals: () => get("/api/work/terminals"),

	sendCommand: (terminalId, op, requestId, args) =>
		post("/api/work/commands", {
			request_id: requestId,
			terminal_id: terminalId,
			op,
			args: args ?? {},
		}),
	command: (id) => get(`/api/work/commands/${enc(id)}`),
};
