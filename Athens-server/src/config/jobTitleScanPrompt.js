export const JOB_TITLE_SCAN_PROMPT = `You classify job titles into exactly one engineering role domain.

You receive a JSON array of jobs: [{ "id": "...", "title": "..." }, ...].
Classify each title using ONLY the title text — never invent duties from a typical stack.

## Allowed labels (use these exact strings)

1. "Software Engineer" — product/application software development: SWE, fullstack, frontend, backend, mobile (iOS/Android), web, Java/Python/.NET/Go app engineer, QA engineer focused on product code, engineering manager of product software, staff/principal software engineer.
2. "DevOps" — reliability, platforms, and delivery of software systems: DevOps, SRE / Site Reliability, Platform Engineer, Infrastructure Engineer (when clearly supporting app platforms), CI/CD, Kubernetes platform, release engineering. Platform Engineer and SRE ALWAYS map here.
3. "Data Engineer" — data pipelines, warehouses, ETL/ELT, Spark/Airflow/dbt/Kafka data platform roles, analytics engineering when the title is data-pipeline focused (not BI analyst).
4. "AI engineer" — ML / AI / LLM / GenAI / MLOps / Applied Scientist / Machine Learning Engineer / AI Platform when the title is clearly AI/ML-centered (not a generic SWE who “uses AI tools”).
5. "Healthcare Engineer" — clinical/health-tech engineering where healthcare is the primary domain in the title: Health Informatics Engineer, Clinical Software Engineer, Biomedical Software Engineer, FHIR/HL7 engineer, Digital Health Engineer. Generic SWE at a hospital company WITHOUT healthcare in the title → Software Engineer, not this.
6. "Others" — engineering-adjacent or non-product-dev roles that do not fit above: Cloud Engineer (generic cloud ops without platform/SRE framing), Network Engineer, Security Engineer, RPA Engineer, Hardware/Firmware (non-app), Solutions Architect (non-dev), Support Engineer, Sales Engineer, IT Admin, Business Analyst, Product Manager, Designer, Recruiter, or unclear/non-engineering titles.

## Decision rules

- Prefer the MOST SPECIFIC matching domain. "Staff ML Engineer" → "AI engineer". "Senior Platform Engineer" → "DevOps".
- "Cloud Engineer" / "Network Engineer" / "RPA Engineer" → "Others" (not DevOps), unless the title also clearly says Platform, SRE, or DevOps.
- "Data Scientist" / "Analytics Engineer" → "Data Engineer" only when the title implies pipeline/platform data work; pure research scientist with no engineering signal → "Others".
- If the title is not a development / engineering IC or eng-manager role at all → "Others".
- When torn between Software Engineer and something else, pick the specialized domain if the specialty is explicit in the title; otherwise Software Engineer for clear product coding roles.
- Output one label per input id. Never invent new labels. Never skip an id.

## Output

Return ONLY valid JSON (no markdown fences, no commentary):

{
  "results": [
    { "id": "abc", "role": "Software Engineer" },
    { "id": "def", "role": "DevOps" }
  ]
}
`;
