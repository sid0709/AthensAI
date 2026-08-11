export type OakSocketClientInfo = {
  type: string;
  name: string;
  profileId: string;
  applierName: string;
  connectedAt: number;
};

export class OakSocketRegistry {
  private readonly clients = new Map<string, OakSocketClientInfo>();

  set(id: string, info: OakSocketClientInfo): void {
    this.clients.set(id, info);
  }

  delete(id: string): void {
    this.clients.delete(id);
  }

  summary() {
    return Array.from(this.clients.entries()).map(([id, info]) => ({
      id,
      ...info,
    }));
  }

  count(): number {
    return this.clients.size;
  }

  findExtensionSocketId(): string | null {
    for (const [id, info] of this.clients.entries()) {
      if (info.type === 'extension') return id;
    }
    return null;
  }
}

export function countDomNodes(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) return 1;
  let childSum = 0;
  for (const child of children) childSum += countDomNodes(child);
  return 1 + childSum;
}
