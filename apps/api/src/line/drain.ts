import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import { sendPendingLineMessages } from './sender.js';

/**
 * One pass of the LINE queue, from the command line: `npm run line:drain -w apps/api`.
 *
 * Two uses. The smoke suite drives the sender through this rather than waiting
 * for the API's own timer — a timer running during the suite would drain rows
 * that other sections assert are still `pending`, and a test that waits on a
 * clock is a test that fails on a slow machine. And an operator can flush the
 * queue after fixing a credential without restarting the service.
 *
 * Prints the outcome as JSON so a script can read it.
 */
async function main(): Promise<void> {
  const result = await sendPendingLineMessages();
  console.log(JSON.stringify({ ...result, dryRun: env.lineDryRun, configured: env.lineConfigured }));
  await prisma.$disconnect();
}

void main();
