# track-analyzer Lambda

Container-image Lambda that computes a single BPM, beat-grid offset, and key
for a track. Callable two ways against the same code path:

1. **S3 upload trigger** — fires automatically on `ObjectCreated`.
2. **Manual invoke** — your backend calls it directly via `lambda:Invoke`
   with `{"bucket": "...", "key": "..."}`.

## Layout

```
handler.py                       # Lambda code
Dockerfile / requirements.txt    # container image
build_and_push.sh                # builds & pushes the image to ECR
.env.example                     # copy to .env — region, bucket, function name
terraform/
  versions.tf                    # provider + AWS account lookup
  variables.tf                   # all inputs, incl. bucket_name
  ecr.tf                         # image repository
  iam.tf                         # execution role, least-privilege policy
  lambda.tf                      # the function itself
  s3.tf                          # permission + bucket notification (trigger)
  outputs.tf
  terraform.tfvars.example       # copy to terraform.tfvars — NOT committed
```

`bucket_name` and everything else environment-specific live in
`terraform.tfvars` / `.env`, both gitignored — only the `.example` files are
committed.

## Bootstrap order

Terraform provisions AWS resources; it doesn't build the container image.
The Lambda resource needs an image to already exist at its `image_uri`, and
the ECR repo needs to exist before you can push to it — so it's a two-pass
apply the first time:

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars   # fill in your values
cp .env.example .env                                                # fill in your values

cd terraform
terraform init
terraform apply -target=aws_ecr_repository.track_analyzer   # create just the repo

cd ..
./build_and_push.sh latest

cd terraform
terraform apply                                              # everything else
```

Every subsequent deploy (new image, same infra) is just:

```bash
./build_and_push.sh v2
terraform apply -var image_tag=v2
```

## Manual invoke from your backend

```python
import boto3, json

lambda_client = boto3.client("lambda")

response = lambda_client.invoke(
    FunctionName="track-analyzer",
    InvocationType="RequestResponse",  # synchronous — waits for the result
    Payload=json.dumps({
        "bucket": "YOUR_BUCKET",
        "key": "tracks/song.mp3",
        "trackId": "abc123",  # optional, echoed back in the result
    }).encode(),
)
result = json.loads(response["Payload"].read())
print(result)
# {"bpm": 128.03, "grid_offset_sec": 0.0464, "key": "A minor", ...}
```

Use `InvocationType="Event"` if the backend shouldn't block — then read the
result back from `s3://YOUR_BUCKET/analysis/tracks/song.mp3.json` (or via
`backend_webhook_url` in tfvars), same as the S3-triggered path does.

## Notes

- Memory (3008 MB) and timeout (300s) are set generously for chroma/beat
  analysis on full-length tracks — tune down once you've measured real
  timings for your file sizes.
- `s3.tf` assumes `bucket_name` already exists (managed elsewhere, or
  created by another stack) and only attaches a notification to it. Say so
  if you'd rather Terraform own the bucket too.
- S3 only allows one suffix filter per notification block, so there's one
  `lambda_function` block per extension in `s3.tf` — add more for formats
  beyond mp3/wav.