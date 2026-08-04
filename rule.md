# AthensAI Engineering Rules

Read this file before changing this repository. Treat these rules as acceptance criteria for implementation, prompts, and review.

## 1. Prefer data and contracts over hardcoding

- Do not encode job-specific technologies, vendors, skills, industries, employers, or keyword allowlists/denylists in application code or prompts.
- Derive behavior from structured inputs, schemas, explicit user decisions, and reusable linguistic or validation rules.
- Keep one source of truth for each rule. Do not duplicate large prompt policies across steps when the server can inject a shared coverage contract.
- Hardcoded protocol constants, UI labels, status values, and schema field names are acceptable when they define the product contract rather than domain vocabulary.

## 2. Resume truth and skill coverage

- The saved career profile is authoritative for employers, dates, titles, education, career history, responsibilities, and achievements. Never invent facts.
- Skill Coverage is authoritative for the canonical skill name, priority, decision, and permitted placement.
- `Used` skills may appear in Experience and Skills when assigned by the coverage contract.
- `Familiar only` skills may appear in Skills, but must not be represented as hands-on Experience.
- `Not used` skills must be omitted.
- Every required placement must use the exact canonical skill spelling and bold its first meaningful occurrence as `**Canonical Skill**`.
- Experience must integrate required skills into credible work: a concrete task or workflow, the skill's technical function, and its practical purpose. Never satisfy coverage with a keyword dump or a standalone keyword-list bullet.
- Every authoritative career entry must appear exactly once, in profile order, with at least one substantive bullet grounded in that role. An empty employer heading is never a valid generated Experience section.
- Prefer one or two target skills per Experience bullet. Do not repeatedly force the same workflow across employers.
- Do not infer related products, frameworks, projects, ownership, metrics, or achievements merely from a target keyword.

## 3. Generation follows the configured prompt pipeline

- Generate analyzes Skill Coverage when it is missing or stale, runs the configured section steps, and saves their final structured outputs.
- Skill Coverage is injected into the model context as generation guidance. Do not run a post-generation coverage audit, quality gate, or model repair pass.
- Generation may fail for transport, model, schema-parsing, cancellation, or persistence errors, but must not fail because a generated keyword placement differs from Skill Coverage guidance.
- Keep generation plans inspectable with fully resolved prompt tokens so the UI shows the actual model request.

## 4. State boundaries

- `Profile` and `ResumeConfig` are reusable persistent state.
- Job description, Skill Coverage analysis and decisions, generated sections, progress, usage, and errors belong to an application run.
- Refreshing the Resume Generator starts a clean application run and loads only Profile and ResumeConfig.
- Completed or historical runs may be loaded only through an explicit History action; they must not silently repopulate the editor or preview after refresh.

## 5. Change discipline

- Preserve unrelated user changes in the working tree.
- Prefer small, composable functions and concise prompts. Additional model steps require a distinct quality purpose; step count alone is not quality.
- Keep frontend and backend defaults synchronized when both define the same product behavior.
