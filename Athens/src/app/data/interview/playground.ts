export const DEFAULT_SYSTEM_PROMPT = `You are an expert interview coach helping a software engineer prepare for technical and behavioral interviews.

Provide structured, actionable guidance:
- Key talking points
- Common pitfalls to avoid
- Sample STAR stories when relevant
- Technical concepts to review

Be concise but thorough.`;

export const MOCK_OUTPUTS: Record<string, string> = {
  default: `## Interview Prep Summary

**Focus areas for today:**
1. Review the company's recent product launches and engineering blog posts
2. Prepare 2–3 STAR stories highlighting leadership and technical depth
3. Practice system design: rate limiting, caching, and API design

**Sample opening:** "I'm excited about this role because it combines my experience in React performance optimization with the team's mission to build developer tools at scale."

**Questions to ask them:**
- How does the team balance shipping velocity with code quality?
- What does success look like in the first 90 days?`,

  notion: `## Notion PM Interview — Prep Plan

**Company context:** Notion's recent AI features and collaboration tools are central to their roadmap.

**Round focus (Product Sense):**
- Walk through a feature you'd improve in Notion
- Discuss metrics you'd track (DAU, retention, time-to-value)
- Show structured thinking: problem → users → solutions → trade-offs

**Behavioral:** Prepare a story about influencing without authority — PM interviews weight this heavily.

**Time check:** Interview at 2:00 PM — arrive mentally 15 min early for warm-up.`,
};

export function buildSystemFromInterview(company: string, role: string, time: string): string {
  return `${DEFAULT_SYSTEM_PROMPT}

## Current interview context
- **Company:** ${company}
- **Role:** ${role}
- **Scheduled:** ${time}
- **Candidate:** Jordan Doe — Senior Frontend Engineer with 6+ years experience

Tailor all advice specifically to this company and role. Include company-specific talking points.`;
}
