export const NOTION_API_VERSION = "2026-03-11";
const NOTION_API_BASE = "https://api.notion.com/v1";
const MAX_RETRIES = 3;

export class NotionApiError extends Error {
	constructor(message, status = 500, code = "notion_error") {
		super(message);
		this.name = "NotionApiError";
		this.status = status;
		this.code = code;
	}
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelayMs(response, attempt) {
	const retryAfter = Number.parseFloat(response.headers.get("retry-after") || "");
	if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(10_000, retryAfter * 1000);
	return Math.min(4_000, 300 * (2 ** attempt));
}

export async function notionRequest(token, path, options = {}, fetchImpl = fetch) {
	const accessToken = String(token || "").trim();
	if (!accessToken) throw new NotionApiError("Notion is not connected", 409, "not_connected");

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
		let response;
		try {
			response = await fetchImpl(`${NOTION_API_BASE}${path}`, {
				...options,
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Notion-Version": NOTION_API_VERSION,
					...(options.body ? { "Content-Type": "application/json" } : {}),
					...(options.headers || {}),
				},
			});
		} catch (error) {
			if (attempt < MAX_RETRIES) {
				await delay(300 * (2 ** attempt));
				continue;
			}
			throw new NotionApiError("Could not reach Notion", 502, "notion_unavailable");
		}

		if ((response.status === 429 || response.status === 503 || response.status === 504) && attempt < MAX_RETRIES) {
			await delay(retryDelayMs(response, attempt));
			continue;
		}

		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const status = response.status === 401 ? 401 : response.status;
			const fallback = status === 401
				? "The Notion token is invalid or revoked"
				: status === 403
					? "The Notion connection does not have permission to read this content"
					: status === 404
						? "Notion could not find this content. Make sure it is shared with the connection"
						: status === 429
							? "Notion is rate limiting requests. Try again shortly"
							: "Notion request failed";
			throw new NotionApiError(fallback, status, String(data?.code || "notion_error"));
		}
		return data;
	}

	throw new NotionApiError("Notion request failed", 502, "notion_unavailable");
}

export function plainText(richText) {
	return Array.isArray(richText)
		? richText.map((part) => String(part?.plain_text ?? part?.text?.content ?? "")).join("")
		: "";
}

export function notionObjectTitle(value) {
	if (!value || typeof value !== "object") return "Untitled";
	const direct = plainText(value.title);
	if (direct) return direct;
	if (typeof value.name === "string" && value.name.trim()) return value.name.trim();
	const properties = value.properties && typeof value.properties === "object" ? value.properties : {};
	for (const property of Object.values(properties)) {
		if (property?.type === "title") {
			const title = plainText(property.title);
			if (title) return title;
		}
	}
	return "Untitled";
}

export async function validateNotionToken(token, fetchImpl = fetch) {
	return notionRequest(token, "/users/me", { method: "GET" }, fetchImpl);
}

export async function searchNotion(token, { query = "", cursor, pageSize = 50, objectType } = {}, fetchImpl = fetch) {
	const body = { page_size: Math.max(1, Math.min(100, Number(pageSize) || 50)) };
	if (query) body.query = String(query).slice(0, 200);
	if (cursor) body.start_cursor = cursor;
	if (objectType === "page" || objectType === "data_source") {
		body.filter = { property: "object", value: objectType };
	}
	return notionRequest(token, "/search", { method: "POST", body: JSON.stringify(body) }, fetchImpl);
}

export async function retrieveDataSource(token, dataSourceId, fetchImpl = fetch) {
	return notionRequest(token, `/data_sources/${encodeURIComponent(dataSourceId)}`, { method: "GET" }, fetchImpl);
}

export async function queryDataSource(token, dataSourceId, body = {}, fetchImpl = fetch) {
	return notionRequest(
		token,
		`/data_sources/${encodeURIComponent(dataSourceId)}/query`,
		{ method: "POST", body: JSON.stringify(body) },
		fetchImpl,
	);
}

export async function retrieveNotionPage(token, pageId, fetchImpl = fetch) {
	return notionRequest(token, `/pages/${encodeURIComponent(pageId)}`, { method: "GET" }, fetchImpl);
}

export async function retrieveBlockChildren(token, blockId, { cursor, pageSize = 100 } = {}, fetchImpl = fetch) {
	const params = new URLSearchParams({ page_size: String(Math.max(1, Math.min(100, Number(pageSize) || 100))) });
	if (cursor) params.set("start_cursor", cursor);
	return notionRequest(
		token,
		`/blocks/${encodeURIComponent(blockId)}/children?${params.toString()}`,
		{ method: "GET" },
		fetchImpl,
	);
}

export async function findCallRecordDataSource(token, fetchImpl = fetch) {
	let cursor;
	const exact = [];
	do {
		const result = await searchNotion(
			token,
			{ query: "Call Record", cursor, pageSize: 100, objectType: "data_source" },
			fetchImpl,
		);
		for (const item of result.results || []) {
			if (notionObjectTitle(item).trim().toLocaleLowerCase("en-US") === "call record") exact.push(item);
		}
		cursor = result.has_more ? result.next_cursor : undefined;
	} while (cursor);

	if (exact.length === 0) {
		throw new NotionApiError(
			'No accessible data source named "Call Record" was found. Share it with this Notion connection and try again.',
			422,
			"call_record_not_found",
		);
	}
	if (exact.length > 1) {
		throw new NotionApiError(
			'More than one accessible data source is named "Call Record". Rename or unshare duplicates before connecting.',
			422,
			"call_record_ambiguous",
		);
	}

	const source = await retrieveDataSource(token, exact[0].id, fetchImpl);
	const properties = Object.values(source.properties || {});
	const titleProperties = properties.filter((property) => property?.type === "title");
	const dateProperties = properties.filter((property) => property?.type === "date");
	if (titleProperties.length !== 1) {
		throw new NotionApiError('"Call Record" must have exactly one title property.', 422, "title_property_ambiguous");
	}
	if (dateProperties.length !== 1) {
		throw new NotionApiError(
			'"Call Record" must have exactly one date property for automatic calendar sync.',
			422,
			"date_property_ambiguous",
		);
	}

	return {
		source,
		titleProperty: titleProperties[0],
		dateProperty: dateProperties[0],
	};
}

function propertyByReference(properties, reference) {
	if (!properties || !reference) return null;
	if (properties[reference.name]) return properties[reference.name];
	return Object.values(properties).find((property) => property?.id === reference.id) || null;
}

function addUtcDay(dateOnly) {
	const date = new Date(`${dateOnly}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
}

export function notionPageToCalendarEvent(page, callRecord) {
	const properties = page?.properties || {};
	const titleProperty = propertyByReference(properties, callRecord?.titleProperty);
	const dateProperty = propertyByReference(properties, callRecord?.dateProperty);
	const start = String(dateProperty?.date?.start || "");
	if (!start) return null;
	const allDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
	let end = String(dateProperty?.date?.end || "");
	if (!end) {
		end = allDay ? addUtcDay(start) : new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
	}
	const title = plainText(titleProperty?.title).trim() || "Untitled Call Record";
	return {
		id: `notion:${page.id}`,
		notionPageId: page.id,
		title,
		start,
		end,
		allDay,
		type: "interview",
		source: "notion",
		notionUrl: page.url || null,
		readOnly: true,
		confirmed: true,
	};
}
