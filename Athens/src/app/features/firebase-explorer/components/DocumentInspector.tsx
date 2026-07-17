import { motion } from "motion/react";

const TYPE_COLORS: Record<string, string> = {
  string: "#2dd4bf",
  number: "#f59e0b",
  boolean: "#60a5fa",
  null: "#94a3b8",
  object: "#a78bfa",
  array: "#f472b6",
  Timestamp: "#34d399",
  GeoPoint: "#38bdf8",
  DocumentReference: "#fb923c",
  Bytes: "#c084fc",
};

function detectType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object" && value !== null && "__type" in value) {
    return String((value as { __type: string }).__type);
  }
  return typeof value;
}

function formatLeaf(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "object" && value !== null && "__type" in value) {
    const typed = value as { __type: string; value?: string; path?: string; latitude?: number; longitude?: number; byteLength?: number };
    if (typed.__type === "Timestamp") return typed.value || "";
    if (typed.__type === "DocumentReference") return typed.path || "";
    if (typed.__type === "GeoPoint") return `${typed.latitude}, ${typed.longitude}`;
    if (typed.__type === "Bytes") return `${typed.byteLength} bytes`;
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function FieldRow({
  name,
  value,
  depth = 0,
}: {
  name: string;
  value: unknown;
  depth?: number;
}) {
  const type = detectType(value);
  const isExpandable =
    (type === "object" && value !== null && !("__type" in (value as object))) || type === "array";
  const entries = isExpandable
    ? Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>)
    : [];

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <div className="fx-field-row">
        <span className="fx-field-key">{name}</span>
        <span className="fx-field-type" style={{ color: TYPE_COLORS[type] || "#94a3b8" }}>
          {type}
        </span>
        {!isExpandable && <span className="fx-field-val">{formatLeaf(value)}</span>}
        {isExpandable && (
          <span className="fx-field-val muted">
            {type === "array" ? `${entries.length} items` : `${entries.length} fields`}
          </span>
        )}
      </div>
      {isExpandable &&
        entries.map(([k, v]) => <FieldRow key={`${name}.${k}`} name={k} value={v} depth={depth + 1} />)}
    </div>
  );
}

export function DocumentInspector({
  documentId,
  path,
  data,
  subcollections,
  onOpenSubcollection,
}: {
  documentId: string;
  path: string;
  data: Record<string, unknown>;
  subcollections: { id: string; path: string }[];
  onOpenSubcollection: (path: string) => void;
}) {
  const fields = Object.entries(data || {});

  return (
    <motion.div
      key={path}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="fx-inspector"
    >
      <div className="fx-inspector-head">
        <div>
          <div className="fx-eyebrow">Document</div>
          <h3 className="fx-doc-title">{documentId}</h3>
          <p className="fx-path">{path}</p>
        </div>
        <button
          type="button"
          className="fx-ghost-btn"
          onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
        >
          Copy JSON
        </button>
      </div>

      {subcollections.length > 0 && (
        <div className="fx-subcols">
          <div className="fx-eyebrow">Subcollections</div>
          <div className="fx-chip-row">
            {subcollections.map((sc) => (
              <button key={sc.path} type="button" className="fx-chip" onClick={() => onOpenSubcollection(sc.path)}>
                {sc.id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="fx-fields">
        {fields.length === 0 ? (
          <div className="fx-empty">Empty document</div>
        ) : (
          fields.map(([k, v]) => <FieldRow key={k} name={k} value={v} />)
        )}
      </div>
    </motion.div>
  );
}
