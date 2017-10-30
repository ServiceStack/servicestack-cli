"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var os = require("os");
var path = require("path");
var request = require("request");
var AsciiTable = require("ascii-table");
var extractZip = require("extract-zip");
var index_1 = require("./index");
var packageConf = require('../package.json');
var DEBUG = false;
var DefultConifgFile = 'dotnet-new.config';
var DefultConifg = {
    "sources": ["https://api.github.com/orgs/NetCoreTemplates/repos"]
};
var headers = {
    'User-Agent': 'servicestack-cli'
};
var VALID_NAME_CHARS = /^[a-zA-Z_$][0-9a-zA-Z_$.]*$/;
var ILLEGAL_NAMES = 'CON|AUX|PRN|COM1|LP2|.|..'.split('|');
var IGNORE_EXTENSIONS = "jpg|jpeg|png|gif|ico|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|ogg|dll|pdb|so|zip|key|snk|p12"
    + "swf|xap|class|doc|xls|ppt".split('|');
function cli(args) {
    var nodeExe = args[0];
    var cliPath = args[1];
    var cwd = process.cwd();
    var cmdArgs = args.slice(2);
    if (DEBUG)
        console.log({ cwd: cwd, cmdArgs: cmdArgs });
    var arg1 = cmdArgs.length > 0
        ? index_1.normalizeSwitches(cmdArgs[0])
        : null;
    var isConfig = arg1 && ["/c", "/config"].indexOf(arg1) >= 0;
    var configFile = DefultConifgFile;
    if (isConfig) {
        configFile = cmdArgs[1];
        cmdArgs = cmdArgs.slice(2);
    }
    var config = getConfigSync(path.join(cwd, configFile));
    if (DEBUG)
        console.log('config', config, cmdArgs);
    if (["/d", "/debug"].indexOf(arg1) >= 0) {
        DEBUG = true;
        cmdArgs = cmdArgs.slice(1);
    }
    if (cmdArgs.length == 0) {
        execShowTemplates(config);
        return;
    }
    var isHelp = ["/h", "/?", "/help"].indexOf(arg1) >= 0;
    if (isHelp) {
        execHelp();
        return;
    }
    var isVersion = ["/v", "/version"].indexOf(arg1) >= 0;
    if (isVersion) {
        console.log("Version: " + packageConf.version);
        return;
    }
    execCreateProject(config, cmdArgs[0], cmdArgs.length > 1 ? cmdArgs[1] : null);
}
exports.cli = cli;
function getConfigSync(path) {
    try {
        if (!fs.existsSync(path))
            return DefultConifg;
        var json = fs.readFileSync(path, 'utf8');
        var config = JSON.parse(json);
        return config;
    }
    catch (e) {
        handleError(e);
    }
}
function handleError(e, msg) {
    if (msg === void 0) { msg = null; }
    if (msg) {
        console.error(msg);
    }
    console.error(e.message || e);
    process.exit(-1);
}
function execShowTemplates(config) {
    if (DEBUG)
        console.log('execShowTemplates', config);
    if (config.sources == null || config.sources.length == 0)
        handleError('No sources defined');
    var count = 0;
    var table = new AsciiTable();
    table.setHeading('', 'template', 'description');
    var done = function () {
        console.log(table.toString());
        console.log('\nUsage: dotnet-new <template> ProjectName');
    };
    var pending = 0;
    config.sources.forEach(function (url) {
        pending++;
        request({ url: url, headers: headers }, function (err, res, json) {
            if (err)
                handleError(err);
            if (res.statusCode >= 400)
                handleError("Request failed '" + url + "': " + res.statusCode + " " + res.statusMessage);
            try {
                var repos = JSON.parse(json);
                for (var i = 0; i < repos.length; i++) {
                    var repo = repos[i];
                    table.addRow(++count, repo.name, repo.description);
                }
                if (--pending == 0)
                    done();
            }
            catch (e) {
                console.log('json', json);
                handleError(e, "ERROR: Could not parse JSON response from: " + url);
            }
        });
    });
    if (process.env.SERVICESTACK_TELEMETRY_OPTOUT != "1") {
        try {
            request("https://servicestack.net/stats/dotnet-new/record?name=list&source=cli&version=" + packageConf.version);
        }
        catch (ignore) { }
    }
}
exports.execShowTemplates = execShowTemplates;
function execCreateProject(config, template, projectName) {
    if (DEBUG)
        console.log('execCreateProject', config, template, projectName);
    if (config.sources == null || config.sources.length == 0)
        handleError('No sources defined');
    assertValidProjectName(projectName);
    var found = false;
    var done = function () {
        if (!found) {
            console.log('Could not find template: ' + template);
        }
    };
    var version = null;
    var parts = index_1.splitOnLast(template, '@');
    if (parts.length > 1) {
        template = parts[0];
        version = parts[1];
    }
    var pending = 0;
    config.sources.forEach(function (url) {
        pending++;
        if (found)
            return;
        request({ url: url, headers: headers }, function (err, res, json) {
            if (err)
                handleError(err);
            if (res.statusCode >= 400)
                handleError("Request failed '" + url + "': " + res.statusCode + " " + res.statusMessage);
            if (found)
                return;
            try {
                var repos = JSON.parse(json);
                repos.forEach(function (repo) {
                    if (repo.name === template) {
                        found = true;
                        var releaseUrl = urlFromTemplate(repo.releases_url);
                        createProject(releaseUrl, projectName, version);
                        return;
                    }
                });
                if (--pending == 0)
                    done();
            }
            catch (e) {
                if (DEBUG)
                    console.log('Invalid JSON: ', json);
                handleError(e, "ERROR: Could not parse JSON response from: " + url);
            }
        });
    });
    if (process.env.SERVICESTACK_TELEMETRY_OPTOUT != "1") {
        try {
            request("https://servicestack.net/stats/dotnet-new/record?name=" + template + "&source=cli&version=" + packageConf.version);
        }
        catch (ignore) { }
    }
}
exports.execCreateProject = execCreateProject;
var urlFromTemplate = function (urlTemplate) { return index_1.splitOnLast(urlTemplate, '{')[0]; };
function createProject(releasesUrl, projectName, version) {
    if (version === void 0) { version = null; }
    if (DEBUG)
        console.log("Creating project from: " + releasesUrl);
    var found = false;
    request({ url: releasesUrl, headers: headers }, function (err, res, json) {
        if (err)
            handleError(err);
        if (res.statusCode >= 400)
            handleError("Request failed '" + releasesUrl + "': " + res.statusCode + " " + res.statusMessage);
        try {
            var releases = JSON.parse(json);
            releases.forEach(function (release) {
                if (found)
                    return;
                if (release.prerelease)
                    return;
                if (version != null && release.name != version)
                    return;
                if (release.zipball_url == null)
                    handleError("Release " + release.name + " does not have zipball_url");
                found = true;
                createProjectFromZipUrl(release.zipball_url, projectName);
            });
            if (!found) {
                console.log('Could not find any Releases');
            }
        }
        catch (e) {
            if (DEBUG)
                console.log('Invalid JSON: ', json);
            handleError(e, "ERROR: Could not parse JSON response from: " + releasesUrl);
        }
    });
}
exports.createProject = createProject;
function createProjectFromZipUrl(zipUrl, projectName) {
    var cachedName = exports.cacheFileName(exports.filenamifyUrl(zipUrl));
    if (!fs.existsSync(cachedName)) {
        request({ url: zipUrl, encoding: null, headers: headers }, function (err, res, body) {
            if (err)
                throw err;
            if (res.statusCode >= 400)
                handleError("Request failed '" + zipUrl + "': " + res.statusCode + " " + res.statusMessage);
            if (DEBUG)
                console.log("Writing zip file to: " + cachedName);
            exports.ensureCacheDir();
            fs.writeFile(cachedName, body, function (err) {
                createProjectFromZip(cachedName, projectName);
            });
        });
    }
    else {
        createProjectFromZip(cachedName, projectName);
    }
}
exports.createProjectFromZipUrl = createProjectFromZipUrl;
function createProjectFromZip(zipFile, projectName) {
    assertValidProjectName(projectName);
    if (!fs.existsSync(zipFile))
        throw new Error("File does not exist: " + zipFile);
    var rootDirs = [];
    extractZip(zipFile, {
        dir: process.cwd(),
        onEntry: function (entry, zipFile) {
            var isRootDir = entry.fileName && entry.fileName.indexOf('/') == entry.fileName.length - 1;
            if (isRootDir) {
                rootDirs.push(entry.fileName);
            }
        }
    }, function (err) {
        if (DEBUG)
            console.log('Project extracted, rootDirs: ', rootDirs);
        if (rootDirs.length == 1) {
            var rootDir = rootDirs[0];
            if (fs.lstatSync(rootDir).isDirectory()) {
                if (DEBUG)
                    console.log("Renaming single root dir '" + rootDir + "' to '" + projectName + "'");
                fs.renameSync(rootDir, projectName);
                renameTemplateFolder(path.join(process.cwd(), projectName), projectName);
            }
        }
        else {
            if (DEBUG)
                console.log('No root folder found, renaming folders and files in: ' + process.cwd());
            renameTemplateFolder(process.cwd(), projectName);
        }
    });
}
exports.createProjectFromZip = createProjectFromZip;
function renameTemplateFolder(dir, projectName) {
    if (DEBUG)
        console.log('Renaming files and folders in: ', dir);
    var replaceRegEx = /MyApp/g;
    var fileNames = fs.readdirSync(dir);
    var _loop_1 = function (f) {
        var fileName = fileNames[f];
        var parts = index_1.splitOnLast(fileName, '.');
        var ext = parts.length == 2 ? parts[1] : null;
        var oldPath = path.join(dir, fileName);
        var fstat = fs.statSync(oldPath);
        var newName = fileName.replace(replaceRegEx, projectName);
        var newPath = path.join(dir, newName);
        fs.renameSync(oldPath, newPath);
        if (fstat.isFile()) {
            if (IGNORE_EXTENSIONS.indexOf(ext) == -1) {
                fs.readFile(newPath, 'utf8', function (err, data) {
                    if (err)
                        return console.log("ERROR readFile '" + fileName + "': " + err);
                    var result = data.replace(replaceRegEx, projectName);
                    fs.writeFile(newPath, result, 'utf8', function (err) {
                        if (err)
                            return console.log("ERROR: " + err);
                    });
                });
            }
        }
        else if (fstat.isDirectory()) {
            renameTemplateFolder(newPath, projectName);
        }
    };
    for (var f = 0; f < fileNames.length; f += 1) {
        _loop_1(f);
    }
}
exports.renameTemplateFolder = renameTemplateFolder;
function assertValidProjectName(projectName) {
    if (projectName == null)
        return;
    if (!VALID_NAME_CHARS.test(projectName))
        handleError('Illegal char in project name: ' + projectName);
    if (ILLEGAL_NAMES.indexOf(projectName) != -1)
        handleError('Illegal project name: ' + projectName);
}
exports.assertValidProjectName = assertValidProjectName;
function execHelp() {
    var USAGE = "Version:  " + packageConf.version + "\nSyntax:   dotnet-new [options] [ProjectUrl|TemplateName] [ProjectName]\n\nView a list of available project templates:\n    dotnet-new\n\nCreate a new project:\n    dotnet-new [TemplateName]\n    dotnet-new [TemplateName] [ProjectName]\n\n    dotnet-new [ProjectUrl]\n    dotnet-new [ProjectUrl] [ProjectName]\n\nOptions:\n    -c, --config [ConfigFile] Use specified config file\n    -h, --help                Print this message\n    -v, --version             Print this version\n\nThis tool collects anonymous usage to determine the most used languages to improve your experience.\nTo disable set SERVICESTACK_TELEMETRY_OPTOUT=1 environment variable to 1 using your favorite shell.";
    console.log(USAGE);
}
exports.execHelp = execHelp;
//Helpers
exports.cacheFileName = function (fileName) { return path.join(os.homedir(), '.servicestack', 'cache', fileName); };
exports.cacheDirName = function () { return path.join(os.homedir(), '.servicestack', 'cache'); };
exports.ensureCacheDir = function () { return exports.mkdir(exports.cacheDirName()); };
exports.mkdir = function (dirPath) {
    var sep = path.sep;
    var initDir = path.isAbsolute(dirPath) ? sep : '';
    dirPath.split(sep).reduce(function (parentDir, childDir) {
        var curDir = path.resolve(parentDir, childDir);
        if (!fs.existsSync(curDir)) {
            fs.mkdirSync(curDir);
        }
        return curDir;
    }, initDir);
};
//The MIT License (MIT)
var matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
var escapeStringRegexp = function (str) { return str.replace(matchOperatorsRe, '\\$&'); };
var trimRepeated = function (str, target) { return str.replace(new RegExp('(?:' + escapeStringRegexp(target) + '){2,}', 'g'), target); };
var filenameReservedRegex = function () { return (/[<>:"\/\\|?*\x00-\x1F]/g); };
var filenameReservedRegexWindowNames = function () { return (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i); };
var stripOuter = function (str, sub) {
    sub = escapeStringRegexp(sub);
    return str.replace(new RegExp('^' + sub + '|' + sub + '$', 'g'), '');
};
var MAX_FILENAME_LENGTH = 100;
var reControlChars = /[\x00-\x1f\x80-\x9f]/g; // eslint-disable-line no-control-regex
var reRelativePath = /^\.+/;
var filenamify = function (str, opts) {
    opts = opts || {};
    var replacement = opts.replacement || '!';
    if (filenameReservedRegex().test(replacement) && reControlChars.test(replacement))
        throw new Error('Replacement string cannot contain reserved filename characters');
    str = str.replace(filenameReservedRegex(), replacement);
    str = str.replace(reControlChars, replacement);
    str = str.replace(reRelativePath, replacement);
    if (replacement.length > 0) {
        str = trimRepeated(str, replacement);
        str = str.length > 1 ? stripOuter(str, replacement) : str;
    }
    str = filenameReservedRegexWindowNames().test(str) ? str + replacement : str;
    str = str.slice(0, MAX_FILENAME_LENGTH);
    return str;
};
var normalizeUrl = function (url) { return url.toLowerCase(); }; //replaces: https://github.com/sindresorhus/normalize-url
var stripUrlAuth = function (input) { return input.replace(/^((?:\w+:)?\/\/)(?:[^@/]+@)/, '$1'); };
var humanizeUrl = function (str) { return normalizeUrl(stripUrlAuth(str)).replace(/^(?:https?:)?\/\//, ''); };
exports.filenamifyUrl = function (str, opts) {
    if (opts === void 0) { opts = null; }
    return filenamify(humanizeUrl(str), opts);
};
//# sourceMappingURL=dotnet-new.js.map