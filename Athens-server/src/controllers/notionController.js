import { accountInfoCollection } from "../db/dataStore.js";
import { isBetaTier } from "../lib/betaTier.js";
import { updateAccountInfoById } from "../services/accountInfoStore.js";
import { decryptAccountSecret, encryptAccountSecret } from "../services/autoBidProfileSecrets.js";
import {
	NOTION_API_VERSION,
	NotionApiError,
	findCallRecordDataSource,
	notionPageToCalendarEvent,
	queryDataSource,
	retrieveBlockChildren,
	retrieveNotionPage,
	searchNotion,
	validateNotionToken,
} from "../services/notionService.js";

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findAccount(nameRaw) {
	const name = String(nameRaw || "").trim();
	if (!name || !accountInfoCollection) return null;
	return (await accountInfoCollection.findOne({ name })) || accountInfoCollection.findOne({
		name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, "i") },
	});
}

function isAdmin(req) {
	return req.auth?.admin === true || String(req.auth?.role || "").toLowerCase() === "admin";
}

function canAccess(req, account) {
	if (!req.auth || isAdmin(req)) return true;
	return req.profileAccess?.profileIds?.has(String(account._id)) ||
		req.profileAccess?.profileNames?.has(String(account.name).trim().toLowerCase());
}

async function resolveAccount(req, res) {
	if (!accountInfoCollection) {
		res.status(503).json({ success: false, error: "Database not ready" });
		return null;
	}
	const name = String(req.body?.applierName || req.query?.applierName || "").trim();
	if (!name) {
		res.status(400).json({ success: false, error: "applierName is required" });
		return null;
	}
	const account = await findAccount(name);
	if (!account) {
		res.status(404).json({ success: false, error: "Account not found" });
		return null;
	}
	if (!canAccess(req, account)) {
		res.status(403).json({ success: false, error: "Profile access denied" });
		return null;
	}
	if (!isBetaTier(account.tier)) {
		res.status(403).json({ success: false, error: "Beta workspace required", betaRequired: true });
		return null;
	}
	return account;
}

async function connectedContext(req, res) {
	const account = await resolveAccount(req, res);
	if (!account) return null;
	const integration = account.notionIntegration;
	if (!integration?.accessToken) {
		res.status(409).json({ success: false, error: "Notion is not connected", code: "not_connected" });
		return null;
	}
	return { account, integration, token: await decryptAccountSecret(integration.accessToken) };
}

function publicStatus(integration) {
	if (!integration?.accessToken) return { connected: false };
	return {
		connected: true,
		apiVersion: integration.apiVersion,
		connectedAt: integration.connectedAt,
		bot: integration.bot || null,
		callRecord: integration.callRecord || null,
	};
}

function sendError(res, error, label) {
	if (error instanceof NotionApiError) {
		return res.status(error.status || 502).json({ success: false, error: error.message, code: error.code });
	}
	console.error(`[notion] ${label}:`, error instanceof Error ? error.message : String(error));
	return res.status(500).json({ success: false, error: "Notion integration request failed" });
}

export async function getNotionStatus(req, res) {
	try {
		const account = await resolveAccount(req, res);
		if (!account) return;
		return res.json({ success: true, ...publicStatus(account.notionIntegration) });
	} catch (error) {
		return sendError(res, error, "status");
	}
}

export async function connectNotion(req, res) {
	try {
		const account = await resolveAccount(req, res);
		if (!account) return;
		const token = String(req.body?.token || "").trim();
		if (!token) return res.status(400).json({ success: false, error: "Notion token is required" });

		const bot = await validateNotionToken(token);
		const { source, titleProperty, dateProperty } = await findCallRecordDataSource(token);
		await queryDataSource(token, source.id, { page_size: 1 });

		const notionIntegration = {
			accessToken: await encryptAccountSecret(token),
			apiVersion: NOTION_API_VERSION,
			connectedAt: new Date().toISOString(),
			bot: {
				id: bot.id,
				name: bot.name || "Notion connection",
				avatarUrl: bot.avatar_url || null,
				workspaceName: bot.bot?.workspace_name || bot.bot?.owner?.workspace?.name || null,
			},
			callRecord: {
				databaseId: source.parent?.database_id || null,
				dataSourceId: source.id,
				name: "Call Record",
				url: source.url || null,
				titleProperty: { id: titleProperty.id, name: titleProperty.name },
				dateProperty: { id: dateProperty.id, name: dateProperty.name },
			},
		};

		await updateAccountInfoById(account._id, account.name, { $set: { notionIntegration } });
		return res.json({ success: true, ...publicStatus(notionIntegration) });
	} catch (error) {
		return sendError(res, error, "connect");
	}
}

export async function disconnectNotion(req, res) {
	try {
		const account = await resolveAccount(req, res);
		if (!account) return;
		await updateAccountInfoById(account._id, account.name, { $unset: { notionIntegration: "" } });
		return res.json({ success: true, connected: false });
	} catch (error) {
		return sendError(res, error, "disconnect");
	}
}

export async function searchNotionResources(req, res) {
	try {
		const context = await connectedContext(req, res);
		if (!context) return;
		const data = await searchNotion(context.token, {
			query: String(req.query?.q || ""),
			cursor: req.query?.cursor ? String(req.query.cursor) : undefined,
			pageSize: req.query?.pageSize,
		});
		return res.json({ success: true, ...data });
	} catch (error) {
		return sendError(res, error, "search");
	}
}

export async function getNotionPage(req, res) {
	try {
		const context = await connectedContext(req, res);
		if (!context) return;
		const page = await retrieveNotionPage(context.token, req.params.pageId);
		return res.json({ success: true, page });
	} catch (error) {
		return sendError(res, error, "page");
	}
}

export async function getNotionBlockChildren(req, res) {
	try {
		const context = await connectedContext(req, res);
		if (!context) return;
		const data = await retrieveBlockChildren(context.token, req.params.blockId, {
			cursor: req.query?.cursor ? String(req.query.cursor) : undefined,
			pageSize: req.query?.pageSize,
		});
		return res.json({ success: true, ...data });
	} catch (error) {
		return sendError(res, error, "blocks");
	}
}

export async function queryNotionDataSource(req, res) {
	try {
		const context = await connectedContext(req, res);
		if (!context) return;
		const body = { page_size: Math.max(1, Math.min(100, Number(req.body?.pageSize) || 50)) };
		if (req.body?.cursor) body.start_cursor = String(req.body.cursor);
		const data = await queryDataSource(context.token, req.params.dataSourceId, body);
		return res.json({ success: true, ...data });
	} catch (error) {
		return sendError(res, error, "data-source");
	}
}

export async function getNotionCalendar(req, res) {
	try {
		const context = await connectedContext(req, res);
		if (!context) return;
		const start = String(req.query?.start || "");
		const end = String(req.query?.end || "");
		if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
			return res.status(400).json({ success: false, error: "Valid start and end dates are required" });
		}
		const callRecord = context.integration.callRecord;
		let cursor;
		const events = [];
		do {
			const body = {
				page_size: 100,
				filter: {
					and: [
						{ property: callRecord.dateProperty.name, date: { on_or_after: start } },
						{ property: callRecord.dateProperty.name, date: { before: end } },
					],
				},
				sorts: [{ property: callRecord.dateProperty.name, direction: "ascending" }],
			};
			if (cursor) body.start_cursor = cursor;
			const data = await queryDataSource(context.token, callRecord.dataSourceId, body);
			for (const page of data.results || []) {
				const event = notionPageToCalendarEvent(page, callRecord);
				if (event) events.push(event);
			}
			cursor = data.has_more ? data.next_cursor : undefined;
		} while (cursor);
		return res.json({ success: true, events, source: callRecord });
	} catch (error) {
		return sendError(res, error, "calendar");
	}
}
