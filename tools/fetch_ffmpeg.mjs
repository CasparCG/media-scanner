import fs from 'fs/promises'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'
import { createWriteStream } from 'node:fs'
import path from 'path'
import cp from 'child_process'

const targetVersions = JSON.parse(await fs.readFile('./src/__tests__/ffmpegReleases.json'))

const toPosix = (str) => str.split(path.sep).join(path.posix.sep)

const streamPipeline = promisify(pipeline)

const ffmpegRootDir = './.ffmpeg'
await fs.mkdir(ffmpegRootDir).catch(() => null)

async function pathExists(path) {
	try {
		await fs.stat(path)
		return true
	} catch (e) {
		return false
	}
}

const platformInfo = `${process.platform}-${process.arch}`
const platformVersions = targetVersions[platformInfo]

if (platformVersions) {
	const tmpPath = path.join(ffmpegRootDir, 'tmp')

	for (const version of platformVersions) {
		const versionPath = path.join(ffmpegRootDir, version.id)
		const dirStat = await pathExists(versionPath)
		if (!dirStat) {
			console.log(`Fetching ${version.url}`)
			// Download it

			// eslint-disable-next-line no-undef
			const response = await fetch(version.url)
			if (!response.ok) throw new Error(`unexpected response ${response.statusText}`)
			await streamPipeline(response.body, createWriteStream(tmpPath))

			// Extract it
			if (version.url.endsWith('.tar.xz')) {
				await fs.mkdir(versionPath).catch(() => null)
				cp.execSync(`tar -xJf ${toPosix(tmpPath)} --strip-components=1 -C ${toPosix(versionPath)}`)
			} else if (version.url.endsWith('.zip')) {
				cp.execSync(`unzip ${toPosix(tmpPath)} -d ${toPosix(ffmpegRootDir)}`)

				const dirname = path.parse(version.url).name
				await fs.rename(path.join(ffmpegRootDir, dirname), versionPath)
			} else {
				throw new Error(`Unhandled file extension: ${version.url}`)
			}
			await fs.rm(tmpPath)
		}
	}
} else {
	throw new Error(`FFmpeg downloading for "${platformInfo}" not supported yet`)
}
