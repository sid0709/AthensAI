import { ExternalLink } from "lucide-react";
import { notionPlainText, type NotionProperty } from "../../../services/notionApi";

function joinedNames(value: unknown): string {
  return Array.isArray(value)
    ? value.map((item) => String((item as { name?: string; id?: string })?.name || (item as { id?: string })?.id || "")).filter(Boolean).join(", ")
    : "";
}

export function notionPropertyText(property?: NotionProperty): string {
  if (!property) return "";
  const type = String(property.type || "");
  const value = property[type];
  switch (type) {
    case "title":
    case "rich_text":
      return notionPlainText(value);
    case "number":
    case "email":
    case "phone_number":
    case "url":
    case "created_time":
    case "last_edited_time":
      return value == null ? "" : String(value);
    case "checkbox":
      return value ? "Yes" : "No";
    case "select":
    case "status":
      return String((value as { name?: string } | null)?.name || "");
    case "multi_select":
    case "people":
      return joinedNames(value);
    case "date": {
      const date = value as { start?: string; end?: string } | null;
      if (!date?.start) return "";
      return date.end ? `${date.start} → ${date.end}` : date.start;
    }
    case "files":
      return Array.isArray(value) ? value.map((file) => String((file as { name?: string })?.name || "File")).join(", ") : "";
    case "relation":
      return Array.isArray(value) ? `${value.length} related page${value.length === 1 ? "" : "s"}` : "";
    case "created_by":
    case "last_edited_by":
      return String((value as { name?: string } | null)?.name || "");
    case "formula": {
      const formula = value as Record<string, unknown> | null;
      if (!formula?.type) return "";
      return notionPropertyText({ type: String(formula.type), [String(formula.type)]: formula[String(formula.type)] });
    }
    case "rollup": {
      const rollup = value as { type?: string; number?: number; date?: { start?: string }; array?: unknown[] } | null;
      if (!rollup) return "";
      if (rollup.type === "number") return String(rollup.number ?? "");
      if (rollup.type === "date") return String(rollup.date?.start || "");
      if (rollup.type === "array") return `${rollup.array?.length || 0} items`;
      return "";
    }
    default:
      return value == null ? "" : typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
}

export function NotionPropertyValue({ property }: { property?: NotionProperty }) {
  const text = notionPropertyText(property);
  if (!text) return <span className="text-muted-foreground/60">—</span>;
  if (property?.type === "url") {
    return <a href={text} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-primary hover:underline">{text}<ExternalLink className="h-3 w-3 flex-shrink-0" /></a>;
  }
  if (property?.type === "email") return <a href={`mailto:${text}`} className="text-primary hover:underline">{text}</a>;
  return <span>{text}</span>;
}
