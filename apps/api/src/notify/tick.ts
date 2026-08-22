import { prisma } from '../db/prisma.js';
import { runReminderTick } from './reminders.js';

/**
 * One reminder pass from the command line: `npm run notify:tick -w apps/api`.
 *
 * The same two uses as `line/drain.ts`. The smoke suite drives the tick through
 * this rather than waiting for the API's own timer, and an operator can run it
 * by hand after fixing a due date without restarting the service.
 *
 * Prints the counts as JSON so a script can read them.
 */
async function main(): Promise<void> {
  console.log(JSON.stringify(await runReminderTick()));
  await prisma.$disconnect();
}

void main();
