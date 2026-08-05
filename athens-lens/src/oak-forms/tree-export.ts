/**
 * Pure-tree formatting adapted from Project Oak UI board (Copy for Analyze).
 */

import type { DomNode, MetaNode, PureNode } from "./types";

const DETAIL_TAGS = new Set([
  "a",
  "button",
  "fieldset",
  "form",
  "input",
  "label",
  "li",
  "option",
  "select",
  "textarea",
]);

const DETAIL_ATTR_KEYS = [
  "for",
  "type",
  "role",
  "name",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-required",
  "aria-invalid",
  "aria-checked",
  "autocomplete",
  "placeholder",
  "value",
  "data-automation-id",
  "data-fkit-id",
  "selected",
  "checked",
] as const;

export function splitDomTree(root: DomNode): { pure: PureNode; meta: MetaNode } {
  return {
    pure: toPureNode(root),
    meta: toMetaNode(root),
  };
}

function toPureNode(node: DomNode): PureNode {
  const pure: PureNode = {
    tag: node.tag,
    id: node.nodeId,
    children: node.children.map(toPureNode),
  };
  if (node.text) pure.text = node.text;
  if (DETAIL_TAGS.has(node.tag) && (node.attrs || node.id)) {
    const parts: string[] = [];
    if (node.id) parts.push(`domId=${node.id}`);
    for (const key of DETAIL_ATTR_KEYS) {
      const value = node.attrs?.[key];
      if (value) parts.push(`${key}=${formatDetailValue(value)}`);
    }
    if (parts.length > 0) pure.detail = parts.join(" ");
  }
  return pure;
}

function formatDetailValue(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function toMetaNode(node: DomNode): MetaNode {
  const meta: MetaNode = {
    id: node.nodeId,
    children: node.children.map(toMetaNode),
  };
  if (node.id) meta.domId = node.id;
  if (node.classes?.length) meta.classes = node.classes;
  if (node.attrs && Object.keys(node.attrs).length > 0) meta.attrs = node.attrs;
  return meta;
}

function formatPureNodeLine(pure: PureNode): string {
  const detailPart = pure.detail ? ` ${pure.detail}` : "";
  const textPart = pure.text ? ` "${pure.text}"` : "";
  return `${pure.tag}[${pure.id}]${detailPart}${textPart}`;
}

export function formatPureTreePreview(pure: PureNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  const lines = [`${indent}${formatPureNodeLine(pure)}`];
  for (const child of pure.children) {
    lines.push(formatPureTreePreview(child, depth + 1));
  }
  return lines.join("\n");
}

/** Indented pure tree text for AI analysis (not JSON). */
export function formatPureTreeForAnalyze(
  pure: PureNode,
  ctx: { title: string; url: string; fetchedAt: string },
): string {
  return [
    `# DOM Tree — ${ctx.title || "Untitled"}`,
    `URL: ${ctx.url}`,
    `Fetched: ${ctx.fetchedAt}`,
    "",
    formatPureTreePreview(pure),
    "",
  ].join("\n");
}
