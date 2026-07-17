import { useState } from "react";
import { AthensInput, FormField } from "../../../components/forms";
import { SlidePanel, SlidePanelHeader } from "../../../components/overlays";
import { Button } from "../../../components/ui/button";
import type { Application } from "../../../types";

type NewApplicationSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (app: Application) => void;
};

export function NewApplicationSheet({ open, onOpenChange, onAdd }: NewApplicationSheetProps) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");

  const handleAdd = () => {
    if (!company.trim() || !role.trim()) return;
    onAdd({
      id: `app-${Date.now()}`,
      company,
      role,
      location: location || "Remote",
      stage: "Applied",
      score: 75 + Math.floor(Math.random() * 20),
      tags: ["New"],
      time: "Just now",
      email: "recruiter@" + company.toLowerCase().replace(/\s+/g, "") + ".com",
      source: "Manual",
    });
    setCompany("");
    setRole("");
    setLocation("");
    onOpenChange(false);
  };

  return (
    <SlidePanel open={open} onOpenChange={onOpenChange} width="md">
      <SlidePanelHeader title="New application" onClose={() => onOpenChange(false)} />
      <div className="p-5 space-y-4 flex-1">
        <FormField label="Company">
          <AthensInput value={company} onChange={(e) => setCompany(e.target.value)} />
        </FormField>
        <FormField label="Role">
          <AthensInput value={role} onChange={(e) => setRole(e.target.value)} />
        </FormField>
        <FormField label="Location">
          <AthensInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Remote" />
        </FormField>
      </div>
      <div className="p-5 border-t border-border">
        <Button className="w-full" onClick={handleAdd}>
          Add to pipeline
        </Button>
      </div>
    </SlidePanel>
  );
}
