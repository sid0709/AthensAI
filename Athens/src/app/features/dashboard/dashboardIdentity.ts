export function dashboardGreeting(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function dashboardAccountName(value?: string | null) {
  const name = value?.trim();
  return name || "there";
}
