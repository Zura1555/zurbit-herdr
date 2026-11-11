// Data layer for the Zurbit factory mod. Phase 1: REST against the
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

// The factory read/act surface — mirrors src/dispatch.ts + src/ship.ts.
export const api = {
	plans: () => get("/api/work/dispatch/plans"),
	tasks: () => get("/api/work/dispatch/tasks"),
	task: (id) => get(`/api/work/dispatch/tasks/${enc(id)}`),
	runs: () => get("/api/work/dispatch/runs"),
	ships: () => get("/api/work/dispatch/ships"),

	approvePlan: (id) => post(`/api/work/dispatch/plans/${enc(id)}/approve`),
	rejectPlan: (id) => post(`/api/work/dispatch/plans/${enc(id)}/reject`),
	dispatchTask: (id) => post(`/api/work/dispatch/tasks/${enc(id)}/dispatch`),
	doneTask: (id) => post(`/api/work/dispatch/tasks/${enc(id)}/done`),
	cancelTask: (id) => post(`/api/work/dispatch/tasks/${enc(id)}/cancel`),
	requeueTask: (id) => post(`/api/work/dispatch/tasks/${enc(id)}/requeue`),
	cancelRun: (id) => post(`/api/work/dispatch/runs/${enc(id)}/cancel`),
	approveShip: (runId, headSha) =>
		post(`/api/work/dispatch/runs/${enc(runId)}/ship/approve`, {
			head_sha: headSha,
		}),
	reconcileShip: (runId) =>
		post(`/api/work/dispatch/runs/${enc(runId)}/ship/reconcile`),
};
