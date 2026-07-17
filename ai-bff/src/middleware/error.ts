import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.flatten(),
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  const status =
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;

  if (status === 401) {
    res.status(401).json({
      error: message,
      hint: 'Check API keys in ai-bff/.env or request apiKeys — placeholder values like sk-... are ignored. Use DEFAULT_MODEL for the provider you configured.',
    });
    return;
  }

  console.error('[ai-bff]', err);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
}
