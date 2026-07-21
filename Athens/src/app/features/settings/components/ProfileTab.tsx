import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { ThemeToggle } from "../../../components/shared/ThemeToggle";
import { emptyCareer, emptyEducation, emptyProfile, type UserProfile } from "../../../data/settings/profile";
import {
  clearVendorAccessPassword,
  fetchAutoBidProfile,
  refreshGeneratedResumesIdentityStream,
  type RefreshResumesProgress,
  saveAutoBidProfile,
  setVendorAccessPassword,
  testLlmKey,
} from "../../../services/profileApi";
import { isAdminPermission } from "../../../lib/admin";
import { isBetaTier } from "../../../lib/beta";
import { ProfileBanner, VendorAccessRow } from "./ProfileBanner";
import {
  ProfileDisclosuresCard,
  ProfileIdentityCard,
  ProfileJobBidCard,
  type KeyCheck,
} from "./ProfileCards";
import { CareerTimeline } from "./CareerTimeline";
import { DefaultModelCard } from "./DefaultModelCard";
import { MongoBackupCard } from "./MongoBackupCard";

export function ProfileTab() {
  const { applier, applierReady, setApplier } = useApplier();
  const [profile, setProfile] = useState<UserProfile>(() => emptyProfile());
  const [vendorAllowed, setVendorAllowed] = useState(false);
  const [vendorPasswordSet, setVendorPasswordSet] = useState(false);
  const [vendorPassword, setVendorPassword] = useState("");
  const [vendorPasswordConfirm, setVendorPasswordConfirm] = useState("");
  const [vendorPasswordSaving, setVendorPasswordSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingResumes, setRefreshingResumes] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<RefreshResumesProgress | null>(null);
  const [accountMissing, setAccountMissing] = useState(false);
  const [keyChecks, setKeyChecks] = useState<{ openai: KeyCheck; deepseek: KeyCheck }>({
    openai: { state: "idle" },
    deepseek: { state: "idle" },
  });
  const isBeta = isBetaTier(applier?.tier);
  const isAdmin = isAdminPermission(applier?.permission);
  const load = useCallback(async () => {
    if (!applier?.name) {
      setProfile(emptyProfile());
      setVendorAllowed(false);
      setVendorPasswordSet(false);
      setAccountMissing(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchAutoBidProfile(applier.name);
      setProfile(data.profile);
      setVendorAllowed(data.vendorAllowed);
      setVendorPasswordSet(data.vendorPasswordSet);
      setAccountMissing(!data.accountExists);
    } catch {
      toast.error("Could not load profile");
      setProfile(emptyProfile());
    } finally {
      setLoading(false);
    }
  }, [applier?.name]);

  useEffect(() => {
    if (!applierReady) return;
    void load();
  }, [applierReady, load]);

  const patch = (p: Partial<UserProfile>) => setProfile((prev) => ({ ...prev, ...p }));

  const saveVendorPassword = async () => {
    if (!applier?.name) {
      toast.warning("Sign in to set a vendor access password");
      return;
    }
    if (vendorPassword.length < 8) {
      toast.error("Vendor access password must be at least 8 characters");
      return;
    }
    if (vendorPassword !== vendorPasswordConfirm) {
      toast.error("Passwords do not match");
      return;
    }
    setVendorPasswordSaving(true);
    try {
      const res = await setVendorAccessPassword(applier.name, vendorPassword);
      if (res.success) {
        toast.success("Vendor access password saved");
        setVendorPassword("");
        setVendorPasswordConfirm("");
        setVendorPasswordSet(true);
      } else {
        toast.error(res.message || "Could not save vendor access password");
      }
    } catch {
      toast.error("Could not save vendor access password");
    } finally {
      setVendorPasswordSaving(false);
    }
  };

  const clearVendorPassword = async () => {
    if (!applier?.name) return;
    setVendorPasswordSaving(true);
    try {
      const res = await clearVendorAccessPassword(applier.name);
      if (res.success) {
        toast.success("Vendor access password cleared");
        setVendorPasswordSet(false);
        setVendorPassword("");
        setVendorPasswordConfirm("");
      } else {
        toast.error(res.message || "Could not clear vendor access password");
      }
    } catch {
      toast.error("Could not clear vendor access password");
    } finally {
      setVendorPasswordSaving(false);
    }
  };

  const save = async () => {
    if (!applier?.name) {
      toast.warning("Sign in to save your profile");
      return;
    }
    setSaving(true);
    try {
      const res = await saveAutoBidProfile(applier.name, profile, vendorAllowed);
      if (res.success) {
        toast.success("Profile saved");
        setAccountMissing(false);
        await load();
      } else {
        toast.error(res.error || "Save failed");
      }
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const refreshResumes = async () => {
    if (!applier?.name) {
      toast.warning("Sign in to refresh résumés");
      return;
    }
    if (!isBeta) {
      toast.warning("Beta workspace required to refresh generated résumés");
      return;
    }
    setRefreshingResumes(true);
    setRefreshProgress({
      done: 0,
      total: 0,
      left: 0,
      updated: 0,
      pdfs: 0,
      skipped: 0,
      failed: 0,
      active: 0,
      phase: "start",
    });
    try {
      // Persist the latest profile first so LinkedIn / contact changes are on the server.
      const saved = await saveAutoBidProfile(applier.name, profile, vendorAllowed);
      if (!saved.success) {
        toast.error(saved.error || "Save profile before refreshing résumés");
        return;
      }
      setAccountMissing(false);
      const res = await refreshGeneratedResumesIdentityStream(applier.name, (progress) => {
        setRefreshProgress(progress);
      });
      if (!res.success) {
        toast.error(res.error || "Could not refresh résumés");
        return;
      }
      const failed = res.failed ?? 0;
      const already = res.alreadyCurrent ?? 0;
      if ((res.total ?? 0) === 0 && already > 0) {
        toast.success(`All ${already} generated résumé${already === 1 ? "" : "s"} already match your profile`);
      } else {
        toast.success(
          `Updated ${res.updated ?? 0} of ${res.total ?? 0} outdated résumé${(res.total ?? 0) === 1 ? "" : "s"}` +
            (already ? ` · ${already} already current` : "") +
            (res.pdfs ? ` · ${res.pdfs} PDF${res.pdfs === 1 ? "" : "s"}` : "") +
            (failed ? ` · ${failed} failed` : ""),
        );
      }
      await load();
    } catch {
      toast.error("Could not refresh résumés");
    } finally {
      setRefreshingResumes(false);
      setRefreshProgress(null);
    }
  };

  const checkKey = async (provider: "openai" | "deepseek") => {
    const apiKey = provider === "openai" ? profile.openaiApiKey : profile.deepseekApiKey;
    if (!apiKey.trim()) {
      setKeyChecks((c) => ({ ...c, [provider]: { state: "fail", message: "Enter a key first." } }));
      return;
    }
    setKeyChecks((c) => ({ ...c, [provider]: { state: "checking" } }));
    try {
      const res = await testLlmKey(provider, apiKey);
      setKeyChecks((c) => ({
        ...c,
        [provider]: { state: res.ok ? "ok" : "fail", message: res.message },
      }));
    } catch {
      setKeyChecks((c) => ({ ...c, [provider]: { state: "fail", message: "Could not reach the backend." } }));
    }
  };

  if (!applierReady) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (!applier?.name) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground max-w-lg">
        Sign in to edit and save your auto-bid profile.
      </div>
    );
  }

  return (
    <div className="max-w-none w-full">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Auto-bid profile</h2>
          <p className="text-sm text-muted-foreground">Identity, preferences, and career history</p>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {isBeta && (
            <button
              type="button"
              onClick={() => void refreshResumes()}
              disabled={refreshingResumes || saving || loading}
              className="inline-flex items-center gap-2 border border-border bg-secondary text-foreground px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-muted min-h-10 disabled:opacity-50"
              title="Save profile, then re-apply name, contact, and LinkedIn to all generated résumé PDFs"
            >
              {refreshingResumes ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {refreshingResumes
                ? refreshProgress && refreshProgress.total > 0
                  ? `Updating… ${refreshProgress.done}/${refreshProgress.total}`
                  : "Updating résumés…"
                : "Update generated résumés"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || refreshingResumes}
            className="bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {refreshingResumes && refreshProgress && (
        <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-sm font-bold text-foreground">
              Updating outdated résumés
              {refreshProgress.total > 0
                ? ` · ${refreshProgress.done} of ${refreshProgress.total}`
                : "…"}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {refreshProgress.total > 0
                ? `${refreshProgress.left} left${refreshProgress.active ? ` · ${refreshProgress.active} active` : ""}`
                : "Starting…"}
            </p>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
              style={{
                width:
                  refreshProgress.total > 0
                    ? `${Math.min(100, Math.round((refreshProgress.done / refreshProgress.total) * 100))}%`
                    : "8%",
              }}
            />
          </div>
          {refreshProgress.total > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {refreshProgress.updated} updated
              {refreshProgress.pdfs ? ` · ${refreshProgress.pdfs} PDFs` : ""}
              {refreshProgress.alreadyCurrent ? ` · ${refreshProgress.alreadyCurrent} already current` : ""}
              {refreshProgress.failed ? ` · ${refreshProgress.failed} failed` : ""}
            </p>
          )}
        </div>
      )}

      {isBeta && !loading && !refreshingResumes && (
        <p className="mb-4 text-xs text-muted-foreground">
          After changing LinkedIn or other contact details, use{" "}
          <span className="font-semibold text-foreground">Update generated résumés</span> to refresh outdated
          Job Search / Agent PDF headers (skips ones already synced).
          {profile.updatedAt && profile.resumeUpdatedAt && profile.resumeUpdatedAt >= profile.updatedAt
            ? " All résumés are currently in sync."
            : profile.updatedAt
              ? " Some résumés may be out of date."
              : ""}
        </p>
      )}

      {accountMissing && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
          No <span className="font-medium">{applier.name}</span> row in account_info yet. Create this account before saving the profile.
        </div>
      )}

      {isAdmin && applier?.name ? <MongoBackupCard applierName={applier.name} /> : null}

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading profile…
        </div>
      ) : (
        <>
          <ProfileBanner profile={profile} tier={applier.tier} />
          <VendorAccessRow
            enabled={vendorAllowed}
            onChange={setVendorAllowed}
            disabled={saving}
            passwordSet={vendorPasswordSet}
            password={vendorPassword}
            confirmPassword={vendorPasswordConfirm}
            onPasswordChange={setVendorPassword}
            onConfirmPasswordChange={setVendorPasswordConfirm}
            onSavePassword={() => void saveVendorPassword()}
            onClearPassword={() => void clearVendorPassword()}
            passwordSaving={vendorPasswordSaving}
          />

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-4 items-start">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ProfileIdentityCard profile={profile} onChange={patch} />
              <div className="space-y-4">
                <ProfileDisclosuresCard profile={profile} onChange={patch} />
                <ProfileJobBidCard
                  profile={profile}
                  onChange={patch}
                  keyChecks={keyChecks}
                  onTestKey={(p) => void checkKey(p)}
                />
                {applier?.name ? (
                  <DefaultModelCard
                    applierName={applier.name}
                    currentProvider={profile.defaultProvider}
                    currentModel={profile.defaultModel}
                    onSaved={(defaultProvider, defaultModel) => {
                      patch({ defaultProvider, defaultModel });
                      setApplier((prev) => {
                        if (!prev) return prev;
                        return {
                          ...prev,
                          autoBidProfile: {
                            ...(typeof prev.autoBidProfile === "object" && prev.autoBidProfile
                              ? prev.autoBidProfile
                              : {}),
                            defaultProvider,
                            defaultModel,
                          },
                        };
                      });
                    }}
                  />
                ) : null}
              </div>
            </div>

            <CareerTimeline
              education={profile.education}
              careers={profile.careers}
              onAddEducation={() => patch({ education: [...profile.education, emptyEducation()] })}
              onAddCareer={() => patch({ careers: [...profile.careers, emptyCareer()] })}
              onUpdateEducation={(index, p) =>
                patch({ education: profile.education.map((r, j) => (j === index ? { ...r, ...p } : r)) })
              }
              onUpdateCareer={(index, p) =>
                patch({ careers: profile.careers.map((r, j) => (j === index ? { ...r, ...p } : r)) })
              }
              onRemoveEducation={(index) => patch({ education: profile.education.filter((_, j) => j !== index) })}
              onRemoveCareer={(index) => patch({ careers: profile.careers.filter((_, j) => j !== index) })}
            />
          </div>
        </>
      )}
    </div>
  );
}
