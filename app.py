import os
import re
import tempfile
from flask import Flask, render_template, request, jsonify
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from youtube_transcript_api._errors import (
    YouTubeTranscriptApiException,
    VideoUnavailable,
    RequestBlocked,
    IpBlocked,
)
from openai import OpenAI

app = Flask(__name__)


def extract_video_id(url: str) -> str | None:
    patterns = [
        r"(?:v=|youtu\.be/|embed/|shorts/)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def fetch_youtube_transcript(video_id: str) -> tuple[str, str]:
    api = YouTubeTranscriptApi()
    transcript_list = api.list(video_id)

    # Prefer manually created, then auto-generated
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
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is niet ingesteld")

    import yt_dlp

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, "audio.mp3")
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": os.path.join(tmpdir, "audio.%(ext)s"),
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

        client = OpenAI(api_key=api_key)
        with open(audio_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
            )

    return response.text, "OpenAI Whisper"


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

    # Try YouTube transcript first
    try:
        text, method = fetch_youtube_transcript(video_id)
        return jsonify({"transcript": text, "method": method, "video_id": video_id})
    except VideoUnavailable:
        return jsonify({"error": "Video is niet beschikbaar of privé"}), 400
    except (TranscriptsDisabled, NoTranscriptFound):
        whisper_reason = "Geen YouTube-ondertitels beschikbaar"
    except (RequestBlocked, IpBlocked):
        whisper_reason = "YouTube blokkeerde het verzoek"
    except YouTubeTranscriptApiException as e:
        whisper_reason = str(e)
    except Exception as e:
        app.logger.warning("Transcript API fout: %s", e)
        whisper_reason = str(e)

    app.logger.info("YouTube transcript niet beschikbaar (%s), probeer Whisper", whisper_reason)

    # Fallback to Whisper
    try:
        text, method = transcribe_with_whisper(video_id)
        return jsonify({"transcript": text, "method": method, "video_id": video_id})
    except ValueError as e:
        return jsonify({
            "error": f"Geen ondertitels gevonden ({whisper_reason}) en geen OpenAI API-sleutel ingesteld voor Whisper"
        }), 400
    except Exception as e:
        return jsonify({"error": f"Transcriptie mislukt: {e}"}), 500


if __name__ == "__main__":
    app.run(debug=True)
