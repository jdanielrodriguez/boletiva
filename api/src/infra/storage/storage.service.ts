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
  private endpoint = '';
  private publicEndpoint?: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const s3cfg = this.config.getOrThrow<{
      endpoint: string;
      publicEndpoint?: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    }>('storage.s3');
    this.bucket = s3cfg.bucket;
    this.endpoint = s3cfg.endpoint;
    this.publicEndpoint = s3cfg.publicEndpoint;
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
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
    return this.toPublicUrl(url);
  }

  /**
   * Reescribe el host interno del endpoint por el público (dev/LocalStack) para que
   * el navegador pueda descargar. LocalStack no valida la firma SigV4, así que
   * cambiar el host tras firmar es seguro en dev. Sin `publicEndpoint` (prod GCS)
   * devuelve la URL intacta.
   */
  private toPublicUrl(url: string): string {
    if (!this.publicEndpoint || !this.endpoint) return url;
    return url.startsWith(this.endpoint)
      ? this.publicEndpoint.replace(/\/$/, '') + url.slice(this.endpoint.replace(/\/$/, '').length)
      : url;
  }

  /** URL firmada (V4) de SUBIDA (PUT directo del navegador a storage). */
  async signedPutUrl(key: string, contentType?: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** Verificación de conectividad para el health-check. */
  async ping(): Promise<boolean> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return true;
  }
}
