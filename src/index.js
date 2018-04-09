"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var url = require("url");
var request = require("request");
var packageConf = require('../package.json');
var ALIAS = {
    "cs": "csharp",
    "ts": "typescript",
    "tsd": "typescript.d",
    "typescriptd": "typescript.d",
    "kt": "kotlin",
    "vb": "vbnet",
    "fs": "fsharp",
};
var REF_EXT = {
    "csharp": "dtos.cs",
    "typescript": "dtos.ts",
    "typescript.d": "dtos.d.ts",
    "swift": "dtos.swift",
    "java": "dtos.java",
    "kotlin": "dtos.kt",
    "vbnet": "dtos.vb",
    "fsharp": "dtos.fs",
    "dart": "dtos.dart",
};
function cli(args) {
    var nodeExe = args[0];
    var cliPath = args[1];
    var scriptNameExt = exports.splitOnLast(cliPath.replace(/\\/g, '/'), '/')[1];
    var scriptName = exports.splitOnLast(scriptNameExt, '.')[0];
    var cliLang = exports.splitOnLast(scriptName, '-')[0];
    var lang = ALIAS[cliLang] || cliLang;
    var cwd = process.cwd();
    var cmdArgs = args.slice(2);
    var dtosExt = REF_EXT[lang];
    // console.log({ cliPath, scriptNameExt, cliLang, lang, cmdArgs, dtosExt });
    // console.log(packageConf.version);
    // process.exit(0);
    var isDefault = cmdArgs.length == 0;
    if (isDefault) {
        execDefault(lang, cwd, dtosExt);
        return;
    }
    var arg1 = exports.normalizeSwitches(cmdArgs[0]);
    var isHelp = ["/h", "/?", "/help"].indexOf(arg1) >= 0;
    if (isHelp) {
        execHelp(lang, scriptName, dtosExt);
        return;
    }
    var isVersion = ["/v", "/version"].indexOf(arg1) >= 0;
    if (isVersion) {
        console.log("Version: " + packageConf.version);
        return;
    }
    if (["/"].indexOf(arg1[0]) === -1 && cmdArgs.length <= 2) {
        try {
            var target = arg1;
            if (target.indexOf("://") >= 0) {
                var typesUrl = target.indexOf("/types/" + lang) == -1
                    ? exports.combinePaths(target, "/types/" + lang)
                    : target;
                var fileName = "Reference." + dtosExt;
                if (cmdArgs.length >= 2 && cmdArgs[1]) {
                    fileName = cmdArgs[1];
                }
                else {
                    var parts = url.parse(typesUrl).host.split('.');
                    fileName = parts.length >= 2
                        ? parts[parts.length - 2]
                        : parts[0];
                }
                if (!fileName.endsWith("." + dtosExt)) {
                    fileName = fileName + ("." + dtosExt);
                }
                saveReference(lang, typesUrl, cwd, fileName);
            }
            else {
                updateReference(lang, cwd, target);
            }
        }
        catch (e) {
            handleError(e);
        }
        return;
    }
    console.log("Unknown Command: " + scriptName + " " + cmdArgs.join(' ') + "\n");
    execHelp(lang, scriptName, dtosExt);
    return -1;
}
exports.cli = cli;
function handleError(e, msg) {
    if (msg === void 0) { msg = null; }
    if (msg) {
        console.error(msg);
    }
    console.error(e.message || e);
    process.exit(-1);
}
function updateReference(lang, cwd, target) {
    var targetExt = exports.splitOnLast(target, '.')[1];
    var langExt = exports.splitOnLast(REF_EXT[lang], '.')[1];
    if (targetExt != langExt)
        throw new Error("Invalid file type: '" + target + "', expected '." + langExt + "' source file");
    var existingRefPath = exports.combinePaths(cwd, target);
    if (!fs.existsSync(existingRefPath))
        throw new Error("File does not exist: " + existingRefPath.replace(/\\/g, '/'));
    var existingRefSrc = fs.readFileSync(existingRefPath, 'utf8');
    if (existingRefSrc.indexOf("Options:") === -1)
        throw new Error("ERROR: " + target + " is not an existing Swift ServiceStack Reference");
    var options = {};
    var baseUrl = "";
    var lines = existingRefSrc.split(/\r?\n/);
    for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
        var line = lines_1[_i];
        if (line.startsWith("*/"))
            break;
        if (lang === "vbnet") {
            if (line.trim().length === 0)
                break;
            if (line[0] === "'")
                line = line.substring(1);
        }
        if (line.startsWith("BaseUrl: ")) {
            baseUrl = line.substring("BaseUrl: ".length);
        }
        else if (baseUrl) {
            if (line.indexOf("//") === -1 && line.indexOf("'") === -1) {
                var parts = exports.splitOnFirst(line, ":");
                if (parts.length === 2) {
                    var key = parts[0].trim();
                    var val = parts[1].trim();
                    options[key] = val;
                }
            }
        }
    }
    if (!baseUrl)
        throw new Error("ERROR: Could not find baseUrl in " + target);
    var qs = "";
    for (var key in options) {
        qs += qs.length > 0 ? "&" : "?";
        qs += key + "=" + encodeURIComponent(options[key]);
    }
    var typesUrl = exports.combinePaths(baseUrl, "/types/" + lang) + qs;
    saveReference(lang, typesUrl, cwd, target);
}
exports.updateReference = updateReference;
function saveReference(lang, typesUrl, cwd, fileName) {
    var filePath = exports.combinePaths(cwd, fileName);
    request(typesUrl, function (err, res, dtos) {
        if (err)
            handleError(err);
        try {
            if (dtos.indexOf("Options:") === -1)
                throw new Error("ERROR: Invalid Response from " + typesUrl);
            var filePathExists = fs.existsSync(filePath);
            fs.writeFileSync(filePath, dtos, 'utf8');
            console.log(filePathExists ? "Updated: " + fileName : "Saved to: " + fileName);
            if (lang == "swift") {
                importSwiftClientSources(cwd);
            }
            if (process.env.SERVICESTACK_TELEMETRY_OPTOUT != "1") {
                var cmdType = filePathExists ? "updateref" : "addref";
                var statsUrl = "https://servicestack.net/stats/" + cmdType + "/record?name=" + lang + "&source=cli&version=" + packageConf.version;
                try {
                    request(statsUrl);
                }
                catch (ignore) { }
            }
        }
        catch (e) {
            handleError(e, "ERROR: Could not write DTOs to: " + fileName);
        }
    });
}
exports.saveReference = saveReference;
function execDefault(lang, cwd, dtosExt) {
    var matchingFiles = [];
    fs.readdirSync(cwd).forEach(function (entry) {
        if (entry.endsWith(dtosExt)) {
            matchingFiles.push(entry);
        }
    });
    if (matchingFiles.length === 0) {
        console.error("No '." + dtosExt + "' files found");
        process.exit(-1);
    }
    else {
        matchingFiles.forEach(function (target) {
            try {
                updateReference(lang, cwd, target);
            }
            catch (e) {
                console.error(e.message || e);
            }
        });
    }
}
exports.execDefault = execDefault;
function execHelp(lang, scriptName, dtosExt) {
    var USAGE = "Version:  " + packageConf.version + "\nSyntax:   " + scriptName + " [options] [BaseUrl|File]\n\nAdd a new ServiceStack Reference:\n    " + scriptName + " {BaseUrl}\n    " + scriptName + " {BaseUrl} {File}\n\nUpdate all *." + dtosExt + " ServiceStack References in Current Directory:\n    " + scriptName + "\n\nUpdate an existing ServiceStack Reference:\n    " + scriptName + " {File}." + dtosExt + "\n\nOptions:\n    -h, --help               Print this message\n    -v, --version            Print this version\n\nThis tool collects anonymous usage to determine the most used languages to improve your experience.\nTo disable set SERVICESTACK_TELEMETRY_OPTOUT=1 environment variable to 1 using your favorite shell.";
    console.log(USAGE);
}
exports.execHelp = execHelp;
function importSwiftClientSources(cwd) {
    var clientSrcPath = exports.combinePaths(cwd, "JsonServiceClient.swift");
    if (!fs.existsSync(clientSrcPath)) {
        var clientSrcUrl_1 = "https://servicestack.net/dist/swiftref/JsonServiceClient.swift";
        request(clientSrcUrl_1, function (err, res, clientSrc) {
            if (err)
                handleError(err);
            try {
                if (clientSrc.indexOf("JsonServiceClient") === -1)
                    throw new Error("ERROR: Invalid Response from " + clientSrcUrl_1 + "\n" + clientSrc);
                fs.writeFileSync(clientSrcPath, clientSrc, 'utf8');
                console.log("Imported: JsonServiceClient.swift");
            }
            catch (e) {
                handleError(e, "ERROR: Could not import: JsonServiceClient.swift");
            }
        });
    }
}
exports.importSwiftClientSources = importSwiftClientSources;
exports.normalizeSwitches = function (cmd) { return cmd.replace(/^-+/, '/'); };
//utils
exports.splitOnFirst = function (s, c) {
    if (!s)
        return [s];
    var pos = s.indexOf(c);
    return pos >= 0 ? [s.substring(0, pos), s.substring(pos + 1)] : [s];
};
exports.splitOnLast = function (s, c) {
    if (!s)
        return [s];
    var pos = s.lastIndexOf(c);
    return pos >= 0
        ? [s.substring(0, pos), s.substring(pos + 1)]
        : [s];
};
exports.combinePaths = function () {
    var paths = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        paths[_i] = arguments[_i];
    }
    var parts = [], i, l;
    for (i = 0, l = paths.length; i < l; i++) {
        var arg = paths[i];
        parts = arg.indexOf("://") === -1
            ? parts.concat(arg.split("/"))
            : parts.concat(arg.lastIndexOf("/") === arg.length - 1 ? arg.substring(0, arg.length - 1) : arg);
    }
    var combinedPaths = [];
    for (i = 0, l = parts.length; i < l; i++) {
        var part = parts[i];
        if (!part || part === ".")
            continue;
        if (part === "..")
            combinedPaths.pop();
        else
            combinedPaths.push(part);
    }
    if (parts[0] === "")
        combinedPaths.unshift("");
    return combinedPaths.join("/") || (combinedPaths.length ? "/" : ".");
};
//# sourceMappingURL=index.js.map