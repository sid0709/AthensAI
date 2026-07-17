import { useCallback, useEffect, useMemo, useState } from "react";
import { useApplier } from "@/context/applier-context";
import {
  fetchResumeCatalog,
  saveResumeCatalog,
  validateResumeCatalogApi,
} from "../../../services/resumeApi";
import type { ResumeStackCatalog } from "../../../types/resume";
import { computeStackStats, stackAvgScore, validateStackCatalog } from "../lib/validateStacks";

export function useResumeStacks() {
  const { applier, applierReady } = useApplier();
  const [catalog, setCatalog] = useState<ResumeStackCatalog>({});
  const [jsonText, setJsonText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState(true);
  const [featuredStack, setFeaturedStack] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!applier?.name) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { catalog: data, updatedAt: ts } = await fetchResumeCatalog(applier.name);
      setCatalog(data);
      setJsonText(JSON.stringify(data, null, 2));
      setUpdatedAt(ts);
      const stacks = Object.keys(data);
      setFeaturedStack(stacks[0] ?? null);
      setValid(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [applier?.name]);

  useEffect(() => {
    if (!applierReady) return;
    void load();
  }, [applierReady, load]);

  const validate = useCallback(() => {
    const result = validateStackCatalog(jsonText);
    setValid(result.valid);
    setError(result.error ?? null);
    if (result.valid && result.catalog) {
      setCatalog(result.catalog);
      const stacks = Object.keys(result.catalog);
      if (!featuredStack || !result.catalog[featuredStack]) {
        setFeaturedStack(stacks[0] ?? null);
      }
    }
    return result;
  }, [jsonText, featuredStack]);

  const validateServer = useCallback(async () => {
    try {
      const parsed = JSON.parse(jsonText);
      const result = await validateResumeCatalogApi(parsed);
      setValid(result.valid);
      setError(result.errors[0] ?? null);
      if (result.valid && result.catalog) setCatalog(result.catalog);
      return result;
    } catch {
      setValid(false);
      setError("Invalid JSON syntax.");
      return { valid: false, errors: ["Invalid JSON"], warnings: [] };
    }
  }, [jsonText]);

  const save = useCallback(async () => {
    if (!applier?.name) return false;
    const result = validate();
    if (!result.valid || !result.catalog) return false;
    setSaving(true);
    try {
      await saveResumeCatalog(applier.name, result.catalog);
      setCatalog(result.catalog);
      setUpdatedAt(new Date().toISOString());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }, [applier?.name, validate]);

  const stats = useMemo(() => computeStackStats(catalog), [catalog]);
  const stackNames = useMemo(() => Object.keys(catalog), [catalog]);

  const stackCards = useMemo(
    () =>
      stackNames.map((name) => ({
        name,
        skillCount: Object.keys(catalog[name]).length,
        avg: stackAvgScore(name, catalog),
      })),
    [stackNames, catalog],
  );

  return {
    catalog,
    jsonText,
    setJsonText,
    error,
    valid,
    featuredStack,
    setFeaturedStack,
    loading,
    saving,
    updatedAt,
    stats,
    stackNames,
    stackCards,
    validate,
    validateServer,
    save,
    reload: load,
  };
}
