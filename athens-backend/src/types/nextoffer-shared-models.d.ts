declare module '@nextoffer/shared/models' {
  export const DEEPSEEK_MODELS: string[];
  export function isDeepSeekModel(id: string): boolean;
  export function listOpenAiModels(
    apiKey: string,
  ): Promise<Array<{ id: string; created?: number; ownedBy?: string }>>;
}
