export const DEFAULT_JOB_BUDGET_USD = 0.25;
export const BUDGET_STORAGE_KEY = "athens-agent-job-budget-usd";

const MIN_BUDGET_USD = 0.01;
const MAX_BUDGET_USD = 5;

export function clampJobBudgetUsd(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_JOB_BUDGET_USD;
  return Math.min(MAX_BUDGET_USD, Math.max(MIN_BUDGET_USD, value));
}

export function loadJobBudgetUsd(): number {
  try {
    const raw = localStorage.getItem(BUDGET_STORAGE_KEY);
    if (raw == null) return DEFAULT_JOB_BUDGET_USD;
    return clampJobBudgetUsd(Number.parseFloat(raw));
  } catch {
    return DEFAULT_JOB_BUDGET_USD;
  }
}

export function saveJobBudgetUsd(value: number): void {
  try {
    localStorage.setItem(BUDGET_STORAGE_KEY, String(clampJobBudgetUsd(value)));
  } catch {
    /* ignore quota / private mode */
  }
}
