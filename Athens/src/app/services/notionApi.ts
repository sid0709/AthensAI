import { API_BASE } from "@/lib/api-base";
import type { CalendarEvent } from "../data/calendar";

export type NotionProperty = {
  id?: string;
  type?: string;
  [key: string]: unknown;
};

export type NotionResource = {
  object: "page" | "data_source";
  id: string;
  url?: string | null;
  public_url?: string | null;
  title?: NotionRichText[];
  name?: string;
  icon?: NotionIcon | null;
  cover?: NotionFile | null;
  parent?: Record<string, unknown>;
  properties?: Record<string, NotionProperty>;
  created_time?: string;
  last_edited_time?: string;
  in_trash?: boolean;
  [key: string]: unknown;
};

export type NotionRichText = {
  type?: string;
  plain_text?: string;
  href?: string | null;
  text?: { content?: string; link?: { url?: string } | null };
  mention?: Record<string, unknown>;
  equation?: { expression?: string };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: string;
  };
};

export type NotionIcon = {
  type?: "emoji" | "external" | "file" | "custom_emoji";
  emoji?: string;
  external?: { url?: string };
  file?: { url?: string; expiry_time?: string };
  custom_emoji?: { url?: string };
};

export type NotionFile = {
  type?: "external" | "file";
  external?: { url?: string };
  file?: { url?: string; expiry_time?: string };
  name?: string;
};

export type NotionBlock = {
  object?: "block";
  id: string;
  type: string;
  has_children?: boolean;
  url?: string;
  [key: string]: unknown;
};

export type NotionStatus = {
  connected: boolean;
  apiVersion?: string;
  connectedAt?: string;
  bot?: {
    id?: string;
    name?: string;
    avatarUrl?: string | null;
    workspaceName?: string | null;
  } | null;
  callRecord?: {
    dataSourceId: string;
    databaseId?: string | null;
    name: string;
    url?: string | null;
    titleProperty: { id: string; name: string };
    dateProperty: { id: string; name: string };
  } | null;
};

type ListResponse<T> = {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE.replace(/\/$/, "")}${path}`, options);
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    code?: string;
  };
  if (!response.ok) {
    const error = new Error(data.error || data.message || `Request failed (${response.status})`) as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

const accountQuery = (applierName: string) => `applierName=${encodeURIComponent(applierName)}`;

export async function fetchNotionStatus(applierName: string): Promise<NotionStatus> {
  const data = await request<{ success: boolean } & NotionStatus>(
    `/integrations/notion/status?${accountQuery(applierName)}`,
  );
  return data;
}

export async function connectNotion(applierName: string, token: string): Promise<NotionStatus> {
  return request<{ success: boolean } & NotionStatus>("/integrations/notion/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, token }),
  });
}

export async function disconnectNotion(applierName: string): Promise<void> {
  await request(`/integrations/notion?${accountQuery(applierName)}`, { method: "DELETE" });
}

export async function searchNotionResources(
  applierName: string,
  query = "",
  cursor?: string | null,
  pageSize = 100,
): Promise<ListResponse<NotionResource>> {
  const params = new URLSearchParams({ applierName, q: query, pageSize: String(pageSize) });
  if (cursor) params.set("cursor", cursor);
  return request<{ success: boolean } & ListResponse<NotionResource>>(
    `/integrations/notion/search?${params.toString()}`,
  );
}

export async function fetchNotionPage(applierName: string, pageId: string): Promise<NotionResource> {
  const data = await request<{ success: boolean; page: NotionResource }>(
    `/integrations/notion/pages/${encodeURIComponent(pageId)}?${accountQuery(applierName)}`,
  );
  return data.page;
}

export async function fetchNotionBlockChildren(
  applierName: string,
  blockId: string,
  cursor?: string | null,
): Promise<ListResponse<NotionBlock>> {
  const params = new URLSearchParams({ applierName, pageSize: "100" });
  if (cursor) params.set("cursor", cursor);
  return request<{ success: boolean } & ListResponse<NotionBlock>>(
    `/integrations/notion/blocks/${encodeURIComponent(blockId)}/children?${params.toString()}`,
  );
}

export async function queryNotionDataSource(
  applierName: string,
  dataSourceId: string,
  cursor?: string | null,
): Promise<ListResponse<NotionResource>> {
  return request<{ success: boolean } & ListResponse<NotionResource>>(
    `/integrations/notion/data-sources/${encodeURIComponent(dataSourceId)}/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applierName, cursor, pageSize: 50 }),
    },
  );
}

export async function fetchNotionCalendar(
  applierName: string,
  start: string,
  end: string,
): Promise<{ events: CalendarEvent[]; source?: NotionStatus["callRecord"] }> {
  const params = new URLSearchParams({ applierName, start, end });
  return request<{ success: boolean; events: CalendarEvent[]; source?: NotionStatus["callRecord"] }>(
    `/integrations/notion/calendar?${params.toString()}`,
  );
}

export function notionPlainText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      const item = part as NotionRichText;
      return String(item.plain_text ?? item.text?.content ?? item.equation?.expression ?? "");
    })
    .join("");
}

export function notionResourceTitle(resource: NotionResource): string {
  const direct = notionPlainText(resource.title);
  if (direct) return direct;
  if (resource.name?.trim()) return resource.name.trim();
  for (const property of Object.values(resource.properties || {})) {
    if (property.type === "title") {
      const title = notionPlainText(property.title);
      if (title) return title;
    }
  }
  return "Untitled";
}
