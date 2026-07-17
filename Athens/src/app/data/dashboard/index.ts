import { CheckCircle, Bot, Video, Sparkles, Mail, Briefcase } from "lucide-react";

export const ACTIVITIES = [
  { icon: CheckCircle, c: "text-emerald-600", t: "Offer received from Meta for Engineering Lead role", ts: "2h ago" },
  { icon: Briefcase, c: "text-violet-600", t: "Job Scout found 12 new matches on LinkedIn", ts: "3h ago" },
  { icon: Video, c: "text-blue-600", t: "Notion interview scheduled for tomorrow 2 PM", ts: "4h ago" },
  { icon: Bot, c: "text-amber-600", t: "Follow-up Agent sent 3 follow-up emails", ts: "5h ago" },
  { icon: Mail, c: "text-pink-600", t: "Recruiter replied to your Stripe application", ts: "1d ago" },
  { icon: Sparkles, c: "text-violet-600", t: "Resume Optimizer improved match score +12% for OpenAI", ts: "1d ago" },
];

export const AI_RECS = [
  { t: "Vercel role is a 94% match. Tailor your resume to highlight design system experience.", a: "Tailor resume →", c: "text-violet-600" },
  { t: "No response from Stripe in 12 days. Follow-up Agent can draft a polite nudge.", a: "Draft follow-up →", c: "text-amber-600" },
  { t: "Notion interview tomorrow. Interview Prep Agent has a custom plan ready.", a: "Start prep →", c: "text-blue-600" },
];
