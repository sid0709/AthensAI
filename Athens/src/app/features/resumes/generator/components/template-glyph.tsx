import type { TemplateDef } from "../types";

export function TemplateGlyph({ template }: { template: TemplateDef }) {
  const bar = (w: string, c = "bg-neutral-300 dark:bg-white/20") => (
    <div className={`h-1 rounded-sm ${c}`} style={{ width: w }} />
  );
  if (template.columns === 2) {
    const side = (
      <div
        className={`w-1/3 rounded-sm flex flex-col gap-1 p-1 ${
          template.sidebarTint ? "bg-sky-200/70 dark:bg-sky-500/20" : "bg-neutral-100 dark:bg-white/5"
        }`}
      >
        {bar("80%")}
        {bar("60%")}
        {bar("70%")}
      </div>
    );
    const main = (
      <div className="flex-1 flex flex-col gap-1 p-1">
        {bar("70%", "bg-sky-400/70")}
        {bar("100%")}
        {bar("90%")}
        {bar("95%")}
      </div>
    );
    return (
      <div className="h-12 rounded-md border border-neutral-200 dark:border-white/10 p-1.5 flex gap-1 bg-white dark:bg-neutral-800">
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
      className={`h-12 rounded-md border border-neutral-200 dark:border-white/10 p-1.5 flex flex-col gap-1 bg-white dark:bg-neutral-800 ${
        template.defaultHeaderAlign === "center" ? "items-center" : "items-start"
      }`}
    >
      {bar("50%", "bg-sky-400/70")}
      <div className={`w-full flex flex-col gap-1 ${align}`}>
        {bar("100%")}
        {bar("85%")}
        {bar("70%", "bg-sky-400/70")}
        {bar("95%")}
      </div>
    </div>
  );
}
