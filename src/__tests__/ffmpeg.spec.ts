import { generateInfo } from '../ffmpeg'
import { PouchDBMediaDocument } from '../db'
import path from 'path'
import moment from 'moment'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const targetVersions = require('./ffmpegReleases.json')

const testMediaPath = path.join(__dirname, 'samples')

function runForFFmpegRelease(ffprobePath: string, ffmpegPath: string) {
	function createBareDoc(filename: string): PouchDBMediaDocument {
		return {
			_id: 'test',
			_rev: '0',
			mediaPath: path.join(testMediaPath, filename),
			mediaSize: 45678,
			mediaTime: moment('2023-12-06 12:34:56').unix() * 1000,
		}
	}
	const defaultConfig = {
		metadata: null,
		paths: {
			media: testMediaPath,
			ffprobe: ffprobePath,
			ffmpeg: ffmpegPath,
		},
	}

	test('png', async () => {
		const doc = createBareDoc('grey.png')
		await generateInfo(defaultConfig, doc)
		expect(doc.cinf).toBe('"GREY"  STILL  45678 20231206123456 0 0/1\r\n')
	})
}

const ffprobeFilename = process.platform === 'win32' ? 'bin/ffprobe.exe' : 'ffprobe'
const ffmpegFilename = process.platform === 'win32' ? 'bin/ffmpeg.exe' : 'ffmpeg'

const ffmpegRootPath = path.join(__dirname, '../../.ffmpeg')
for (const version of targetVersions[`${process.platform}-${process.arch}`]) {
	describe(`FFmpeg ${version.id}`, () => {
		runForFFmpegRelease(
			path.join(ffmpegRootPath, version.id, ffprobeFilename),
			path.join(ffmpegRootPath, version.id, ffmpegFilename)
		)
	})
}
