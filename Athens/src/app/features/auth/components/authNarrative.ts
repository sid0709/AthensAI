export type AuthNarrativeScene = {
  code: string;
  title: string;
  body: string;
  metric: string;
  value: string;
};

export const AUTH_NARRATIVE_SCENES: readonly AuthNarrativeScene[] = [
  {
    code: "GALAXY / 01",
    title: "AthensAI is your career galaxy.",
    body: "A living map of opportunity, built to help you see the whole market—and your place within it.",
    metric: "CAREER GALAXY",
    value: "AWAKE",
  },
  {
    code: "STARS / 02",
    title: "Every job is a star.",
    body: "Across the market, each role shines as a possible destination. Athens brings the opportunity field into view.",
    metric: "OPPORTUNITY FIELD",
    value: "VISIBLE",
  },
  {
    code: "CONSTELLATIONS / 03",
    title: "Your skills reveal the constellations.",
    body: "Your experience connects the stars, uncovering patterns between who you are and where you can go next.",
    metric: "SKILL CONSTELLATIONS",
    value: "MAPPED",
  },
  {
    code: "NAVIGATE / 04",
    title: "Navigate with intelligence.",
    body: "Athens turns a crowded sky into clear routes, so you can move with direction instead of guesswork.",
    metric: "NAVIGATION ENGINE",
    value: "ACTIVE",
  },
  {
    code: "ROUTE / 05",
    title: "Choose the star worth chasing.",
    body: "Compare the paths, understand the distance, and focus your energy on the opportunities that matter.",
    metric: "ROUTE SYSTEM",
    value: "READY",
  },
  {
    code: "CONQUER / 06",
    title: "Conquer your next star.",
    body: "Athens gives you the power to move from possibility to opportunity—and make the next destination yours.",
    metric: "MISSION CONTROL",
    value: "YOURS",
  },
];
