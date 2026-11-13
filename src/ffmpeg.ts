import path from 'node:path'
import os from 'node:os'
import cp from 'node:child_process'
import fs from 'node:fs/promises'
import moment from 'moment'
import { MediaDocument, PouchDBMediaDocument } from './db.js'
import { getId } from './util.js'

/** The parts of ffprobe's `-show_format -show_streams` JSON that thumbnail selection reads. */
export interface FFprobeResult {
	format?: { duration?: string; [key: string]: unknown }
	streams?: Array<{
		codec_type?: string
		codec_name?: string
		duration?: string
		disposition?: { attached_pic?: number }
		[key: string]: unknown
	}>
}

/** A media file shorter than this is treated as a still, as in generateCinf. */
const STILL_LIMIT_SECONDS = 0.1

/**
 * Where to start looking for the thumbnail frame, in seconds.
 *
 * The first frame is a poor thumbnail for broadcast media: clips fade up from black and
 * graphics with an alpha channel open fully transparent, so every lower third would look
 * empty. When the probe shows a moving picture, the search starts `thumbnails.position`
 * (a fraction of the duration) into the file. Stills, audio with a poster image and files
 * that could not be probed start at the beginning, as before.
 */
export function thumbnailSeekSeconds(config: Record<string, any>, probe: FFprobeResult | undefined): number {
	const position = Number(config.thumbnails?.position)
	if (!(position > 0 && position < 1) || !probe?.streams) return 0

	const duration = parseFloat(probe.format?.duration ?? '')
	if (!(duration >= STILL_LIMIT_SECONDS)) return 0

	const movingPicture = probe.streams.some(
		(stream) =>
			stream.codec_type === 'video' &&
			stream.codec_name !== 'gif' &&
			stream.disposition?.attached_pic !== 1 &&
			(Number(stream.duration || probe.format?.duration) || 0) >= STILL_LIMIT_SECONDS
	)
	return movingPicture ? duration * position : 0
}

/**
 * The video filter for a thumbnail: scale first, so the `thumbnail` filter compares and buffers
 * small frames rather than full-resolution ones, then pick the most representative frame of the
 * next `thumbnails.frames` frames. From FFmpeg 4.4 the alpha channel is kept, so a graphic stays a
 * graphic; up to 4.3 the `thumbnail` filter accepts no alpha format, so there it arrives over black.
 * With one frame or fewer there is nothing to choose between (and the filter needs at least
 * two), so the frame at the seek point is used as it is.
 */
export function thumbnailFilter(config: Record<string, any>): string {
	const scale = `scale=${config.thumbnails.width}:${config.thumbnails.height}`
	const frames = Math.floor(Number(config.thumbnails?.frames) || 0)
	return frames >= 2 ? `${scale},thumbnail=${frames}` : scale
}

async function renderThumb(
	config: Record<string, any>,
	mediaPath: string,
	outPath: string,
	seekSeconds: number
): Promise<void> {
	const args = [
		// TODO (perf) Low priority process?
		config.paths.ffmpeg,
		'-hide_banner',
		'-loglevel error',
		// Before -i, so ffmpeg seeks the input rather than decoding everything up to the point.
		seekSeconds > 0 ? `-ss ${seekSeconds.toFixed(3)}` : '',
		'-i',
		`"${mediaPath}"`,
		'-an',
		'-sn',
		'-dn',
		// A single -vf: ffmpeg applies only the last of several, which is how the earlier
		// `-vf select=... -vf scale=...` silently lost its frame selection.
		`-vf ${thumbnailFilter(config)}`,
		'-frames:v 1',
		'-threads 1',
		'-y',
		`"${outPath}"`,
	].filter((arg) => arg !== '')

	await new Promise<void>((resolve, reject) => {
		cp.exec(args.join(' '), (err) => (err ? reject(err) : resolve()))
	})
	// ffmpeg exits successfully without writing a file when no frame reached the encoder,
	// for example after seeking past the last decodable frame.
	await fs.stat(outPath)
}

export async function generateThumb(
	config: Record<string, any>,
	doc: PouchDBMediaDocument,
	probe?: FFprobeResult
): Promise<void> {
	const tmpPath = path.join(os.tmpdir(), Math.random().toString(16)) + '.png'
	await fs.mkdir(path.dirname(tmpPath), { recursive: true })

	try {
		const seekSeconds = thumbnailSeekSeconds(config, probe)
		try {
			await renderThumb(config, doc.mediaPath, tmpPath, seekSeconds)
		} catch (err) {
			// A file whose duration is wrong or that cannot seek still gets a thumbnail from its start.
			if (seekSeconds === 0) throw err
			await renderThumb(config, doc.mediaPath, tmpPath, 0)
		}

		const thumbStat = await fs.stat(tmpPath)
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
				data: await fs.readFile(tmpPath),
			},
		}
	} finally {
		await fs.rm(tmpPath, { force: true })
	}
}

/**
 * Probes the file, fills in `cinf` (and `mediainfo` when metadata is enabled) and returns the
 * ffprobe result, which generateThumb uses to choose where to take the thumbnail from.
 */
export async function generateInfo(config: Record<string, any>, doc: PouchDBMediaDocument): Promise<FFprobeResult> {
	const json = await new Promise<FFprobeResult>((resolve, reject) => {
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

	return json
}

type Timebase = [number, number]

function generateCinf(config: Record<string, any>, doc: MediaDocument, json: any) {
	const dur = parseFloat(json.format.duration) || 1 / 24
	const stillLimit = 0.1

	let audioTb: Timebase | null = null
	let videoTb: Timebase | null = null
	let stillTb: Timebase | null = null
	let audioDur = 0

	for (const stream of json.streams) {
		if (stream.codec_type === 'audio') {
			if (!audioTb) {
				audioTb = (stream.time_base || '1/25').split('/')
				audioDur = parseFloat(stream.duration)
			}
		} else if (stream.codec_type === 'video') {
			// Sometimes the stream has no duration, so fallback to using the file duration
			const streamDuration = Number(stream.duration || json.format.duration) || 0

			if (streamDuration < stillLimit || stream.codec_name == 'gif' || stream.disposition.attached_pic === 1) {
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
	} else if ((stillTb && !audioTb) || (stillTb && audioTb && audioDur < stillLimit)) {
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
			moment(doc.mediaTime).format('YYYYMMDDHHmmss'),
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
			frame_rate: s.avg_frame_rate || s.r_frame_rate,

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
