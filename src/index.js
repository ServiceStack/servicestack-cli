"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var url = require("url");
var request = require("request");
var utils_1 = require("./utils");
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
};
function cli(args) {
    var nodeExe = args[0];
    var cliPath = args[1];
    var scriptNameExt = utils_1.splitOnLast(cliPath.replace(/\\/g, '/'), '/')[1];
    var scriptName = utils_1.splitOnLast(scriptNameExt, '.')[0];
    var cliLang = utils_1.splitOnLast(scriptName, '-')[0];
    var lang = ALIAS[cliLang] || cliLang;
    var cwd = process.cwd();
    var cmdArgs = args.slice(2);
    var dtosExt = REF_EXT[lang];
    // console.log({ cliPath, scriptNameExt, cliLang, lang, cmdArgs, dtosExt });
    // process.exit(0);
    var isDefault = cmdArgs.length == 0;
    if (isDefault) {
        execDefault(lang, cwd);
        return;
    }
    var isHelp = ["-h", "/h", "-?", "/?", "--help", "/help"].indexOf(cmdArgs[0]) >= 0;
    if (isHelp) {
        execHelp(lang, scriptName, dtosExt);
        return;
    }
    if (cmdArgs.length >= 1 && cmdArgs.length <= 2) {
        try {
            var target = cmdArgs[0];
            if (target.indexOf("://") >= 0) {
                var typesUrl = target.indexOf("/types/" + lang) == -1
                    ? utils_1.combinePaths(target, "/types/" + lang)
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
    console.log("Unknown Command:");
    console.log(scriptName + " " + cmdArgs.join(' ') + "\n");
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
    var existingRefPath = utils_1.combinePaths(cwd, target);
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
                var parts = utils_1.splitOnFirst(line, ":");
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
    var typesUrl = utils_1.combinePaths(baseUrl, "/types/" + lang) + qs;
    saveReference(lang, typesUrl, cwd, target);
}
exports.updateReference = updateReference;
function saveReference(lang, typesUrl, cwd, fileName) {
    var filePath = utils_1.combinePaths(cwd, fileName);
    var dtos = "";
    request(typesUrl, function (err, res, dtos) {
        if (err)
            handleError(err);
        try {
            if (dtos.indexOf("Options:") === -1)
                throw new Error("ERROR: Invalid Response from " + typesUrl);
            var filePathExists = fs.existsSync(filePath);
            fs.writeFileSync(filePath, dtos, 'utf8');
            console.log(filePathExists ? "Saved to: " + fileName : "Updated: " + fileName);
            if (lang == "swift") {
                importSwiftClientSources(cwd);
            }
        }
        catch (e) {
            handleError(e, "ERROR: Could not write DTOs to: " + fileName);
        }
    });
}
exports.saveReference = saveReference;
function execDefault(lang, cwd) {
    console.log('\nexecDefault', { lang: lang, cwd: cwd });
}
exports.execDefault = execDefault;
function execHelp(lang, scriptName, dtosExt) {
    var USAGE = "\nUsage:\n\nAdd a new ServiceStack Reference:\n    " + scriptName + " {BaseUrl}\n    " + scriptName + " {BaseUrl} {FileName}\n\nUpdate all *." + dtosExt + " ServiceStack References in Current Directory:\n    " + scriptName + "\n\nUpdate an existing ServiceStack Reference:\n    " + scriptName + " {FileName}." + dtosExt + "\n\nShow usage:\n    -h --help -?\n    /h  /help /?";
    console.log(USAGE);
}
exports.execHelp = execHelp;
function importSwiftClientSources(cwd) {
    var clientSrcPath = utils_1.combinePaths(cwd, "JsonServiceClient.swift");
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
//# sourceMappingURL=index.js.map