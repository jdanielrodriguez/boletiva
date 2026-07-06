import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Almacenamiento de objetos. Local: S3 emulado por LocalStack. Prod: GCS
 * (que expone API compatible S3) o el SDK nativo de GCS (se añade en su ola).
 * Sirve para imágenes de evento, PDFs de boleto y wallet passes.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3!: S3Client;
  private bucket!: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const s3cfg = this.config.getOrThrow<{
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    }>('storage.s3');
    this.bucket = s3cfg.bucket;
    this.s3 = new S3Client({
      endpoint: s3cfg.endpoint,
      region: s3cfg.region,
      forcePathStyle: s3cfg.forcePathStyle,
      credentials: { accessKeyId: s3cfg.accessKeyId, secretAccessKey: s3cfg.secretAccessKey },
    });
    await this.ensureBucket();
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket "${this.bucket}" creado`);
      } catch (err) {
        this.logger.warn(
          `No se pudo asegurar el bucket "${this.bucket}": ${(err as Error).message}`,
        );
      }
    }
  }

  async putObject(key: string, body: Buffer | string, contentType?: string): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  }

  /** URL firmada (V4) de descarga, con expiración corta. */
  async signedGetUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  /** Verificación de conectividad para el health-check. */
  async ping(): Promise<boolean> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return true;
  }
}
