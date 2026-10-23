/**
 * Answers what it was handed.
 */

import { serveToolThread } from '../../index.ts';

serveToolThread((job: unknown) => ({ echoed: job }));
