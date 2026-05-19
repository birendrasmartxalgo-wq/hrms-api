import { Elysia, t } from 'elysia';

async function main() {
  console.log('Testing Elysia WS...');

  const app = new Elysia()
    .ws('/socket', {
      body: t.Object({
        type: t.String(),
        data: t.Any(),
      }),
      message(ws, message) {
        if (message.type === 'ping') {
          ws.send({ type: 'pong', data: 'ok' }); // auto stringify?
        }
      },
    })
    .listen(0); // arbitrary port

  const port = app.server?.port;
  console.log(`Server listening on port ${port}`);

  const ws = new WebSocket(`ws://localhost:${port}/socket`);
  let passed = false;

  ws.onopen = () => {
    // 1. Send invalid frame
    ws.send(JSON.stringify({ wrong: 'frame' }));
  };

  ws.onmessage = (event) => {
    // The Elysia WS might send an error back or drop the connection.
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'validation' || parsed.errors) {
        console.log('Received validation error message!');
        passed = true;
        ws.close();
      }
    } catch (e) {
      // ignore
    }
  };

  ws.onclose = (event) => {
    console.log('WS closed after invalid frame. Moving to valid frame test...');
    
    // Now test valid frame
    if (passed) {
      passed = false; // reset for next test
      console.log('Testing valid frame...');
      const ws2 = new WebSocket(`ws://localhost:${port}/socket`);
      ws2.onopen = () => {
        ws2.send(JSON.stringify({ type: 'ping', data: {} }));
      };
      ws2.onmessage = (ev) => {
        const parsed = JSON.parse(ev.data);
        if (parsed.type === 'pong') {
          console.log('ws.send auto-stringify works!');
          passed = true;
        }
        ws2.close();
      };
      ws2.onclose = () => {
        if (passed) {
          console.log('WS Smoke test passed');
          app.stop();
          process.exit(0);
        } else {
          console.log('WS Smoke test failed on valid frame');
          app.stop();
          process.exit(1);
        }
      };
    } else {
      console.log('WS Smoke test failed on invalid frame');
      app.stop();
      process.exit(1);
    }
  };

  ws.onerror = (error) => {
    console.log('WS error:', error);
  };
}

main();
