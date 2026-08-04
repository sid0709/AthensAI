import type { Job } from "../types";

// Fixtures are the sole source of job-domain vocabulary in the MVP. UI behavior
// depends only on the Job contract and never branches on these values.
export const MOCK_JOBS = [
  {
    id: "job-001",
    title: "Senior Product Designer",
    company: "Northstar Works",
    location: "Austin, TX",
    workMode: "Hybrid",
    employmentType: "Full-time",
    seniority: "Senior level",
    salary: "Undisclosed",
    experience: "",
    postedAt: "2026-08-03",
    skills: ["Product design", "Research"],
    tags: [],
    applicantsText: "",
    description: "Join a small product group focused on making everyday workflows feel calm, predictable, and useful. You will partner closely with research, product, and engineering from early discovery through launch.",
    responsibilities: [
      "Turn customer needs into clear interaction models and polished product experiences.",
      "Facilitate design reviews and communicate decisions across the product team.",
      "Improve shared patterns so new experiences remain consistent and accessible."
    ],
    qualifications: [
      "Experience designing end-to-end digital product experiences.",
      "A portfolio that demonstrates systems thinking and strong visual craft.",
      "Clear written and verbal communication in collaborative environments."
    ],
    applyUrl: "https://example.com/jobs/job-001"
  },
  {
    id: "job-002",
    title: "Customer Operations Lead",
    company: "Cedar & Coast",
    location: "Remote — US",
    workMode: "Remote",
    employmentType: "Full-time",
    seniority: "Lead",
    salary: "Undisclosed",
    experience: "",
    postedAt: "2026-08-02",
    skills: ["Customer operations"],
    tags: [],
    applicantsText: "",
    description: "Lead the systems and rituals that help a growing customer team deliver timely, personal support. You will clarify priorities, coach teammates, and surface recurring customer needs.",
    responsibilities: [
      "Create simple operating rhythms for intake, prioritization, and follow-through.",
      "Coach team members and establish useful service-quality feedback loops.",
      "Share recurring themes with product and business partners."
    ],
    qualifications: [
      "Experience leading a customer-facing operations function.",
      "Comfort improving ambiguous processes through practical iteration.",
      "Strong judgment, empathy, and written communication."
    ],
    applyUrl: "https://example.com/jobs/job-002"
  },
  {
    id: "job-003",
    title: "Research Program Manager",
    company: "Fieldnote Studio",
    location: "New York, NY",
    workMode: "Hybrid",
    employmentType: "Full-time",
    seniority: "Mid level",
    salary: "Undisclosed",
    experience: "",
    postedAt: "2026-07-31",
    skills: ["Program management", "Research operations"],
    tags: [],
    applicantsText: "",
    description: "Coordinate a portfolio of research initiatives that inform product and organizational decisions. You will make complex timelines visible and create an excellent experience for participants and partners.",
    responsibilities: [
      "Plan research programs, schedules, participant logistics, and communication.",
      "Maintain shared documentation and keep cross-functional partners aligned.",
      "Identify operational improvements that increase research quality and reach."
    ],
    qualifications: [
      "Experience coordinating multi-part programs with several stakeholders.",
      "Excellent organization and attention to participant experience.",
      "Ability to communicate tradeoffs and keep work moving through ambiguity."
    ],
    applyUrl: "https://example.com/jobs/job-003"
  },
  {
    id: "job-004",
    title: "Finance Operations Manager",
    company: "Juniper House",
    location: "Chicago, IL",
    workMode: "On-site",
    employmentType: "Full-time",
    seniority: "Manager",
    salary: "Undisclosed",
    experience: "",
    postedAt: "2026-07-29",
    skills: ["Financial operations"],
    tags: [],
    applicantsText: "",
    description: "Own core planning and reporting workflows while helping leaders understand the story behind the numbers. This role combines careful execution with practical process design.",
    responsibilities: [
      "Coordinate recurring planning, reporting, and reconciliation workflows.",
      "Develop clear operating reports for leaders across the organization.",
      "Document controls and improve handoffs between business teams."
    ],
    qualifications: [
      "Experience managing financial or business operations.",
      "Strong analytical judgment and attention to detail.",
      "Ability to translate complex information into clear recommendations."
    ],
    applyUrl: "https://example.com/jobs/job-004"
  },
  {
    id: "job-005",
    title: "People Experience Partner",
    company: "Common Thread",
    location: "Remote — Americas",
    workMode: "Remote",
    employmentType: "Full-time",
    seniority: "Mid level",
    salary: "Undisclosed",
    experience: "",
    postedAt: "2026-07-27",
    skills: ["People operations"],
    tags: [],
    applicantsText: "",
    description: "Partner with managers and team members to strengthen everyday employee experiences. You will guide practical programs, listen carefully, and turn feedback into durable improvements.",
    responsibilities: [
      "Advise managers on team health, growth conversations, and change.",
      "Run people programs with clear communication and reliable follow-through.",
      "Synthesize employee feedback into practical recommendations."
    ],
    qualifications: [
      "Experience supporting managers and employees in a growing organization.",
      "Sound judgment and care when handling sensitive information.",
      "A collaborative, service-oriented approach to solving problems."
    ],
    applyUrl: "https://example.com/jobs/job-005"
  },
  {
    id: "job-006",
    title: "Content Strategy Director",
    company: "Brightwell Collective",
    location: "Los Angeles, CA",
    workMode: "Hybrid",
    employmentType: "Full-time",
    seniority: "Director",
    salary: "Undisclosed",
    experience: "",
    postedAt: "2026-07-25",
    skills: ["Content strategy", "Editorial direction"],
    tags: [],
    applicantsText: "",
    description: "Lead content strategy from narrative foundations through everyday customer touchpoints. You will align contributors around a coherent voice and help teams make complex ideas easy to understand.",
    responsibilities: [
      "Define editorial principles and guide their use across customer experiences.",
      "Coach contributors and create lightweight review practices.",
      "Partner with leaders to translate business priorities into clear narratives."
    ],
    qualifications: [
      "Experience setting content strategy across multiple channels.",
      "A strong editorial point of view grounded in audience needs.",
      "Skill leading through influence and constructive feedback."
    ],
    applyUrl: "https://example.com/jobs/job-006"
  },
  {
    id: "job-007",
    title: "Workplace Programs Coordinator",
    company: "Morrow & Lane",
    location: "Seattle, WA",
    workMode: "On-site",
    employmentType: "Full-time",
    seniority: "Coordinator",
    salary: "Undisclosed",
    experience: "",
    postedAt: "2026-07-22",
    skills: ["Workplace operations"],
    tags: [],
    applicantsText: "",
    description: "Coordinate the details that make the workplace reliable and inclusive. You will support daily operations, team gatherings, and relationships with external partners.",
    responsibilities: [
      "Coordinate workplace services, supplies, schedules, and partner requests.",
      "Plan inclusive team gatherings and communicate logistics clearly.",
      "Track recurring needs and propose practical improvements."
    ],
    qualifications: [
      "Experience coordinating workplace, hospitality, or community programs.",
      "Excellent organization and calm follow-through.",
      "A welcoming communication style and service mindset."
    ],
    applyUrl: "https://example.com/jobs/job-007"
  },
  {
    id: "job-008",
    title: "Business Planning Associate",
    company: "Pine & Harbor",
    location: "Boston, MA",
    workMode: "Hybrid",
    employmentType: "Full-time",
    seniority: "Associate",
    salary: "Undisclosed",
    experience: "",
    postedAt: "2026-07-20",
    skills: ["Business analysis", "Planning"],
    tags: [],
    applicantsText: "",
    description: "Support leaders with research, planning, and cross-functional initiatives. You will bring structure to ambiguous questions and communicate findings in a concise, decision-ready way.",
    responsibilities: [
      "Build clear analyses for planning and operating decisions.",
      "Coordinate focused projects across business functions.",
      "Prepare concise updates that surface decisions, risks, and next steps."
    ],
    qualifications: [
      "Experience in business analysis, planning, or program coordination.",
      "Strong written communication and quantitative reasoning.",
      "Curiosity and comfort learning unfamiliar business contexts."
    ],
    applyUrl: "https://example.com/jobs/job-008"
  }
] as const satisfies readonly Job[];
