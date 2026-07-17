import { AthensTextarea, FormField } from "../../../../components/forms";

type JobDescriptionPanelProps = {
  value: string;
  onChange: (value: string) => void;
};

export function JobDescriptionPanel({ value, onChange }: JobDescriptionPanelProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-bold text-foreground mb-3">Job description</h3>
      <FormField label="About the job">
        <AthensTextarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste the job description here. The generator will tailor your resume to match role requirements…"
          rows={8}
          className="min-h-[160px]"
        />
      </FormField>
    </div>
  );
}
