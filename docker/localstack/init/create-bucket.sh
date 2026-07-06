#!/bin/bash
# LocalStack ejecuta este script cuando el servicio S3 está listo.
# Crea el bucket local usado por el StorageService.
set -e
awslocal s3 mb "s3://pasaeventos-local" || true
awslocal s3api put-bucket-cors --bucket pasaeventos-local --cors-configuration '{
  "CORSRules": [
    { "AllowedOrigins": ["*"], "AllowedMethods": ["GET","PUT","POST","DELETE","HEAD"], "AllowedHeaders": ["*"] }
  ]
}' || true
echo "LocalStack: bucket pasaeventos-local listo."
