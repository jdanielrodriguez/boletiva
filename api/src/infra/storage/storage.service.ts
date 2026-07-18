import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Storage as GcsStorage, type Bucket as GcsBucket } from '@google-cloud/storage';

/**
 * Contrato de almacenamiento de objetos, agnóstico del backend. Sirve para
 * imágenes de evento, PDFs de boleto y wallet passes.
 */
interface StorageBackend {
  init(): Promise<void>;
  putObject(key: string, body: Buffer | string, contentType?: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  signedGetUrl(key: string, expiresInSeconds: number): Promise<string>;
  signedPutUrl(key: string, contentType: string | undefined, expiresInSeconds: number): Promise<string>;
  ping(): Promise<void>;
}

/**
 * Almacenamiento de objetos. Local/dev: S3 emulado por LocalStack (`S3Backend`).
 * Prod: Google Cloud Storage NATIVO (`GcsBackend`), que firma las URLs localmente
 * con la cuenta de servicio (`GCS_SERVICE_ACCOUNT_JSON`) — sin llaves HMAC. El
 * backend se elige por `storage.provider` en el arranque; la API pública es idéntica
 * para el resto de la app (media/tickets/wallet inyectan `StorageService` por clase).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private backend!: StorageBackend;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const provider = this.config.get<'s3' | 'gcs'>('storage.provider') ?? 's3';
    this.backend =
      provider === 'gcs' ? new GcsBackend(this.config, this.logger) : new S3Backend(this.config, this.logger);
    this.logger.log(`Almacenamiento: backend "${provider}"`);
    await this.backend.init();
  }

  async putObject(key: string, body: Buffer | string, contentType?: string): Promise<string> {
    await this.backend.putObject(key, body, contentType);
    return key;
  }

  /**
   * Descarga un objeto como Buffer (p.ej. incrustar el banner del evento en el PDF
   * del boleto). Lanza si el objeto no existe; el llamador degrada con elegancia.
   */
  getObject(key: string): Promise<Buffer> {
    return this.backend.getObject(key);
  }

  /** URL firmada (V4) de descarga, con expiración corta. */
  signedGetUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return this.backend.signedGetUrl(key, expiresInSeconds);
  }

  /** URL firmada (V4) de SUBIDA (PUT directo del navegador al storage). */
  signedPutUrl(key: string, contentType?: string, expiresInSeconds = 300): Promise<string> {
    return this.backend.signedPutUrl(key, contentType, expiresInSeconds);
  }

  /** Verificación de conectividad para el health-check. */
  async ping(): Promise<boolean> {
    await this.backend.ping();
    return true;
  }
}

/**
 * Backend S3 (LocalStack en dev; también cualquier storage compatible S3). Conserva
 * el comportamiento previo intacto: reescribe el host interno por el público, asegura
 * el bucket y la CORS. Se firma con SigV4 vía `@aws-sdk/s3-request-presigner`.
 */
class S3Backend implements StorageBackend {
  private s3!: S3Client;
  private bucket!: string;
  private endpoint = '';
  private publicEndpoint?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  async init(): Promise<void> {
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
      // AWS SDK v3 ≥ 3.729 inyecta por DEFAULT `x-amz-checksum-crc32` en la URL
      // firmada (CRC32 del payload VACÍO, calculado al firmar) + el header
      // `x-amz-sdk-checksum-algorithm`. Al subir el binario real desde el navegador
      // el checksum no coincide → S3/LocalStack rechaza el PUT con 400
      // "Value for x-amz-checksum-crc32 header is invalid". `WHEN_REQUIRED` evita
      // firmar ese checksum salvo que la operación lo exija → el presign de subida
      // vuelve a funcionar (banner upload).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
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
        this.logger.warn(`No se pudo asegurar el bucket "${this.bucket}": ${(err as Error).message}`);
      }
    }
    await this.ensureCors();
  }

  /**
   * CORS del bucket: el navegador sube el banner por PUT firmado directamente al
   * storage (cross-origin). Sin una política CORS el preflight falla y la subida
   * se cae silenciosamente. Permisiva en dev (LocalStack). Tolerante a fallos.
   */
  private async ensureCors(): Promise<void> {
    try {
      await this.s3.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedMethods: ['GET', 'PUT', 'HEAD'],
                AllowedOrigins: ['*'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (err) {
      this.logger.warn(`No se pudo aplicar CORS al bucket: ${(err as Error).message}`);
    }
  }

  async putObject(key: string, body: Buffer | string, contentType?: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = res.Body;
    if (!body) throw new Error(`Objeto vacío: ${key}`);
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async signedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
    return this.toPublicUrl(url);
  }

  async signedPutUrl(key: string, contentType: string | undefined, expiresInSeconds: number): Promise<string> {
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
    return this.toPublicUrl(url);
  }

  async ping(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /**
   * Reescribe el host interno del endpoint por el público (dev/LocalStack) para que
   * el navegador pueda descargar. LocalStack no valida la firma SigV4, así que
   * cambiar el host tras firmar es seguro en dev. Sin `publicEndpoint` devuelve intacta.
   */
  private toPublicUrl(url: string): string {
    if (!this.publicEndpoint || !this.endpoint) return url;
    return url.startsWith(this.endpoint)
      ? this.publicEndpoint.replace(/\/$/, '') + url.slice(this.endpoint.replace(/\/$/, '').length)
      : url;
  }
}

/**
 * Backend nativo de Google Cloud Storage (prod). Firma las URLs V4 localmente con
 * la private key de la cuenta de servicio → no requiere llaves HMAC ni API S3-interop.
 * Si `GCS_SERVICE_ACCOUNT_JSON` viene vacío, usa las credenciales por defecto del
 * runtime de Cloud Run (ADC); en ese caso la firma de URLs requiere el permiso IAM
 * `iam.serviceAccounts.signBlob` sobre la SA del servicio.
 */
class GcsBackend implements StorageBackend {
  private storage!: GcsStorage;
  private bucket!: GcsBucket;
  private bucketName!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  async init(): Promise<void> {
    const gcs = this.config.getOrThrow<{ projectId: string; bucket: string; serviceAccountJson: string }>(
      'storage.gcs',
    );
    if (!gcs.bucket) {
      throw new Error('STORAGE_PROVIDER=gcs pero GCS_BUCKET está vacío.');
    }
    this.bucketName = gcs.bucket;
    const credentials = this.parseServiceAccount(gcs.serviceAccountJson);
    this.storage = new GcsStorage({
      projectId: gcs.projectId || undefined,
      ...(credentials ? { credentials } : {}), // sin JSON → ADC del runtime
    });
    this.bucket = this.storage.bucket(this.bucketName);
    // La CORS del bucket se gestiona a nivel de INFRA (una sola vez), NO en runtime:
    // la SA de prod tiene `roles/storage.objectAdmin` (objetos), que no incluye
    // `storage.buckets.update`. Configurar la CORS aquí siempre daría 403. Se aplica
    // con `gcloud storage buckets update gs://<bucket> --cors-file=cors.json`.
  }

  async putObject(key: string, body: Buffer | string, contentType?: string): Promise<void> {
    await this.bucket.file(key).save(body, {
      resumable: false,
      ...(contentType ? { contentType } : {}),
    });
  }

  async getObject(key: string): Promise<Buffer> {
    const [buf] = await this.bucket.file(key).download();
    return buf;
  }

  async signedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
    });
    return url;
  }

  async signedPutUrl(key: string, contentType: string | undefined, expiresInSeconds: number): Promise<string> {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + expiresInSeconds * 1000,
      ...(contentType ? { contentType } : {}),
    });
    return url;
  }

  async ping(): Promise<void> {
    // Comprobación a nivel OBJETO (storage.objects.list), no bucket: la SA de prod
    // tiene `roles/storage.objectAdmin` sobre el bucket (objetos: get/list/create/
    // delete) pero NO permisos de bucket (`buckets.get`), así que `bucket.exists()`
    // daría 403. Listar 1 objeto verifica credenciales + acceso real al bucket.
    await this.bucket.getFiles({ maxResults: 1, autoPaginate: false });
  }

  /** Acepta el JSON crudo o base64 (como suele venir de Secret Manager); vacío → ADC. */
  private parseServiceAccount(raw: string): { client_email: string; private_key: string } | null {
    if (!raw || !raw.trim()) return null;
    const attempt = (text: string): { client_email: string; private_key: string } | null => {
      try {
        const p = JSON.parse(text) as { client_email?: string; private_key?: string };
        if (p.client_email && p.private_key) return { client_email: p.client_email, private_key: p.private_key };
      } catch {
        // no era JSON directo
      }
      return null;
    };
    const direct = attempt(raw);
    if (direct) return direct;
    const decoded = attempt(Buffer.from(raw, 'base64').toString('utf8'));
    if (decoded) return decoded;
    // No exponemos el contenido de la cuenta de servicio en el log.
    this.logger.warn('GCS_SERVICE_ACCOUNT_JSON inválido (ni JSON ni base64 con client_email/private_key); se usará ADC.');
    return null;
  }
}
