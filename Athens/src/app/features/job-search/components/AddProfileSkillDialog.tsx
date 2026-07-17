import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { UserSkillCategory } from "../hooks/useProfileMatchSkills";
import { CATEGORY_ORDER, normalizeSkillCategory } from "../../resumes/lib/skillCategories";

export type PendingProfileSkill = {
  name: string;
  category: UserSkillCategory;
  level: number;
};

const CATEGORY_META: Record<UserSkillCategory, { label: string }> = {
  hard: { label: "Hard skills" },
  devops: { label: "DevOps" },
  tools: { label: "Tools" },
  domain: { label: "Domain" },
  soft: { label: "Soft skills" },
};

const LEVELS = [1, 2, 3, 4, 5] as const;

type AddProfileSkillPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSkill: PendingProfileSkill;
  onConfirm: (skill: PendingProfileSkill) => void | Promise<void>;
  saving?: boolean;
};

export function AddProfileSkillPanel({
  open,
  onOpenChange,
  initialSkill,
  onConfirm,
  saving = false,
}: AddProfileSkillPanelProps) {
  const [draft, setDraft] = useState(initialSkill.name);
  const [category, setCategory] = useState<UserSkillCategory>(initialSkill.category);
  const [level, setLevel] = useState(initialSkill.level);

  useEffect(() => {
    if (open) {
      setDraft(initialSkill.name);
      setCategory(initialSkill.category);
      setLevel(initialSkill.level);
    }
  }, [open, initialSkill.name, initialSkill.category, initialSkill.level]);

  if (!open) return null;

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !saving;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    await onConfirm({
      name: trimmed,
      category,
      level,
    });
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={() => !saving && onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-profile-skill-title"
        className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-profile-skill-title" className="text-lg font-semibold">
          Add to your profile?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Save this skill with category and proficiency level. It will be used for future job match scores.
        </p>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-skill-draft">Skill name</Label>
            <Input
              id="profile-skill-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. C#, Vue.js, Communication"
              disabled={saving}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  void handleConfirm();
                }
              }}
            />
            {initialSkill.name && trimmed.toLowerCase() !== initialSkill.name.trim().toLowerCase() ? (
              <p className="text-xs text-muted-foreground">
                From job requirement: <span className="font-medium text-foreground">{initialSkill.name}</span>
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="profile-skill-category">Category</Label>
              <select
                id="profile-skill-category"
                value={category}
                onChange={(e) => setCategory(normalizeSkillCategory(e.target.value))}
                disabled={saving}
                className="h-10 w-full rounded-md border border-border bg-secondary/60 px-2 text-sm text-foreground outline-none focus:border-primary/40"
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-skill-level">Level (1–5)</Label>
              <select
                id="profile-skill-level"
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
                disabled={saving}
                className="h-10 w-full rounded-md border border-border bg-secondary/60 px-2 text-sm text-foreground outline-none focus:border-primary/40"
              >
                {LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    Level {lv}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void handleConfirm()}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Adding…
              </>
            ) : (
              "Add to profile"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function pendingSkillFromJobRequirement(
  name: string,
  category?: string,
  requirement?: number,
): PendingProfileSkill {
  const req = Number(requirement);
  const level =
    Number.isFinite(req) && req >= 1 && req <= 5 ? Math.round(req) : 3;
  return {
    name: name.trim(),
    category: normalizeSkillCategory(category),
    level,
  };
}
