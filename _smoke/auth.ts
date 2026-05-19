import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';

const { app } = await import('../src/index');
const { env } = await import('../src/env');
const { connectDb } = await import('../src/db/client');

async function main() {
  const replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  env.MONGO_URI = replset.getUri();

  await connectDb();

  // Start app
  app.listen(0);
  const port = app.server?.port;
  const baseUrl = `http://localhost:${port}/api/v1/auth`;

  try {
    console.log('Testing /register...');
    const regRes = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@smartxalgo.com',
        password: 'password123',
        name: 'Test User'
      })
    });
    
    if (!regRes.ok) throw new Error(`Register failed: ${await regRes.text()}`);
    const regData = await regRes.json();
    console.log('Register OK:', regData.user.email);

    console.log('Testing /login...');
    const loginRes = await fetch(`${baseUrl}/login?client=web`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@smartxalgo.com',
        password: 'password123'
      })
    });

    if (!loginRes.ok) throw new Error(`Login failed: ${await loginRes.text()}`);
    const loginData = await loginRes.json();
    console.log('Login OK:', Object.keys(loginData));

    const token = loginData.token;
    const refreshToken = loginData.refreshToken;

    console.log('Testing /me...');
    const meRes = await fetch(`${baseUrl}/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!meRes.ok) throw new Error(`Me failed: ${await meRes.text()}`);
    const meData = await meRes.json();
    console.log('Me OK:', meData.user.name, 'Employee:', !!meData.user.employee);

    console.log('Testing /refresh...');
    const refRes = await fetch(`${baseUrl}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!refRes.ok) throw new Error(`Refresh failed: ${await refRes.text()}`);
    const refData = await refRes.json();
    console.log('Refresh OK, new token starts with:', refData.token.substring(0, 10));

    console.log('All Auth smoke tests passed!');
  } finally {
    app.stop();
    await replset.stop();
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
