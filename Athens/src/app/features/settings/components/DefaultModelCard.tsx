import React, { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { fetchLlmModels, setDefaultModel } from "../../../services/profileApi";

type Provider = "openai" | "deepseek";
const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

/**
 * Chooses the single default model (provider + model) used by every AI feature:
 * resume generation, agent work, and job-search skill extraction. "Set as
 * default" validates the stored API key for the chosen provider before saving.
 */
export function DefaultModelCard({
  applierName,
  currentProvider,
  currentModel,
  onSaved,
}: {
  applierName: string;
  currentProvider: string;
  currentModel: string;
  onSaved: (provider: Provider, model: string) => void;
}) {
  const initialProvider: Provider = currentProvider === "openai" ? "openai" : "deepseek";
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [model, setModel] = useState(currentModel);
  const [models, setModels] = useState<string[]>(
    initialProvider === "deepseek" ? DEEPSEEK_MODELS : [],
  );
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Load the model list when the provider changes.
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (provider === "deepseek") {
      setModels(DEEPSEEK_MODELS);
      if (!DEEPSEEK_MODELS.includes(model)) setModel(DEEPSEEK_MODELS[0]);
      return;
    }
    setLoadingModels(true);
    (async () => {
      const list = await fetchLlmModels("openai", applierName);
      if (cancelled) return;
      setModels(list);
      if (list.length && !list.includes(model)) setModel(list[0]);
      setLoadingModels(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, applierName]);

  const isCurrent = currentProvider === provider && currentModel === model;

  const save = async () => {
    if (!model) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await setDefaultModel(applierName, provider, model);
      if (res.success && res.valid) {
        setResult({ ok: true, msg: res.message || "Set as default." });
        onSaved(provider, model);
      } else {
        setResult({ ok: false, msg: res.error || res.message || "Could not validate the API key." });
      }
    } catch {
      setResult({ ok: false, msg: "Could not reach the backend." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-foreground">Default AI model</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Used by resume generation, agent work, and job-search skill extraction. Setting a
          default validates the matching API key first.
        </p>
        {currentProvider && currentModel ? (
          <p className="text-xs text-muted-foreground mt-2">
            Current: <span className="font-semibold text-foreground">{currentProvider} · {currentModel}</span>
          </p>
        ) : (
          <p className="text-xs text-amber-600 mt-2">No default set — features fall back to whichever key exists.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider)}
          className="h-9 rounded-md border border-border bg-secondary/60 px-2 text-sm text-foreground outline-none"
          aria-label="Model provider"
        >
          <option value="deepseek">DeepSeek</option>
          <option value="openai">OpenAI</option>
        </select>

        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={loadingModels || models.length === 0}
          className="h-9 min-w-[180px] flex-1 rounded-md border border-border bg-secondary/60 px-2 text-sm text-foreground outline-none disabled:opacity-60"
          aria-label="Model"
        >
          {loadingModels ? (
            <option>Loading models…</option>
          ) : models.length === 0 ? (
            <option value="">No models (check API key)</option>
          ) : (
            models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          )}
        </select>

        <Button className="h-9" disabled={saving || !model || isCurrent} onClick={() => void save()}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {isCurrent ? "Current default" : "Set as default"}
        </Button>
      </div>

      {result ? (
        <div
          className={`flex items-center gap-1.5 text-xs ${result.ok ? "text-emerald-600" : "text-rose-600"}`}
        >
          {result.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {result.msg}
        </div>
      ) : null}
    </div>
  );
}
