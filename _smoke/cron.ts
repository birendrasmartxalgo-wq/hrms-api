import { Elysia } from 'elysia';
import { cron } from '@elysiajs/cron';

async function main() {
  console.log('Testing Elysia Cron...');
  
  let triggered = false;
  
  const app = new Elysia()
    .use(
      cron({
        name: 'testJob',
        pattern: '0 0 1 1 *', // Jan 1st
        run: () => {
          console.log('Cron job ran!');
          triggered = true;
        }
      })
    );

  try {
    // Attempt manual trigger
    console.log('Triggering job manually...');
    // @ts-ignore - store.cron typing might not show trigger() without extra type imports
    if (app.store.cron?.testJob?.trigger) {
      app.store.cron.testJob.trigger();
    } else {
      throw new Error('trigger() method not found on app.store.cron.testJob');
    }

    if (triggered) {
      console.log('Manual trigger works!');
    } else {
      throw new Error('trigger() ran but callback was not invoked synchronously');
    }
  } catch (err) {
    console.error('Cron Smoke test failed:', err);
    process.exit(1);
  }
}

main();
