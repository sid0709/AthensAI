import type { ExperienceLayout } from "../lib/templates";
import { pt } from "../../lib/previewUtils";

export type PreviewCareer = {
  title: string;
  company: string;
  location: string;
  period: string;
  bullets: string[];
};

type ExperienceEntryProps = {
  career: PreviewCareer;
  layout: ExperienceLayout;
  bodySize: number;
  accent: string;
};

export function ExperienceEntry({ career: c, layout, bodySize, accent }: ExperienceEntryProps) {
  const metaSize = pt(Math.max(8, bodySize - 1));
  const dates = c.period;
  const datesLoc = [c.period, c.location].filter(Boolean).join(", ");

  const meta = (text: string, italic = false) => (
    <span style={{ opacity: 0.72, whiteSpace: "nowrap", fontSize: metaSize, fontStyle: italic ? "italic" : "normal" }}>{text}</span>
  );

  const row = (left: React.ReactNode, right: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
      {left}
      {right}
    </div>
  );

  if (layout === "two-col-entry") {
    return (
      <div style={{ display: "flex", gap: 20, breakInside: "avoid" }}>
        <div style={{ width: "32%", flexShrink: 0 }}>
          <div style={{ fontWeight: 700 }}>{c.title || "Role"}</div>
          <div style={{ opacity: 0.6, fontSize: metaSize }}>{c.period}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 3 }}>
            <span style={{ fontWeight: 700 }}>{c.company || "Company"}</span>
            {c.location && <span style={{ opacity: 0.7 }}> | {c.location}</span>}
          </div>
          {c.bullets.map((b, i) => (
            <p key={i} style={{ margin: "0 0 2px", textAlign: "justify", breakInside: "avoid" }}>{b}</p>
          ))}
        </div>
      </div>
    );
  }

  if (layout === "dev") {
    return (
      <div style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: 8, breakInside: "avoid" }}>
        <div style={{ breakAfter: "avoid" }}>
          <span style={{ fontWeight: 700 }}>{c.company || "Company"}</span>{" "}
          <span style={{ opacity: 0.55 }}>{c.title || "Role"}</span>
        </div>
        {c.bullets.length > 0 && (
          <ul style={{ listStyleType: "disc", margin: "3px 0 0", paddingLeft: 18 }}>
            {c.bullets.map((b, i) => (
              <li key={i} style={{ marginBottom: 1, breakInside: "avoid" }}>{b}</li>
            ))}
          </ul>
        )}
        <div style={{ opacity: 0.5, fontSize: metaSize, marginTop: 4 }}>{datesLoc}</div>
      </div>
    );
  }

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
    default:
      head = (
        <>
          {row(<span style={{ fontWeight: 700 }}>{c.title || "Role"}</span>, meta(dates))}
          <div style={{ fontStyle: "italic", color: accent, marginBottom: 2 }}>{c.company || "Company"}</div>
        </>
      );
  }

  return (
    <div style={{ breakInside: "avoid" }}>
      <div style={{ breakAfter: "avoid" }}>{head}</div>
      {c.bullets.length > 0 && (
        <ul style={{ listStyleType: "disc", margin: "2px 0 0", paddingLeft: 18 }}>
          {c.bullets.map((b, i) => (
            <li key={i} style={{ marginBottom: 1, breakInside: "avoid" }}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
