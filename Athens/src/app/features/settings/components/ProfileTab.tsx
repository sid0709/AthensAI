import React, { useCallback, useEffect, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";
import { emptyCareer, emptyEducation, emptyProfile, type UserProfile } from "../../../data/settings/profile";
import {
  clearVendorAccessPassword,
  fetchAutoBidProfile,
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

export function ProfileTab() {
  const { applier, applierReady, setApplier } = useApplier();
	const { latestTask, startTask, cancelTask, waitForTask } = useBackgroundTasks();
	const resumeRefreshTask = latestTask("resume_identity_refresh");
	const activeResumeRefreshTask = resumeRefreshTask
		&& ["queued", "running", "cancelling"].includes(resumeRefreshTask.status)
		? resumeRefreshTask
		: null;
	const refreshStopping = activeResumeRefreshTask?.status === "cancelling";
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

	useEffect(() => {
		if (!resumeRefreshTask) return;
		const progress = resumeRefreshTask.progress || {};
		if (["queued", "running", "cancelling"].includes(resumeRefreshTask.status)) {
			setRefreshingResumes(true);
			setRefreshProgress({
				done: Number(progress.completed || 0),
				total: Number(progress.total || 0),
				left: Number(progress.remaining || 0),
				updated: Number(progress.updated || 0),
				pdfs: Number(progress.pdfs || 0),
				skipped: Number(progress.skipped || 0),
				failed: Number(progress.failed || 0),
				active: Number(progress.active || 0),
				alreadyCurrent: Number(progress.alreadyCurrent || 0),
				phase: String(progress.phase || resumeRefreshTask.status),
				profileUpdatedAt: progress.profileUpdatedAt ? String(progress.profileUpdatedAt) : null,
				resumeUpdatedAt: progress.resumeUpdatedAt ? String(progress.resumeUpdatedAt) : null,
			});
			return;
		}
		setRefreshingResumes(false);
	}, [resumeRefreshTask]);
  const isAdmin = isAdminPermission(applier?.permission);
  const load = useCallback(async (signal?: AbortSignal) => {
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
      const data = await fetchAutoBidProfile(
        applier.name,
        signal,
        applier._id != null ? String(applier._id) : undefined,
      );
      if (signal?.aborted) return;
      setProfile(data.profile);
      setVendorAllowed(data.vendorAllowed);
      setVendorPasswordSet(data.vendorPasswordSet);
      setAccountMissing(!data.accountExists);
    } catch (error) {
      if (signal?.aborted || (error as Error)?.name === "AbortError") return;
      toast.error("Could not load profile");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [applier?._id, applier?.name]);

  useEffect(() => {
    if (!applierReady) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
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
      const res = await saveAutoBidProfile(
        applier.name,
        profile,
        vendorAllowed,
        applier._id != null ? String(applier._id) : undefined,
      );
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
		if (activeResumeRefreshTask) {
			if (activeResumeRefreshTask.status === "cancelling") return;
			try {
				await cancelTask(activeResumeRefreshTask.id);
				toast.info("Stopping résumé updates…");
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Could not stop résumé updates");
			}
			return;
		}
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
      const saved = await saveAutoBidProfile(
        applier.name,
        profile,
        vendorAllowed,
        applier._id != null ? String(applier._id) : undefined,
      );
      if (!saved.success) {
        toast.error(saved.error || "Save profile before refreshing résumés");
        return;
      }
      setAccountMissing(false);
			const task = await startTask("resume_identity_refresh", {});
			const finished = await waitForTask(task.id);
			if (finished.status === "cancelled") {
				toast.info("Résumé updates stopped");
				return;
			}
			if (finished.status === "failed") {
				toast.error(finished.error || "Could not refresh résumés");
				return;
			}
			const res = finished.result || {};
			const failed = Number(res.failed ?? 0);
			const already = Number(res.alreadyCurrent ?? 0);
			const total = Number(res.total ?? 0);
			const updated = Number(res.updated ?? 0);
			const pdfs = Number(res.pdfs ?? 0);
			if (total === 0 && already > 0) {
        toast.success(`All ${already} generated résumé${already === 1 ? "" : "s"} already match your profile`);
      } else {
        toast.success(
          `Updated ${updated} of ${total} outdated résumé${total === 1 ? "" : "s"}` +
            (already ? ` · ${already} already current` : "") +
            (pdfs ? ` · ${pdfs} PDF${pdfs === 1 ? "" : "s"}` : "") +
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
      <div className="athens-settings__loading">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (!applier?.name) {
    return (
      <div className="athens-callout max-w-lg">
        Sign in to edit and save your auto-bid profile.
      </div>
    );
  }

  const refreshPct =
    refreshProgress && refreshProgress.total > 0
      ? Math.min(100, Math.round((refreshProgress.done / refreshProgress.total) * 100))
      : 8;

  return (
    <div className="max-w-none w-full">
      <div className="athens-settings__head">
        <div className="min-w-0">
          <h2 className="athens-settings__title">Auto-bid profile</h2>
          <p className="athens-settings__lede">Identity, preferences, and career history</p>
        </div>
        <div className="athens-toolbar-actions">
          {isBeta && (
            <button
              type="button"
              onClick={() => void refreshResumes()}
              disabled={refreshStopping || (refreshingResumes && !activeResumeRefreshTask) || saving || loading}
              className="athens-text-btn"
              title={refreshingResumes
                ? "Stop résumé updates immediately"
                : "Save profile, then re-apply name, contact, and LinkedIn to all generated résumé PDFs"}
            >
              {refreshingResumes ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {refreshStopping
                ? "Stopping…"
                : refreshingResumes
                  ? refreshProgress && refreshProgress.total > 0
                    ? `Stop · ${refreshProgress.done}/${refreshProgress.total}`
                    : "Stop update"
                  : "Update résumés"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || refreshingResumes}
            className="athens-btn-primary"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {isBeta && !loading && !refreshingResumes && (
        <div className="athens-settings__notice" role="status">
          <Info size={16} aria-hidden="true" />
          <p>
            After changing LinkedIn or other contact details, use{" "}
            <strong>Update résumés</strong> to refresh outdated PDF headers.
            {profile.updatedAt && profile.resumeUpdatedAt && profile.resumeUpdatedAt >= profile.updatedAt
              ? " All résumés are currently in sync."
              : profile.updatedAt
                ? " Some résumés may be out of date."
                : ""}
          </p>
        </div>
      )}

      {refreshingResumes && refreshProgress && (
        <div className="athens-card mb-4">
          <div className="athens-progress">
            <div className="athens-progress__meta">
              <span>
                Updating outdated résumés
                {refreshProgress.total > 0
                  ? ` · ${refreshProgress.done} of ${refreshProgress.total}`
                  : "…"}
              </span>
              <span>
                {refreshProgress.total > 0
                  ? `${refreshProgress.left} left${refreshProgress.active ? ` · ${refreshProgress.active} active` : ""}`
                  : "Starting…"}
              </span>
            </div>
            <div className="athens-progress__track">
              <div
                className={`athens-progress__bar${refreshProgress.total > 0 ? "" : " is-indeterminate"}`}
                style={{ width: `${refreshPct}%` }}
              />
            </div>
            {refreshProgress.total > 0 && (
              <p className="athens-card-meta">
                {refreshProgress.updated} updated
                {refreshProgress.pdfs ? ` · ${refreshProgress.pdfs} PDFs` : ""}
                {refreshProgress.alreadyCurrent ? ` · ${refreshProgress.alreadyCurrent} already current` : ""}
                {refreshProgress.failed ? ` · ${refreshProgress.failed} failed` : ""}
              </p>
            )}
          </div>
        </div>
      )}

      {accountMissing && (
        <div className="athens-callout mb-4">
          No <strong>{applier.name}</strong> row in account_info yet. Create this account before saving the profile.
        </div>
      )}

      {loading ? (
        <div className="athens-card athens-settings__loading">
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
                    profileId={applier._id != null ? String(applier._id) : undefined}
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
