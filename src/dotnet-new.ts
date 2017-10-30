import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as url from 'url';
import * as request from "request";
import * as AsciiTable from "ascii-table";
import * as extractZip from "extract-zip";
import * as isBinaryFile from "isbinaryfile";
import { normalizeSwitches, splitOnLast } from './index';

var packageConf = require('../package.json');

let DEBUG = false;
const DefultConifgFile = 'dotnet-new.config';
const DefultConifg = {
    "sources": ["https://api.github.com/orgs/NetCoreTemplates/repos"]
};
const headers = {
    'User-Agent': 'servicestack-cli'
};

interface IConfig {
    sources: Array<string>
}

interface IRepo {
    name: string;
    description: string;
    releases_url: string;
}

interface IRelease {
    name: string;
    zipball_url: string;
    prerelease: boolean;
}

const VALID_NAME_CHARS = /^[a-zA-Z_$][0-9a-zA-Z_$.]*$/;
const ILLEGAL_NAMES = 'CON|AUX|PRN|COM1|LP2|.|..'.split('|');
const IGNORE_EXTENSIONS = "jpg|jpeg|png|gif|ico|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|ogg|dll|pdb|so|zip|key|snk|p12"
     + "swf|xap|class|doc|xls|ppt".split('|');

export function cli(args: string[]) {

    const nodeExe = args[0];
    const cliPath = args[1];
    const cwd = process.cwd();
    let cmdArgs = args.slice(2);

    if (DEBUG) console.log({ cwd, cmdArgs });

    const arg1 = cmdArgs.length > 0
        ? normalizeSwitches(cmdArgs[0])
        : null;

    const isConfig = arg1 && ["/c", "/config"].indexOf(arg1) >= 0;
    let configFile = DefultConifgFile;
    if (isConfig) {
        configFile = cmdArgs[1];
        cmdArgs = cmdArgs.slice(2);
    }

    const config = getConfigSync(path.join(cwd, configFile));

    if (DEBUG) console.log('config', config, cmdArgs);

    if (["/d", "/debug"].indexOf(arg1) >= 0) {
        DEBUG = true;
        cmdArgs = cmdArgs.slice(1);
    }

    if (cmdArgs.length == 0) {
        execShowTemplates(config);
        return;
    }

    const isHelp = ["/h", "/?", "/help"].indexOf(arg1) >= 0;
    if (isHelp) {
        execHelp();
        return;
    }
    const isVersion = ["/v", "/version"].indexOf(arg1) >= 0;
    if (isVersion) {
        console.log(`Version: ${packageConf.version}`);
        return;
    }

    execCreateProject(config, cmdArgs[0], cmdArgs.length > 1 ? cmdArgs[1] : null);
}

function getConfigSync(path: string): IConfig {
    try {
        if (!fs.existsSync(path))
            return DefultConifg;

        var json = fs.readFileSync(path, 'utf8');
        var config = JSON.parse(json);
        return config as IConfig;
    } catch (e) {
        handleError(e);
    }
}

function handleError(e, msg: string = null) {
    if (msg) {
        console.error(msg);
    }
    console.error(e.message || e);
    process.exit(-1);
}

export function execShowTemplates(config: IConfig) {
    if (DEBUG) console.log('execShowTemplates', config);

    if (config.sources == null || config.sources.length == 0)
        handleError('No sources defined');

    var count = 0;
    var table = new AsciiTable();
    table.setHeading('', 'template', 'description');

    const done = () => {
        console.log(table.toString());
        console.log('\nUsage: dotnet-new <template> ProjectName')
    };

    var pending = 0;
    config.sources.forEach(url => {

        pending++;
        request({ url, headers }, (err, res, json) => {
            if (err)
                handleError(err);
            if (res.statusCode >= 400)
                handleError(`Request failed '${url}': ${res.statusCode} ${res.statusMessage}`);

            try {
                var repos = JSON.parse(json);

                for (var i = 0; i < repos.length; i++) {
                    var repo = repos[i] as IRepo;
                    table.addRow(++count, repo.name, repo.description);
                }

                if (--pending == 0)
                    done();

            } catch (e) {
                console.log('json', json)
                handleError(e, `ERROR: Could not parse JSON response from: ${url}`);
            }
        });
    });

    if (process.env.SERVICESTACK_TELEMETRY_OPTOUT != "1") {
        try { request(`https://servicestack.net/stats/dotnet-new/record?name=list&source=cli&version=${packageConf.version}`); } catch (ignore) { }
    }
}

export function execCreateProject(config: IConfig, template: string, projectName: string) {
    if (DEBUG) console.log('execCreateProject', config, template, projectName);

    if (config.sources == null || config.sources.length == 0)
        handleError('No sources defined');

    assertValidProjectName(projectName);

    let found = false;
    const done = () => {
        if (!found) {
            console.log('Could not find template: ' + template);
        }
    };

    let version: string = null;
    const parts = splitOnLast(template, '@');
    if (parts.length > 1) {
        template = parts[0];
        version = parts[1];
    }

    let pending = 0;
    config.sources.forEach(url => {

        pending++;
        if (found) return;
        request({ url, headers }, (err, res, json) => {
            if (err)
                handleError(err);
            if (res.statusCode >= 400)
                handleError(`Request failed '${url}': ${res.statusCode} ${res.statusMessage}`);
            if (found)
                return;

            try {
                let repos = JSON.parse(json) as IRepo[];

                repos.forEach(repo => {
                    if (repo.name === template) {
                        found = true;
                        let releaseUrl = urlFromTemplate(repo.releases_url);
                        createProject(releaseUrl, projectName, version);
                        return;
                    }
                });

                if (--pending == 0)
                    done();

            } catch (e) {
                if (DEBUG) console.log('Invalid JSON: ', json);
                handleError(e, `ERROR: Could not parse JSON response from: ${url}`);
            }
        });
    });

    if (process.env.SERVICESTACK_TELEMETRY_OPTOUT != "1") {
        try { request(`https://servicestack.net/stats/dotnet-new/record?name=${template}&source=cli&version=${packageConf.version}`); } catch (ignore) { }
    }
}

const urlFromTemplate = (urlTemplate: string) => splitOnLast(urlTemplate, '{')[0];

export function createProject(releasesUrl: string, projectName: string, version: string = null) {
    if (DEBUG) console.log(`Creating project from: ${releasesUrl}`);

    let found = false;

    request({ url: releasesUrl, headers }, (err, res, json) => {
        if (err)
            handleError(err);
        if (res.statusCode >= 400)
            handleError(`Request failed '${releasesUrl}': ${res.statusCode} ${res.statusMessage}`);

        try {
            var releases = JSON.parse(json) as IRelease[];
            releases.forEach(release => {
                if (found)
                    return;
                if (release.prerelease)
                    return;
                if (version != null && release.name != version)
                    return;

                if (release.zipball_url == null)
                    handleError(`Release ${release.name} does not have zipball_url`);

                found = true;
                createProjectFromZipUrl(release.zipball_url, projectName);
            });

            if (!found) {
                console.log('Could not find any Releases');
            }
        } catch (e) {
            if (DEBUG) console.log('Invalid JSON: ', json);
            handleError(e, `ERROR: Could not parse JSON response from: ${releasesUrl}`);
        }
    });
}

export function createProjectFromZipUrl(zipUrl: string, projectName: string) {
    let cachedName = cacheFileName(filenamifyUrl(zipUrl));

    if (!fs.existsSync(cachedName)) {
        request({ url: zipUrl, encoding: null, headers }, (err, res, body) => {
            if (err)
                throw err;
            if (res.statusCode >= 400)
                handleError(`Request failed '${zipUrl}': ${res.statusCode} ${res.statusMessage}`);

            if (DEBUG) console.log(`Writing zip file to: ${cachedName}`);
            ensureCacheDir();
            fs.writeFile(cachedName, body, function (err) {
                createProjectFromZip(cachedName, projectName);
            });
        });
    } else {
        createProjectFromZip(cachedName, projectName);
    }
}

export function createProjectFromZip(zipFile: string, projectName: string) {
    assertValidProjectName(projectName);

    if (!fs.existsSync(zipFile))
        throw new Error(`File does not exist: ${zipFile}`);

    let rootDirs = [];

    extractZip(zipFile, {
        dir: process.cwd(),
        onEntry: (entry, zipFile) => {
            var isRootDir = entry.fileName && entry.fileName.indexOf('/') == entry.fileName.length - 1;
            if (isRootDir) {
                rootDirs.push(entry.fileName);
            }
        }
    }, function (err) {
        if (DEBUG) console.log('Project extracted, rootDirs: ', rootDirs);

        if (rootDirs.length == 1) {
            const rootDir = rootDirs[0];
            if (fs.lstatSync(rootDir).isDirectory()) {
                if (DEBUG) console.log(`Renaming single root dir '${rootDir}' to '${projectName}'`);
                fs.renameSync(rootDir, projectName);
                renameTemplateFolder(path.join(process.cwd(), projectName), projectName);
            }
        } else {
            if (DEBUG) console.log('No root folder found, renaming folders and files in: ' + process.cwd());
            renameTemplateFolder(process.cwd(), projectName);
        }
    })
}

export function renameTemplateFolder(dir: string, projectName: string) {
    if (DEBUG) console.log('Renaming files and folders in: ', dir);

    const replaceRegEx = /MyApp/g;

    const fileNames = fs.readdirSync(dir);
    for (let f = 0; f < fileNames.length; f += 1) {
        const fileName = fileNames[f];
        const parts = splitOnLast(fileName, '.');
        const ext = parts.length == 2 ? parts[1] : null;
        const oldPath = path.join(dir, fileName);
        const fstat = fs.statSync(oldPath);
        const newName = fileName.replace(replaceRegEx, projectName);
        const newPath = path.join(dir, newName);
        fs.renameSync(oldPath, newPath);
        
        if (fstat.isFile()) {
            if (IGNORE_EXTENSIONS.indexOf(ext) == -1) {
                fs.readFile(newPath, 'utf8', function (err, data) {
                    if (err) 
                        return console.log(`ERROR readFile '${fileName}': ${err}`);
    
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
    }
}

export function assertValidProjectName(projectName: string) {
    if (projectName == null)
        return;

    if (!VALID_NAME_CHARS.test(projectName))
        handleError('Illegal char in project name: ' + projectName);

    if (ILLEGAL_NAMES.indexOf(projectName) != -1)
        handleError('Illegal project name: ' + projectName);
}

export function execHelp() {
    const USAGE = `Version:  ${packageConf.version}
Syntax:   dotnet-new [options] [ProjectUrl|TemplateName] [ProjectName]

View a list of available project templates:
    dotnet-new

Create a new project:
    dotnet-new [TemplateName]
    dotnet-new [TemplateName] [ProjectName]

    dotnet-new [ProjectUrl]
    dotnet-new [ProjectUrl] [ProjectName]

Options:
    -c, --config [ConfigFile] Use specified config file
    -h, --help                Print this message
    -v, --version             Print this version

This tool collects anonymous usage to determine the most used languages to improve your experience.
To disable set SERVICESTACK_TELEMETRY_OPTOUT=1 environment variable to 1 using your favorite shell.`;

    console.log(USAGE);
}


//Helpers
export const cacheFileName = (fileName: string) => path.join(os.homedir(), '.servicestack', 'cache', fileName);
export const cacheDirName = () => path.join(os.homedir(), '.servicestack', 'cache');
export const ensureCacheDir = () => mkdir(cacheDirName());
export const mkdir = (dirPath: string) => {
    const sep = path.sep;
    const initDir = path.isAbsolute(dirPath) ? sep : '';
    dirPath.split(sep).reduce((parentDir, childDir) => {
        const curDir = path.resolve(parentDir, childDir);
        if (!fs.existsSync(curDir)) {
            fs.mkdirSync(curDir);
        }
        return curDir;
    }, initDir);
}

//The MIT License (MIT)
const matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
const escapeStringRegexp = (str: string) => str.replace(matchOperatorsRe, '\\$&');
const trimRepeated = (str: string, target: string) => str.replace(new RegExp('(?:' + escapeStringRegexp(target) + '){2,}', 'g'), target);
const filenameReservedRegex = () => (/[<>:"\/\\|?*\x00-\x1F]/g);
const filenameReservedRegexWindowNames = () => (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i);
const stripOuter = (str: string, sub: string) => {
    sub = escapeStringRegexp(sub);
    return str.replace(new RegExp('^' + sub + '|' + sub + '$', 'g'), '');
}
const MAX_FILENAME_LENGTH = 100;
const reControlChars = /[\x00-\x1f\x80-\x9f]/g; // eslint-disable-line no-control-regex
const reRelativePath = /^\.+/;
const filenamify = (str: string, opts: any) => {
    opts = opts || {};

    const replacement = opts.replacement || '!';

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
}
const normalizeUrl = (url: string) => url.toLowerCase(); //replaces: https://github.com/sindresorhus/normalize-url
const stripUrlAuth = (input: string) => input.replace(/^((?:\w+:)?\/\/)(?:[^@/]+@)/, '$1');
const humanizeUrl = (str: string) => normalizeUrl(stripUrlAuth(str)).replace(/^(?:https?:)?\/\//, '');
export const filenamifyUrl = (str: string, opts: any = null) => filenamify(humanizeUrl(str), opts);
