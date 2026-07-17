/** MIME type for dragging a Gmail label onto mail rows */
export const MAIL_LABEL_DRAG_MIME = "application/x-mail-label";

export function getDraggedLabelPath(dataTransfer: DataTransfer): string | null {
  const raw =
    dataTransfer.getData(MAIL_LABEL_DRAG_MIME) || dataTransfer.getData("text/plain");
  const path = String(raw || "").trim();
  return path || null;
}
