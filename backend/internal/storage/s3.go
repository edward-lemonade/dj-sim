package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	appconfig "github.com/edward-lemonade/dj-sim-backend/internal/config"
)

type UploadedObject struct {
	URL string
	Key string
}

type S3Store struct {
	bucket          string
	defaultRegion   string
	accessKeyID     string
	secretAccessKey string

	mu            sync.RWMutex
	clients       map[string]*s3.Client
	bucketRegions map[string]string
}

func NewS3Store(cfg appconfig.Config) (*S3Store, error) {
	bucket := strings.TrimSpace(cfg.S3Bucket)
	if bucket == "" {
		return nil, fmt.Errorf("AWS_S3_BUCKET is not configured")
	}
	region := strings.TrimSpace(cfg.S3Region)
	if region == "" {
		region = "us-west-1"
	}
	return &S3Store{
		bucket:          bucket,
		defaultRegion:   region,
		accessKeyID:     strings.TrimSpace(cfg.AWSAccessKeyID),
		secretAccessKey: strings.TrimSpace(cfg.AWSSecretAccessKey),
		clients:         make(map[string]*s3.Client),
		bucketRegions:   make(map[string]string),
	}, nil
}

func (s *S3Store) UploadObject(ctx context.Context, reader io.Reader, key, contentType string) (UploadedObject, error) {
	body, err := asReadSeeker(reader)
	if err != nil {
		return UploadedObject{}, err
	}

	client, region, err := s.client(ctx)
	if err != nil {
		return UploadedObject{}, err
	}

	put := func(c *s3.Client) error {
		if seeker, ok := body.(io.Seeker); ok {
			_, _ = seeker.Seek(0, io.SeekStart)
		}
		_, err := c.PutObject(ctx, &s3.PutObjectInput{
			Bucket:      aws.String(s.bucket),
			Key:         aws.String(key),
			Body:        body,
			ContentType: aws.String(contentType),
		})
		return err
	}

	if err := put(client); err != nil {
		if redirected := regionFromError(err); redirected != "" && redirected != region {
			s.rememberBucketRegion(redirected)
			retryClient, retryRegion, retryErr := s.client(ctx)
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
		URL: fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", s.bucket, region, key),
		Key: key,
	}, nil
}

type S3Object struct {
	Body          io.ReadCloser
	ContentType   string
	ContentLength int64
}

func (s *S3Store) GetObject(ctx context.Context, objectKey string) (*S3Object, error) {
	if strings.TrimSpace(objectKey) == "" {
		return nil, fmt.Errorf("object key is required")
	}

	client, _, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	get := func(c *s3.Client) (*s3.GetObjectOutput, error) {
		return c.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(s.bucket),
			Key:    aws.String(objectKey),
		})
	}

	out, err := get(client)
	if err != nil {
		if redirected := regionFromError(err); redirected != "" {
			s.rememberBucketRegion(redirected)
			retryClient, _, retryErr := s.client(ctx)
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

	return &S3Object{
		Body:          out.Body,
		ContentType:   contentType,
		ContentLength: size,
	}, nil
}

func (s *S3Store) DeleteObject(ctx context.Context, objectKey string) error {
	if strings.TrimSpace(objectKey) == "" {
		return nil
	}

	client, _, err := s.client(ctx)
	if err != nil {
		return err
	}

	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		if redirected := regionFromError(err); redirected != "" {
			s.rememberBucketRegion(redirected)
			retryClient, _, retryErr := s.client(ctx)
			if retryErr != nil {
				return fmt.Errorf("delete from s3: %w", err)
			}
			_, err = retryClient.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(s.bucket),
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

func (s *S3Store) RetriggerObject(ctx context.Context, objectKey string) error {
	if strings.TrimSpace(objectKey) == "" {
		return fmt.Errorf("object key is required")
	}

	client, _, err := s.client(ctx)
	if err != nil {
		return err
	}

	touch := func(c *s3.Client) error {
		head, err := c.HeadObject(ctx, &s3.HeadObjectInput{
			Bucket: aws.String(s.bucket),
			Key:    aws.String(objectKey),
		})
		if err != nil {
			return err
		}
		_, err = c.CopyObject(ctx, &s3.CopyObjectInput{
			Bucket:            aws.String(s.bucket),
			Key:               aws.String(objectKey),
			CopySource:        aws.String(copySource(s.bucket, objectKey)),
			ContentType:       head.ContentType,
			Metadata:          head.Metadata,
			MetadataDirective: types.MetadataDirectiveReplace,
		})
		return err
	}

	if err := touch(client); err != nil {
		redirected := regionFromError(err)
		if redirected == "" {
			return fmt.Errorf("retrigger s3 object: %w", err)
		}
		s.rememberBucketRegion(redirected)
		retryClient, _, retryErr := s.client(ctx)
		if retryErr != nil {
			return fmt.Errorf("retrigger s3 object: %w", err)
		}
		if err := touch(retryClient); err != nil {
			return fmt.Errorf("retrigger s3 object: %w", err)
		}
	}
	return nil
}

// Helpers

func (s *S3Store) client(ctx context.Context) (*s3.Client, string, error) {
	region := s.rememberedBucketRegion()
	if region == "" {
		resolved, err := s.lookupBucketRegion(ctx)
		if err != nil {
			region = s.defaultRegion
		} else {
			region = resolved
		}
		s.rememberBucketRegion(region)
	}

	client, err := s.clientForRegion(ctx, region)
	if err != nil {
		return nil, "", err
	}
	return client, region, nil
}

func (s *S3Store) lookupBucketRegion(ctx context.Context) (string, error) {
	client, err := s.clientForRegion(ctx, s.defaultRegion)
	if err != nil {
		return "", err
	}
	out, err := client.GetBucketLocation(ctx, &s3.GetBucketLocationInput{
		Bucket: aws.String(s.bucket),
	})
	if err != nil {
		if redirected := regionFromError(err); redirected != "" {
			return redirected, nil
		}
		return "", err
	}
	if out == nil || out.LocationConstraint == "" {
		return s.defaultRegion, nil
	}
	if out.LocationConstraint == types.BucketLocationConstraintEu {
		return "eu-west-1", nil
	}
	return string(out.LocationConstraint), nil
}

func (s *S3Store) clientForRegion(ctx context.Context, region string) (*s3.Client, error) {
	s.mu.RLock()
	if client, ok := s.clients[region]; ok {
		s.mu.RUnlock()
		return client, nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if client, ok := s.clients[region]; ok {
		return client, nil
	}

	awsCfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	if s.accessKeyID != "" && s.secretAccessKey != "" {
		awsCfg.Credentials = credentials.NewStaticCredentialsProvider(s.accessKeyID, s.secretAccessKey, "")
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.Region = region
		o.UsePathStyle = false
	})
	s.clients[region] = client
	return client, nil
}

func (s *S3Store) rememberedBucketRegion() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.bucketRegions[s.bucket]
}

func (s *S3Store) rememberBucketRegion(region string) {
	if region == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bucketRegions[s.bucket] = region
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

func copySource(bucket, key string) string {
	parts := strings.Split(key, "/")
	for i, p := range parts {
		parts[i] = strings.ReplaceAll(url.QueryEscape(p), "+", "%20")
	}
	return bucket + "/" + strings.Join(parts, "/")
}
