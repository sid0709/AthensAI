import React from "react";
import { Briefcase, GraduationCap, Plus, Sparkles, Trash2 } from "lucide-react";
import { AthensInput, AthensSelect, AthensTextarea } from "../../../components/forms";
import { cn } from "../../../lib/utils";
import { CAREER_END_MONTH_OPTIONS, MONTH_OPTIONS } from "../../../data/settings/profileConstants";
import type { CareerEntry, EducationEntry } from "../../../data/settings/profile";

function timelineSortKey(row: { startYear: string; startMonth: string }) {
  const y = parseInt(row.startYear, 10) || 0;
  const m = parseInt(row.startMonth, 10) || 0;
  return y * 12 + m;
}

function formatEducationPeriod(row: Pick<EducationEntry, "startMonth" | "startYear" | "endMonth" | "endYear">) {
  const sm = row.startMonth?.trim();
  const sy = row.startYear?.trim();
  const startPart = sy && sm ? `${sy}.${sm}` : sy || (sm ? `?.${sm}` : "…");
  const em = row.endMonth?.trim();
  const ey = row.endYear?.trim();
  if (!em && !ey) return `${startPart} - present`;
  const endPart = ey && em ? `${ey}.${em}` : ey || (em ? `?.${em}` : "…");
  return `${startPart} - ${endPart}`;
}

function formatCareerPeriod(row: Pick<CareerEntry, "startMonth" | "startYear" | "endMonth" | "endYear" | "endPresent">) {
  const sm = row.startMonth?.trim();
  const sy = row.startYear?.trim();
  const startPart = sy && sm ? `${sy}.${sm}` : sy || (sm ? `?.${sm}` : "…");
  if (row.endPresent) return `${startPart} - present`;
  const em = row.endMonth?.trim();
  const ey = row.endYear?.trim();
  const endPart = ey && em ? `${ey}.${em}` : ey || (em ? `?.${em}` : "…");
  return `${startPart} - ${endPart}`;
}

type TimelineItem =
  | { kind: "education"; index: number; data: EducationEntry }
  | { kind: "career"; index: number; data: CareerEntry };

function DateRow({
  startMonth,
  startYear,
  endMonth,
  endYear,
  endPresent,
  onChange,
  allowPresent,
}: {
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
  endPresent?: boolean;
  onChange: (p: { startMonth?: string; startYear?: string; endMonth?: string; endYear?: string; endPresent?: boolean }) => void;
  allowPresent?: boolean;
}) {
  const endMonthValue = allowPresent && endPresent ? "present" : endMonth || "";
  const disabledEnd = allowPresent && endPresent;

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Start</p>
        <div className="grid grid-cols-2 gap-1.5">
          <AthensSelect size="sm" value={startMonth || ""} onChange={(v) => onChange({ startMonth: v })} options={[...MONTH_OPTIONS]} placeholder="Mo" />
          <AthensInput
            inputMode="numeric"
            placeholder="Yr"
            maxLength={4}
            value={startYear}
            onChange={(e) => onChange({ startYear: e.target.value.replace(/\D/g, "").slice(0, 4) })}
            className="h-9 text-xs"
          />
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">End</p>
        <div className="grid grid-cols-2 gap-1.5">
          <AthensSelect
            size="sm"
            value={endMonthValue}
            onChange={(v) => {
              if (allowPresent && v === "present") onChange({ endPresent: true, endMonth: "", endYear: "" });
              else onChange({ endPresent: false, endMonth: v });
            }}
            options={allowPresent ? [...CAREER_END_MONTH_OPTIONS] : [...MONTH_OPTIONS]}
            placeholder="Mo"
          />
          <AthensInput
            inputMode="numeric"
            placeholder={disabledEnd ? "—" : "Yr"}
            maxLength={4}
            disabled={disabledEnd}
            value={disabledEnd ? "" : endYear}
            onChange={(e) => onChange({ endYear: e.target.value.replace(/\D/g, "").slice(0, 4), endPresent: false })}
            className={cn("h-9 text-xs", disabledEnd && "opacity-45 cursor-not-allowed")}
          />
        </div>
      </div>
    </div>
  );
}

function TimelineNode({
  item,
  isLast,
  educationCount,
  careerCount,
  onUpdateEducation,
  onUpdateCareer,
  onRemoveEducation,
  onRemoveCareer,
}: {
  item: TimelineItem;
  isLast: boolean;
  educationCount: number;
  careerCount: number;
  onUpdateEducation: (index: number, patch: Partial<EducationEntry>) => void;
  onUpdateCareer: (index: number, patch: Partial<CareerEntry>) => void;
  onRemoveEducation: (index: number) => void;
  onRemoveCareer: (index: number) => void;
}) {
  const isEducation = item.kind === "education";
  const Icon = isEducation ? GraduationCap : Briefcase;
  const period = isEducation ? formatEducationPeriod(item.data) : formatCareerPeriod(item.data);
  const isCurrent = !isEducation && item.data.endPresent;
  const headline = isEducation
    ? item.data.school.trim() || item.data.diploma.trim() || "Education"
    : item.data.title.trim() || item.data.company.trim() || "Role";

  return (
    <div className="relative flex gap-3">
      <div className="flex flex-col items-center shrink-0 w-9">
        <div
          className={cn(
            "w-9 h-9 rounded-full grid place-items-center z-10 shadow-sm",
            isEducation ? "bg-violet-500/15 text-violet-600" : "bg-primary/15 text-primary",
          )}
        >
          <Icon className="w-4 h-4" />
        </div>
        {!isLast && <div className="w-px flex-1 min-h-[12px] bg-border mt-1" />}
      </div>

      <div className="flex-1 min-w-0 rounded-xl border border-border bg-secondary/20 p-3 mb-3">
        <div className="flex items-start gap-2 mb-2 min-w-0">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{headline}</p>
            <p className="text-[10px] font-mono tabular-nums text-muted-foreground mt-0.5">{period}</p>
          </div>
          {isCurrent && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-medium shrink-0">
              Current
            </span>
          )}
          <button
            type="button"
            className="icon-btn text-muted-foreground hover:text-destructive w-7 h-7 shrink-0 disabled:opacity-30"
            disabled={isEducation ? educationCount <= 1 : careerCount <= 1}
            onClick={() => (isEducation ? onRemoveEducation(item.index) : onRemoveCareer(item.index))}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {isEducation ? (
          <div className="space-y-2">
            <AthensInput placeholder="School" value={item.data.school} onChange={(e) => onUpdateEducation(item.index, { school: e.target.value })} className="h-9 text-xs" />
            <AthensInput placeholder="Degree" value={item.data.diploma} onChange={(e) => onUpdateEducation(item.index, { diploma: e.target.value })} className="h-9 text-xs" />
            <DateRow
              startMonth={item.data.startMonth}
              startYear={item.data.startYear}
              endMonth={item.data.endMonth}
              endYear={item.data.endYear}
              onChange={(p) => onUpdateEducation(item.index, p)}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <AthensInput placeholder="Company" value={item.data.company} onChange={(e) => onUpdateCareer(item.index, { company: e.target.value })} className="h-9 text-xs" />
            <AthensInput placeholder="Title" value={item.data.title} onChange={(e) => onUpdateCareer(item.index, { title: e.target.value })} className="h-9 text-xs" />
            <AthensTextarea
              placeholder="Product, domain, project, or responsibilities…"
              value={item.data.description}
              onChange={(e) => onUpdateCareer(item.index, { description: e.target.value })}
              rows={3}
              className="text-xs min-h-[72px]"
            />
            <DateRow
              startMonth={item.data.startMonth}
              startYear={item.data.startYear}
              endMonth={item.data.endMonth}
              endYear={item.data.endYear}
              endPresent={item.data.endPresent}
              allowPresent
              onChange={(p) => onUpdateCareer(item.index, p)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function CareerTimeline({
  education,
  careers,
  onAddEducation,
  onAddCareer,
  onUpdateEducation,
  onUpdateCareer,
  onRemoveEducation,
  onRemoveCareer,
}: {
  education: EducationEntry[];
  careers: CareerEntry[];
  onAddEducation: () => void;
  onAddCareer: () => void;
  onUpdateEducation: (index: number, patch: Partial<EducationEntry>) => void;
  onUpdateCareer: (index: number, patch: Partial<CareerEntry>) => void;
  onRemoveEducation: (index: number) => void;
  onRemoveCareer: (index: number) => void;
}) {
  const items: TimelineItem[] = [
    ...education.map((data, index) => ({ kind: "education" as const, index, data })),
    ...careers.map((data, index) => ({ kind: "career" as const, index, data })),
  ].sort((a, b) => timelineSortKey(b.data) - timelineSortKey(a.data));

  return (
    <section className="w-full rounded-xl border border-border bg-card overflow-hidden shadow-sm xl:sticky xl:top-6">
      <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-primary/5 via-violet-500/5 to-transparent">
        <div className="flex items-center gap-2 min-w-0 mb-2">
          <div className="w-8 h-8 rounded-xl bg-primary/10 grid place-items-center shrink-0">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground">Career timeline</h3>
            <p className="text-[10px] text-muted-foreground">Most recent first</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onAddEducation}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-violet-500/25 bg-violet-500/10 text-[11px] text-violet-700 dark:text-violet-300 font-semibold hover:bg-violet-500/15"
          >
            <Plus className="w-3 h-3" />
            Education
          </button>
          <button
            type="button"
            onClick={onAddCareer}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-primary/25 bg-primary/10 text-[11px] text-primary font-semibold hover:bg-primary/15"
          >
            <Plus className="w-3 h-3" />
            Role
          </button>
        </div>
      </div>

      <div className="p-3 max-h-[calc(100vh-10rem)] overflow-y-auto subtle-scroll">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Add education or work history.</p>
        ) : (
          items.map((item, index) => (
            <TimelineNode
              key={`${item.kind}-${item.index}`}
              item={item}
              isLast={index === items.length - 1}
              educationCount={education.length}
              careerCount={careers.length}
              onUpdateEducation={onUpdateEducation}
              onUpdateCareer={onUpdateCareer}
              onRemoveEducation={onRemoveEducation}
              onRemoveCareer={onRemoveCareer}
            />
          ))
        )}
      </div>
    </section>
  );
}
