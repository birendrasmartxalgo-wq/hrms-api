import { Elysia, t } from 'elysia';

async function main() {
  console.log('Testing t.File runtime validation...');

  const app = new Elysia()
    .post('/upload', ({ body }) => {
      return { ok: true, name: body.file.name };
    }, {
      body: t.Object({
        file: t.File({ type: 'image/png', maxSize: 1024 * 1024 })
      })
    })
    .listen(0);

  const port = app.server?.port;

  // 1. Create a dummy txt file
  const form1 = new FormData();
  form1.append('file', new File(['hello'], 'test.txt', { type: 'text/plain' }));

  const res1 = await fetch(`http://localhost:${port}/upload`, {
    method: 'POST',
    body: form1,
  });

  if (res1.status === 422) {
    console.log('Invalid file type correctly rejected.');
  } else {
    console.error('Failed to reject invalid file type.');
    process.exit(1);
  }

  // 2. Create a dummy png file
  const form2 = new FormData();
  form2.append('file', new File(['fake-png-data'], 'test.png', { type: 'image/png' }));

  const res2 = await fetch(`http://localhost:${port}/upload`, {
    method: 'POST',
    body: form2,
  });

  if (res2.ok) {
    console.log('Valid file type correctly accepted.');
  } else {
    console.error('Failed to accept valid file type. Status:', res2.status);
    console.error(await res2.text());
    process.exit(1);
  }

  console.log('t.File Smoke test passed');
  app.stop();
  process.exit(0);
}

main();
