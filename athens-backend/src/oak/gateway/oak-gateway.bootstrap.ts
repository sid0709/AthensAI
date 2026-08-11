import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { OakSessionService } from '../auth/oak-session.service';
import { OAK_SOCKET_PATH } from '../constants/oak.constants';
import { countDomNodes, OakSocketRegistry } from './oak-socket-registry';

@Injectable()
export class OakGatewayBootstrap implements OnModuleDestroy {
  private readonly logger = new Logger(OakGatewayBootstrap.name);
  private readonly registry = new OakSocketRegistry();
  private io: Server | null = null;

  constructor(private readonly sessions: OakSessionService) {}

  attach(httpServer: HttpServer): void {
    if (this.io) return;

    // Token-auth already gates the socket; allow extension origins like standalone Oak did.
    this.io = new Server(httpServer, {
      path: OAK_SOCKET_PATH,
      cors: {
        origin: true,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      maxHttpBufferSize: 50e6,
    });

    this.io.use(async (socket, next) => {
      try {
        const token = extractToken(socket);
        if (!token) {
          next(new Error('Oak session required'));
          return;
        }
        const session = await this.sessions.read(token);
        if (!session) {
          next(new Error('Oak session expired or invalid'));
          return;
        }
        socket.data.oakSession = session;
        next();
      } catch (err) {
        next(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.io.on('connection', (socket) => this.onConnection(socket));
    this.logger.log(`Oak Socket.io attached at path ${OAK_SOCKET_PATH}`);
  }

  clientCount(): number {
    return this.io?.engine.clientsCount ?? this.registry.count();
  }

  onModuleDestroy(): void {
    void this.io?.close();
    this.io = null;
  }

  private onConnection(socket: Socket): void {
    const io = this.io!;
    const session = socket.data.oakSession as {
      profileId: string;
      applierName: string;
      username: string;
    };
    const type = String(socket.handshake.query.type || 'unknown');
    const name = String(
      socket.handshake.query.name || session.username || 'anonymous',
    );

    this.registry.set(socket.id, {
      type,
      name,
      profileId: session.profileId,
      applierName: session.applierName,
      connectedAt: Date.now(),
    });

    this.logger.log(`[${type}] connected: ${name} (${socket.id})`);

    socket.emit('connected', {
      id: socket.id,
      type,
      clients: this.registry.summary(),
    });
    io.emit('clients:update', this.registry.summary());

    socket.on('dom:tree', (payload: Record<string, unknown>) => {
      const meta = {
        from: socket.id,
        clientType: type,
        clientName: name,
        url: payload?.url ?? 'unknown',
        title: payload?.title ?? 'unknown',
        tabId: payload?.tabId ?? null,
        frameId: payload?.frameId ?? null,
        timestamp: Date.now(),
        nodeCount: countDomNodes(payload?.tree),
      };
      this.logger.log(
        `[dom:tree] from ${name} — ${meta.nodeCount} nodes @ ${meta.url}`,
      );
      socket.broadcast.emit('dom:tree', { ...payload, meta });
      socket.emit('dom:tree:sent', meta);
    });

    socket.on('pipeline:progress', (payload: Record<string, unknown>) => {
      const progress = payload?.progress as { phase?: string } | undefined;
      const phase = progress?.phase ?? payload?.phase ?? 'unknown';
      this.logger.log(
        `[pipeline:progress] tab=${payload?.tabId ?? null} phase=${phase}`,
      );
      socket.broadcast.emit('pipeline:progress', payload);
    });

    socket.on('dom:highlight', (payload: Record<string, unknown>) => {
      const { extensionId, nodeId, tabId, url } = payload ?? {};
      if (nodeId == null || !tabId) return;
      if (typeof extensionId === 'string' && extensionId) {
        io.to(extensionId).emit('dom:highlight', { nodeId, tabId, url });
        return;
      }
      for (const client of this.registry.summary()) {
        if (client.type === 'extension') {
          io.to(client.id).emit('dom:highlight', { nodeId, tabId, url });
        }
      }
    });

    socket.on(
      'dom:get-content',
      (payload: Record<string, unknown>, ack?: (res: unknown) => void) => {
        this.relayToExtension(payload, 'dom:get-content', ack, 15_000);
      },
    );

    socket.on(
      'dom:execute-actions',
      (payload: Record<string, unknown>, ack?: (res: unknown) => void) => {
        this.relayToExtension(payload, 'dom:execute-actions', ack, 60_000);
      },
    );

    socket.on(
      'dom:plan-step',
      (payload: Record<string, unknown>, ack?: (res: unknown) => void) => {
        this.relayPlanStepToExtension(payload, ack, 45_000);
      },
    );

    socket.on('disconnect', () => {
      this.registry.delete(socket.id);
      this.logger.log(`[${type}] disconnected: ${name} (${socket.id})`);
      io.emit('clients:update', this.registry.summary());
    });
  }

  private relayToExtension(
    payload: Record<string, unknown> | undefined,
    event: string,
    ack?: (res: unknown) => void,
    timeoutMs = 15_000,
  ): void {
    const io = this.io!;
    const { extensionId, nodeId, tabId } = payload ?? {};
    if (nodeId == null || !tabId) {
      ack?.({ error: 'Missing nodeId or tabId' });
      return;
    }

    const targetId =
      (typeof extensionId === 'string' && extensionId) ||
      this.registry.findExtensionSocketId();
    if (!targetId) {
      ack?.({ error: 'No extension connected' });
      return;
    }

    const extSocket = io.sockets.sockets.get(targetId);
    if (!extSocket) {
      ack?.({ error: 'Extension socket not found' });
      return;
    }

    extSocket
      .timeout(timeoutMs)
      .emit(event, payload, (err: Error, res: unknown) => {
        if (err) {
          ack?.({ error: err.message ?? 'Extension request timed out' });
          return;
        }
        ack?.(res ?? { error: 'No response from extension' });
      });
  }

  private relayPlanStepToExtension(
    payload: Record<string, unknown> | undefined,
    ack?: (res: unknown) => void,
    timeoutMs = 45_000,
  ): void {
    const io = this.io!;
    const { extensionId, tabId, step, frameId } = payload ?? {};
    const stepObj = step as
      { action?: string; element_index?: number } | undefined;
    if (!tabId || !stepObj?.action) {
      ack?.({ ok: false, error: 'Missing tabId or step' });
      return;
    }

    const targetId =
      (typeof extensionId === 'string' && extensionId) ||
      this.registry.findExtensionSocketId();
    if (!targetId) {
      ack?.({ ok: false, error: 'No extension connected' });
      return;
    }

    const extSocket = io.sockets.sockets.get(targetId);
    if (!extSocket) {
      ack?.({ ok: false, error: 'Extension socket not found' });
      return;
    }

    this.logger.log(
      `[dom:plan-step] ${stepObj.action} index=${stepObj.element_index ?? '-'} tab=${tabId} frame=${frameId ?? 'auto'}`,
    );

    extSocket
      .timeout(timeoutMs)
      .emit('dom:plan-step', payload, (err: Error, res: unknown) => {
        if (err) {
          ack?.({
            ok: false,
            error: err.message ?? 'Extension request timed out',
          });
          return;
        }
        ack?.(res ?? { ok: false, error: 'No response from extension' });
      });
  }
}

function extractToken(socket: Socket): string {
  const auth = socket.handshake.auth as { token?: string } | undefined;
  if (typeof auth?.token === 'string' && auth.token.trim()) {
    return auth.token.trim();
  }
  const header = String(socket.handshake.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match?.[1]?.trim()) return match[1].trim();
  const queryToken = socket.handshake.query.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  return '';
}
