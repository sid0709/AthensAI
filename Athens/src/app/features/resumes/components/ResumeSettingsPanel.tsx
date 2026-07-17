import { useEffect, useState } from "react";
import { CheckCircle, Save, AlertCircle } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useResumeStacks } from "../hooks/useResumeStacks";
import { StackStatsCards } from "./stacks/StackStatsCards";
import { StackRadarChart } from "./stacks/StackRadarChart";
import {
  getIdentityProfile,
  saveIdentityProfile,
  getRefinementPipelines,
  saveRefinementPipelines,
} from "../../../services/resumeStorage";
import { loadDefaultIdentity } from "../../../services/resumeProfileBridge";
import type { ResumeIdentity } from "../../../types/resume";
import { DEFAULT_REFINEMENT_STEPS } from "../../../data/resumes/seedDocument";

const STACK_COLORS = ["#6c5ce7", "#2dd4bf", "#f59e0b", "#ec4899", "#3b82f6", "#10b981"];

type ResumeSettingsSection = "all" | "identity" | "stacks" | "pipeline";

export function ResumeSettingsPanel({ section = "all" }: { section?: ResumeSettingsSection }) {
  const stacks = useResumeStacks();
  const [identity, setIdentity] = useState<ResumeIdentity | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadDefaultIdentity().then(setIdentity);
  }, []);

  const show = (part: ResumeSettingsSection) => section === "all" || section === part;

  const handleSaveIdentity = async () => {
    if (!identity) return;
    await saveIdentityProfile(identity);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveStacks = async () => {
    const ok = await stacks.save();
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleResetPipeline = async () => {
    const pipelines = await getRefinementPipelines();
    const updated = pipelines.map((p) =>
      p.isDefault ? { ...p, steps: DEFAULT_REFINEMENT_STEPS.map((s) => ({ ...s })) } : p
    );
    await saveRefinementPipelines(updated);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {show("stacks") && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-foreground mb-1">Resume stacks</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Paste JSON from an external resume catalog. Each top-level key is a resume stack; nested keys are skills scored 0–10.
          </p>
          <textarea
            value={stacks.jsonText}
            onChange={(e) => stacks.setJsonText(e.target.value)}
            rows={12}
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm font-mono outline-none focus:border-primary/40"
          />
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <button type="button" onClick={stacks.validate} className="bg-secondary border border-border px-4 py-2 rounded-xl text-sm font-bold hover:text-foreground min-h-10">
              Validate
            </button>
            <button type="button" onClick={handleSaveStacks} className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10 flex items-center gap-2">
              <Save className="w-4 h-4" />Save
            </button>
            {stacks.valid ? (
              <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-semibold">
                <CheckCircle className="w-4 h-4" />Valid catalog — preview updates live below.
              </span>
            ) : stacks.error ? (
              <span className="flex items-center gap-1.5 text-sm text-destructive font-semibold">
                <AlertCircle className="w-4 h-4" />{stacks.error}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {show("stacks") && !stacks.loading && stacks.valid && (
        <>
          <StackStatsCards
            stackCount={stacks.stats.stackCount}
            skillEntries={stacks.stats.skillEntries}
            avgSkillsPerStack={stacks.stats.avgSkillsPerStack}
          />

          {stacks.featuredStack && (
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <h4 className="text-lg font-bold text-foreground mb-1">{stacks.featuredStack}</h4>
              <p className="text-sm text-muted-foreground mb-4">
                {Object.keys(stacks.catalog[stacks.featuredStack]).length} skills · Avg{" "}
                {stacks.stackCards.find((c) => c.name === stacks.featuredStack)?.avg}/10
              </p>
              <StackRadarChart stackName={stacks.featuredStack} catalog={stacks.catalog} height={280} />
            </div>
          )}

          <div className="flex gap-4 overflow-x-auto pb-2 scroll-row">
            {stacks.stackCards.map((card, i) => (
              <button
                key={card.name}
                type="button"
                onClick={() => stacks.setFeaturedStack(card.name)}
                className={cn(
                  "flex-shrink-0 w-56 bg-card border rounded-xl p-4 text-left transition-all shadow-sm",
                  stacks.featuredStack === card.name ? "border-primary ring-2 ring-primary/20" : "border-border hover:shadow-md"
                )}
              >
                <p className="text-sm font-bold text-foreground truncate">{card.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{card.skillCount} skills · Avg {card.avg}/10</p>
                <StackRadarChart
                  stackName={card.name}
                  catalog={stacks.catalog}
                  height={100}
                  compact
                  color={STACK_COLORS[i % STACK_COLORS.length]}
                />
              </button>
            ))}
          </div>
        </>
      )}

      {show("identity") && identity && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-foreground mb-1">Default identity profile</h3>
          <p className="text-sm text-muted-foreground mb-4">Used when you click Reload profile in the Editor.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(
              [
                ["fullName", "Full Name"],
                ["location", "Location"],
                ["email", "Email"],
                ["phone", "Phone"],
                ["linkedin", "LinkedIn"],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className={field === "linkedin" ? "sm:col-span-2" : ""}>
                <label className="text-sm font-semibold text-muted-foreground block mb-1.5">{label}</label>
                <input
                  value={identity[field]}
                  onChange={(e) => setIdentity({ ...identity, [field]: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-primary/40 min-h-10"
                />
              </div>
            ))}
          </div>
          <button type="button" onClick={handleSaveIdentity} className="mt-5 bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10">
            Save identity
          </button>
        </div>
      )}

      {show("pipeline") && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-foreground mb-2">Saved refinement pipelines</h3>
          <p className="text-sm text-muted-foreground mb-4">Default pipeline is used in the Resume Editor.</p>
          <button type="button" onClick={handleResetPipeline} className="bg-secondary border border-border px-4 py-2 rounded-xl text-sm font-bold hover:text-foreground min-h-10">
            Reset default pipeline
          </button>
        </div>
      )}

      {saved && (
        <p className="text-sm text-emerald-600 font-semibold fixed bottom-6 right-6 bg-card border border-emerald-200 px-4 py-2 rounded-xl shadow-lg">
          Saved successfully
        </p>
      )}
    </div>
  );
}
