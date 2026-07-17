import type { ActionableTree } from "@avalon/shared";
import type { FieldActionPlan, FlatFormField } from "./types";

export const FORM_ACTION_PLAN_SYSTEM_PROMPT = `You are a job-application automation planner. You receive form fields scraped from a live application page and must output an executable action plan for each field.

For every field id, return:
- action: one of Click | Typing | SelectOption | FileUpload | Check | Uncheck
- shouldSkip: Yes | No
- value: the literal value to use, or "N/A" when not applicable
- notes: brief rationale (use "" if none)

Action rules by controlType:
- text / textarea → Typing, value = the text to enter (a real, complete answer — never a placeholder).
  - Open-ended / essay / "describe" / "challenge" / "why" / cover-letter style questions: COMPOSE a substantive, genuine answer from the profile and the job description. Respect any stated max length (e.g. "1 page"). Do NOT skip — a blank required essay fails submission.
  - Only shouldSkip a text/textarea field when it is clearly optional AND no reasonable answer can be written from the profile/job context.
- combobox (autocomplete input, including location/city fields) → ALWAYS Typing — type a short searchable prefix from profile (e.g. "New York" not the full option string), never SelectOption. Options in the payload are hints only; automation types, waits for suggestions, then confirms with keyboard.
- native select element (controlTag select) → SelectOption with EXACT option label
- checkbox → Check or Uncheck, value = "checked" or "unchecked"
- Multi-select checkbox groups (groupContext like "Select all that apply", skill/interest questions):
  - Evaluate each checkbox individually — shouldSkip No for nearly all options in the group
  - Check options that match the candidate's careers, title, diploma, and reasonable skills for a software engineer
  - Uncheck only options clearly unrelated — never skip the whole group with "no profile data"
  - Use groupContext + option label together (e.g. "What do you want to work on?" → Check Backend/Frontend for a full-stack engineer)
- radio → Click (select that option), value = N/A
- button → Click, value = N/A. Primary in-flow navigation buttons (Apply, Apply for, Submit, Continue, Next, Proceed, Start application, Review and submit) MUST use shouldSkip No — they advance to or through the application; never skip them just because text fields are not on this screen yet.
  - Exception — final form submit (Submit Application, Send application on a filled form): shouldSkip Yes; the executor auto-clicks submit after all fields are filled.
  - Exception — exit / reverse navigation (back to jobs/listings/search, cancel application, return, close, previous page): shouldSkip Yes; the goal is to complete and submit this application, never leave it.
- Single-select option groups (radio options, or Yes/No and segmented <button> options that SHARE the same groupContext): these are ONE question split into multiple option fields. You MUST select EXACTLY ONE option per group — shouldSkip No on the chosen option and shouldSkip Yes on every OTHER option in that same group. Never leave all options in a group skipped, and never mark more than one as shouldSkip No.
  - Choose the option that matches the profile (e.g. sponsorship Yes/No from profile.sponsorship).
  - If the profile has no direct answer, still answer when the question is required (asterisk / "required") or clearly expects a choice: pick the most reasonable, low-risk answer for a qualified applicant from the groupContext (e.g. authorized-to-work → Yes; require-sponsorship → No). Do not skip a required question for "no profile data".
- file → FileUpload, value = file purpose (e.g. "resume", "cover letter") — do not invent file bytes
- link → Click. shouldSkip No when the label/groupContext is in-application navigation (Apply, Apply for, Submit, Continue, Next, Proceed, Start application, Review and submit, Save and continue) — these open or advance the application form and MUST be clicked. shouldSkip Yes only for informational/external links (definitions, OFCCP, dol.gov, privacy policy, learn more, unrelated www/http URLs) that do not advance the application.

Resume / CV file upload (TOP PRIORITY — MANDATORY):
- Any field labeled Resume, CV, Resume/CV, or similar file upload is the highest-priority action on the form.
- Always action FileUpload with shouldSkip No — never skip Resume/CV even if the field appears optional.
- value = "resume" (or the exact label purpose). The automation attaches the candidate document separately.
- Cover letter file uploads: shouldSkip Yes — automation only supplies a tailored resume PDF, not a cover letter.
- Autofill-from-resume widgets (upload to autofill other fields): shouldSkip Yes — not the application resume field.

Application navigation (MUST click — shouldSkip No):
- Any button or link whose label clearly starts or continues the application (Apply, Apply for [job title], Continue, Next, Proceed, Start application, Review and submit). This includes job-posting pages that only show an Apply control before name/email fields appear.

Exit / reverse navigation (MUST skip — shouldSkip Yes):
- Any button or link that leaves the application or returns to browsing (back to jobs/listings/search results, cancel, close, return, previous page). Never click these — the purpose is to fill and submit this application.

Form submit (auto-handled — shouldSkip Yes):
- Submit Application / Send application / Finish on the filled application form: action=Click, shouldSkip=Yes. The executor auto-clicks submit after all fields are filled; include in the plan only for visibility.

ShouldSkip Yes when:
- Exit / reverse navigation that abandons the application (see above)
- Informational / disclosure / external links (definitions, OFCCP, dol.gov, learn more, company marketing pages off-site)
- Optional fields with no profile data and no sensible default (only if truly skippable)
- The NON-chosen options of a single-select group (exactly one option per group stays shouldSkip No)
- NEVER for Resume/CV file uploads
- NEVER for all checkboxes in a "select all that apply" group — pick Check/Uncheck per option instead
- NEVER for ALL options of a single-select / Yes-No / radio group — that silently leaves the question unanswered; always pick one
- NEVER for a required free-text / textarea question (including open-ended essays and challenges) — compose an answer from profile + job description instead

ShouldSkip No for required fields and all real inputs that must be filled to submit. Treat every question as answerable: prefer making a sensible choice over skipping. Only skip when the field is genuinely optional AND there is no reasonable answer.

Profile (autoBidProfile): use exact values for firstName, lastName, email, phone, city, state, country,
linkedin, github, gender, demographic fields, sponsorship, etc. Map EEO dropdowns to closest listed option label.
Never use placeholder names like John Doe or johndoe@example.com when profile data is provided.

Return one entry per field id in the request. Use value "N/A" for Click actions and when shouldSkip is Yes.`;

const INFORMATIONAL_LINK_PATTERN =
  /\b(definition|definitions|learn more|ofccp|dol\.gov|privacy|policy|voluntary|disclosure|www\.|https?:\/\/)\b/i;

/** In-flow Apply / Submit / Continue controls — must reach the AI planner, never auto-skipped. */
const NAVIGATION_LABEL_PATTERN =
  /\b(apply(\s+(for|now|to|today))?|submit(\s+(application|my\s+application))?|continue|next(\s+step)?|proceed|start(\s+application)?|save(\s+and\s+continue)?|review(\s+and\s+submit)?)\b/i;

export function isSkippableField(field: FlatFormField): boolean {
  if (field.controlType !== "link") return false;
  const text = `${field.label} ${field.groupContext}`;
  if (NAVIGATION_LABEL_PATTERN.test(text)) return false;
  return INFORMATIONAL_LINK_PATTERN.test(text);
}

export function skipActionPlanEntry(field: FlatFormField): FieldActionPlan {
  const informational = INFORMATIONAL_LINK_PATTERN.test(`${field.label} ${field.groupContext}`);
  return {
    id: field.id,
    action: "Click",
    shouldSkip: "Yes",
    value: "N/A",
    notes: informational
      ? "Informational link — do not click; leaves the application page."
      : "Link — skip during autofill.",
  };
}

export function partitionFields(fields: FlatFormField[]): {
  actionable: FlatFormField[];
  skippable: FlatFormField[];
} {
  const actionable: FlatFormField[] = [];
  const skippable: FlatFormField[] = [];
  for (const field of fields) {
    if (isSkippableField(field)) {
      skippable.push({ ...field, skippable: true });
    } else {
      actionable.push(field);
    }
  }
  return { actionable, skippable };
}

export function isRequiredLabel(label: string): boolean {
  return /\*\s*$/.test(label.trim()) || label.includes("*");
}

export function flattenActionableTree(tree: ActionableTree): FlatFormField[] {
  const fields: FlatFormField[] = [];

  tree.forEach((group, groupIndex) => {
    group.children.forEach((entry, childIndex) => {
      fields.push({
        id: `${groupIndex}:${childIndex}`,
        groupIndex,
        childIndex,
        groupContext: group.content,
        label: entry.target.replace(/\*+\s*$/, "").trim(),
        // Free-text fields are always treated as mandatory: a blank text/textarea
        // is never the right outcome, so the AI must compose an answer (generic
        // control-type rule, not a label/vendor branch).
        required:
          isRequiredLabel(entry.target) ||
          entry.controlType === "text" ||
          entry.controlType === "textarea",
        controlType: entry.controlType,
        controlTag: entry.control.tag,
        options: entry.options?.map((o) => o.label).filter(Boolean),
        optionsSource: entry.optionsSource,
      });
    });
  });

  return fields;
}

export function buildAnalysisUserMessage(
  fields: FlatFormField[],
  applicantContext?: string,
  skippedCount = 0,
): string {
  const payload = {
    fieldCount: fields.length,
    fields: fields.map((f) => ({
      id: f.id,
      groupContext: f.groupContext,
      label: f.label,
      required: f.required,
      controlType: f.controlType,
      controlTag: f.controlTag,
      ...(f.options?.length ? { options: f.options } : {}),
    })),
  };

  const parts = [
    "Build an action plan (action, shouldSkip, value) for every field id below.",
    "Answer every question — do not leave any required field unanswered. Prefer a sensible choice over skipping.",
    "Single-select groups (Yes/No, radio, segmented buttons sharing a groupContext): pick EXACTLY ONE option (shouldSkip No) and shouldSkip Yes the rest. Never skip all options of such a group.",
    "Open-ended / essay / textarea questions (e.g. \"describe…\", \"challenge…\", \"why…\"): write a genuine, complete answer from the profile + job description; never skip them.",
    "EVERY text and textarea field is mandatory: action=Typing, shouldSkip=No, with a real composed value — never Click and never skip a text/textarea.",
    "Resume/CV file uploads are mandatory — must be FileUpload with shouldSkip No (top priority).",
    "Apply / Continue / Next buttons and links: action=Click, shouldSkip=No — required to reach or advance the application form.",
    "Exit / back navigation (back to jobs/listings, cancel, return, close): action=Click, shouldSkip=Yes — never leave the application.",
    "Submit Application on the filled form: action=Click, shouldSkip=Yes — auto-submit handles it after all fields are filled.",
    "Multi-select checkbox groups: shouldSkip No per option — Check skills that match profile careers/title.",
    "Combobox / location / autocomplete fields: action must be Typing (never SelectOption) — type profile city or filter text; Enter confirms after typing.",
    skippedCount > 0
      ? `(Note: ${skippedCount} informational link(s) omitted from this list — already marked shouldSkip Yes.)`
      : "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].filter(Boolean);

  if (applicantContext?.trim()) {
    parts.push("", "Applicant profile (MongoDB autoBidProfile):", "```json", applicantContext.trim(), "```");
  } else {
    parts.push("", "No applicant profile was provided — use realistic generic values where needed.");
  }

  return parts.join("\n");
}
