import React from "react";
import { Crown, Linkedin, Github, Globe } from "lucide-react";
import { Av } from "../../../components/ui";
import { AthensInput, AthensSwitch } from "../../../components/forms";
import { computeProfileCompletion } from "../../../data/settings/profileCompletion";
import type { UserProfile } from "../../../data/settings/profile";
import { isBetaTier } from "../../../lib/beta";

export function ProfileBanner({ profile, tier }: { profile: UserProfile; tier?: string | null }) {
  const pct = computeProfileCompletion(profile);
  const circumference = 2 * Math.PI * 32;
  const offset = circumference - (pct / 100) * circumference;
  const displayName =
    profile.fullName.trim() || `${profile.firstName} ${profile.lastName}`.trim() || "Your profile";
  const beta = isBetaTier(tier);

  return (
    <div className="athens-card mb-4">
      <div className="athens-settings__banner">
        <Av name={displayName} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h2 className="athens-settings__title truncate">{displayName}</h2>
            {beta ? (
              <span className="athens-status">
                <Crown size={12} aria-hidden="true" />
                Beta
              </span>
            ) : (
              <span className="athens-status">Job seeker</span>
            )}
          </div>
          <p className="athens-settings__lede truncate">
            {[profile.city, profile.state, profile.country].filter(Boolean).join(", ") || "Add your location"}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="athens-chip">{profile.education.length} education</span>
            <span className="athens-chip">{profile.careers.length} roles</span>
          </div>
        </div>
        <div className="athens-settings__complete">
          <div className="athens-settings__complete-ring">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 72 72" aria-hidden="true">
              <circle
                cx="36"
                cy="36"
                r="32"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                className="athens-settings__complete-track"
              />
              <circle
                cx="36"
                cy="36"
                r="32"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="athens-settings__complete-fill"
              />
            </svg>
            <span className="athens-settings__complete-value">{pct}%</span>
          </div>
          <span className="athens-eyebrow">Complete</span>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          {[
            { icon: Linkedin, label: "LinkedIn", href: profile.linkedin },
            { icon: Github, label: "GitHub", href: profile.github },
            { icon: Globe, label: "Portfolio", href: profile.portfolioUrl },
          ]
            .filter((l) => l.href?.trim())
            .map(({ icon: Icon, label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="athens-btn"
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </a>
            ))}
        </div>
      </div>
    </div>
  );
}

export function VendorAccessRow({
  enabled,
  onChange,
  disabled,
  passwordSet,
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  onSavePassword,
  onClearPassword,
  passwordSaving,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  passwordSet?: boolean;
  password?: string;
  confirmPassword?: string;
  onPasswordChange?: (v: string) => void;
  onConfirmPasswordChange?: (v: string) => void;
  onSavePassword?: () => void;
  onClearPassword?: () => void;
  passwordSaving?: boolean;
}) {
  return (
    <div className="athens-card mb-4">
      <AthensSwitch
        label="Allow vendor access"
        description="Lets Athens Lens bidders sign in with your profile name and a vendor-purpose password"
        checked={enabled}
        onCheckedChange={onChange}
        disabled={disabled}
      />

      {enabled && (
        <div className="athens-settings__split space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="athens-card-title">Vendor access password</p>
            <span className="athens-status">
              {passwordSet ? "Set" : "Not set — Athens Lens blocked"}
            </span>
          </div>
          <p className="athens-card-meta">
            Separate from your Athens login password. Share only with trusted bidders.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AthensInput
              type="password"
              value={password || ""}
              onChange={(e) => onPasswordChange?.(e.target.value)}
              placeholder={passwordSet ? "New password (min 8)" : "Set password (min 8)"}
              autoComplete="new-password"
              disabled={disabled || passwordSaving}
            />
            <AthensInput
              type="password"
              value={confirmPassword || ""}
              onChange={(e) => onConfirmPasswordChange?.(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              disabled={disabled || passwordSaving}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onSavePassword?.()}
              disabled={disabled || passwordSaving}
              className="athens-btn-primary"
            >
              {passwordSaving ? "Saving…" : passwordSet ? "Update password" : "Set password"}
            </button>
            {passwordSet && (
              <button
                type="button"
                onClick={() => onClearPassword?.()}
                disabled={disabled || passwordSaving}
                className="athens-btn"
              >
                Clear password
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
