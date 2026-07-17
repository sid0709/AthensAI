import type { CareerEntry, EducationEntry, UserProfile } from "./profile";

function filled(value: string) {
  return value.trim().length > 0;
}

function educationComplete(row: EducationEntry) {
  return filled(row.school) && filled(row.diploma) && filled(row.startYear);
}

function careerComplete(row: CareerEntry) {
  return filled(row.company) && filled(row.title) && filled(row.startYear);
}

/** Soft completion score — no fields are hard-required on save. */
export function computeProfileCompletion(form: UserProfile): number {
  const checks = [
    filled(form.fullName) || (filled(form.firstName) && filled(form.lastName)),
    filled(form.age),
    filled(form.email),
    filled(form.phone),
    filled(form.address),
    filled(form.city),
    filled(form.state),
    filled(form.country),
    filled(form.zipCode),
    filled(form.desiredSalary),
    filled(form.linkedin),
    form.immigrationStatus !== "prefer_not_say",
    form.sponsorship !== "prefer_not_say",
    form.education.some(educationComplete),
    form.careers.some(careerComplete),
  ];

  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}
