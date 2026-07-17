export const QUESTIONS = [
  { cat: "System Design", diff: "Hard", q: "Design a rate limiter for a distributed API gateway handling 10M req/s. Walk through your approach, trade-offs, and failure modes." },
  { cat: "Technical", diff: "Medium", q: "How would you optimize a React app rendering 10,000+ list items? Describe your profiling strategy and the solutions you'd apply." },
  { cat: "Behavioral", diff: "Medium", q: "Tell me about a time you drove a significant technical decision without direct authority. What was the outcome?" },
  { cat: "System Design", diff: "Hard", q: "Design a real-time collaborative editing system. Focus on conflict resolution, consistency guarantees, and latency." },
  { cat: "Culture", diff: "Easy", q: "Describe your ideal engineering culture. How do you actively contribute to building it?" },
  { cat: "Technical", diff: "Hard", q: "Walk me through how browsers render a webpage from network request to painted pixels. Where would you look for performance bottlenecks?" },
];

export const DIFFICULTY_VARIANTS: Record<string, "err" | "warn" | "success"> = {
  Hard: "err",
  Medium: "warn",
  Easy: "success",
};

export const PREP_PLANS = [
  { role: "Notion — Product Manager", rounds: 4, next: "Tomorrow 2 PM" },
  { role: "Anthropic — Senior Frontend", rounds: 3, next: "Jun 25" },
  { role: "Meta — Engineering Lead", rounds: 5, next: "Offer call Jun 22" },
];

export const SCORECARDS = [
  { company: "Notion", role: "Product Manager", scores: [["Technical", 85], ["Communication", 88], ["Problem Solving", 82], ["Culture Fit", 90]] as [string, number][], overall: 86 },
  { company: "Anthropic", role: "Senior Frontend", scores: [["Technical", 91], ["Communication", 84], ["System Design", 88], ["Culture Fit", 87]] as [string, number][], overall: 88 },
];
