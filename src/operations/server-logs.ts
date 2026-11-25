import { performance } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';
import { routeTemplate } from '../common/logger';
import type { ServerLogSnapshot, ServerRequestLog } from '../shared/domain/site-settings';

const capacity = 300;
const startedAt = new Date().toISOString();
const entries: ServerRequestLog[] = [];
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export function captureRequest(onError: (e: ServerRequestLog) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    res.once('finish', () => {
      const route = routeTemplate(req);
      if (
        route.endsWith('/admin/server-logs') ||
        route.endsWith('/health') ||
        route.endsWith('/admin/developer/view')
      )
        return;
      const id = res.getHeader('x-request-id');
      if (typeof id !== 'string') return;
      const status = res.statusCode;
      const entry: ServerRequestLog = {
        id,
        at: new Date().toISOString(),
        method: methods.has(req.method) ? req.method : 'OTHER',
        route,
        status,
        durationMs: Math.round((performance.now() - start) * 10) / 10,
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      };
      entries.push(entry);
      if (entry.status >= 400) onError(entry);
      if (entries.length > capacity) entries.shift();
    });
    next();
  };
}
export function recentServerLogs(): ServerLogSnapshot {
  return { source: 'server', capacity, startedAt, entries: entries.slice().reverse() };
}
