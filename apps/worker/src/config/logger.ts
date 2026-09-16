import { createLogger } from '@taskflow/shared';
import { env } from './env';

export const logger = createLogger('worker', env.NODE_ENV === 'production');
