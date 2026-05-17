import re
import tempfile
import threading
import whisper
import yt_dlp
from flask import Flask, render_template, request, jsonify
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from youtube_transcript_api._errors import (
    YouTubeTranscriptApiException,
    VideoUnavailable,
    RequestBlocked,
    IpBlocked,
)

app = Flask(__name__)

# Load Whisper model once at startup (base = good balance of speed/accuracy)
_whisper_model = None
_whisper_lock = threading.Lock()


def get_whisper_model():
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            import os
            model_name = os.environ.get("WHISPER_MODEL", "base")
            _whisper_model = whisper.load_model(model_name)
    return _whisper_model


def extract_video_id(url: str) -> str | None:
    match = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([a-zA-Z0-9_-]{11})", url)
    return match.group(1) if match else None


def fetch_youtube_transcript(video_id: str) -> tuple[str, str]:
    api = YouTubeTranscriptApi()
    transcript_list = api.list(video_id)

    # Prefer manually created captions, fall back to auto-generated
    try:
        transcript = transcript_list.find_manually_created_transcript(
            ["nl", "en", "de", "fr", "es"]
        )
    except NoTranscriptFound:
        transcript = transcript_list.find_generated_transcript(
            ["nl", "en", "de", "fr", "es"]
        )

    entries = transcript.fetch()
    language = transcript.language
    text = " ".join(entry["text"] for entry in entries)
    return text, f"YouTube ondertitels ({language})"


def transcribe_with_whisper(video_id: str) -> tuple[str, str]:
    with tempfile.TemporaryDirectory() as tmpdir:
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": f"{tmpdir}/audio.%(ext)s",
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "128",
                }
            ],
            "quiet": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([f"https://www.youtube.com/watch?v={video_id}"])

        model = get_whisper_model()
        result = model.transcribe(f"{tmpdir}/audio.mp3")

    return result["text"], f"Whisper ({result.get('language', 'onbekend')})"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/transcribe", methods=["POST"])
def transcribe():
    data = request.get_json()
    url = (data or {}).get("url", "").strip()

    if not url:
        return jsonify({"error": "Geen URL opgegeven"}), 400

    video_id = extract_video_id(url)
    if not video_id:
        return jsonify({"error": "Ongeldige YouTube URL"}), 400

    whisper_reason = None

    # Try YouTube subtitles first (fast, no download needed)
    try:
        text, method = fetch_youtube_transcript(video_id)
        return jsonify({"transcript": text, "method": method, "video_id": video_id})
    except VideoUnavailable:
        return jsonify({"error": "Video is niet beschikbaar of privé"}), 400
    except (TranscriptsDisabled, NoTranscriptFound):
        whisper_reason = "geen YouTube-ondertitels beschikbaar"
    except (RequestBlocked, IpBlocked):
        whisper_reason = "YouTube blokkeerde het verzoek"
    except YouTubeTranscriptApiException as e:
        whisper_reason = str(e)
    except Exception as e:
        app.logger.warning("Transcript API fout: %s", e)
        whisper_reason = str(e)

    app.logger.info("Whisper fallback gestart: %s", whisper_reason)

    # Fallback: download audio and transcribe locally with Whisper
    try:
        text, method = transcribe_with_whisper(video_id)
        return jsonify({"transcript": text, "method": method, "video_id": video_id})
    except Exception as e:
        return jsonify({"error": f"Transcriptie mislukt: {e}"}), 500


if __name__ == "__main__":
    app.run(debug=True)
