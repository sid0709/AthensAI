import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchResumeTemplatePreviewImages, type ResumeTemplatePreviewPage } from "@/app/services/resumeApi";
import type { GeneratedContent } from "../types";
import { uploadedTemplateMongoId } from "../types";

const LETTER_WIDTH_PX = 816;
const LETTER_HEIGHT_PX = 1056;

export function UploadedTemplatePreview({
  templateId,
  ownerName,
  generated,
  generating,
}: {
  templateId: string;
  ownerName: string | null | undefined;
  generated: GeneratedContent | null;
  generating?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pages, setPages] = useState<ResumeTemplatePreviewPage[]>([]);

  const pageWidth = pages[0]?.width || LETTER_WIDTH_PX;

  const sections = useMemo(() => {
    if (!generated) return {};
    return {
      summary: { summary: generated.summary },
      skills: { skills: generated.skills },
      experience: { experiences: generated.experience },
    };
  }, [generated]);

  const sectionsKey = useMemo(() => JSON.stringify(sections), [sections]);

  useEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, Math.max(0.1, el.clientWidth / pageWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageWidth]);

  useEffect(() => {
    if (!ownerName || !templateId) {
      setPages([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      setPages([]);
      void fetchResumeTemplatePreviewImages({
        templateId,
        ownerName,
        sections: sectionsKey === "{}" ? {} : JSON.parse(sectionsKey),
      })
        .then((res) => {
          if (cancelled) return;
          setPages(res.pages);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
          setPages([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ownerName, templateId, sectionsKey]);

  const mongoId = uploadedTemplateMongoId(templateId);
  const docHeight = pages.reduce((sum, page, index) => {
    const gap = index === 0 ? 0 : 16;
    return sum + gap + (page.height || LETTER_HEIGHT_PX) * scale;
  }, 0);

  return (
    <div className="rounded-xl bg-neutral-200/70 dark:bg-black/40 p-4 overflow-auto max-h-[80vh] w-full">
      <div ref={fitRef} className="w-full flex justify-center min-h-[200px]">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-white/50 py-16">
            <Loader2 className="w-4 h-4 animate-spin" />
            Rendering template preview…
          </div>
        )}
        {!loading && error && (
          <div className="text-sm text-rose-500 py-16 text-center max-w-md">
            Could not render template preview: {error}
          </div>
        )}
        <div
          className={pages.length && !error ? "block" : "hidden"}
          style={{
            width: Math.ceil(pageWidth * scale),
            minHeight: Math.ceil(docHeight || LETTER_HEIGHT_PX * scale),
          }}
        >
          <div className="flex flex-col gap-4">
            {pages.map((page, index) => {
              const width = page.width || LETTER_WIDTH_PX;
              const height = page.height || LETTER_HEIGHT_PX;
              return (
                <img
                  key={index}
                  alt={`Resume preview page ${index + 1}`}
                  className="block bg-white shadow-[0_16px_44px_rgba(15,23,42,0.18)]"
                  src={`data:${page.mimeType || "image/png"};base64,${page.dataBase64}`}
                  style={{
                    width: Math.ceil(width * scale),
                    height: Math.ceil(height * scale),
                  }}
                />
              );
            })}
          </div>
        </div>
        {!loading && !error && !pages.length && (
          <div className="text-sm text-neutral-500 dark:text-white/50 py-16">
            {generating ? "Generating content…" : "Template preview will appear here."}
          </div>
        )}
      </div>
      <p className="text-[11px] text-neutral-400 dark:text-white/40 mt-2 text-center">
        Preview rendered from your uploaded DOCX template
        {mongoId ? ` (${mongoId.slice(0, 8)}…)` : ""}. Word export uses the same fill pipeline.
      </p>
    </div>
  );
}
