---
name: speech-to-text-gemini-web
description: Speech-to-text (transcription) skill using Gemini Web. Transcribes local audio files (mp3, wav, m4a, ogg, flac, opus, webm) to text, with optional language hint, timestamps, and translation. Shares login/cookies with the genimg-gemini-web skill.
---

# Speech-to-Text (Gemini Web)

Transcribes local audio files to text by uploading them to Gemini Web, reusing the
same browser-cookie authentication as the `genimg-gemini-web` skill.

Supports:
- Word-for-word transcription of local audio files
- Language hinting (e.g. `--language nl`)
- Approximate timestamps (`--timestamps`)
- Post-transcription translation (`--translate en`)
- Saving the transcript to a text file (`--output`)
- Multi-turn follow-up questions about the same audio (`--sessionId`)

## Quick start

```bash
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts audio.mp3
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts --audio recording.wav --output transcript.txt
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts interview.m4a --language nl --timestamps
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts audio.mp3 --translate en --json
```

## Options

| Option | Description |
|--------|-------------|
| `--audio <path>`, `-a` | Audio file to transcribe (positional argument also works) |
| `--output <path>`, `-o` | Save the transcript to a text file |
| `--language <hint>` | Hint for the spoken language (e.g. `nl`, `Dutch`) |
| `--timestamps` | Include approximate `[mm:ss]` timestamps in the transcript |
| `--translate <language>` | Also translate the transcript into the given language |
| `--prompt <text>`, `-p` | Override the default transcription instruction entirely |
| `--model <id>`, `-m` | `gemini-3-pro` (default), `gemini-2.5-pro`, `gemini-2.5-flash` |
| `--sessionId <id>` | Session ID to keep discussing the same audio afterwards |
| `--list-sessions` | List saved sessions (max 100, sorted by update time) |
| `--json` | Output as JSON |
| `--login` | Refresh cookies only, then exit |
| `--cookie-path <path>` | Custom cookie file path |
| `--profile-dir <path>` | Chrome profile directory |
| `--help`, `-h` | Show help |

## Supported audio formats

`.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.oga`, `.flac`, `.opus`, `.webm`

## Authentication

Uses the same Gemini cookie jar and Chrome profile as `genimg-gemini-web`
(`GEMINI_WEB_DATA_DIR` and friends). If no valid cookies are found, a Chrome
window opens for you to log in to Gemini; cookies are then cached for
subsequent runs.

```bash
# Force cookie refresh
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts --login
```

## Examples

### Basic transcription
```bash
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts voicememo.m4a
```

### Save transcript to file
```bash
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts meeting.wav --output meeting.txt
```

### Dutch audio with timestamps
```bash
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts gesprek.mp3 --language nl --timestamps
```

### Transcribe and translate to English
```bash
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts interview.mp3 --translate en
```

### Ask follow-up questions about the audio
```bash
npx -y bun skills/speech-to-text-gemini-web/scripts/main.ts call.mp3 --sessionId call-abc123
npx -y bun skills/genimg-gemini-web/scripts/main.ts "Summarize the key action items" --sessionId call-abc123
```
