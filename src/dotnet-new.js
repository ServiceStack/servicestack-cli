"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var os = require("os");
var path = require("path");
var url = require("url");
var request = require("request");
var AsciiTable = require("ascii-table");
var extractZip = require("extract-zip");
var index_1 = require("./index");
var packageConf = require('../package.json');
var TemplatePlaceholder = "MyApp";
var DEBUG = false;
var DefaultConfigFile = 'dotnet-new.config';
var DefaultConfig = {
    "sources": [
        { "name": "ServiceStack .NET Core 2.0 C# Templates", "url": "https://api.github.com/orgs/NetCoreTemplates/repos" },
        { "name": "ServiceStack .NET Framework C# Templates", "url": "https://api.github.com/orgs/NetFrameworkTemplates/repos" },
        { "name": "ServiceStack .NET Framework ASP.NET Core C# Templates", "url": "https://api.github.com/orgs/NetFrameworkCoreTemplates/repos" },
    ],
    "postinstall": [
        { "test": "MyApp/package.json", "exec": 'cd "MyApp" && npm install' },
        { "test": "MyApp.sln", "exec": "nuget restore" },
    ]
};
var headers = {
    'User-Agent': 'servicestack-cli'
};
var VALID_NAME_CHARS = /^[a-zA-Z_$][0-9a-zA-Z_$.]*$/;
var ILLEGAL_NAMES = 'CON|AUX|PRN|COM1|LP2|.|..'.split('|');
var IGNORE_EXTENSIONS = "jpg|jpeg|png|gif|ico|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|ogg|dll|exe|pdb|so|zip|key|snk|p12|swf|xap|class|doc|xls|ppt|sqlite|db".split('|');
var camelToKebab = function (str) { return (str || '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(); };
var escapeRegEx = function (str) { return (str || '').replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"); };
var replaceRegEx = /MyApp/g;
var replaceKebabRegEx = /my-app/g;
var replaceSplitCaseRegEx = /My App/g;
var removeWindowsCR = /\r/g;
var splitCase = function (t) { return typeof t != 'string' ? t : t.replace(/([A-Z]|[0-9]+)/g, ' $1').replace(/_/g, ' ').trim(); };
var replaceMyApp = function (s, projectName) {
    if (!s)
        return "";
    var ret = s.replace(replaceRegEx, projectName)
        .replace(replaceKebabRegEx, camelToKebab(projectName))
        .replace(replaceSplitCaseRegEx, splitCase(projectName));
    if (process.platform != 'win32')
        return ret.replace(removeWindowsCR, "");
    return ret;
};
var exec = require('child_process').execSync;
function runScript(script) {
    process.env.FORCE_COLOR = "1";
    exec(script, { stdio: [process.stdin, process.stdout, process.stderr] });
}
function cli(args) {
    var nodeExe = args[0];
    var cliPath = args[1];
    var cwd = process.cwd();
    var cmdArgs = args.slice(2);
    if (process.env.GITHUB_OAUTH_TOKEN)
        headers['Authorization'] = "token " + process.env.GITHUB_OAUTH_TOKEN;
    if (DEBUG)
        console.log({ cwd: cwd, cmdArgs: cmdArgs });
    var arg1 = cmdArgs.length > 0
        ? index_1.normalizeSwitches(cmdArgs[0])
        : null;
    var isConfig = arg1 && ["/c", "/config"].indexOf(arg1) >= 0;
    var configFile = DefaultConfigFile;
    if (isConfig) {
        configFile = cmdArgs[1];
        cmdArgs = cmdArgs.slice(2);
    }
    if (["/d", "/debug"].indexOf(arg1) >= 0) {
        DEBUG = true;
        cmdArgs = cmdArgs.slice(1);
    }
    var config = getConfigSync(path.join(cwd, configFile));
    if (DEBUG)
        console.log('config', config, cmdArgs);
    if (cmdArgs.length == 0) {
        showTemplates(config);
        return;
    }
    if (["/h", "/?", "/help"].indexOf(arg1) >= 0) {
        showHelp();
        return;
    }
    if (["/v", "/version"].indexOf(arg1) >= 0) {
        console.log("Version: " + packageConf.version);
        return;
    }
    if (["/clean"].indexOf(arg1) >= 0) {
        exports.rmdir(exports.cacheDirName());
        console.log("Cleared package cache: " + exports.cacheDirName());
        return;
    }
    var template = cmdArgs[0];
    if (template.startsWith("-") || (template.startsWith("/") && template.split('/').length == 1)) {
        showHelp("Unknown switch: " + arg1);
        return;
    }
    if (parseInt(template) >= 0) {
        showHelp("Please specify a template name.");
        return;
    }
    var projectName = cmdArgs.length > 1 ? cmdArgs[1] : null;
    var isGitHubProject = template.indexOf('://') == -1 && template.split('/').length == 2;
    if (isGitHubProject)
        template = "https://github.com/" + template;
    var isUrl = template.indexOf('://') >= 0;
    var isZip = template.endsWith('.zip');
    var done = function (err) {
        if (err) {
            console.log(err);
        }
        else {
            if (fs.existsSync(projectName)) {
                process.chdir(projectName);
                (config.postinstall || []).forEach(function (rule) {
                    var path = replaceMyApp(rule.test, projectName);
                    if (fs.existsSync(path)) {
                        if (!rule.exec)
                            return;
                        var exec = replaceMyApp(rule.exec, projectName);
                        if (DEBUG)
                            console.log("Matched: '" + rule.test + "', executing '" + exec + "'...");
                        try {
                            runScript(exec);
                        }
                        catch (e) {
                            console.log(e.message || e);
                        }
                    }
                    else {
                        if (DEBUG)
                            console.log("path does not exist: '" + path + "' in '" + process.cwd() + "'");
                    }
                });
            }
            else {
                if (DEBUG)
                    console.log(projectName + " does not exist");
            }
        }
    };
    if (isUrl && isZip) {
        createProjectFromZipUrl(template, projectName, done);
    }
    else if (isZip) {
        createProjectFromZip(template, projectName, done);
    }
    else if (isUrl) {
        //https://github.com/NetCoreTemplates/react-app
        //https://api.github.com/repos/NetCoreTemplates/react-app/releases
        if (template.endsWith("/releases")) {
            createProjectFromReleaseUrl(template, projectName, null, done);
        }
        else if (template.indexOf('github.com/') >= 0) {
            var repoName = template.substring(template.indexOf('github.com/') + 'github.com/'.length);
            if (repoName.split('/').length == 2) {
                var releaseUrl = "https://api.github.com/repos/" + repoName + "/releases";
                createProjectFromReleaseUrl(releaseUrl, projectName, null, done);
                return;
            }
        }
        return showHelp("Invalid URL: only .zip URLs, GitHub repo URLs or release HTTP API URLs are supported.");
    }
    else {
        createProject(config, template, projectName, done);
    }
}
exports.cli = cli;
function getConfigSync(path) {
    try {
        if (!fs.existsSync(path))
            return DefaultConfig;
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
function showTemplates(config) {
    if (DEBUG)
        console.log('execShowTemplates', config);
    console.log('Help: dotnet-new -h\n');
    if (config.sources == null || config.sources.length == 0)
        handleError('No sources defined');
    var results = [];
    var done = function () {
        results.forEach(function (table) {
            console.log(table.toString());
            console.log();
        });
        console.log('Usage: dotnet-new <template> ProjectName');
    };
    var pending = 0;
    config.sources.forEach(function (source, index) {
        var count = 0;
        pending++;
        request({ url: source.url, headers: headers }, function (err, res, json) {
            if (err)
                handleError(err);
            if (res.statusCode >= 400)
                handleError("Request failed '" + url + "': " + res.statusCode + " " + res.statusMessage);
            try {
                var repos = JSON.parse(json);
                var table = new AsciiTable(source.name);
                table.setHeading('', 'template', 'description');
                for (var i = 0; i < repos.length; i++) {
                    var repo = repos[i];
                    table.addRow(++count, repo.name, repo.description);
                }
                results[index] = table;
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
exports.showTemplates = showTemplates;
function createProject(config, template, projectName, done) {
    if (DEBUG)
        console.log('execCreateProject', config, template, projectName);
    if (config.sources == null || config.sources.length == 0)
        handleError('No sources defined');
    assertValidProjectName(projectName);
    var found = false;
    var cb = function () {
        if (!found) {
            done("Could not find template '" + template + "'. Run 'dotnet-new' to view list of templates available.");
        }
        else {
            done();
        }
    };
    var version = null;
    var parts = index_1.splitOnLast(template, '@');
    if (parts.length > 1) {
        template = parts[0];
        version = parts[1];
    }
    var pending = 0;
    config.sources.forEach(function (source) {
        pending++;
        if (found)
            return;
        request({ url: source.url, headers: headers }, function (err, res, json) {
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
                        createProjectFromReleaseUrl(releaseUrl, projectName, version, cb);
                        return;
                    }
                });
                if (--pending == 0)
                    cb();
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
exports.createProject = createProject;
var urlFromTemplate = function (urlTemplate) { return index_1.splitOnLast(urlTemplate, '{')[0]; };
function createProjectFromReleaseUrl(releasesUrl, projectName, version, done) {
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
                createProjectFromZipUrl(release.zipball_url, projectName, done);
            });
            if (!found) {
                console.log('Could not find any Releases for this project.');
                var githubUrl = 'api.github.com/repos/';
                if (releasesUrl.indexOf(githubUrl) >= 0 && releasesUrl.endsWith('/releases')) {
                    var repoName = releasesUrl.substring(releasesUrl.indexOf(githubUrl) + githubUrl.length, releasesUrl.length - '/releases'.length);
                    var masterZipUrl = "https://github.com/" + repoName + "/archive/master.zip";
                    console.log('Fallback to using master archive from: ' + masterZipUrl);
                    createProjectFromZipUrl(masterZipUrl, projectName, done);
                }
            }
        }
        catch (e) {
            if (DEBUG)
                console.log('Invalid JSON: ', json);
            handleError(e, "ERROR: Could not parse JSON response from: " + releasesUrl);
        }
    });
}
exports.createProjectFromReleaseUrl = createProjectFromReleaseUrl;
function createProjectFromZipUrl(zipUrl, projectName, done) {
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
                createProjectFromZip(cachedName, projectName, done);
            });
        });
    }
    else {
        createProjectFromZip(cachedName, projectName, done);
    }
}
exports.createProjectFromZipUrl = createProjectFromZipUrl;
var execTimeoutMs = 10 * 1000;
var retryAfterMs = 100;
var sleep = function (ms) { return exec("\"" + process.argv[0] + "\" -e setTimeout(function(){}," + ms + ")"); };
// Rename can fail on Windows when Windows Defender real-time AV is on: 
// https://github.com/react-community/create-react-native-app/issues/191#issuecomment-304073970
var managedExec = function (fn) {
    var started = new Date().getTime();
    do {
        try {
            fn();
            return;
        }
        catch (e) {
            if (DEBUG)
                console.log((e.message || e) + ", retrying after " + retryAfterMs + "ms...");
            sleep(retryAfterMs);
        }
    } while (new Date().getTime() - started < execTimeoutMs);
};
function createProjectFromZip(zipFile, projectName, done) {
    assertValidProjectName(projectName);
    if (!fs.existsSync(zipFile))
        throw new Error("File does not exist: " + zipFile);
    if (!projectName)
        projectName = TemplatePlaceholder;
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
            var rootDir_1 = rootDirs[0];
            if (fs.lstatSync(rootDir_1).isDirectory()) {
                if (DEBUG)
                    console.log("Renaming single root dir '" + rootDir_1 + "' to '" + projectName + "'");
                managedExec(function () { return fs.renameSync(rootDir_1, projectName); });
                renameTemplateFolder(path.join(process.cwd(), projectName), projectName, done);
            }
        }
        else {
            if (DEBUG)
                console.log('No root folder found, renaming folders and files in: ' + process.cwd());
            renameTemplateFolder(process.cwd(), projectName, done);
        }
    });
}
exports.createProjectFromZip = createProjectFromZip;
function renameTemplateFolder(dir, projectName, done) {
    if (done === void 0) { done = null; }
    if (DEBUG)
        console.log('Renaming files and folders in: ', dir);
    var fileNames = fs.readdirSync(dir);
    var _loop_1 = function (f) {
        var fileName = fileNames[f];
        var parts = index_1.splitOnLast(fileName, '.');
        var ext = parts.length == 2 ? parts[1] : null;
        var oldPath = path.join(dir, fileName);
        var fstat = fs.statSync(oldPath);
        var newName = replaceMyApp(fileName, projectName);
        var newPath = path.join(dir, newName);
        managedExec(function () { return fs.renameSync(oldPath, newPath); });
        if (fstat.isFile()) {
            if (IGNORE_EXTENSIONS.indexOf(ext) == -1) {
                try {
                    data = fs.readFileSync(newPath, 'utf8');
                    result = replaceMyApp(data, projectName);
                    try {
                        fs.writeFileSync(newPath, result, 'utf8');
                    }
                    catch (e) {
                        console.log("ERROR: " + e);
                    }
                }
                catch (err) {
                    return { value: console.log("ERROR readFile '" + fileName + "': " + err) };
                }
            }
        }
        else if (fstat.isDirectory()) {
            renameTemplateFolder(newPath, projectName, null);
        }
    };
    var data, result;
    for (var f = 0; f < fileNames.length; f += 1) {
        var state_1 = _loop_1(f);
        if (typeof state_1 === "object")
            return state_1.value;
    }
    if (done)
        done();
}
exports.renameTemplateFolder = renameTemplateFolder;
function assertValidProjectName(projectName) {
    if (!projectName)
        return;
    if (!VALID_NAME_CHARS.test(projectName))
        handleError('Illegal char in project name: ' + projectName);
    if (ILLEGAL_NAMES.indexOf(projectName) != -1)
        handleError('Illegal project name: ' + projectName);
    if (fs.existsSync(projectName))
        handleError('Project folder already exists: ' + projectName);
}
exports.assertValidProjectName = assertValidProjectName;
function showHelp(msg) {
    if (msg === void 0) { msg = null; }
    var USAGE = "Version:  " + packageConf.version + "\nSyntax:   dotnet-new [options] [TemplateName|Repo|ProjectUrl.zip] [ProjectName]\n\nView a list of available project templates:\n    dotnet-new\n\nCreate a new project:\n    dotnet-new [TemplateName]\n    dotnet-new [TemplateName] [ProjectName]\n\n    # Use latest release of a GitHub Project\n    dotnet-new [RepoUrl]\n    dotnet-new [RepoUrl] [ProjectName]\n\n    # Direct link to project release .zip tarball\n    dotnet-new [ProjectUrl.zip]\n    dotnet-new [ProjectUrl.zip] [ProjectName]\n\nOptions:\n    -c, --config [ConfigFile]  Use specified config file\n    -h, --help                 Print this message\n    -v, --version              Print this version\n    --clean                    Clear template cache\n\nThis tool collects anonymous usage to determine the most used languages to improve your experience.\nTo disable set SERVICESTACK_TELEMETRY_OPTOUT=1 environment variable to 1 using your favorite shell.";
    if (msg != null)
        console.log(msg + "\n");
    console.log(USAGE);
}
exports.showHelp = showHelp;
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
exports.rmdir = function (path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(function (file, index) {
            var curPath = path + "/" + file;
            if (fs.lstatSync(curPath).isDirectory()) {
                exports.rmdir(curPath);
            }
            else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
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