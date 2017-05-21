import * as fs from "fs";
import * as url from 'url';
import * as request from "request";

import {
    splitOnFirst,
    splitOnLast,
    combinePaths
} from "./utils";

const ALIAS = {
    "cs": "csharp",
    "ts": "typescript",
    "tsd": "typescript.d",
    "typescriptd": "typescript.d",
    "kt": "kotlin",
    "vb": "vbnet",
    "fs": "fsharp",
}

const REF_EXT = {
    "csharp": "dtos.cs",
    "typescript": "dtos.ts",
    "typescript.d": "dtos.d.ts",
    "swift": "dtos.swift",
    "java": "dtos.java",
    "kotlin": "dtos.kt",
    "vbnet": "dtos.vb",
    "fsharp": "dtos.fs",
};

export function cli(args: string[]) {
    const nodeExe = args[0];
    const cliPath = args[1];
    const scriptNameExt = splitOnLast(cliPath.replace(/\\/g, '/'), '/')[1];
    const scriptName = splitOnLast(scriptNameExt, '.')[0];
    const cliLang = splitOnLast(scriptName, '-')[0];
    const lang = ALIAS[cliLang] || cliLang;
    const cwd = process.cwd();
    const cmdArgs = args.slice(2);
    const dtosExt = REF_EXT[lang];

    // console.log({ cliPath, scriptNameExt, cliLang, lang, cmdArgs, dtosExt });
    // process.exit(0);

    const isDefault = cmdArgs.length == 0;

    if (isDefault) {
        execDefault(lang, cwd);
        return;
    }

    const isHelp = ["-h", "/h", "-?", "/?", "--help", "/help"].indexOf(cmdArgs[0]) >= 0;
    if (isHelp) {
        execHelp(lang, scriptName, dtosExt);
        return;
    }

    if (cmdArgs.length >= 1 && cmdArgs.length <= 2) {
        try {
            const target = cmdArgs[0];

            if (target.indexOf("://") >= 0) {
                var typesUrl = target.indexOf(`/types/${lang}`) == -1
                    ? combinePaths(target, `/types/${lang}`)
                    : target;

                var fileName = `Reference.${dtosExt}`;

                if (cmdArgs.length >= 2 && cmdArgs[1]) {
                    fileName = cmdArgs[1];
                } else {
                    const parts = url.parse(typesUrl).host.split('.');
                    fileName = parts.length >= 2
                        ? parts[parts.length - 2]
                        : parts[0];
                }

                if (!fileName.endsWith(`.${dtosExt}`)) {
                    fileName = fileName + `.${dtosExt}`;
                }

                saveReference(lang, typesUrl, cwd, fileName);

            } else {
                updateReference(lang, cwd, target);
            }

        } catch (e) {
            handleError(e);
        }
        return;
    }

    console.log("Unknown Command:");
    console.log(`${scriptName} ${cmdArgs.join(' ')}\n`);
    execHelp(lang, scriptName, dtosExt);
    return -1;
}

function handleError(e, msg:string=null) {
    if (msg) {
        console.error(msg);
    }
    console.error(e.message || e);
    process.exit(-1);
}

export function updateReference(lang: string, cwd: string, target:string) {
    const existingRefPath = combinePaths(cwd, target);
    if (!fs.existsSync(existingRefPath))
        throw new Error(`File does not exist: ${existingRefPath.replace(/\\/g, '/')}`);

    const existingRefSrc = fs.readFileSync(existingRefPath, 'utf8');

    if (existingRefSrc.indexOf("Options:") === -1) 
        throw new Error(`ERROR: ${target} is not an existing Swift ServiceStack Reference`);

    var options = {};
    var baseUrl = "";

    var lines = existingRefSrc.split(/\r?\n/);
    for (var line of lines) {
        if (line.startsWith("*/"))
            break;
        if (lang === "vbnet"){
            if (line.trim().length === 0)
                break;
            if (line[0] === "'")
                line = line.substring(1);
        }            
        
        if (line.startsWith("BaseUrl: ")) {
            baseUrl = line.substring("BaseUrl: ".length);
        } else if (baseUrl) {
            if (line.indexOf("//") === -1 && line.indexOf("'") === -1) {
                var parts = splitOnFirst(line, ":");
                if (parts.length === 2) {
                    var key = parts[0].trim();
                    var val = parts[1].trim();
                    options[key] = val;
                }
            }
        }
    }

    if (!baseUrl)
        throw new Error(`ERROR: Could not find baseUrl in ${target}`);

    var qs = "";
    for (var key in options) {
        qs += qs.length > 0 ? "&" : "?";
        qs += `${key}=${encodeURIComponent(options[key])}`;
    }

    const typesUrl = combinePaths(baseUrl, `/types/${lang}`) + qs;
    saveReference(lang, typesUrl, cwd, target);
}

export function saveReference(lang: string, typesUrl: string, cwd: string, fileName: string) {
    const filePath = combinePaths(cwd, fileName);

    var dtos = "";
    request(typesUrl, (err, res, dtos) => {
        if (err)
            handleError(err);

        try {
            if (dtos.indexOf("Options:") === -1) 
                throw new Error(`ERROR: Invalid Response from ${typesUrl}`);
            
            const filePathExists = fs.existsSync(filePath);

            fs.writeFileSync(filePath, dtos, 'utf8');

            console.log(filePathExists? `Saved to: ${fileName}` : `Updated: ${fileName}`);

            if (lang == "swift") {
                importSwiftClientSources(cwd);
            }

        } catch (e) {
            handleError(e, `ERROR: Could not write DTOs to: ${fileName}`);
        }

    });
}

export function execDefault(lang: string, cwd: string) {
    console.log('\nexecDefault', { lang, cwd });
}

export function execHelp(lang: string, scriptName: string, dtosExt: string) {
    const USAGE = `
Usage:

Add a new ServiceStack Reference:
    ${scriptName} {BaseUrl}
    ${scriptName} {BaseUrl} {FileName}

Update all *.${dtosExt} ServiceStack References in Current Directory:
    ${scriptName}

Update an existing ServiceStack Reference:
    ${scriptName} {FileName}.${dtosExt}

Show usage:
    -h --help -?
    /h  /help /?`;

    console.log(USAGE);
}

export function importSwiftClientSources(cwd:string) {
    const clientSrcPath = combinePaths(cwd, "JsonServiceClient.swift"); 

    if (!fs.existsSync(clientSrcPath)) {
        const clientSrcUrl = "https://servicestack.net/dist/swiftref/JsonServiceClient.swift";
        request(clientSrcUrl, (err, res, clientSrc) => {

            if (err)
                handleError(err);

            try {

                if (clientSrc.indexOf("JsonServiceClient") === -1) 
                    throw new Error(`ERROR: Invalid Response from ${clientSrcUrl}\n${clientSrc}`);

                fs.writeFileSync(clientSrcPath, clientSrc, 'utf8');
                console.log("Imported: JsonServiceClient.swift");

            } catch (e) {
                handleError(e, `ERROR: Could not import: JsonServiceClient.swift`);
            }
        });
    }
}
