import { useEffect, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  CheckCircle2,
  Chrome,
  Download,
  Puzzle,
  Sparkles,
  Unplug,
} from "lucide-react";
import { PageShell } from "../../components/layout/PageShell";
import { display } from "../../lib/utils";
import { APPS_CATALOG, type AppPlugin, type DownloadsManifest } from "./catalog";

const INSTALL_STEPS = [
  {
    title: "Download the zip",
    body: "Grab Bid Monitor or Project Avalon from the cards below. Each build ships with the VPS release.",
  },
  {
    title: "Unzip on your machine",
    body: "Extract the archive — you’ll load the unpacked folder, not the zip itself.",
  },
  {
    title: "Load unpacked in Chrome",
    body: "Open chrome://extensions → enable Developer mode → Load unpacked → select the folder.",
  },
];

function accentClasses(accent: AppPlugin["accent"]) {
  if (accent === "teal") {
    return {
      glow: "from-teal-500/25 via-cyan-400/10 to-transparent",
      chip: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
      btn: "from-teal-600 to-cyan-600 shadow-teal-500/25 hover:shadow-teal-500/35",
      ring: "ring-teal-500/20",
      orb: "bg-teal-400/30",
    };
  }
  return {
    glow: "from-indigo-500/25 via-violet-400/10 to-transparent",
    chip: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300",
    btn: "from-indigo-600 to-violet-600 shadow-indigo-500/25 hover:shadow-indigo-500/35",
    ring: "ring-indigo-500/20",
    orb: "bg-indigo-400/30",
  };
}

function AppCard({
  app,
  liveVersion,
  index,
}: {
  app: AppPlugin;
  liveVersion?: string;
  index: number;
}) {
  const a = accentClasses(app.accent);
  const version = liveVersion ?? app.version;

  return (
    <motion.article
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.15 + index * 0.1, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-[1.75rem] border border-border/80 bg-card shadow-[var(--shadow-lg)] ring-1 ${a.ring}`}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${a.glow}`} />
      <div className={`pointer-events-none absolute -top-16 -right-10 h-44 w-44 rounded-full blur-3xl ${a.orb}`} />

      <div className="relative p-6 sm:p-7 flex flex-col h-full gap-5">
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/40 to-transparent blur-sm" />
            <img
              src={app.iconSrc}
              alt=""
              className="relative w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] rounded-2xl object-cover shadow-md ring-1 ring-black/5 dark:ring-white/10"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-foreground" style={display}>
                {app.name}
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-secondary text-[11px] font-bold text-muted-foreground mono">
                v{version}
              </span>
            </div>
            <p className="text-sm font-medium text-muted-foreground">{app.tagline}</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">{app.description}</p>

        <div className="flex flex-wrap gap-1.5">
          {app.badges.map((b) => (
            <span key={b} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${a.chip}`}>
              {b}
            </span>
          ))}
        </div>

        <ul className="space-y-2">
          {app.highlights.map((h) => (
            <li key={h} className="flex items-start gap-2 text-sm text-foreground/90">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <span>{h}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-1">
          <a
            href={app.downloadUrl}
            download
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r ${a.btn} text-white text-sm font-bold shadow-md transition-shadow`}
          >
            <Download className="w-4 h-4" />
            Download zip
          </a>
          {app.pairsWith && (
            <Link
              to={app.pairsWith.href}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              Open {app.pairsWith.label}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export function AppsPluginsPage() {
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [builtAt, setBuiltAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/downloads/manifest.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DownloadsManifest | null) => {
        if (cancelled || !data?.extensions) return;
        const map: Record<string, string> = {};
        for (const ext of data.extensions) map[ext.id] = ext.version;
        setVersions(map);
        if (data.builtAt) setBuiltAt(data.builtAt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageShell fullWidth className="bg-background">
      <div className="relative overflow-hidden">
        {/* Hero */}
        <section className="relative min-h-[280px] sm:min-h-[320px]">
          <img
            src="/apps/avalon-banner.png"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a1020]/55 via-[#0a1020]/70 to-background" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(99,102,241,0.35),transparent_55%)]" />

          <div className="relative px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-12 max-w-[1100px] mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4 max-w-2xl"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white/90 text-xs font-bold tracking-wide">
                <Puzzle className="w-3.5 h-3.5" />
                Apps & Plugins
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              </div>
              <h1
                className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold text-white tracking-tight leading-[1.15]"
                style={display}
              >
                Athens
              </h1>
              <p className="text-lg sm:text-xl font-semibold text-white/90 tracking-tight" style={display}>
                Tools that plug into your browser
              </p>
              <p className="text-sm sm:text-base text-white/70 leading-relaxed max-w-xl">
                Download the Chrome extensions built with every deploy. Load them in developer mode —
                not the Chrome Web Store — and pair them with Bid Ready & Agents.
              </p>
              {builtAt && (
                <p className="text-xs text-white/50 font-medium">
                  Latest pack from deploy · {new Date(builtAt).toLocaleString()}
                </p>
              )}
            </motion.div>
          </div>
        </section>

        <div className="px-4 sm:px-6 lg:px-8 pb-14 max-w-[1100px] mx-auto space-y-10 -mt-2">
          {/* Install steps */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="grid sm:grid-cols-3 gap-3"
          >
            {INSTALL_STEPS.map((step, i) => (
              <div
                key={step.title}
                className="relative rounded-2xl border border-border bg-card/80 backdrop-blur-sm px-4 py-4 shadow-[var(--shadow-sm)]"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="w-7 h-7 rounded-lg bg-primary/12 text-primary text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <h3 className="text-sm font-bold text-foreground">{step.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed pl-[2.375rem]">
                  {step.body}
                </p>
              </div>
            ))}
          </motion.section>

          {/* App cards */}
          <section className="grid lg:grid-cols-2 gap-5">
            {APPS_CATALOG.map((app, index) => (
              <AppCard key={app.id} app={app} liveVersion={versions[app.id]} index={index} />
            ))}
          </section>

          {/* Footnote */}
          <motion.aside
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="rounded-2xl border border-dashed border-border bg-secondary/40 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Chrome className="w-4 h-4 text-muted-foreground" />
              Developer mode only
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground flex-1 leading-relaxed">
              These builds are private team artifacts from the Docker → VPS pipeline. They are not
              published to the Chrome Web Store. After updates deploy, re-download the zip and reload
              the unpacked extension.
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground shrink-0">
              <Unplug className="w-3.5 h-3.5" />
              Load unpacked
            </div>
          </motion.aside>
        </div>
      </div>
    </PageShell>
  );
}
