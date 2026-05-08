import * as fs from 'node:fs/promises'
import { rimraf } from 'rimraf'
import cp from 'node:child_process'
import { zip, tar } from 'zip-a-folder'
import { build } from 'esbuild'
// import pkg from '@yao-pkg/pkg'

const platform = process.argv[2] || process.platform
const arch = process.argv[3] || process.arch

console.log(`Building for ${platform}-${arch}`)

// await rimraf('deploy')
await fs.mkdir('deploy', { recursive: true })

console.log('Building with esbuild...')
await build({
	entryPoints: ['packages/app/src/main.ts'],
	bundle: true,
	minify: false,
	platform: 'node',
	target: ['node24'],
	external: [],
	outfile: 'deploy/helper.js',
})

// Copy leveldown
console.log('Copying leveldown prebuilds...')
await fs.mkdir(`deploy/prebuilds`, { recursive: true })
await fs.cp(`./node_modules/leveldown/prebuilds/${platform}-${arch}`, `deploy/prebuilds/${platform}-${arch}`, {
	recursive: true,
})
// Copy assets
console.log('Copying assets...')
// Copy renderer
await fs.cp(`./packages/ograf-renderer/dist`, `deploy/assets/renderer`, {
	recursive: true,
})

// Determine version and package name for archive naming

const packageJson = await fs.readFile('./package.json')
const pkg = JSON.parse(packageJson)
const version = pkg.version

console.log(`Version: ${version}`)

const packageName = 'casparcg-helper'

const unpacked = !!process.env.UNPACKED
if (!unpacked) {
	await fs.writeFile(
		'deploy/package.json',
		JSON.stringify({
			name: 'casparcg-helper',
			version,
			description: 'CasparCG Helper',
			main: 'helper.js',
			bin: {
				helper: './helper.js',
			},
			pkg: {
				assets: ['prebuilds/**/*', 'assets/**/*'],
			},
		})
	)
	// process.exit(0)
	// Run pkg
	const filename = `${packageName}-v${version}-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`
	await rimraf(`deploy/${filename}`)
	try {
		cp.execSync(`pkg -t node24-${platform} . -o ${filename}`, { cwd: './deploy' })
	} catch (error) {
		console.log(error.stdout.toString())
		// eslint-disable-next-line n/no-process-exit
		process.exit(1)
	}

	await rimraf(['deploy/package.json', 'deploy/helper.js', 'deploy/prebuilds', 'deploy/assets'])
}

// Archive the deploy folder — tar.gz on Linux, zip everywhere else
const archiveSuffix = unpacked ? '-unpacked' : ''
const archiveExt = platform === 'linux' ? '.tar.gz' : '.zip'
const archiveFileName = `${packageName}-v${version}${archiveSuffix}-${platform}-${arch}${archiveExt}`

await rimraf(`./${archiveFileName}`)

if (platform === 'linux') {
	await tar('./deploy', `./${archiveFileName}`)
} else {
	await zip('./deploy', `./${archiveFileName}`)
}

await fs.rename(`./${archiveFileName}`, `./deploy/${archiveFileName}`)
