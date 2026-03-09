import fs from 'fs/promises'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'
import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
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
	} catch (_e) {
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
			if (!version.sha256) throw new Error(`SHA256 checksum not set for ${version.id} (${version.url})`)

			console.log(`Fetching ${version.url}`)
			// Download it

			const response = await fetch(version.url)
			if (!response.ok) throw new Error(`unexpected response ${response.statusText}`)
			await streamPipeline(response.body, createWriteStream(tmpPath))

			// Verify SHA256 checksum
			const fileBuffer = await fs.readFile(tmpPath)
			const actualHash = createHash('sha256').update(fileBuffer).digest('hex')
			if (actualHash !== version.sha256) {
				await fs.rm(tmpPath)
				throw new Error(`SHA256 mismatch for ${version.url}\n  expected: ${version.sha256}\n  actual:   ${actualHash}`)
			}

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
