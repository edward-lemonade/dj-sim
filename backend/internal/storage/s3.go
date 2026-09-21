package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/google/uuid"
)

type UploadedObject struct {
	URL string
	Key string
}

var (
	s3Mu          sync.Mutex
	s3Clients     = map[string]*s3.Client{}
	bucketRegions = map[string]string{}
)

func UploadTrackToS3(ctx context.Context, reader io.Reader, fileName, contentType string) (UploadedObject, error) {
	bucket := strings.TrimSpace(os.Getenv("AWS_S3_BUCKET"))
	if bucket == "" {
		return UploadedObject{}, fmt.Errorf("AWS_S3_BUCKET is not configured")
	}

	body, err := asReadSeeker(reader)
	if err != nil {
		return UploadedObject{}, err
	}

	client, region, err := clientForBucket(ctx, bucket)
	if err != nil {
		return UploadedObject{}, err
	}

	key := fmt.Sprintf("uploads/%s/%s-%s", time.Now().UTC().Format("2006/01/02"), uuid.NewString(), fileName)
	put := func(c *s3.Client) error {
		if seeker, ok := body.(io.Seeker); ok {
			_, _ = seeker.Seek(0, io.SeekStart)
		}
		_, err := c.PutObject(ctx, &s3.PutObjectInput{
			Bucket:      aws.String(bucket),
			Key:         aws.String(key),
			Body:        body,
			ContentType: aws.String(contentType),
		})
		return err
	}

	if err := put(client); err != nil {
		if redirected := regionFromError(err); redirected != "" && redirected != region {
			rememberBucketRegion(bucket, redirected)
			retryClient, retryRegion, retryErr := clientForBucket(ctx, bucket)
			if retryErr != nil {
				return UploadedObject{}, fmt.Errorf("upload to s3: %w", err)
			}
			if err := put(retryClient); err != nil {
				return UploadedObject{}, fmt.Errorf("upload to s3: %w", err)
			}
			region = retryRegion
		} else {
			return UploadedObject{}, fmt.Errorf("upload to s3: %w", err)
		}
	}

	return UploadedObject{
		URL: fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", bucket, region, key),
		Key: key,
	}, nil
}

type TrackObject struct {
	Body          io.ReadCloser
	ContentType   string
	ContentLength int64
}

func GetTrackFromS3(ctx context.Context, objectKey string) (*TrackObject, error) {
	if strings.TrimSpace(objectKey) == "" {
		return nil, fmt.Errorf("object key is required")
	}

	bucket := strings.TrimSpace(os.Getenv("AWS_S3_BUCKET"))
	if bucket == "" {
		return nil, fmt.Errorf("AWS_S3_BUCKET is not configured")
	}

	client, _, err := clientForBucket(ctx, bucket)
	if err != nil {
		return nil, err
	}

	get := func(c *s3.Client) (*s3.GetObjectOutput, error) {
		return c.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(objectKey),
		})
	}

	out, err := get(client)
	if err != nil {
		if redirected := regionFromError(err); redirected != "" {
			rememberBucketRegion(bucket, redirected)
			retryClient, _, retryErr := clientForBucket(ctx, bucket)
			if retryErr != nil {
				return nil, fmt.Errorf("get from s3: %w", err)
			}
			out, err = get(retryClient)
			if err != nil {
				return nil, fmt.Errorf("get from s3: %w", err)
			}
		} else {
			return nil, fmt.Errorf("get from s3: %w", err)
		}
	}

	contentType := "application/octet-stream"
	if out.ContentType != nil && strings.TrimSpace(*out.ContentType) != "" {
		contentType = *out.ContentType
	}
	var size int64
	if out.ContentLength != nil {
		size = *out.ContentLength
	}

	return &TrackObject{
		Body:          out.Body,
		ContentType:   contentType,
		ContentLength: size,
	}, nil
}

func DeleteTrackFromS3(ctx context.Context, objectKey string) error {
	if strings.TrimSpace(objectKey) == "" {
		return nil
	}

	bucket := strings.TrimSpace(os.Getenv("AWS_S3_BUCKET"))
	if bucket == "" {
		return fmt.Errorf("AWS_S3_BUCKET is not configured")
	}

	client, _, err := clientForBucket(ctx, bucket)
	if err != nil {
		return err
	}

	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		if redirected := regionFromError(err); redirected != "" {
			rememberBucketRegion(bucket, redirected)
			client, _, retryErr := clientForBucket(ctx, bucket)
			if retryErr != nil {
				return fmt.Errorf("delete from s3: %w", err)
			}
			_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(bucket),
				Key:    aws.String(objectKey),
			})
			if err != nil {
				return fmt.Errorf("delete from s3: %w", err)
			}
			return nil
		}
		return fmt.Errorf("delete from s3: %w", err)
	}
	return nil
}

func clientForBucket(ctx context.Context, bucket string) (*s3.Client, string, error) {
	region := rememberedBucketRegion(bucket)
	if region == "" {
		configured := strings.TrimSpace(os.Getenv("AWS_REGION"))
		if configured == "" {
			configured = "us-east-1"
		}
		resolved, err := lookupBucketRegion(ctx, bucket)
		if err != nil {
			region = configured
		} else {
			region = resolved
		}
		rememberBucketRegion(bucket, region)
	}

	client, err := s3Client(ctx, region)
	if err != nil {
		return nil, "", err
	}
	return client, region, nil
}

func lookupBucketRegion(ctx context.Context, bucket string) (string, error) {
	client, err := s3Client(ctx, "us-east-1")
	if err != nil {
		return "", err
	}
	out, err := client.GetBucketLocation(ctx, &s3.GetBucketLocationInput{
		Bucket: aws.String(bucket),
	})
	if err != nil {
		if redirected := regionFromError(err); redirected != "" {
			return redirected, nil
		}
		return "", err
	}
	if out == nil || out.LocationConstraint == "" {
		return "us-east-1", nil
	}
	if out.LocationConstraint == types.BucketLocationConstraintEu {
		return "eu-west-1", nil
	}
	return string(out.LocationConstraint), nil
}

func s3Client(ctx context.Context, region string) (*s3.Client, error) {
	s3Mu.Lock()
	defer s3Mu.Unlock()
	if client, ok := s3Clients[region]; ok {
		return client, nil
	}

	accessKey := strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID"))
	secretKey := strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY"))
	awsCfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	if accessKey != "" && secretKey != "" {
		awsCfg.Credentials = credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.Region = region
		o.UsePathStyle = false
	})
	s3Clients[region] = client
	return client, nil
}

func rememberedBucketRegion(bucket string) string {
	s3Mu.Lock()
	defer s3Mu.Unlock()
	return bucketRegions[bucket]
}

func rememberBucketRegion(bucket, region string) {
	if bucket == "" || region == "" {
		return
	}
	s3Mu.Lock()
	defer s3Mu.Unlock()
	bucketRegions[bucket] = region
}

func regionFromError(err error) string {
	var httpErr *awshttp.ResponseError
	if errors.As(err, &httpErr) && httpErr.Response != nil {
		if region := strings.TrimSpace(httpErr.Response.Header.Get("x-amz-bucket-region")); region != "" {
			return region
		}
	}
	return ""
}

func asReadSeeker(reader io.Reader) (io.ReadSeeker, error) {
	if rs, ok := reader.(io.ReadSeeker); ok {
		return rs, nil
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read upload body: %w", err)
	}
	return bytes.NewReader(data), nil
}
