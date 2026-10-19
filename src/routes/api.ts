import { Hono } from 'hono';

import type { AppEnv } from '../types.js';
import { annotationsRoutes } from './api/annotations.js';
import { attachmentsRoutes } from './api/attachments.js';
import { codexConnectionRoutes } from './api/codex-connection.js';
import { companyDeploymentsRoutes } from './api/company-deployments.js';
import { contextRoutes } from './api/context.js';
import { dbBackupRoutes } from './api/db-backups.js';
import { filesRoutes } from './api/files.js';
import { githubAccountsRoutes } from './api/github-accounts.js';
import { imageRoutes } from './api/image.js';
import { outlineRoutes } from './api/outline.js';
import { pluginsRoutes } from './api/plugins.js';
import { projectSettingsRoutes } from './api/project-settings.js';
import { reviewNotesRoutes } from './api/review-notes.js';
import { reviewsRoutes } from './api/reviews.js';
import { sharePromptRoutes } from './api/share-prompt.js';
import { slackReactionsRoutes } from './api/slack-reactions.js';
import { systemRoutes } from './api/system.js';

/**
 * Aggregator for the core JSON API mounted at `/api/*` in `server.ts`. Each
 * concern lives in its own focused sub-router under `routes/api/`; this
 * file just composes them.
 */
export const apiRoutes = new Hono<AppEnv>();

apiRoutes.route('/', reviewsRoutes);
apiRoutes.route('/', filesRoutes);
apiRoutes.route('/', annotationsRoutes);
apiRoutes.route('/', attachmentsRoutes);
apiRoutes.route('/', outlineRoutes);
apiRoutes.route('/', contextRoutes);
apiRoutes.route('/', projectSettingsRoutes);
apiRoutes.route('/', companyDeploymentsRoutes);
apiRoutes.route('/', githubAccountsRoutes);
apiRoutes.route('/', slackReactionsRoutes);
apiRoutes.route('/', codexConnectionRoutes);
apiRoutes.route('/', pluginsRoutes);
apiRoutes.route('/', imageRoutes);
apiRoutes.route('/', reviewNotesRoutes);
apiRoutes.route('/', sharePromptRoutes);
apiRoutes.route('/', systemRoutes);
apiRoutes.route('/', dbBackupRoutes);
