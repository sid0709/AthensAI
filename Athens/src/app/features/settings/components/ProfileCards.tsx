import React from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { AthensInput, AthensSelect, FormField } from "../../../components/forms";
import {
  COUNTRY_OPTIONS,
  enumOptions,
  GENDER_LABEL,
  GENDER_VALUES,
  IMMIGRATION_STATUS_LABEL,
  IMMIGRATION_STATUS_VALUES,
  ORIENTATION_LABEL,
  ORIENTATION_VALUES,
  PRONOUN_LABEL,
  PRONOUN_VALUES,
  RACE_LABEL,
  RACE_VALUES,
  VETERAN_LABEL,
  VETERAN_VALUES,
  YES_NO_DECLINE_LABEL,
  YES_NO_DECLINE_VALUES,
  type Gender,
  type ImmigrationStatus,
  type Pronouns,
  type RaceEthnicity,
  type SexualOrientation,
  type VeteranStatus,
  type YesNoDecline,
} from "../../../data/settings/profileConstants";
import type { UserProfile } from "../../../data/settings/profile";

const grid2 = "grid grid-cols-2 gap-2";

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

type KeyCheck = { state: "idle" | "checking" | "ok" | "fail"; message?: string };

function KeyTestRow({ check, onTest }: { check: KeyCheck; onTest: () => void }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <button
        type="button"
        onClick={onTest}
        disabled={check.state === "checking"}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-secondary disabled:opacity-50"
      >
        {check.state === "checking" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Test key
      </button>
      {check.state === "ok" && (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="w-3.5 h-3.5" /> {check.message || "Valid"}
        </span>
      )}
      {check.state === "fail" && (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <XCircle className="w-3.5 h-3.5 shrink-0" /> <span className="truncate max-w-[240px]">{check.message || "Invalid"}</span>
        </span>
      )}
    </div>
  );
}

export function ProfileIdentityCard({
  profile,
  onChange,
}: {
  profile: UserProfile;
  onChange: (patch: Partial<UserProfile>) => void;
}) {
  return (
    <SectionCard title="Identity" subtitle="Name, contact, location, and links">
      <FormField label="Full name">
        <AthensInput value={profile.fullName} onChange={(e) => onChange({ fullName: e.target.value })} autoComplete="name" className="h-9 text-sm" />
      </FormField>
      <div className={grid2}>
        <FormField label="First name">
          <AthensInput value={profile.firstName} onChange={(e) => onChange({ firstName: e.target.value })} autoComplete="given-name" className="h-9 text-sm" />
        </FormField>
        <FormField label="Last name">
          <AthensInput value={profile.lastName} onChange={(e) => onChange({ lastName: e.target.value })} autoComplete="family-name" className="h-9 text-sm" />
        </FormField>
        <FormField label="Age">
          <AthensInput
            inputMode="numeric"
            value={profile.age}
            onChange={(e) => onChange({ age: e.target.value.replace(/\D/g, "").slice(0, 3) })}
            className="h-9 text-sm max-w-[120px]"
          />
        </FormField>
        <AthensSelect
          size="sm"
          label="Gender"
          value={profile.gender}
          onChange={(v) => onChange({ gender: v as Gender })}
          options={enumOptions(GENDER_VALUES, GENDER_LABEL)}
        />
        <AthensSelect
          size="sm"
          label="Pronouns"
          value={profile.pronouns}
          onChange={(v) => onChange({ pronouns: v as Pronouns })}
          options={enumOptions(PRONOUN_VALUES, PRONOUN_LABEL)}
        />
        <AthensSelect
          size="sm"
          label="Orientation"
          value={profile.sexualOrientation}
          onChange={(v) => onChange({ sexualOrientation: v as SexualOrientation })}
          options={enumOptions(ORIENTATION_VALUES, ORIENTATION_LABEL)}
        />
        <FormField label="Email">
          <AthensInput type="email" value={profile.email} onChange={(e) => onChange({ email: e.target.value })} autoComplete="email" className="h-9 text-sm" />
        </FormField>
        <FormField label="Phone">
          <AthensInput type="tel" value={profile.phone} onChange={(e) => onChange({ phone: e.target.value })} autoComplete="tel" className="h-9 text-sm" />
        </FormField>
      </div>
      <FormField label="Gmail app password">
        <AthensInput
          type="password"
          value={profile.gmailAppPassword}
          onChange={(e) => onChange({ gmailAppPassword: e.target.value })}
          placeholder="16-char app password"
          className="h-9 text-sm max-w-md"
        />
      </FormField>

      <div className="border-t border-border pt-2 space-y-2">
        <FormField label="Street address">
          <AthensInput value={profile.address} onChange={(e) => onChange({ address: e.target.value })} autoComplete="street-address" className="h-9 text-sm" />
        </FormField>
        <div className={grid2}>
          <FormField label="City">
            <AthensInput value={profile.city} onChange={(e) => onChange({ city: e.target.value })} autoComplete="address-level2" className="h-9 text-sm" />
          </FormField>
          <FormField label="State">
            <AthensInput value={profile.state} onChange={(e) => onChange({ state: e.target.value })} autoComplete="address-level1" className="h-9 text-sm" />
          </FormField>
          <AthensSelect
            size="sm"
            label="Citizenship"
            value={profile.immigrationStatus}
            onChange={(v) => onChange({ immigrationStatus: v as ImmigrationStatus })}
            options={enumOptions(IMMIGRATION_STATUS_VALUES, IMMIGRATION_STATUS_LABEL)}
          />
          <AthensSelect size="sm" label="Country" value={profile.country} onChange={(v) => onChange({ country: v })} options={[...COUNTRY_OPTIONS]} />
          <FormField label="ZIP / postal">
            <AthensInput value={profile.zipCode} onChange={(e) => onChange({ zipCode: e.target.value })} autoComplete="postal-code" className="h-9 text-sm max-w-[140px]" />
          </FormField>
        </div>
      </div>

      <div className="border-t border-border pt-2">
        <div className={grid2}>
          <FormField label="LinkedIn" className="col-span-2">
            <AthensInput type="url" value={profile.linkedin} onChange={(e) => onChange({ linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" className="h-9 text-sm" />
          </FormField>
          <FormField label="GitHub">
            <AthensInput type="url" value={profile.github} onChange={(e) => onChange({ github: e.target.value })} placeholder="https://github.com/…" className="h-9 text-sm" />
          </FormField>
          <FormField label="Portfolio">
            <AthensInput type="url" value={profile.portfolioUrl} onChange={(e) => onChange({ portfolioUrl: e.target.value })} placeholder="https://…" className="h-9 text-sm" />
          </FormField>
        </div>
      </div>
    </SectionCard>
  );
}

export function ProfileDisclosuresCard({
  profile,
  onChange,
}: {
  profile: UserProfile;
  onChange: (patch: Partial<UserProfile>) => void;
}) {
  return (
    <SectionCard title="Voluntary disclosures" subtitle="EEO and sponsorship answers">
      <div className={grid2}>
        <AthensSelect
          size="sm"
          label="Hispanic / Latino"
          value={profile.demographicHispanic}
          onChange={(v) => onChange({ demographicHispanic: v as YesNoDecline })}
          options={enumOptions(YES_NO_DECLINE_VALUES, YES_NO_DECLINE_LABEL)}
        />
        <AthensSelect
          size="sm"
          label="Race / ethnicity"
          value={profile.demographicRaceEthnicity}
          onChange={(v) => onChange({ demographicRaceEthnicity: v as RaceEthnicity })}
          options={enumOptions(RACE_VALUES, RACE_LABEL)}
        />
        <AthensSelect
          size="sm"
          label="Visa / sponsorship"
          value={profile.sponsorship}
          onChange={(v) => onChange({ sponsorship: v as YesNoDecline })}
          options={YES_NO_DECLINE_VALUES.map((v) => ({
            value: v,
            label: v === "yes" ? "Yes — requires sponsorship" : v === "no" ? "No — no sponsorship" : YES_NO_DECLINE_LABEL[v],
          }))}
        />
        <AthensSelect
          size="sm"
          label="Disability"
          value={profile.demographicDisability}
          onChange={(v) => onChange({ demographicDisability: v as YesNoDecline })}
          options={YES_NO_DECLINE_VALUES.map((v) => ({
            value: v,
            label: v === "yes" ? "Yes — has disability" : v === "no" ? "No — no disability" : YES_NO_DECLINE_LABEL[v],
          }))}
        />
        <AthensSelect
          size="sm"
          label="Veteran status"
          className="col-span-2"
          value={profile.demographicMilitaryStatus}
          onChange={(v) => onChange({ demographicMilitaryStatus: v as VeteranStatus })}
          options={enumOptions(VETERAN_VALUES, VETERAN_LABEL)}
        />
      </div>
    </SectionCard>
  );
}

export function ProfileJobBidCard({
  profile,
  onChange,
  keyChecks,
  onTestKey,
}: {
  profile: UserProfile;
  onChange: (patch: Partial<UserProfile>) => void;
  keyChecks: { openai: KeyCheck; deepseek: KeyCheck };
  onTestKey: (provider: "openai" | "deepseek") => void;
}) {
  return (
    <SectionCard title="Job Bid Assistant" subtitle="Salary, API keys, and resume path">
      <FormField label="Desired salary (annual)">
        <AthensInput
          inputMode="numeric"
          value={profile.desiredSalary}
          onChange={(e) => onChange({ desiredSalary: e.target.value.replace(/[^\d.,$kKmM\- ]/g, "").slice(0, 32) })}
          placeholder="e.g. 150k–180k USD"
          className="h-9 text-sm max-w-xs"
        />
      </FormField>
      <FormField label="OpenAI API key">
        <AthensInput
          type="password"
          value={profile.openaiApiKey}
          onChange={(e) => onChange({ openaiApiKey: e.target.value })}
          placeholder="sk-…"
          className="h-9 text-sm max-w-md"
        />
        <KeyTestRow check={keyChecks.openai} onTest={() => onTestKey("openai")} />
      </FormField>
      <FormField label="DeepSeek API key">
        <AthensInput
          type="password"
          value={profile.deepseekApiKey}
          onChange={(e) => onChange({ deepseekApiKey: e.target.value })}
          placeholder="DeepSeek key"
          className="h-9 text-sm max-w-md"
        />
      </FormField>
      <KeyTestRow check={keyChecks.deepseek} onTest={() => onTestKey("deepseek")} />
      <FormField label="Default account password">
        <AthensInput
          type="password"
          value={profile.defaultPassword}
          onChange={(e) => onChange({ defaultPassword: e.target.value })}
          placeholder="Used when an application requires sign-up / sign-in"
          className="h-9 text-sm max-w-md"
        />
      </FormField>
      <FormField label="Resume folder path">
        <AthensInput
          value={profile.resumeFolderUrl}
          onChange={(e) => onChange({ resumeFolderUrl: e.target.value })}
          placeholder="C:\Users\you\Documents\Resumes"
          className="h-9 text-sm"
        />
      </FormField>
    </SectionCard>
  );
}

export type { KeyCheck };
