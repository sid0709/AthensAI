import { AUTH_NARRATIVE_SCENES } from "../auth/components/authNarrative";

export const LANDING_CHAPTERS = AUTH_NARRATIVE_SCENES;

export const LANDING_MODULES = [
  {
    title: "Job Search",
    body: "See the market as a living map of opportunity and spend your energy on the roles worth chasing.",
  },
  {
    title: "Resumes",
    body: "Keep a career profile that stays true, then generate resumes that follow from it.",
  },
  {
    title: "Mail",
    body: "Keep conversations next to the search so outreach and replies stay in one place.",
  },
  {
    title: "Bid Management",
    body: "Follow each application from first signal through to the outcome.",
  },
  {
    title: "Analytics",
    body: "See how the search is moving, not just that it is busy.",
  },
  {
    title: "Apps & Plugins",
    body: "Bring focused tools into the same workspace when you need them.",
  },
] as const;
