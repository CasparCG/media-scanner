import * as fs from 'node:fs/promises'
import { rimraf } from 'rimraf'
import cp from 'node:child_process'
import { zip } from 'zip-a-folder'
import { build } from 'esbuild'
// import pkg from '@yao-pkg/pkg'

const platform = process.argv[2] || process.platform
const arch = process.argv[3] || process.arch

console.log(`Building for ${platform}-${arch}`)

await rimraf('deploy')
await fs.mkdir('deploy', { recursive: true })

await build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	minify: false,
	platform: 'node',
	target: ['node24'],
	external: [],
	outfile: 'deploy/scanner.js',
})

// Copy leveldown
await fs.mkdir(`deploy/prebuilds`, { recursive: true })
await fs.cp(`./node_modules/leveldown/prebuilds/${platform}-${arch}`, `deploy/prebuilds/${platform}-${arch}`, {
	recursive: true,
})

// Create zip
const packageJson = await fs.readFile('./package.json')
const pkg = JSON.parse(packageJson)
const version = pkg.version

const packageName = 'casparcg-scanner'

const unpacked = !!process.env.UNPACKED
if (!unpacked) {
	await fs.writeFile(
		'deploy/package.json',
		JSON.stringify({
			name: 'casparcg-scanner',
			version: '0.0.0',
			description: 'CasparCG Media Scanner',
			main: 'scanner.js',
			bin: {
				scanner: './scanner.js',
			},
			pkg: {
				assets: 'prebuilds/**/*',
			},
		})
	)

	// Run pkg
	const filename = `${packageName}-v${version}-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`
	try {
		cp.execSync(`pkg -t node24-${platform} . -o ${filename}`, { cwd: './deploy' })
	} catch (error) {
		console.log(error.stdout.toString())
		// eslint-disable-next-line n/no-process-exit
		process.exit(1)
	}

	await rimraf(['deploy/package.json', 'deploy/scanner.js', 'deploy/prebuilds'])
} else {
	const zipFileName = `${packageName}-v${version}-unpacked-${platform}-${arch}.zip`

	const err = await zip('./deploy', `./${zipFileName}`)
	if (err) {
		throw new Error(err)
	}

	await fs.rename(`./${zipFileName}`, `./deploy/${zipFileName}`)
}
