// server.js
// where your node app starts

// we've started you off with Express (https://expressjs.com/)
// but feel free to use whatever libraries or frameworks you'd like through `package.json`.
const express = require("express");
const fs = require('fs-extra');
const yaml = require('js-yaml');
const targz = require('targz');
const semver = require('semver');
const rimraf = require("rimraf");
const nanoid = require('nanoid');
const got = require('got');

const app = express(); 

// make all the files in 'public' available
// https://expressjs.com/en/starter/static-files.html
app.use(express.static("public"));

// https://expressjs.com/en/starter/basic-routing.html
app.get("/", (request, response) => {
  response.sendFile(__dirname + "/views/index.html");
});
 

function getDirectories(path) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path+'/'+file).isDirectory();
  });
}
            
// https://stackoverflow.com/a/56119188
// decompress files from tar.gz archive
function decompressPromise(file, tmpPath) {
  return new Promise((resolve, reject) => {
  targz.decompress({
    src: file,
    dest: tmpPath
  }, function(err){
      if(err) {
          console.log(err);
          reject(err);
      } else {
          // console.log("Done decompressing!");
          resolve(tmpPath);
      }
  })
})};

function compressPromise(tmpPath, tmpFile) {
    return new Promise((resolve, reject) => {
      // compress files into tar.gz archive
        targz.compress({
            src: tmpPath,
            dest: tmpFile
        }, function(err){
            if(err) {
              reject(err);
                console.log(err);
            } else {
                // console.log("Done compressing!");
                resolve(tmpFile);
            }
        });
    });
  }

app.get("/test/:registry/:nameAtVersion", async (request, response, next) => {
  let packages = [];
  
  // response.json(request.query);
  let parts0 = request.params.nameAtVersion.split(',');
  for(let key in parts0) {
    let tuple = splitNameAndVersion(parts0[key]);
    
    if(!tuple) {
      response.status(500).send({ error: 'Please use the format com.my.package@1.0.0 with a valid semver.' });
      return;
    }
    
    packages.push({
      name: tuple.name,
      version: tuple.version,
      installType: 1
    });
  }
  
  response.json(packages);
});

function removeCredentialsTools(tmpPath) {
  // remove directories we don't need right now,
  // e.g. everything related to credentials handling.
  let credentialsFiles = ["52218f1b260be3045a4293f1ebc40b18", "d7a51e69373973d458e0da95b391295f", "d7dd0223250a92244a276c6129a21f40", "d9a1dbfef6b8e6645b0358fd82179d8a"];
  for(let d in credentialsFiles) {
    let dirName = tmpPath + "/" + credentialsFiles[d];
    if(fs.existsSync(dirName))
      // fs.rmdirSync(dirName, { recursive: true });
      rimraf.sync(dirName);
    else
      console.log("directory does not exist, can't remove: " + dirName);
  }
}

function modifyPackagePath(tmpPath, packageName) {
  // Modify all paths to make this a unique installer
  // get all directories
  let dirs = getDirectories(tmpPath);
  // console.log(dirs);
  
  let newPackageName = "Packages/installer." + packageName + "/";
  
  // in each directory
  for(var d in dirs) {
    let dir = dirs[d];
    let pathnamePath = tmpPath + "/" + dir + "/pathname";
    // - open the single line in the file "path"
    let pathData = fs.readFileSync(pathnamePath, 'utf8');
    // console.log("in dir: " + dirs[d] + ": " + pathData);
    // - change the path prefix to a common one for this installer
    pathData = pathData.replace("Packages/com.needle.auto-installer/", newPackageName); 
    // - write the "path" file again
    fs.writeFileSync(pathnamePath, pathData, 'utf8');
  }
}

function splitNameAndVersion(nameAndVersion) {
  let parts = nameAndVersion.split('@');
  if(parts.length < 1 || parts.length > 2)
    return false;
  
  let name = parts[0];
  let version = parts.length == 2 ? parts[1] : "";
  
  if(version === "latest")
    version = "";
  
  if(version != null && version != "")
    if(!semver.valid(version))
      return false;
  
  if(version = "")
    version = "latest";
  
  return { name: name, version: version };
}
  
function checkPackageExistance(url) {
  got(url, { json: true }).then(response => {
    console.log(response.body.url);
    console.log(response.body.explanation);
  }).catch(error => {
    console.log(error.response.body);
  });
}

// http://package-installer.glitch.me/v1/install/needle/com.needle.compilation-visualizer/1.0.0?registry=https://packages.needle.tools&scope=com.needle
// http://package-installer.glitch.me/v1/install/OpenUPM/elzach.leveleditor/0.0.7?registry=https://package.openupm.com&scope=elzach.leveleditor&scope=elzach.extensions

// https://stackoverflow.com/questions/41941724/nodejs-sendfile-with-file-name-in-download
// send the .unitypackage back
// https://techeplanet.com/express-path-parameter/
app.get("/v1/installer/:registry/:nameAtVersion", async (request, response, next) => {

  console.log(request.query.scope + " - " + request.params.nameAtVersion);
  console.log(request.query.registry);
  
  let registryName = request.params.registry;
  
  let nameVersion = splitNameAndVersion(request.params.nameAtVersion);
  if(!nameVersion)
    response.status(500).send({ error: 'Please use the format com.my.package@1.0.0 with a valid semver.' });
  
  let packageName = nameVersion.name;
  let packageVersion = nameVersion.version;
  
  let registryScope = request.query.scope;
  if(!Array.isArray(registryScope)) registryScope = [ registryScope ];
  
  let registryUrl = request.query.registry;
  
  // try to download package details from registry; check if the package even exists before creating an installer for it.
  checkPackageExistance(registryUrl + "/" + packageName + "/" + packageVersion);
  
  // input file - this needs to be updated via Git import
  // so that it lives directly next to the files here.
  // this is a renamed .unitypackage file (which is just a .tar.gz)
  // CAREFUL - selecting the file in the glitch UI will weirdly convert it to some text format?! DO NOT TOUCH this file through the Glitch UI
  let file = __dirname + "/DO-NOT-TOUCH/" + "archtemp.tar.gz";
  
  // generate temporary paths to unpack/pack the archive file
  let salt = nanoid.nanoid() + "_" + Date.now();
  let tmpPath = '/tmp/my_package_folder_' + salt;
  let tmpFile = '/tmp/my_package_file_' + salt + '.tar.gz';
  
  fs.ensureDir(tmpPath);
    
  let targetPath = await decompressPromise(file, tmpPath);
  
  /// MODIFY PACKAGE CONTENT
  
  removeCredentialsTools(tmpPath);  
  modifyPackagePath(tmpPath, packageName);
  
  // Modify PackageData.asset:
  let dataGuid = "54e893365203989479ba056e0bf3174a";
  let assetFile = tmpPath + "/" + dataGuid + "/" + "asset";
  var data = fs.readFileSync(assetFile, 'utf8');
  
  // we need to split the original file into parts
  // since Unity's YAML format is not spec conform.
  // we split off the header, and treat the rest as valid yaml.
  // Note: There's probably a way to configure the yaml parser to accept the Unity headers
  const splitLines = str => str.split(/\r?\n/);
  let split_lines = splitLines(data);
  
  let some_lines = split_lines.slice(3);  
  let startWithBrokenYamlTag = split_lines.slice(0, 3).join("\n");
  
  let yamlData = yaml.load(some_lines.join("\n"));
  
  yamlData["MonoBehaviour"]["registries"] = [{
    name: registryName,
    url: registryUrl,
    scope: registryScope
  }];
  
  yamlData["MonoBehaviour"]["packages"] = [{
    name: packageName,
    version: packageVersion,
    installType: 1
  }];
  
  let combinedFile = startWithBrokenYamlTag + "\n" + yaml.dump(yamlData);
  
  fs.writeFileSync(assetFile, combinedFile, 'utf8')
  
  /// END MODIFY PACKAGE CONTENT  
  
  // pack into a .tar.gz again
  let compressPath = await compressPromise(tmpPath, tmpFile);  
  
  // serve as .unitypackage with a nice name related to the package name and version.
  response.download(compressPath, "Install-" + packageName + "-" + packageVersion + ".unitypackage");
});

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + listener.address().port);
});
