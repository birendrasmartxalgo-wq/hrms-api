import { treaty } from '@elysiajs/eden';
import { Elysia, t } from 'elysia';

// Define a simple app to test
const app = new Elysia()
  .post('/test', ({ body }) => {
    return { ok: true, received: body.value };
  }, {
    body: t.Object({ value: t.String() })
  });

type App = typeof app;

async function main() {
  console.log('Testing Eden Treaty type inference and runtime...');

  // Start app just to have something to fetch against
  app.listen(0);
  const port = app.server?.port;

  const client = treaty<App>(`http://localhost:${port}`);

  // 1. Type inference: `client.test.post` should require `{ value: string }`
  const res = await client.test.post({ value: 'hello' });
  
  if (res.data?.ok && res.data.received === 'hello') {
    console.log('Eden Treaty inference and runtime works!');
    console.log('Eden Treaty smoke test passed');
    app.stop();
    process.exit(0);
  } else {
    console.error('Eden Treaty test failed', res.error);
    app.stop();
    process.exit(1);
  }
}

main();
