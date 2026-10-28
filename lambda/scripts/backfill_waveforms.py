"""Rate-limited backfill for recordings without waveform sidecars."""

import argparse
import json
import time

import boto3
from botocore.exceptions import ClientError


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", required=True, help="S3 bucket containing recordings")
    parser.add_argument("--function", required=True, help="Deployed waveform Lambda function name")
    parser.add_argument("--prefix", default="recordings/", help="Recording object key prefix")
    parser.add_argument("--delay-seconds", type=float, default=1.0, help="Delay between invocations")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Reprocess recordings even when a waveform sidecar already exists",
    )
    parser.add_argument("--execute", action="store_true", help="Invoke the Lambda; otherwise only report candidates")
    args = parser.parse_args()
    if args.delay_seconds < 0:
        parser.error("--delay-seconds cannot be negative")

    client = boto3.client("s3")
    lambda_client = boto3.client("lambda")
    paginator = client.get_paginator("list_objects_v2")
    candidates = 0
    invoked = 0

    for page in paginator.paginate(Bucket=args.bucket, Prefix=args.prefix):
        for item in page.get("Contents", []):
            key = item["Key"]
            if not key.endswith(".mp3"):
                continue
            sidecar_key = f"{key}.waveform.json"
            if not args.force:
                try:
                    client.head_object(Bucket=args.bucket, Key=sidecar_key)
                except ClientError as error:
                    status_code = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
                    error_code = error.response.get("Error", {}).get("Code")
                    if status_code != 404 and error_code not in {"404", "NoSuchKey", "NotFound"}:
                        raise
                else:
                    continue

            candidates += 1
            print(f"{'Would process' if not args.execute else 'Processing'} s3://{args.bucket}/{key}")
            if not args.execute:
                continue

            response = lambda_client.invoke(
                FunctionName=args.function,
                InvocationType="RequestResponse",
                Payload=json.dumps({"bucket": args.bucket, "key": key}).encode("utf-8"),
            )
            if response.get("FunctionError"):
                payload = response["Payload"].read().decode("utf-8", errors="replace")
                raise RuntimeError(f"waveform Lambda failed for {key}: {payload}")
            invoked += 1
            if args.delay_seconds:
                time.sleep(args.delay_seconds)

    print(f"Found {candidates} recording(s); invoked {invoked}.")


if __name__ == "__main__":
    main()
