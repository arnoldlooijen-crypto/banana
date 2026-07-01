import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { fetchGeminiAccessToken, runGeminiWebWithFallback } from '../../genimg-gemini-web/scripts/client.js';
import { getGeminiCookieMapViaChrome } from '../../genimg-gemini-web/scripts/chrome-auth.js';
import {
    hasRequiredGeminiCookies,
    readGeminiCookieMapFromDisk,
    writeGeminiCookieMapToDisk,
} from '../../genimg-gemini-web/scripts/cookie-store.js';
import {
    resolveGeminiWebChromeProfileDir,
    resolveGeminiWebCookiePath,
} from '../../genimg-gemini-web/scripts/paths.js';
import { readSession, writeSession, listSessions } from '../../genimg-gemini-web/scripts/session-store.js';

const AUDIO_EXTENSIONS = new Set([
    '.mp3',
    '.wav',
    '.m4a',
    '.aac',
    '.ogg',
    '.oga',
    '.flac',
    '.opus',
    '.webm',
]);

function printUsage(exitCode = 0): never {
    const cookiePath = resolveGeminiWebCookiePath();
    const profileDir = resolveGeminiWebChromeProfileDir();

    console.log(`Usage:
  npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts audio.mp3
  npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts --audio audio.wav --output transcript.txt
  npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts recording.m4a --language nl --timestamps
  npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts audio.mp3 --translate en

Options:
  -a, --audio <path>        Audio file to transcribe (positional argument also works)
  -o, --output <path>       Save the transcript to a text file
  --language <hint>         Hint for the spoken language (e.g. "nl", "Dutch")
  --timestamps               Include approximate timestamps in the transcript
  --translate <language>    Translate the transcript into the given language
  --prompt <text>           Override the default transcription instruction entirely
  -m, --model <id>          gemini-3-pro | gemini-2.5-pro | gemini-2.5-flash (default: gemini-3-pro)
  --sessionId <id>          Session ID to keep discussing the same audio afterwards
  --list-sessions           List saved sessions (max 100, sorted by update time)
  --json                    Output JSON
  --login                   Only refresh cookies, then exit
  --cookie-path <path>      Cookie file path (default: ${cookiePath})
  --profile-dir <path>      Chrome profile dir (default: ${profileDir})
  -h, --help                Show help

Env overrides:
  GEMINI_WEB_DATA_DIR, GEMINI_WEB_COOKIE_PATH, GEMINI_WEB_CHROME_PROFILE_DIR, GEMINI_WEB_CHROME_PATH
`);

    process.exit(exitCode);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]): {
    audioPath?: string;
    outputPath?: string;
    language?: string;
    timestamps?: boolean;
    translate?: string;
    prompt?: string;
    model?: string;
    json?: boolean;
    loginOnly?: boolean;
    cookiePath?: string;
    profileDir?: string;
    sessionId?: string;
    listSessions?: boolean;
} {
    const out: ReturnType<typeof parseArgs> = {};
    const positional: string[] = [];

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] ?? '';
        if (arg === '--help' || arg === '-h') printUsage(0);
        if (arg === '--json') {
            out.json = true;
            continue;
        }
        if (arg === '--timestamps') {
            out.timestamps = true;
            continue;
        }
        if (arg === '--login') {
            out.loginOnly = true;
            continue;
        }
        if (arg === '--audio' || arg === '-a') {
            out.audioPath = argv[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--audio=')) {
            out.audioPath = arg.slice('--audio='.length);
            continue;
        }
        if (arg === '--output' || arg === '-o') {
            out.outputPath = argv[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--output=')) {
            out.outputPath = arg.slice('--output='.length);
            continue;
        }
        if (arg === '--language' || arg === '--lang') {
            out.language = argv[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--language=') || arg.startsWith('--lang=')) {
            out.language = arg.split('=').slice(1).join('=');
            continue;
        }
        if (arg === '--translate') {
            out.translate = argv[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--translate=')) {
            out.translate = arg.slice('--translate='.length);
            continue;
        }
        if (arg === '--prompt' || arg === '-p') {
            out.prompt = argv[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--prompt=')) {
            out.prompt = arg.slice('--prompt='.length);
            continue;
        }
        if (arg === '--model' || arg === '-m') {
            out.model = argv[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--model=')) {
            out.model = arg.slice('--model='.length);
            continue;
        }
        if (arg === '--cookie-path') {
            out.cookiePath = argv[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--cookie-path=')) {
            out.cookiePath = arg.slice('--cookie-path='.length);
            continue;
        }
        if (arg === '--profile-dir') {
            out.profileDir = argv[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--profile-dir=')) {
            out.profileDir = arg.slice('--profile-dir='.length);
            continue;
        }
        if (arg === '--sessionId' || arg === '--session-id') {
            out.sessionId = argv[i + 1] ?? '';
            i += 1;
            continue;
        }
        if (arg.startsWith('--sessionId=') || arg.startsWith('--session-id=')) {
            out.sessionId = arg.split('=')[1] ?? '';
            continue;
        }
        if (arg === '--list-sessions') {
            out.listSessions = true;
            continue;
        }

        if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
        }
        positional.push(arg);
    }

    if (!out.audioPath && positional.length > 0) {
        out.audioPath = positional.join(' ').trim();
    }

    if (out.audioPath != null) out.audioPath = out.audioPath.trim();
    if (out.outputPath != null) out.outputPath = out.outputPath.trim();
    if (out.language != null) out.language = out.language.trim();
    if (out.translate != null) out.translate = out.translate.trim();
    if (out.prompt != null) out.prompt = out.prompt.trim();
    if (out.model != null) out.model = out.model.trim();
    if (out.cookiePath != null) out.cookiePath = out.cookiePath.trim();
    if (out.profileDir != null) out.profileDir = out.profileDir.trim();
    if (out.sessionId != null) out.sessionId = out.sessionId.trim();

    if (out.audioPath === '') delete out.audioPath;
    if (out.outputPath === '') delete out.outputPath;
    if (out.language === '') delete out.language;
    if (out.translate === '') delete out.translate;
    if (out.prompt === '') delete out.prompt;
    if (out.cookiePath === '') delete out.cookiePath;
    if (out.profileDir === '') delete out.profileDir;
    if (out.sessionId === '') delete out.sessionId;

    return out;
}

async function isCookieMapValid(cookieMap: Record<string, string>): Promise<boolean> {
    if (!hasRequiredGeminiCookies(cookieMap)) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
        await fetchGeminiAccessToken(cookieMap, controller.signal);
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

async function ensureGeminiCookieMap(options: {
    cookiePath: string;
    profileDir: string;
}): Promise<Record<string, string>> {
    const log = (msg: string) => console.error(msg);

    let cookieMap = await readGeminiCookieMapFromDisk({ cookiePath: options.cookiePath, log });
    if (await isCookieMapValid(cookieMap)) return cookieMap;

    log('[speech-to-text] No valid cookies found. Opening browser to sync Gemini cookies...');
    cookieMap = await getGeminiCookieMapViaChrome({ userDataDir: options.profileDir, log });
    await writeGeminiCookieMapToDisk(cookieMap, { cookiePath: options.cookiePath, log });
    return cookieMap;
}

function resolveModel(value: string): 'gemini-3-pro' | 'gemini-2.5-pro' | 'gemini-2.5-flash' {
    const desired = value.trim();
    if (!desired) return 'gemini-3-pro';
    switch (desired) {
        case 'gemini-3-pro':
        case 'gemini-3.0-pro':
            return 'gemini-3-pro';
        case 'gemini-2.5-pro':
            return 'gemini-2.5-pro';
        case 'gemini-2.5-flash':
            return 'gemini-2.5-flash';
        default:
            console.error(`[speech-to-text] Unsupported model "${desired}", falling back to gemini-3-pro.`);
            return 'gemini-3-pro';
    }
}

function resolveAudioPath(value: string): string {
    const resolved = path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Audio file not found: ${resolved}`);
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) {
        console.error(
            `[speech-to-text] Warning: "${ext}" is not a recognized audio extension. Attempting upload anyway.`,
        );
    }
    return resolved;
}

function buildTranscriptionPrompt(args: {
    language?: string;
    timestamps?: boolean;
    translate?: string;
    prompt?: string;
}): string {
    if (args.prompt) return args.prompt;

    const parts: string[] = [
        'Transcribe the attached audio file word-for-word.',
        'Return only the transcript text, with no preamble, labels, or commentary.',
    ];

    if (args.language) {
        parts.push(`The spoken language is expected to be: ${args.language}.`);
    } else {
        parts.push('Keep the transcript in the original spoken language.');
    }

    if (args.timestamps) {
        parts.push('Prefix each sentence or speaker turn with an approximate timestamp like [mm:ss].');
    }

    if (args.translate) {
        parts.push(`After transcribing, also provide a translation of the full transcript into ${args.translate}, clearly separated under a "Translation:" heading.`);
    }

    return parts.join(' ');
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const cookiePath = args.cookiePath ?? resolveGeminiWebCookiePath();
    const profileDir = args.profileDir ?? resolveGeminiWebChromeProfileDir();

    if (args.listSessions) {
        const sessions = await listSessions();
        if (sessions.length === 0) {
            console.log('No saved sessions.');
        } else {
            for (const { id, updatedAt } of sessions) {
                console.log(`${id}\t${updatedAt}`);
            }
        }
        return;
    }

    if (args.loginOnly) {
        await ensureGeminiCookieMap({ cookiePath, profileDir });
        return;
    }

    if (!args.audioPath) printUsage(1);
    const audioPath = resolveAudioPath(args.audioPath);

    const sessionData = args.sessionId ? await readSession(args.sessionId) : null;
    const chatMetadata = sessionData?.metadata ?? null;

    let cookieMap = await ensureGeminiCookieMap({ cookiePath, profileDir });
    const desiredModel = resolveModel(args.model || 'gemini-3-pro');
    const prompt = buildTranscriptionPrompt(args);

    async function transcribeOnce() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300_000);
        try {
            const out = await runGeminiWebWithFallback({
                prompt,
                files: [audioPath],
                model: desiredModel,
                cookieMap,
                chatMetadata,
                signal: controller.signal,
            });

            if (args.sessionId && out.metadata) {
                await writeSession(args.sessionId, out.metadata, prompt, out.text ?? '', out.errorMessage);
            }

            return out;
        } finally {
            clearTimeout(timeout);
        }
    }

    let out: Awaited<ReturnType<typeof transcribeOnce>>;
    try {
        out = await transcribeOnce();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Unable to locate Gemini access token')) throw error;

        console.error('[speech-to-text] Cookies may be expired. Re-opening browser to refresh cookies...');
        await sleep(500);
        cookieMap = await getGeminiCookieMapViaChrome({ userDataDir: profileDir, log: (m) => console.error(m) });
        await writeGeminiCookieMapToDisk(cookieMap, { cookiePath, log: (m) => console.error(m) });
        out = await transcribeOnce();
    }

    if (args.outputPath) {
        const resolvedOutput = path.isAbsolute(args.outputPath)
            ? args.outputPath
            : path.resolve(process.cwd(), args.outputPath);
        fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
        fs.writeFileSync(resolvedOutput, `${out.text ?? ''}\n`);
    }

    if (args.json) {
        const jsonOut = {
            ...out,
            ...(args.outputPath && { outputPath: args.outputPath }),
            ...(args.sessionId && { sessionId: args.sessionId }),
        };
        process.stdout.write(`${JSON.stringify(jsonOut, null, 2)}\n`);
        if (out.errorMessage) process.exit(1);
        return;
    }

    if (out.errorMessage) {
        throw new Error(out.errorMessage);
    }

    process.stdout.write(out.text ?? '');
    if (!out.text?.endsWith('\n')) process.stdout.write('\n');
    if (args.outputPath) {
        process.stdout.write(`Saved transcript to: ${args.outputPath}\n`);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
