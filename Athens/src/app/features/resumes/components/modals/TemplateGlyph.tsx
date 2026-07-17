import type { TemplateDef } from "../../lib/templates";

export function TemplateGlyph({ template }: { template: TemplateDef }) {
  const bar = (w: string, c = "bg-muted") => (
    <div className={`h-1 rounded-sm ${c}`} style={{ width: w }} />
  );

  if (template.columns === 2) {
    const side = (
      <div
        className={`w-1/3 rounded-sm flex flex-col gap-1 p-1 ${
          template.sidebarTint ? "bg-primary/15" : "bg-secondary"
        }`}
      >
        {bar("80%")}
        {bar("60%")}
        {bar("70%")}
      </div>
    );
    const main = (
      <div className="flex-1 flex flex-col gap-1 p-1">
        {bar("70%", "bg-primary/50")}
        {bar("100%")}
        {bar("90%")}
        {bar("95%")}
      </div>
    );
    return (
      <div className="h-12 rounded-md border border-border p-1.5 flex gap-1 bg-card">
        {template.sidebarSide === "left" ? (
          <>
            {side}
            {main}
          </>
        ) : (
          <>
            {main}
            {side}
          </>
        )}
      </div>
    );
  }

  const align = template.headingAlign === "center" ? "items-center" : "items-start";
  return (
    <div
      className={`h-12 rounded-md border border-border p-1.5 flex flex-col gap-1 bg-card ${
        template.defaultHeaderAlign === "center" ? "items-center" : "items-start"
      }`}
    >
      {template.topBar && <div className="h-1 w-full rounded-sm bg-primary/70" />}
      {bar("50%", "bg-primary/50")}
      <div className={`w-full flex flex-col gap-1 ${align}`}>
        {bar("100%")}
        {bar("85%")}
        {template.heading === "bar" ? bar("70%", "bg-primary/40 border-l-2 border-primary pl-0.5") : bar("70%", "bg-primary/40")}
        {bar("95%")}
      </div>
    </div>
  );
}
