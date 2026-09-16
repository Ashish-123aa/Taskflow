import { createLogger } from '@taskflow/shared';
import { env } from './env';

export const logger = createLogger('api', env.NODE_ENV === 'production');
