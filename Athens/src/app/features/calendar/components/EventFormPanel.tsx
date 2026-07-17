import React, { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { AthensInput, AthensSelect, AthensTextarea, DatePicker, FormField, TimePicker } from "../../../components/forms";
import { SlidePanel, SlidePanelHeader } from "../../../components/overlays";
import { cn } from "../../../lib/utils";
import { RESUMES } from "../../../data/resumes";
import {
  INTERVIEW_RESULTS,
  INTERVIEW_STEPS,
  RESULT_COLORS,
  RESULT_LABEL,
  STEP_LABEL,
  type CalendarEvent,
  type CalendarEventType,
  type InterviewResult,
  type InterviewStep,
} from "../../../data/calendar";

const NO_PROFILE = "__none__";

export type EventFormData = {
  title: string;
  type: CalendarEventType;
  company: string;
  profile: string;
  step: InterviewStep | "";
  result: InterviewResult;
  reason: string;
  date: Date | undefined;
  startTime: string;
  endTime: string;
  confirmed: boolean;
};

export function eventToForm(event: CalendarEvent): EventFormData {
  const d = new Date(event.start);
  return {
    title: event.title,
    type: event.type,
    company: event.company ?? "",
    profile: event.profile ? event.profile : NO_PROFILE,
    step: event.step ?? "",
    result: event.result ?? "pending",
    reason: event.reason ?? "",
    date: d,
    startTime: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).slice(0, 5),
    endTime: new Date(event.end).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).slice(0, 5),
    confirmed: event.confirmed ?? false,
  };
}

export function formToEvent(form: EventFormData, id?: string): CalendarEvent {
  const base = form.date ?? new Date();
  const [sh, sm] = form.startTime.split(":").map(Number);
  const [eh, em] = form.endTime.split(":").map(Number);
  const start = new Date(base);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(base);
  end.setHours(eh, em, 0, 0);

  return {
    id: id ?? `e-${Date.now()}`,
    title: form.title.trim() || "Untitled event",
    start: start.toISOString(),
    end: end.toISOString(),
    type: form.type,
    company: form.company.trim() || undefined,
    profile: form.profile !== NO_PROFILE ? form.profile : undefined,
    step: form.type === "interview" && form.step ? form.step : undefined,
    result: form.type === "interview" ? form.result : undefined,
    reason:
      form.type === "interview" && (form.result === "failed" || form.result === "ignored")
        ? form.reason.trim() || undefined
        : undefined,
    confirmed: form.confirmed,
  };
}

const EMPTY_FORM: EventFormData = {
  title: "",
  type: "interview",
  company: "",
  profile: NO_PROFILE,
  step: "intro",
  result: "scheduled",
  reason: "",
  date: new Date(),
  startTime: "10:00",
  endTime: "11:00",
  confirmed: false,
};

type EventFormPanelProps = {
  event: CalendarEvent | null;
  mode: "create" | "edit";
  open: boolean;
  onClose: () => void;
  onSave: (event: CalendarEvent) => void;
  onDelete?: (id: string) => void;
};

export function EventFormPanel({ event, mode, open, onClose, onSave, onDelete }: EventFormPanelProps) {
  const [form, setForm] = useState<EventFormData>(EMPTY_FORM);

  useEffect(() => {
    if (open) {
      setForm(event ? eventToForm(event) : { ...EMPTY_FORM, date: new Date() });
    }
  }, [open, event?.id, mode]);

  const patch = (p: Partial<EventFormData>) => setForm((f) => ({ ...f, ...p }));
  const isInterview = form.type === "interview";
  const needsReason = form.result === "failed" || form.result === "ignored";

  const handleSave = () => {
    onSave(formToEvent(form, event?.id));
    onClose();
  };

  const profileOptions = RESUMES.map((r) => ({ value: r.name, label: r.name }));

  return (
    <SlidePanel open={open} onOpenChange={(o) => !o && onClose()} width="md">
      <SlidePanelHeader
        title={mode === "create" ? "New event" : "Event details"}
        onClose={onClose}
        actions={
          mode === "edit" && event && onDelete ? (
            <button
              type="button"
              onClick={() => {
                onDelete(event.id);
                onClose();
              }}
              className="icon-btn text-muted-foreground hover:text-destructive w-9 h-9"
              aria-label="Delete event"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-auto p-5 space-y-4 subtle-scroll">
        <AthensInput
          value={form.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Event title"
        />
        <AthensSelect
          label="Type"
          value={form.type}
          onChange={(v) => patch({ type: v as CalendarEventType })}
          options={[
            { value: "interview", label: "Interview" },
            { value: "deadline", label: "Deadline" },
            { value: "followup", label: "Follow-up" },
          ]}
        />
        <AthensInput
          value={form.company}
          onChange={(e) => patch({ company: e.target.value })}
          placeholder="Company"
        />
        {isInterview && (
          <>
            <AthensSelect
              label="Profile / resume"
              value={form.profile}
              onChange={(v) => patch({ profile: v })}
              options={[{ value: NO_PROFILE, label: "— Select profile —" }, ...profileOptions]}
            />
            <AthensSelect
              label="Pipeline step"
              value={form.step}
              onChange={(v) => patch({ step: v as InterviewStep })}
              options={INTERVIEW_STEPS.map((s) => ({ value: s.value, label: s.label }))}
            />
            <AthensSelect
              label="Result"
              value={form.result}
              onChange={(v) => patch({ result: v as InterviewResult })}
              options={INTERVIEW_RESULTS.map((r) => ({ value: r.value, label: r.label }))}
            />
            <div
              className={cn(
                "rounded-xl px-4 py-2.5 text-sm font-semibold inline-block",
                RESULT_COLORS[form.result],
              )}
            >
              {RESULT_LABEL[form.result]}
              {form.step && ` · ${STEP_LABEL[form.step as InterviewStep]}`}
            </div>
            {needsReason && (
              <AthensTextarea
                value={form.reason}
                onChange={(e) => patch({ reason: e.target.value })}
                placeholder="Why did this fail or get ignored?"
                rows={3}
              />
            )}
          </>
        )}
        <DatePicker label="Date" value={form.date} onChange={(d) => patch({ date: d })} />
        <div className="grid grid-cols-2 gap-3">
          <TimePicker label="Start" value={form.startTime} onChange={(v) => patch({ startTime: v })} />
          <TimePicker label="End" value={form.endTime} onChange={(v) => patch({ endTime: v })} />
        </div>
        <FormField label="Confirmation">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.confirmed}
              onChange={(e) => patch({ confirmed: e.target.checked })}
              className="rounded border-border"
            />
            Time confirmed with recruiter
          </label>
        </FormField>
      </div>
      <div className="p-5 border-t border-border flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-border hover:bg-secondary min-h-10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10"
        >
          {mode === "create" ? "Create event" : "Save changes"}
        </button>
      </div>
    </SlidePanel>
  );
}
