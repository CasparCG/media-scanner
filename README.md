CasparCG Media-Scanner
===============

This project facilitates CasparCG Server since version 2.2.0. It abstracts the collection of metadata and generation of thumbnails into a separate process.

Usage
-----

This project is designed to be used via the AMCP protocol in CasparCG server. However, there are some endpoints for additional data which can only be access directly over http.

### AMCP Endpoints
These endpoints are exposed by the AMCP protocol in CasparCG Server. This means that they have some AMCP syntax wrappings, which will likely need to be stripped off if using in an external client

* `/tls` - Lists available template files
* `/cls` - Lists available media files
* `/fls` - Lists available font files
* `/cinf/<name>` - Gets information on specified media file
* `/thumbnail/generate` - Backwards compatibility, has no effect
* `/thumbnail/generate/<name>` - Backwards compatibility, has no effect
* `/thumbnail` - Lists the available thumbnails
* `/thumbnail/<name>` - Gets the thumbnail for a media file

### Changes
A stream of changes can be accessed with the following. [Full docs](https://pouchdb.com/api.html#changes)
```
const PouchDB = require('pouchdb-node')
const db = new PouchDB('http://localhost:8000/db/_media')

// Listen for changes
db.changes({
    since: 'now',
    include_docs: true,
    live: true
}).on('change', function (changes) {
    console.log(changes)
}).on('error', function (err) {
    // handle errors
});
```


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

Note: Due to an incompatability with a dependency and pkg, a fix up step is performed during build until this is resolved upstream [pkg](https://github.com/zeit/pkg/issues/75) [express-pouchdb](https://github.com/pouchdb/pouchdb-server/issues/326). This could cause issues when updating the express-pouchdb package.

Usage on Linux
---------------

On Ubuntu and similar distros, the easiest way to get nodeJs and npm installed, would be to run:  
`sudo apt-get install nodeJs npm`

Due to the differences between the Linux and Windows versions, the Linux build of this software relies
on FFmpeg being installed in a way that it can be used at the command line. This is most easily accomplished
through the use of `sudo apt-get install ffmpeg`, which will install the appropriate prebuilt build of 
ffmpeg for your distro. You can check as to whether or not it is already installed by running `ffmpeg -version`.

A tip to easily run the media scanner in conjunction with the caspar server, is to start it as a background job.
The simple way to do this, is when in the server folder where the scanner has been copied to, is to:  
* Start it as a background job by running:  
    * `./scanner &` 
* To then kill it, run:  
    * `jobs` &emsp; (When back at the normal cmd line)  
    * Take note of it's process number.  
* Then run:
    * `kill %n` , where `n` is the process number.

If you are having issues getting the scanner to work correctly, you may inadvertently have some file permissions for the server
and media folder set incorrectly. See here for some more details on it: https://github.com/CasparCG/media-scanner/issues/28
However, the basic fix should be to:
1. Navigate to the directory above your server folder.
2. Run: (Prefix with sudo if required) `chown -R user:user name_of_server_dir/` &emsp; "`user`" is the user that will be running caspar
3. Run: (Prefix with sudo if required) `chmod -R 755 name_of_server_dir/` &emsp; Sets permissions of the server folder
4. If your media folder is not a subfolder of your server directory, execute the above commands upon it as well.


If you are having issues with getting the caspar client to list the media on your server, you may have an issue with the scanner trying to communicate over IPv6/tcp6, instead of IPv4.  
To check if this is the case, once you have started the scanner, if you log into a second terminal/ssh session and run `sudo netstat -tulpn | grep LISTEN`  , you should see a process called `scanner` listening to IPv4 tcp port 8000. If it is listening to an IPv6 port, you will need to make the minor change to the scanner code as shown here: https://github.com/CasparCG/media-scanner/pull/48, rebuild the scanner, and copy the new build into the server folder.

License
-------

CasparCG Media-Scanner is distributed under the GNU Lesser General Public License LGPLv3 or
higher, see [LICENSE](LICENSE) for details.

More information is available at http://casparcg.com/


Documentation
-------------

The most up-to-date documentation is always available at
https://github.com/CasparCG/help/wiki
