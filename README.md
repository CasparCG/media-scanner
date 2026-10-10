# CasparCG Media-Scanner

This project facilitates CasparCG Server since version 2.2.0. It abstracts the collection of metadata and generation of thumbnails into a separate process.

## Usage

This project is designed to be used via the AMCP protocol in CasparCG server. However, there are some endpoints for additional data which can only be access directly over http.

### Requirements

The scanner needs a copy of `ffmpeg` to be able to scan any media files. On windows, a copy of `ffmpeg.exe` should be placed in the same folder as the scanner executable. On linux, `ffmpeg` should be made available on the path.
You can override these locations in the scanner configuration.

### Configuration

There are various options that can be changed for the scanner. These can all be set by environment variables or as arguments.
Some features are disabled by default and should be enabled in this way.

To change options with arguments use the following syntax: `scanner.exe --metadata.scenes true --metadata.sceneThreshold 0.5`

The full set of available options and their default values can be found at [config.ts](src/config.ts)

By default the scanner expects there to be a casparcg.config file next to the executable to specify the paths to media. To disable use of this file `scanner.exe --caspar null`

### AMCP Endpoints

These endpoints are exposed by the AMCP protocol in CasparCG Server. This means that they have some AMCP syntax wrappings, which will likely need to be stripped off if using in an external client

- `/tls` - Lists available template files
- `/cls` - Lists available media files
- `/fls` - Lists available font files
- `/cinf/<name>` - Gets information on specified media file
- `/thumbnail/generate` - Backwards compatibility, has no effect
- `/thumbnail/generate/<name>` - Backwards compatibility, has no effect
- `/thumbnail` - Lists the available thumbnails
- `/thumbnail/<name>` - Gets the thumbnail for a media file
- `/templates` - Detailed list of templates in JSON format.
- `/media` - Lists available media files in json form with an enhanced set of metadata
- `/media/info/<name>` - Gets the json enhanced metadata for the specified media file
- `/media/thumbnail/<name>` - Gets the thumbnail for a media file

# For Developers

## Running in development

This project requires **Node.js 24.12 or later** (see `engines` in `package.json`). Get it from: https://nodejs.org/en/.

Dependencies are managed with **Yarn 4**, which is installed through [Corepack](https://github.com/nodejs/corepack):

- Node.js 24 bundles Corepack, so `corepack enable` is all that is needed.
- Node.js 25 and later no longer bundle it. Install it first with `npm install -g corepack`.
  - If npm fails with `EEXIST` on `yarn` or `pnpm`, an existing install is occupying that name. This includes the official `node:25` Docker images, which ship Yarn 1. `npm install -g corepack --force` replaces those shims.

Skipping this step makes `yarn install` fail with:

```
This project's package.json defines "packageManager": "yarn@4.12.0".
However the current global version of Yarn is 1.22.22.
```

Leveldown ships prebuilt binaries for `linux-x64`, `linux-arm64` and `win32-x64`, so no compiler or Python is needed on the supported platforms.

After this:

- Clone the repository
- [Required] Obtain the [_FFmpeg_ and _FFprobe_](https://ffmpeg.org/download.html) executables and place them in the root folder (or add them to your PATH).
  - FFmpeg 6.1 is currently recommended, newer versions have not been tested and may have issues
  - A full list of known working versions can be found at https://github.com/CasparCG/media-scanner/blob/master/src/__tests__/ffmpegReleases.json
- [Required] Copy a `casparcg.config` file into the root folder. The scanner reads its media and template paths from it, and exits with `ENOENT: no such file or directory, open './casparcg.config'` when it is missing.
- Run `corepack enable`
- Run `yarn install`
- Run `yarn dev` to start the development server

On Windows, PowerShell's default execution policy blocks the `yarn.ps1` shim that Corepack installs. Use `yarn.cmd`, or run the commands from `cmd.exe`.

## Building executable

Be aware that because of the native extensions, you may only be able to build for the target you are currently on.

- Build for the current platform
  - `yarn build`
- On Windows
  - `yarn build-win32-x64`
- On Linux
  - `yarn build-linux-x64` or `yarn build-linux-arm64` depending on cpu architecture

The built files will be placed in `./deploy`, make sure you copy all non-zipfiles into the main CasparCG directory.

# License

CasparCG Media-Scanner is distributed under the GNU Lesser General Public License LGPLv3 or
higher, see [LICENSE](LICENSE) for details.

More information is available at http://casparcg.com/

# Documentation

The most up-to-date documentation is always available at
https://github.com/CasparCG/help/wiki
