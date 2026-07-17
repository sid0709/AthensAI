import { Sparkles, Target, TrendingUp } from "lucide-react";
import { AppLogo } from "../../../components/shared/AppLogo";
import { display } from "../../../lib/utils";

const FEATURES = [
  {
    icon: Target,
    title: "Smart job matching",
    body: "Rank roles by skill fit, salary, freshness, and competition — all from your live MongoDB pipeline.",
  },
  {
    icon: Sparkles,
    title: "AI skill graph",
    body: "Analyze postings on demand. DeepSeek enrichment grows your Neo4j knowledge graph job by job.",
  },
  {
    icon: TrendingUp,
    title: "One command center",
    body: "Resumes, applications, interview prep, and analytics — unified under your signed-in profile.",
  },
];

export function AuthHeroPanel() {
  return (
    <div className="relative hidden min-h-0 overflow-hidden bg-[#0d0b18] text-white lg:block">
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 20% 40%, rgba(108,92,231,0.45) 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 80% 80%, rgba(45,212,191,0.2) 0%, transparent 50%), linear-gradient(145deg, #0d0b18 0%, #1a1530 50%, #0f172a 100%)",
        }}
      />

      <svg
        className="absolute inset-0 w-full h-full opacity-[0.12]"
        aria-hidden
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1200 900"
      >
        <defs>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="1200" height="900" fill="url(#grid)" />
        <circle cx="920" cy="180" r="120" fill="none" stroke="#8b78f0" strokeWidth="1.5" strokeDasharray="8 6" />
        <circle cx="920" cy="180" r="80" fill="none" stroke="#2dd4bf" strokeWidth="1" opacity="0.6" />
        <path
          d="M 180 620 Q 400 420 620 520 T 980 380"
          fill="none"
          stroke="#6c5ce7"
          strokeWidth="2"
          opacity="0.5"
        />
        <g opacity="0.35">
          <rect x="140" y="200" width="200" height="130" rx="16" fill="#6c5ce7" />
          <rect x="380" y="280" width="180" height="110" rx="14" fill="#2dd4bf" />
          <rect x="560" y="160" width="220" height="140" rx="18" fill="#8b78f0" />
        </g>
      </svg>

      <div className="relative z-10 flex h-full min-h-0 w-full max-w-3xl flex-col justify-between overflow-y-auto p-12 xl:p-16">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-semibold mb-8">
            <AppLogo size={20} className="rounded-md" />
            AthensAI · Career command center
          </div>
          <h1 className="text-4xl xl:text-5xl font-bold leading-[1.1] tracking-tight mb-4" style={display}>
            Land your next role with AI that knows your skills.
          </h1>
          <p className="text-lg text-white/65 max-w-xl leading-relaxed">
            Sign in to connect your profile, DeepSeek API key, and job pipeline. Every analyze action runs under
            your account.
          </p>
        </div>

        <ul className="space-y-5 mt-10">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-violet-300" />
              </div>
              <div>
                <p className="font-bold text-white/95">{title}</p>
                <p className="text-sm text-white/55 mt-0.5 leading-relaxed">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-xs text-white/35 mt-12">Your AI API key is loaded from account_info after sign-in.</p>
      </div>
    </div>
  );
}
