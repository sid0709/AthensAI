import { GoogleAuth } from "google-auth-library";

const clients = new Map();

function serviceAuthRequired() {
	const raw = String(process.env.SERVICE_AUTH_REQUIRED ?? "").trim().toLowerCase();
	if (raw) return !["0", "false", "no", "off"].includes(raw);
	return process.env.NODE_ENV === "production";
}

function audienceFor(url) {
	const explicit = String(process.env.AI_BFF_AUDIENCE || "").trim();
	if (explicit) return explicit.replace(/\/$/, "");
	const parsed = new URL(url);
	return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Return a Google-signed Cloud Run identity header. Local development keeps the
 * existing unauthenticated loopback path unless SERVICE_AUTH_REQUIRED is set.
 */
export async function getServiceAuthHeaders(targetUrl) {
	if (!serviceAuthRequired()) return {};
	const audience = audienceFor(targetUrl);
	let client = clients.get(audience);
	if (!client) {
		client = await new GoogleAuth().getIdTokenClient(audience);
		clients.set(audience, client);
	}
	const headers = await client.getRequestHeaders(audience);
	const authorization = headers.get?.("authorization") || headers.authorization;
	if (!authorization) throw new Error(`Could not mint a service identity token for ${audience}`);
	return { Authorization: authorization };
}
