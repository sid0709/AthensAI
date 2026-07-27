import test from "node:test";
import assert from "node:assert/strict";
import {
	NotionApiError,
	findCallRecordDataSource,
	notionPageToCalendarEvent,
	notionRequest,
} from "./notionService.js";

function jsonResponse(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

test("Call Record discovery resolves a unique title and date property", async () => {
	const fetchMock = async (url) => {
		if (url.endsWith("/search")) {
			return jsonResponse({
				results: [{ id: "source-1", object: "data_source", title: [{ plain_text: "Call Record" }] }],
				has_more: false,
				next_cursor: null,
			});
		}
		return jsonResponse({
			id: "source-1",
			properties: {
				Name: { id: "title", name: "Name", type: "title" },
				Date: { id: "date", name: "Date", type: "date" },
			},
		});
	};

	const result = await findCallRecordDataSource("secret", fetchMock);
	assert.equal(result.source.id, "source-1");
	assert.equal(result.titleProperty.name, "Name");
	assert.equal(result.dateProperty.name, "Date");
});

test("Call Record discovery fails closed when date fields are ambiguous", async () => {
	const fetchMock = async (url) => {
		if (url.endsWith("/search")) {
			return jsonResponse({
				results: [{ id: "source-1", object: "data_source", title: [{ plain_text: "Call Record" }] }],
				has_more: false,
			});
		}
		return jsonResponse({
			id: "source-1",
			properties: {
				Name: { id: "title", name: "Name", type: "title" },
				Start: { id: "start", name: "Start", type: "date" },
				FollowUp: { id: "follow", name: "Follow up", type: "date" },
			},
		});
	};

	await assert.rejects(
		findCallRecordDataSource("secret", fetchMock),
		(error) => error instanceof NotionApiError && error.code === "date_property_ambiguous",
	);
});

test("Notion request retries a rate limit without exposing the token", async () => {
	let calls = 0;
	const fetchMock = async (_url, options) => {
		calls += 1;
		assert.equal(options.headers.Authorization, "Bearer super-secret");
		return calls === 1
			? jsonResponse({ code: "rate_limited" }, 429, { "retry-after": "0" })
			: jsonResponse({ ok: true });
	};
	const result = await notionRequest("super-secret", "/users/me", { method: "GET" }, fetchMock);
	assert.deepEqual(result, { ok: true });
	assert.equal(calls, 2);
});

test("calendar mapping preserves timed ranges", () => {
	const page = {
		id: "page-1",
		url: "https://notion.so/page-1",
		properties: {
			Name: { id: "title", type: "title", title: [{ plain_text: "Recruiter Call" }] },
			Date: { id: "date", type: "date", date: { start: "2026-07-27T09:00:00-05:00", end: "2026-07-27T10:00:00-05:00" } },
		},
	};
	const event = notionPageToCalendarEvent(page, {
		titleProperty: { id: "title", name: "Name" },
		dateProperty: { id: "date", name: "Date" },
	});
	assert.equal(event.title, "Recruiter Call");
	assert.equal(event.start, "2026-07-27T09:00:00-05:00");
	assert.equal(event.end, "2026-07-27T10:00:00-05:00");
	assert.equal(event.allDay, false);
	assert.equal(event.readOnly, true);
});

test("calendar mapping creates one-day all-day events and 30-minute timed events", () => {
	const callRecord = {
		titleProperty: { id: "title", name: "Name" },
		dateProperty: { id: "date", name: "Date" },
	};
	const allDay = notionPageToCalendarEvent({
		id: "a",
		properties: {
			Name: { id: "title", type: "title", title: [] },
			Date: { id: "date", type: "date", date: { start: "2026-07-27" } },
		},
	}, callRecord);
	assert.equal(allDay.title, "Untitled Call Record");
	assert.equal(allDay.end, "2026-07-28");
	assert.equal(allDay.allDay, true);

	const timed = notionPageToCalendarEvent({
		id: "b",
		properties: {
			Name: { id: "title", type: "title", title: [{ plain_text: "Phone screen" }] },
			Date: { id: "date", type: "date", date: { start: "2026-07-27T12:00:00.000Z" } },
		},
	}, callRecord);
	assert.equal(timed.end, "2026-07-27T12:30:00.000Z");
	assert.equal(timed.allDay, false);
});
