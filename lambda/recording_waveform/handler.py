"""Generate compact waveform sidecars for uploaded recording MP3s."""

import json
import logging
import os
import subprocess
import tempfile
import time
import urllib.parse

import boto3
import numpy as np
import requests

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
PEAK_COUNT = 2048
SAMPLE_RATE = 8000
RECORDINGS_PREFIX = os.environ.get("RECORDINGS_PREFIX", "recordings/").lstrip("/")
BACKEND_WAVEFORM_WEBHOOK_URL = os.environ.get("BACKEND_WAVEFORM_WEBHOOK_URL", "")
BACKEND_WEBHOOK_API_KEY = os.environ.get("BACKEND_WEBHOOK_API_KEY", "")


def _duration_seconds(local_path: str) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            local_path,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    duration = float(result.stdout.strip())
    if not 0 < duration <= 3600:
        raise ValueError("recording duration is outside the supported range")
    return duration


def _decode_peaks(local_path: str, duration: float) -> list[list[float]]:
    total_samples = max(1, round(duration * SAMPLE_RATE))
    minimums = np.ones(PEAK_COUNT, dtype=np.float32)
    maximums = -np.ones(PEAK_COUNT, dtype=np.float32)
    populated = np.zeros(PEAK_COUNT, dtype=np.bool_)
    sample_offset = 0

    process = subprocess.Popen(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            local_path,
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    assert process.stdout is not None
    try:
        while chunk := process.stdout.read(128 * 1024):
            if len(chunk) % 2:
                raise ValueError("decoder returned an incomplete PCM sample")
            samples = np.frombuffer(chunk, dtype="<i2").astype(np.float32) / 32768.0
            indices = (
                (np.arange(sample_offset, sample_offset + len(samples), dtype=np.int64) * PEAK_COUNT)
                // total_samples
            ).clip(0, PEAK_COUNT - 1)
            np.minimum.at(minimums, indices, samples)
            np.maximum.at(maximums, indices, samples)
            populated[indices] = True
            sample_offset += len(samples)
    finally:
        process.stdout.close()

    return_code = process.wait(timeout=30)
    if return_code != 0:
        raise RuntimeError("ffmpeg could not decode recording")
    if sample_offset == 0:
        raise ValueError("recording contains no decodable audio")

    minimums[~populated] = 0
    maximums[~populated] = 0
    return [
        [round(float(low), 5), round(float(high), 5)]
        for low, high in zip(minimums, maximums)
    ]


def _notify_backend(object_key: str, status: str) -> None:
    if not BACKEND_WAVEFORM_WEBHOOK_URL:
        return
    headers = {"Authorization": f"Bearer {BACKEND_WEBHOOK_API_KEY}"}
    last_error = None
    for attempt in range(4):
        try:
            response = requests.post(
                BACKEND_WAVEFORM_WEBHOOK_URL,
                json={"s3_key": object_key, "status": status},
                headers=headers,
                timeout=10,
            )
            if response.status_code == 404 or response.status_code >= 500:
                response.raise_for_status()
                last_error = RuntimeError(f"waveform webhook returned {response.status_code}")
            else:
                response.raise_for_status()
                return
        except requests.RequestException as error:
            last_error = error
        if attempt < 3:
            time.sleep(2**attempt)
    raise RuntimeError("waveform webhook could not be updated") from last_error


def _process_recording(bucket: str, object_key: str) -> dict:
    if not object_key.startswith(RECORDINGS_PREFIX) or not object_key.endswith(".mp3"):
        raise ValueError("S3 event is outside the configured recordings prefix")

    fd, local_path = tempfile.mkstemp(suffix=".mp3", dir="/tmp")
    os.close(fd)
    try:
        s3.download_file(bucket, object_key, local_path)
        duration = _duration_seconds(local_path)
        waveform = {
            "version": 1,
            "durationSeconds": round(duration, 3),
            "peaks": _decode_peaks(local_path, duration),
        }
        sidecar_key = f"{object_key}.waveform.json"
        s3.put_object(
            Bucket=bucket,
            Key=sidecar_key,
            Body=json.dumps(waveform, separators=(",", ":")).encode("utf-8"),
            ContentType="application/json",
            CacheControl="private, max-age=3600",
        )
    except Exception:
        logger.exception("Waveform generation failed for s3://%s/%s", bucket, object_key)
        try:
            s3.put_object(
                Bucket=bucket,
                Key=f"{object_key}.waveform-status.json",
                Body=b'{"status":"failed"}',
                ContentType="application/json",
                CacheControl="private, max-age=3600",
            )
        except Exception:
            logger.exception("Could not write waveform failure status for s3://%s/%s", bucket, object_key)
        try:
            _notify_backend(object_key, "failed")
        except Exception:
            logger.exception("Could not notify backend of waveform failure for s3://%s/%s", bucket, object_key)
        raise
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)

    try:
        _notify_backend(object_key, "complete")
    except Exception:
        logger.exception("Could not notify backend of waveform completion for s3://%s/%s", bucket, object_key)
    return {"s3_key": object_key, "status": "complete", "peak_count": PEAK_COUNT}


def handler(event, context):
    results = []
    if "Records" in event:
        targets = (
            (
                record["s3"]["bucket"]["name"],
                urllib.parse.unquote_plus(record["s3"]["object"]["key"]),
            )
            for record in event["Records"]
        )
    else:
        targets = [(event["bucket"], event["key"])]

    for bucket, key in targets:
        results.append(_process_recording(bucket, key))
    return {"results": results}
