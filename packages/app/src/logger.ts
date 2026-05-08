import pino from 'pino'
import { Config } from '@helper/shared'

export function initializeLogger(config: Config): pino.Logger {
	return pino(
		Object.assign({}, config.logger, {
			serializers: {
				err: pino.stdSerializers.err,
			},
		})
	)
}
