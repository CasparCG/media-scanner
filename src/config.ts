import nconf from 'nconf'
import fs from 'node:fs'
import xml2js from 'xml2js'
import pkg from '../package.json' with { type: 'json' }

const defaults = {
	caspar: {
		config: './casparcg.config',
	},
	paths: {
		template: './template',
		media: './media',
		font: './font',
		ffmpeg: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
		ffprobe: process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
	},
	scanner: {
		paths: null,
		// Note: See https://www.npmjs.com/package/chokidar#api.
	},
	thumbnails: {
		width: 256,
		height: -1,
	},
	metadata: {
		fieldOrder: false, // This is an expensive check, as it requires decoding the beginning of the video
		fieldOrderScanDuration: 200, // Frames. Note: Needs sufficient motion (Not titlecard)
	},
	isProduction: process.env.NODE_ENV === 'production',
	logger: {
		level: process.env.NODE_ENV === 'production' ? 'info' : 'trace',
		name: pkg.name,
		print: process.env.NODE_ENV !== 'production',
	},
	http: {
		port: 8000,
		host: undefined,
	},
}

const args = {
	'caspar.config': {
		describe:
			'CasparCG config file. Values in this file override any paths.* options. \nDefault: ' + defaults.caspar.config,
		group: 'Caspar',
		requiresArg: true,
	},
	'paths.template': {
		describe: 'Template path. \nDefault: ' + defaults.paths.template,
		group: 'Paths',
		requiresArg: true,
	},
	'paths.media': {
		describe: 'Media path. \nDefault: ' + defaults.paths.media,
		group: 'Paths',
		requiresArg: true,
	},
	'paths.font': {
		describe: 'Font path. \nDefault: ' + defaults.paths.font,
		group: 'Paths',
		requiresArg: true,
	},
	'paths.ffmpeg': {
		describe: 'FFmpeg binary path. \nDefault: ' + defaults.paths.ffmpeg,
		group: 'Paths',
		requiresArg: true,
	},
	'paths.ffprobe': {
		describe: 'FFprobe binary path. \nDefault: ' + defaults.paths.ffprobe,
		group: 'Paths',
		requiresArg: true,
	},
	'scanner.paths': {
		describe: 'Scanner paths (argument can be repeated)',
		group: 'Scanner',
		requiresArg: true,
	},
	'thumbnails.width': {
		describe: 'Thumbnail width. \nDefault: ' + defaults.thumbnails.width,
		group: 'Thumbnails',
		requiresArg: true,
	},
	'thumbnails.height': {
		describe: 'Thumbnail height. \nDefault: ' + defaults.thumbnails.height,
		group: 'Thumbnails',
		requiresArg: true,
	},
	'metadata.fieldOrder': {
		describe: 'Check field order. This is an expensive check, as it requires decoding the beginning of the video',
		group: 'Metadata',
		requiresArg: true,
	},
	'metadata.fieldOrderScanDuration': {
		describe:
			'Field order scan duration (frames), Note: Needs sufficient motion (Not titlecard). \nDefault: ' +
			defaults.metadata.fieldOrderScanDuration,
		group: 'Metadata',
		requiresArg: true,
	},
	'logger.level': {
		describe: 'Logger level. \nDefault: ' + defaults.logger.level,
		group: 'Logger',
		requiresArg: true,
	},
	'logger.name': {
		describe: 'Logger name. \nDefault: ' + defaults.logger.name,
		group: 'Logger',
		requiresArg: true,
	},
	'logger.print': {
		describe: 'Logger print to console. \nDefault: ' + defaults.logger.print,
		group: 'Logger',
		requiresArg: true,
	},
	'http.port': {
		describe: 'HTTP port. \nDefault: ' + defaults.http.port,
		group: 'HTTP',
		requiresArg: true,
	},
	'http.host': {
		describe: 'HTTP host. \nDefault: ' + defaults.http.host,
		group: 'HTTP',
		requiresArg: true,
	},
}

export const config = nconf.argv(args).env('__').defaults(defaults).get()

if (config.caspar && config.caspar.config) {
	const parser = new xml2js.Parser()
	const data = fs.readFileSync(config.caspar.config)
	parser.parseString(data, (err, result) => {
		if (err) {
			throw err
		}
		for (const path in result.configuration.paths[0]) {
			config.paths[path.split('-')[0]] = result.configuration.paths[0][path][0]
		}
	})
}

if (!config.scanner.path) {
	config.scanner.paths = config.paths.media
}
