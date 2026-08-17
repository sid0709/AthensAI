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
        <p className="athens-eyebrow mb-1">Start</p>
        <div className="grid grid-cols-2 gap-1.5">
          <AthensSelect
            size="sm"
            tone="lens"
            value={startMonth || ""}
            onChange={(v) => onChange({ startMonth: v })}
            options={[...MONTH_OPTIONS]}
            placeholder="Mo"
          />
          <AthensInput
            inputMode="numeric"
            placeholder="Yr"
            maxLength={4}
            value={startYear}
            onChange={(e) => onChange({ startYear: e.target.value.replace(/\D/g, "").slice(0, 4) })}
          />
        </div>
      </div>
      <div>
        <p className="athens-eyebrow mb-1">End</p>
        <div className="grid grid-cols-2 gap-1.5">
          <AthensSelect
            size="sm"
            tone="lens"
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
            className={cn(disabledEnd && "opacity-45 cursor-not-allowed")}
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
    <div className="athens-settings__timeline-node">
      <div className="athens-settings__timeline-rail">
        <div className="athens-settings__timeline-dot">
          <Icon size={16} aria-hidden="true" />
        </div>
        {!isLast && <div className="athens-settings__timeline-line" />}
      </div>

      <div className="athens-settings__timeline-item">
        <div className="flex items-start gap-2 mb-2 min-w-0">
          <div className="flex-1 min-w-0">
            <p className="athens-card-title truncate">{headline}</p>
            <p className="athens-card-meta mt-0.5" style={{ fontFamily: "var(--font-athens-mono)" }}>{period}</p>
          </div>
          {isCurrent && <span className="athens-status shrink-0">Current</span>}
          <button
            type="button"
            className="athens-icon-btn"
            style={{ width: 32, height: 32, minHeight: 32 }}
            disabled={isEducation ? educationCount <= 1 : careerCount <= 1}
            onClick={() => (isEducation ? onRemoveEducation(item.index) : onRemoveCareer(item.index))}
            aria-label={isEducation ? "Remove education" : "Remove role"}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>

        {isEducation ? (
          <div className="space-y-2">
            <AthensInput placeholder="School" value={item.data.school} onChange={(e) => onUpdateEducation(item.index, { school: e.target.value })} />
            <AthensInput placeholder="Degree" value={item.data.diploma} onChange={(e) => onUpdateEducation(item.index, { diploma: e.target.value })} />
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
            <AthensInput placeholder="Company" value={item.data.company} onChange={(e) => onUpdateCareer(item.index, { company: e.target.value })} />
            <AthensInput placeholder="Title" value={item.data.title} onChange={(e) => onUpdateCareer(item.index, { title: e.target.value })} />
            <AthensTextarea
              placeholder="Product, domain, project, or responsibilities…"
              value={item.data.description}
              onChange={(e) => onUpdateCareer(item.index, { description: e.target.value })}
              rows={3}
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
    <section className="athens-card athens-settings__timeline xl:sticky xl:top-6">
      <div className="athens-settings__timeline-head">
        <div className="flex items-center gap-2 min-w-0">
          <span className="athens-settings__timeline-dot">
            <Sparkles size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="athens-card-title">Career timeline</h3>
            <p className="athens-card-meta">Most recent first</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onAddEducation} className="athens-btn flex-1">
            <Plus size={14} aria-hidden="true" />
            Education
          </button>
          <button type="button" onClick={onAddCareer} className="athens-btn flex-1">
            <Plus size={14} aria-hidden="true" />
            Role
          </button>
        </div>
      </div>

      <div className="athens-settings__timeline-body subtle-scroll">
        {items.length === 0 ? (
          <p className="athens-settings__empty">Add education or work history.</p>
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
