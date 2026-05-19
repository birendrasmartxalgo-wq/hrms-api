import { swagger } from '@elysiajs/swagger';
import { env } from '../env';

export const swaggerPlugin = swagger({
  path: '/docs',
  documentation: {
    info: {
      title: 'HRMS API',
      version: env.API_VERSION,
      description: 'SmartXAlgo HRMS API',
    },
  },
});
