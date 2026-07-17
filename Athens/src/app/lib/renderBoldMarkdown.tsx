export function renderBoldMarkdown(content: string) {
  return content.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*.*?\*\*)/g);
    return (
      <p key={i} className={i > 0 && line ? "mt-2" : i > 0 ? "mt-1" : ""}>
        {parts.map((pt, j) =>
          pt.startsWith("**") && pt.endsWith("**") ? (
            <strong key={j} className="font-bold text-foreground">
              {pt.slice(2, -2)}
            </strong>
          ) : (
            pt
          )
        )}
      </p>
    );
  });
}
