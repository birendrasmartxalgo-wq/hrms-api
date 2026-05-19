import { Elysia } from 'elysia';

const startedAt = new WeakMap<Request, number>();

type LoggerContext = {
  request: Request;
  path?: string;
  set: { status?: number | string };
  requestId?: string;
  user?: { userId: string } | null;
};

export const loggerPlugin = new Elysia({ name: 'logger' })
  .onRequest(({ request }) => {
    startedAt.set(request, performance.now());
  })
  .onAfterResponse((context) => {
    const { request, path, set } = context as LoggerContext;
    const start = startedAt.get(request) ?? performance.now();
    const url = new URL(request.url);

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        method: request.method,
        path: path ?? url.pathname,
        status: typeof set.status === 'number' ? set.status : 200,
        ms: Math.round((performance.now() - start) * 100) / 100,
        requestId: (context as LoggerContext).requestId,
        userId: (context as LoggerContext).user?.userId,
      }),
    );
  });
