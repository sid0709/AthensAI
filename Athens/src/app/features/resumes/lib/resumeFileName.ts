/** Download name from the résumé identity: keep the full name, including spaces. */
export function resumeDownloadFileName(fullName: string | null | undefined): string {
  const base = String(fullName ?? "").trim() || "resume";
  const safe = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "resume";
  return safe.toLowerCase().endsWith(".docx") ? safe : `${safe}.docx`;
}
