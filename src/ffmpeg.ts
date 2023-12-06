import path from 'path'
import os from 'os'
import { mkdirp } from 'mkdirp'
import cp from 'child_process'
import fs from 'fs'
import util from 'util'
import moment from 'moment'
import { MediaDocument, PouchDBMediaDocument } from './db'
import { getId } from './util'

const statAsync = util.promisify(fs.stat)
const unlinkAsync = util.promisify(fs.unlink)
const readFileAsync = util.promisify(fs.readFile)

export async function generateThumb(config: Record<string, any>, doc: PouchDBMediaDocument) {
	const tmpPath = path.join(os.tmpdir(), Math.random().toString(16)) + '.png'

	const args = [
		// TODO (perf) Low priority process?
		config.paths.ffmpeg,
		'-hide_banner',
		'-i',
		`"${doc.mediaPath}"`,
		'-vf select=gt\\(scene,0.4\\)',
		`-vf scale=${config.thumbnails.width}:${config.thumbnails.height}`,
		'-frames:v 1',
		'-threads 1',
		tmpPath,
	]

	await mkdirp(path.dirname(tmpPath))
	await new Promise<void>((resolve, reject) => {
		cp.exec(args.join(' '), (err) => (err ? reject(err) : resolve()))
	})

	const thumbStat = await statAsync(tmpPath)
	doc.thumbSize = thumbStat.size
	doc.thumbTime = thumbStat.mtime.getTime()
	doc.tinf =
		[
			`"${getId(config.paths.media, doc.mediaPath)}"`,
			moment(doc.thumbTime).format('YYYYMMDDTHHmmss'),
			// TODO (fix) Binary or base64 size?
			doc.thumbSize,
		].join(' ') + '\r\n'

	doc._attachments = {
		'thumb.png': {
			content_type: 'image/png',
			data: await readFileAsync(tmpPath),
		},
	}
	await unlinkAsync(tmpPath)
}

export async function generateInfo(config: Record<string, any>, doc: PouchDBMediaDocument) {
	const json = await new Promise((resolve, reject) => {
		const args = [
			// TODO (perf) Low priority process?
			config.paths.ffprobe,
			'-hide_banner',
			'-i',
			`"${doc.mediaPath}"`,
			'-show_streams',
			'-show_format',
			'-print_format',
			'json',
		]
		cp.exec(args.join(' '), (err, stdout) => {
			if (err) {
				return reject(err)
			}

			const json = JSON.parse(stdout)
			if (!json.streams || !json.streams[0]) {
				return reject(new Error('not media'))
			}

			resolve(json)
		})
	})

	doc.cinf = generateCinf(config, doc, json)

	if (config.metadata !== null) {
		doc.mediainfo = await generateMediainfo(config, doc, json)
	}
}

type Timebase = [number, number]

function generateCinf(config: Record<string, any>, doc: MediaDocument, json: any) {
	const dur = parseFloat(json.format.duration) || 1 / 24

	let audioTb: Timebase | null = null
	let videoTb: Timebase | null = null
	let stillTb: Timebase | null = null

	for (const stream of json.streams) {
		if (stream.codec_type === 'audio') {
			if (!audioTb) audioTb = (stream.time_base || '1/25').split('/')
		} else if (stream.codec_type === 'video') {
			if (stream.codec_time_base === '0/1') {
				if (!stillTb) stillTb = [0, 1]
			} else {
				if (!videoTb) {
					const fr = String(stream.avg_frame_rate || stream.r_frame_rate || '').split('/')
					if (fr.length === 2) {
						videoTb = [Number(fr[1]), Number(fr[0])]
					} else {
						videoTb = (stream.time_base || '1/25').split('/')
					}
				}
			}
		}
	}

	let type: string
	let tb: Timebase
	if (videoTb) {
		type = ' MOVIE '
		tb = videoTb
	} else if (stillTb && !audioTb) {
		type = ' STILL '
		tb = stillTb
	} else {
		type = ' AUDIO '
		tb = audioTb ?? [0, 1]
	}

	return (
		[
			`"${getId(config.paths.media, doc.mediaPath)}"`,
			type,
			doc.mediaSize,
			moment(doc.thumbTime).format('YYYYMMDDHHmmss'),
			tb[0] === 0 ? 0 : Math.floor((dur * tb[1]) / tb[0]),
			`${tb[0]}/${tb[1]}`,
		].join(' ') + '\r\n'
	)
}

async function generateMediainfo(config: Record<string, any>, doc: PouchDBMediaDocument, json: any) {
	const fieldOrder = await new Promise((resolve, reject) => {
		if (!config.metadata.fieldOrder) {
			return resolve('unknown')
		}

		const args = [
			// TODO (perf) Low priority process?
			config.paths.ffmpeg,
			'-hide_banner',
			'-filter:v',
			'idet',
			'-frames:v',
			config.metadata.fieldOrderScanDuration,
			'-an',
			'-f',
			'rawvideo',
			'-y',
			process.platform === 'win32' ? 'NUL' : '/dev/null',
			'-i',
			`"${doc.mediaPath}"`,
		]
		cp.exec(args.join(' '), (err, _stdout, stderr) => {
			if (err) {
				return reject(err)
			}

			const resultRegex = /Multi frame detection: TFF:\s+(\d+)\s+BFF:\s+(\d+)\s+Progressive:\s+(\d+)/
			const res = resultRegex.exec(stderr)
			if (res === null) {
				return resolve('unknown')
			}

			const tff = parseInt(res[1])
			const bff = parseInt(res[2])
			const fieldOrder = tff <= 10 && bff <= 10 ? 'progressive' : tff > bff ? 'tff' : 'bff'

			resolve(fieldOrder)
		})
	})

	return {
		name: doc._id,
		path: doc.mediaPath,
		size: doc.mediaSize,
		time: doc.mediaTime,
		field_order: fieldOrder,

		streams: json.streams.map((s: any) => ({
			codec: {
				long_name: s.codec_long_name,
				type: s.codec_type,
				time_base: s.codec_time_base,
				tag_string: s.codec_tag_string,
				is_avc: s.is_avc,
			},

			// Video
			width: s.width,
			height: s.height,
			sample_aspect_ratio: s.sample_aspect_ratio,
			display_aspect_ratio: s.display_aspect_ratio,
			pix_fmt: s.pix_fmt,
			bits_per_raw_sample: s.bits_per_raw_sample,

			// Audio
			sample_fmt: s.sample_fmt,
			sample_rate: s.sample_rate,
			channels: s.channels,
			channel_layout: s.channel_layout,
			bits_per_sample: s.bits_per_sample,

			// Common
			time_base: s.time_base,
			start_time: s.start_time,
			duration_ts: s.duration_ts,
			duration: s.duration,

			bit_rate: s.bit_rate,
			max_bit_rate: s.max_bit_rate,
			nb_frames: s.nb_frames,
		})),
		format: {
			name: json.format.format_name,
			long_name: json.format.format_long_name,
			size: json.format.time,

			start_time: json.format.start_time,
			duration: json.format.duration,
			bit_rate: json.format.bit_rate,
			max_bit_rate: json.format.max_bit_rate,
		},
	}
}
