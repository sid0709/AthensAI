# AthensAI Engineering Rules

Read this file before changing this repository. Treat these rules as acceptance criteria for implementation, prompts, and review.

## 1. Prefer data and contracts over hardcoding

- Do not encode job-specific technologies, vendors, skills, industries, employers, or keyword allowlists/denylists in application code or prompts.
- Derive behavior from structured inputs, schemas, explicit user decisions, and reusable linguistic or validation rules.
- Keep one source of truth for each rule. Do not duplicate large prompt policies across steps when the server can inject a shared policy block.
- Hardcoded protocol constants, UI labels, status values, and schema field names are acceptable when they define the product contract rather than domain vocabulary.

## 2. Resume truth

- The saved career profile is authoritative for employers, dates, titles, education, career history, responsibilities, and achievements. Never invent facts.
- Skills and Experience content come from the configured generation prompts plus the profile and job description. Do not inject a Skill Coverage closed set, and do not post-process Skills to strip or force bolded canonical terms.
- Experience must stay credible and grounded in profile roles. Prefer integrating skills into concrete tasks or workflows rather than keyword dumps or standalone keyword-list bullets.
- Every authoritative career entry must appear exactly once, in profile order, with at least one substantive bullet grounded in that role. An empty employer heading is never a valid generated Experience section.
- Do not invent employer-specific metrics, project names, internal systems, team size, ownership, or achievements that are not supported by the profile.

## 3. Generation follows the configured prompt pipeline

- Generate runs the configured section steps (Summary, Skills, Experience in parallel by purpose; fine-tunes sequential within a purpose) and saves their final structured outputs.
- Do not auto-run Skill Coverage analysis before generation, and do not fail generation because coverage decisions are missing.
- Generation may fail for transport, model, schema-parsing, cancellation, or persistence errors.
- Keep generation plans inspectable with fully resolved prompt tokens so the UI shows the actual model request.

## 4. State boundaries

- `Profile` and `ResumeConfig` are reusable persistent state.
- Job description, generated sections, progress, usage, and errors belong to an application run.
- Refreshing the Resume Generator starts a clean application run and loads only Profile and ResumeConfig.
- Completed or historical runs may be loaded only through an explicit History action; they must not silently repopulate the editor or preview after refresh.

## 5. Change discipline

- Preserve unrelated user changes in the working tree.
- Prefer small, composable functions and concise prompts. Additional model steps require a distinct quality purpose; step count alone is not quality.
- Keep frontend and backend defaults synchronized when both define the same product behavior.
