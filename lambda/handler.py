"""
BPM / beat-grid / key analysis Lambda.

Invocation modes
-----------------
1. S3 event notification (async, ObjectCreated:*) — event has "Records".
2. Direct/manual invoke from the backend (RequestResponse or Event) with:
       {"bucket": "my-bucket", "key": "tracks/song.mp3"}
   Any extra fields you send (e.g. "trackId") are echoed back in the result,
   so you can correlate the response with your own record.

One BPM, one grid offset, one key for the whole file — no attempt to
detect tempo or key changes mid-track, by design.

Output
------
Always returns the analysis dict as the Lambda response payload (useful for
synchronous manual invokes). Also always writes a copy to
  s3://<RESULTS_BUCKET or source bucket>/<RESULTS_PREFIX>/<key>.json
so results from S3-triggered (fire-and-forget) runs are discoverable even
though nothing is waiting on the return value. If BACKEND_WEBHOOK_URL is
set, POSTs the result there too. Drop _notify_webhook / the env var if your
backend instead polls S3 or a DB table you write from here.
"""
import json
import logging
import os
import tempfile
import urllib.parse

import boto3
import numpy as np
import librosa

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

RESULTS_BUCKET = os.environ.get("RESULTS_BUCKET")  # defaults to source bucket if unset
RESULTS_PREFIX = os.environ.get("RESULTS_PREFIX").strip("/")
BACKEND_WEBHOOK_URL = os.environ.get("BACKEND_WEBHOOK_URL")  # optional
BACKEND_WEBHOOK_API_KEY = os.environ.get("BACKEND_WEBHOOK_API_KEY")  # optional

# Krumhansl-Schmuckler key profiles (relative pitch-class weights)
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def analyze_track(local_path: str) -> dict:
    """Single BPM, single grid offset, single key for the whole track."""
    y, sr = librosa.load(local_path, sr=22050, mono=True)

    # --- Tempo + beat grid (one global tempo estimate, on purpose) ---
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, trim=False)
    tempo = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    grid_offset_sec = float(beat_times[0]) if len(beat_times) else 0.0

    # --- Key: average chroma over the whole track, correlate against
    # major/minor templates in all 12 transpositions, take the best fit. ---
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    chroma_mean = chroma_mean / (np.linalg.norm(chroma_mean) + 1e-9)

    best_score, best_key = -np.inf, None
    for shift in range(12):
        maj = np.roll(MAJOR_PROFILE, shift)
        minr = np.roll(MINOR_PROFILE, shift)
        maj_score = np.corrcoef(chroma_mean, maj / np.linalg.norm(maj))[0, 1]
        min_score = np.corrcoef(chroma_mean, minr / np.linalg.norm(minr))[0, 1]
        if maj_score > best_score:
            best_score, best_key = maj_score, f"{PITCH_CLASSES[shift]} major"
        if min_score > best_score:
            best_score, best_key = min_score, f"{PITCH_CLASSES[shift]} minor"

    return {
        "bpm": round(tempo, 2),
        "grid_offset_sec": round(grid_offset_sec, 4),
        "key": best_key,
        "key_confidence": round(float(best_score), 4),
        "duration_sec": round(float(librosa.get_duration(y=y, sr=sr)), 3),
    }


def _iter_targets(event: dict):
    """Yield (bucket, key) pairs for either invocation shape."""
    if "Records" in event:
        for record in event["Records"]:
            bucket = record["s3"]["bucket"]["name"]
            key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
            yield bucket, key
    else:
        yield event["bucket"], event["key"]


def _download(bucket: str, key: str) -> str:
    suffix = os.path.splitext(key)[1] or ".audio"
    fd, local_path = tempfile.mkstemp(suffix=suffix, dir="/tmp")
    os.close(fd)
    s3.download_file(bucket, key, local_path)
    return local_path


def _persist_result(source_bucket: str, source_key: str, result: dict) -> str:
    out_bucket = RESULTS_BUCKET or source_bucket
    out_key = f"{RESULTS_PREFIX}/{source_key}.json"
    s3.put_object(
        Bucket=out_bucket,
        Key=out_key,
        Body=json.dumps(result).encode("utf-8"),
        ContentType="application/json",
    )
    return f"s3://{out_bucket}/{out_key}"


def _notify_webhook(payload: dict) -> None:
    if not BACKEND_WEBHOOK_URL:
        return
    import requests  # local import: only paid for when the webhook is used

    headers = {"Content-Type": "application/json"}
    if BACKEND_WEBHOOK_API_KEY:
        headers["Authorization"] = f"Bearer {BACKEND_WEBHOOK_API_KEY}"
    try:
        requests.post(BACKEND_WEBHOOK_URL, json=payload, headers=headers, timeout=10)
    except Exception:
        logger.exception("Webhook notify failed for %s", payload.get("key"))


def handler(event, context):
    logger.info("Event: %s", json.dumps(event)[:2000])

    results = []
    for bucket, key in _iter_targets(event):
        local_path = None
        try:
            local_path = _download(bucket, key)
            analysis = analyze_track(local_path)
            analysis.update({"bucket": bucket, "s3_key": key})
            analysis["status"] = "complete"
            # echo through any extra fields a manual caller sent (e.g. trackId)
            if "Records" not in event:
                for k, v in event.items():
                    if k not in ("bucket", "key"):
                        analysis.setdefault(k, v)

            result_location = _persist_result(bucket, key, analysis)
            analysis["result_location"] = result_location
            _notify_webhook(analysis)
            results.append(analysis)
        except Exception as exc:
            logger.exception("Analysis failed for s3://%s/%s", bucket, key)
            error_result = {"bucket": bucket, "s3_key": key, "status": "failed", "error": str(exc)}
            _persist_result(bucket, key, error_result)
            results.append(error_result)
        finally:
            if local_path and os.path.exists(local_path):
                os.remove(local_path)

    # Manual/direct single-target invoke: return the single result object
    # (not a list) so callers can read response["bpm"] etc. directly.
    if "Records" not in event and len(results) == 1:
        return results[0]
    return {"results": results}