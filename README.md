CasparCG Media-Scanner
===============

This project facilitates CasparCG Server since version 2.2.0. It abstracts the collection of metadata and generation of thumbnails into a separate process.

Development
-----------

This project uses the latest LTS version NodeJS (8), so you need that installed. Get it from: https://nodejs.org/en/. 
We also use Leveldown which uses native modules so if you're on Windows you need to install windows build tools:

`npm install --global --production windows-build-tools`

After this:
* Clone the repository
* Run `npm install`
* Run `npm dev` to start the development server

Building
-----------
Be aware that because of the native extensions, you can only build for the target you are currently on.

* On Windows
  * `npm run build-win32`
* On Linux
  * `npm run build-linux`
  
The built files will be placed in `./dist`, make sure you copy all files into the main CasparCG directory.

License
-------

CasparCG Media-Scanner is distributed under the GNU General Public License GPLv3 or
higher, see [LICENSE](LICENSE.md) for details.

More information is available at http://casparcg.com/


More information about CasparCG is available at http://casparcg.com/ and
in the forum at http://casparcg.com/forum/


Documentation
-------------

The most up-to-date documentation is always available at
https://github.com/CasparCG/Server/wiki

Ask questions in the forum: http://casparcg.com/forum/
