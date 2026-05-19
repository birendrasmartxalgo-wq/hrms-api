import { MongoMemoryReplSet } from 'mongodb-memory-server';

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';

// Use default office: 20.2961, 85.8245, 200m
process.env.OFFICE_LAT = '20.2961';
process.env.OFFICE_LNG = '85.8245';
process.env.OFFICE_RADIUS_METRES = '200';

const { app } = await import('../src/index');
const { env } = await import('../src/env');
const { connectDb } = await import('../src/db/client');
const { collections } = await import('../src/db/collections');

async function main() {
  const replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  env.MONGO_URI = replset.getUri();

  await connectDb();

  // Create an approved employee
  const registerRes = await app.handle(new Request('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@smartxalgo.com', password: 'password', name: 'Test' })
  }));
  const registerData: any = await registerRes.json();
  const token = registerData.token;
  
  // Update onboarding to approved
  await collections.employees().updateOne(
    { name: 'Test' },
    { $set: { onboardingStatus: 'approved', canMarkAttendance: true } }
  );

  app.listen(0);
  const port = app.server?.port;
  const baseUrl = `http://localhost:${port}/api/v1/attendance`;

  try {
    console.log('Testing Punch In (Outside Geofence)...');
    const outsideRes = await fetch(`${baseUrl}/punch-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ lat: 21.0, lng: 86.0 }) // far away
    });

    if (outsideRes.status !== 422) {
      const text = await outsideRes.text();
      throw new Error(`Expected 422 for outside geofence, got ${outsideRes.status}: ${text}`);
    }
    const outsideData = await outsideRes.json();
    if (outsideData.code !== 'OUTSIDE_GEOFENCE') throw new Error(`Expected code OUTSIDE_GEOFENCE, got ${outsideData.code}`);
    console.log('Outside Geofence correctly rejected with 422');

    console.log('Testing Punch In (Inside Geofence)...');
    const insideRes = await fetch(`${baseUrl}/punch-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ lat: 20.2961, lng: 85.8245 }) // exactly at office
    });

    if (!insideRes.ok) throw new Error(`Punch in failed: ${await insideRes.text()}`);
    const insideData = await insideRes.json();
    console.log('Punch In OK:', insideData.message, 'withinGeofence:', insideData.geofence.withinGeofence);

    console.log('All Attendance smoke tests passed!');
  } finally {
    app.stop();
    await replset.stop();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
