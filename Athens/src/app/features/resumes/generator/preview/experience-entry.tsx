import type { ExperienceLayout, LayoutSection, PreviewCareer, PreviewEdit } from "../types";
import { EditableRich, renderRich } from "./rich-text";
import { pt } from "./utils";

export function ExperienceEntry({
  c,
  layout,
  section,
  accent,
  editable,
  expIndex,
  onEdit,
}: {
  c: PreviewCareer;
  layout: ExperienceLayout;
  section: LayoutSection;
  accent: string;
  editable: boolean;
  expIndex: number;
  onEdit?: (e: PreviewEdit) => void;
}) {
  const metaSize = pt(Math.max(8, section.bodySize - 1));
  const dates = c.period;
  const datesLoc = [c.period, c.location].filter(Boolean).join(", ");
  // Bullets are editable in the editor preview (Cmd/Ctrl+B toggles bold).
  const bulletNode = (b: string, bi: number) =>
    editable ? (
      <EditableRich as="span" value={b} onChange={(t) => onEdit?.({ kind: "bullet", exp: expIndex, bullet: bi, text: t })} />
    ) : (
      renderRich(b)
    );
  const meta = (text: string, italic = false) => (
    <span style={{ opacity: 0.72, whiteSpace: "nowrap", fontSize: metaSize, fontStyle: italic ? "italic" : "normal" }}>{text}</span>
  );
  const row = (left: React.ReactNode, right: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
      {left}
      {right}
    </div>
  );

  let head: React.ReactNode;
  switch (layout) {
    case "standard":
      head = (
        <>
          <div style={{ fontWeight: 700 }}>{c.title || "Role"}</div>
          {row(<span style={{ fontWeight: 700 }}>{c.company || "Company"}</span>, meta(datesLoc))}
        </>
      );
      break;
    case "single-line":
      head = (
        <div style={{ fontWeight: 700 }}>
          {[c.title || "Role", c.company || "Company", c.location, c.period].filter(Boolean).join("  |  ")}
        </div>
      );
      break;
    case "modern":
      head = (
        <>
          <div>
            <span style={{ fontWeight: 700, color: accent }}>{c.title || "Role"}</span>
            <span style={{ fontWeight: 700 }}> | {c.company || "Company"}</span>
          </div>
          <div style={{ opacity: 0.6, fontSize: metaSize }}>{datesLoc}</div>
        </>
      );
      break;
    case "harvard":
      head = (
        <>
          {row(<span style={{ fontWeight: 700 }}>{c.company || "Company"}</span>, meta(c.location))}
          {row(<span style={{ fontWeight: 700 }}>{c.title || "Role"}</span>, meta(dates))}
        </>
      );
      break;
    case "jakes":
      head = (
        <>
          {row(<span style={{ fontWeight: 700 }}>{c.company || "Company"}</span>, meta(c.location))}
          {row(<span style={{ fontStyle: "italic" }}>{c.title || "Role"}</span>, meta(dates, true))}
        </>
      );
      break;
    case "two-col-entry":
      // Left gutter: title + dates. Right: company | location + paragraph.
      return (
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ width: "32%", flexShrink: 0 }}>
            <div style={{ fontWeight: 700 }}>{c.title || "Role"}</div>
            <div style={{ opacity: 0.6, fontSize: metaSize }}>{c.period}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginBottom: 3 }}>
              <span style={{ fontWeight: 700 }}>{c.company || "Company"}</span>
              {c.location && <span style={{ opacity: 0.7 }}> | {c.location}</span>}
            </div>
            {c.bullets.map((b, bi) => (
              <p key={bi} style={{ margin: "0 0 2px", textAlign: "justify", breakInside: "avoid" }}>
                {bulletNode(b, bi)}
              </p>
            ))}
          </div>
        </div>
      );
    case "dev":
      // Monospace: company (bold) + role (muted) inline, bullets, muted dates,
      // and a divider rule between entries.
      return (
        <div style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: 8 }}>
          <div style={{ breakAfter: "avoid" }}>
            <span style={{ fontWeight: 700 }}>{c.company || "Company"}</span>{" "}
            <span style={{ opacity: 0.55 }}>{c.title || "Role"}</span>
          </div>
          <ul style={{ listStyleType: "disc", margin: "3px 0 0", paddingLeft: 18 }}>
            {c.bullets.map((b, bi) => (
              <li key={bi} style={{ marginBottom: 1, breakInside: "avoid" }}>
                {bulletNode(b, bi)}
              </li>
            ))}
          </ul>
          <div style={{ opacity: 0.5, fontSize: metaSize, marginTop: 4 }}>{datesLoc}</div>
        </div>
      );
    default: // "default"
      head = (
        <>
          {row(<span style={{ fontWeight: 700 }}>{c.title || "Role"}</span>, meta(dates))}
          <div style={{ fontStyle: "italic", color: accent, marginBottom: 2 }}>{c.company || "Company"}</div>
        </>
      );
  }

  return (
    <div>
      <div style={{ breakAfter: "avoid" }}>{head}</div>
      <ul style={{ listStyleType: "disc", margin: "2px 0 0", paddingLeft: 18 }}>
        {c.bullets.map((b, bi) => (
          <li key={bi} style={{ marginBottom: 1, breakInside: "avoid" }}>
            {bulletNode(b, bi)}
          </li>
        ))}
      </ul>
    </div>
  );
}
