export const AREA_DATA = [
  { m: "Jan", apps: 8, responses: 2, interviews: 1, offers: 0 },
  { m: "Feb", apps: 12, responses: 4, interviews: 2, offers: 0 },
  { m: "Mar", apps: 10, responses: 3, interviews: 2, offers: 1 },
  { m: "Apr", apps: 15, responses: 6, interviews: 3, offers: 1 },
  { m: "May", apps: 18, responses: 7, interviews: 4, offers: 1 },
  { m: "Jun", apps: 22, responses: 9, interviews: 5, offers: 2 },
];

export const SRC_DATA = [
  { src: "LinkedIn", apps: 18, responses: 6, rate: 33.3 },
  { src: "Referral", apps: 8, responses: 5, rate: 62.5 },
  { src: "Direct", apps: 6, responses: 3, rate: 50.0 },
  { src: "Indeed", apps: 10, responses: 2, rate: 20.0 },
  { src: "AngelList", apps: 5, responses: 1, rate: 20.0 },
];

export const ROLE_PIE = [
  { name: "Frontend", v: 42, c: "#6c5ce7" },
  { name: "Full Stack", v: 28, c: "#2dd4bf" },
  { name: "ML/AI", v: 18, c: "#f59e0b" },
  { name: "DevOps", v: 8, c: "#f472b6" },
  { name: "Other", v: 4, c: "#60a5fa" },
];

export const HEATMAP_DATA = [
  { day: "Mon", h6: 1, h9: 4, h12: 2, h15: 5, h18: 3, h21: 1 },
  { day: "Tue", h6: 0, h9: 5, h12: 3, h15: 6, h18: 4, h21: 2 },
  { day: "Wed", h6: 2, h9: 6, h12: 4, h15: 7, h18: 5, h21: 1 },
  { day: "Thu", h6: 1, h9: 4, h12: 5, h15: 8, h18: 6, h21: 3 },
  { day: "Fri", h6: 0, h9: 3, h12: 2, h15: 4, h18: 2, h21: 0 },
  { day: "Sat", h6: 0, h9: 1, h12: 1, h15: 2, h18: 1, h21: 0 },
  { day: "Sun", h6: 0, h9: 2, h12: 1, h15: 1, h18: 0, h21: 0 },
];

export const VELOCITY_SERIES = [
  { w: "W1", response: 5.2, interview: 12, offer: 28 },
  { w: "W2", response: 4.8, interview: 10, offer: 25 },
  { w: "W3", response: 4.5, interview: 9, offer: 22 },
  { w: "W4", response: 4.2, interview: 8, offer: 20 },
  { w: "W5", response: 3.9, interview: 7, offer: 18 },
  { w: "W6", response: 3.5, interview: 6, offer: 15 },
];

export const COHORT_DATA = [
  { m: "Jan", c1: 100, c2: 45, c3: 22 },
  { m: "Feb", c1: 100, c2: 48, c3: 25 },
  { m: "Mar", c1: 100, c2: 52, c3: 28 },
  { m: "Apr", c1: 100, c2: 55, c3: 32 },
  { m: "May", c1: 100, c2: 58, c3: 35 },
  { m: "Jun", c1: 100, c2: 62, c3: 38 },
];

export const STAGE_OVER_TIME = [
  { m: "Jan", applied: 8, screening: 3, interview: 1, offer: 0 },
  { m: "Feb", applied: 12, screening: 5, interview: 2, offer: 0 },
  { m: "Mar", applied: 10, screening: 4, interview: 2, offer: 1 },
  { m: "Apr", applied: 15, screening: 7, interview: 3, offer: 1 },
  { m: "May", applied: 18, screening: 8, interview: 4, offer: 1 },
  { m: "Jun", applied: 22, screening: 10, interview: 5, offer: 2 },
];

export const DIVERSITY_DATA = [
  { name: "Asian", v: 35, c: "#6c5ce7" },
  { name: "White", v: 28, c: "#2dd4bf" },
  { name: "Hispanic", v: 18, c: "#f59e0b" },
  { name: "Black", v: 12, c: "#f472b6" },
  { name: "Other", v: 7, c: "#60a5fa" },
];

export const COST_DATA = [
  { src: "LinkedIn", cost: 42 },
  { src: "Referral", cost: 0 },
  { src: "Direct", cost: 15 },
  { src: "Indeed", cost: 28 },
  { src: "AngelList", cost: 12 },
];

export const OFFER_SCATTER = [
  { match: 72, likelihood: 12, company: "Startup A" },
  { match: 85, likelihood: 28, company: "Mid Co" },
  { match: 91, likelihood: 45, company: "Stripe" },
  { match: 94, likelihood: 62, company: "Vercel" },
  { match: 88, likelihood: 38, company: "Figma" },
  { match: 96, likelihood: 71, company: "OpenAI" },
];

export const SOURCE_RADAR = [
  { metric: "Volume", LinkedIn: 9, Referral: 5, Direct: 4 },
  { metric: "Response rate", LinkedIn: 6, Referral: 10, Direct: 8 },
  { metric: "Interview rate", LinkedIn: 5, Referral: 9, Direct: 7 },
  { metric: "Offer rate", LinkedIn: 4, Referral: 8, Direct: 6 },
  { metric: "Speed", LinkedIn: 7, Referral: 9, Direct: 8 },
];
