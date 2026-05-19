import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

async function main() {
  console.log('Testing S3 on Bun...');
  const s3 = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
  });

  try {
    const cmd = new PutObjectCommand({
      Bucket: 'test-bucket',
      Key: 'test-key.txt',
      ContentType: 'text/plain',
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 604800 }); // 7 days
    console.log('Generated presigned URL:', url.substring(0, 50) + '...');
    console.log('ExpiresIn 7 days is accepted!');
    
    // We cannot perform the actual round-trip HTTP PUT because the bucket is fake.
    // However, generating the URL ensures the cryptographic Node-compat works in Bun.
    console.log('S3 Smoke test passed');
  } catch (err) {
    console.error('S3 Smoke test failed:', err);
    process.exit(1);
  }
}

main();
