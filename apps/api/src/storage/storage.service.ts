/**
 * Сервис S3-хранилища (v0.7.0-B, ADR-036).
 *
 * Обёртка над S3-совместимым API с двумя задачами:
 *  1. presigned PUT/GET — файлы ходят напрямую клиент ↔ хранилище,
 *     API не перекачивает мегабайты и не держит соединение;
 *  2. HEAD объекта — подтверждение, что клиент реально загрузил файл
 *     (confirm без объекта в хранилище → 400, «мёртвых» ссылок нет).
 *
 * Доступность: если S3_* не задан ИЛИ бакет недоступен при старте —
 * сервис честно говорит isAvailable()=false, и доказательства идут
 * fallback-путём (data:-URL ≤ 500 КБ). Приложение не падает: push в
 * Noop-режиме (ADR-031) — тот же принцип «деградация, а не падение».
 *
 * Presign — локальное подписание (SigV4), сети не требует: генерация
 * тысячи ссылок стоит столько же, сколько вывод в консоль.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_S3_REGION,
  EVIDENCE_KEY_PREFIX,
  MIME_EXTENSION,
  S3_ACCESS_KEY,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_FORCE_PATH_STYLE,
  S3_GET_URL_TTL_SECONDS,
  S3_PUT_URL_TTL_SECONDS,
  S3_REGION,
  S3_SECRET_KEY,
  type EvidenceMimeType,
} from './storage.constants';

/** Результат presign-запроса: куда класть и под каким ключом. */
export interface PresignedPut {
  objectKey: string;
  uploadUrl: string;
  /** Срок жизни ссылки в секундах — клиенту для UI («ссылка истечёт»). */
  expiresIn: number;
}

/** Данные HEAD объекта: факт загрузки + метаданные для сверки. */
export interface HeadResult {
  sizeBytes: number;
  mimeType: string;
}

/** Конфиг SDK-клиента (вынесен для тестируемой фабрики). */
export interface S3ClientConfig {
  endpoint?: string;
  forcePathStyle: boolean;
  region: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
}

/** Фабрика SDK-клиента: отдельный параметр — мок в юнит-тестах без сети. */
export type S3ClientFactory = (config: S3ClientConfig) => S3Client;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;
  private bucket: string | null = null;
  private healthy = false;

  /** Конфиг задан полностью? (без этого presign невозможен в принципе). */
  isConfigured(): boolean {
    return this.client !== null && this.bucket !== null;
  }

  /** Конфиг задан И бакет отвечал при старте. */
  isAvailable(): boolean {
    return this.isConfigured() && this.healthy;
  }

  /**
   * Инициализация по env + проверка бакета. Вызывается из onModuleInit
   * модуля (не из конструктора): async-работа в конструкторе — антипаттерн.
   * createClient — точка подмены в юнит-тестах (сеть не трогаем).
   *
   * Если бакета нет — пытаемся создать (удобно для dev/LocalStack; в проде
   * обычно есть заранее созданный бакет или прав не хватает — тогда
   * WARN и healthy=false, приложение живёт с fallback).
   */
  async configureFromEnv(
    env: Record<string, string | undefined>,
    createClient: S3ClientFactory = (config) => new S3Client(config),
  ): Promise<void> {
    const endpoint = env[S3_ENDPOINT]?.trim();
    const bucket = env[S3_BUCKET]?.trim();
    const accessKeyId = env[S3_ACCESS_KEY]?.trim();
    const secretAccessKey = env[S3_SECRET_KEY]?.trim();
    const region = env[S3_REGION]?.trim() || DEFAULT_S3_REGION;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      this.logger.log('S3 не настроен (нет S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY) — fallback на data:-URL');
      return;
    }

    const forcePathStyle =
      env[S3_FORCE_PATH_STYLE]?.trim() !== undefined
        ? env[S3_FORCE_PATH_STYLE]!.trim() === 'true'
        : Boolean(endpoint);

    this.client = createClient({
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.bucket = bucket;

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      this.healthy = true;
      this.logger.log(`S3 хранилище готово: бакет «${bucket}»`);
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.healthy = true;
        this.logger.log(`S3 бакет «${bucket}» создан`);
      } catch (err) {
        this.client = null;
        this.bucket = null;
        this.logger.warn(
          `S3 недоступно (${err instanceof Error ? err.message : String(err)}); доказательства пойдут fallback-путём (data:-URL ≤ 500 КБ)`,
        );
      }
    }
  }

  /**
   * Ключ под новое доказательство: disputes/<disputeId>/<uuid>.<ext>.
   * disputeId в ключе — основа изоляции: confirm проверяет префикс,
   * доказательство спора A нельзя прицепить к спору B.
   */
  evidenceObjectKey(disputeId: string, mimeType: EvidenceMimeType): string {
    return `${EVIDENCE_KEY_PREFIX}/${disputeId}/${randomUUID()}.${MIME_EXTENSION[mimeType]}`;
  }

  /** Presigned PUT: прямая загрузка с клиента в хранилище. */
  async presignPut(objectKey: string, mimeType: string): Promise<PresignedPut> {
    const client = this.requireClient();
    const uploadUrl = await awsGetSignedUrl(
      client,
      new PutObjectCommand({ Bucket: this.requireBucket(), Key: objectKey, ContentType: mimeType }),
      { expiresIn: S3_PUT_URL_TTL_SECONDS },
    );
    return { objectKey, uploadUrl, expiresIn: S3_PUT_URL_TTL_SECONDS };
  }

  /** Presigned GET: короткоживущая ссылка на приватный файл. */
  async presignGet(objectKey: string): Promise<string> {
    const client = this.requireClient();
    return awsGetSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.requireBucket(), Key: objectKey }),
      { expiresIn: S3_GET_URL_TTL_SECONDS },
    );
  }

  /**
   * HEAD объекта: существует ли файл и каким он оказался на самом деле.
   * Сверка размера/MIME на confirm — заявленное клиентом ≠ правда о файле.
   */
  async headObject(objectKey: string): Promise<HeadResult | null> {
    const client = this.requireClient();
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: this.requireBucket(), Key: objectKey }),
      );
      return {
        sizeBytes: head.ContentLength ?? 0,
        mimeType: head.ContentType ?? '',
      };
    } catch {
      return null;
    }
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new Error('S3-клиент не инициализирован (не настроен или недоступен)');
    }
    return this.client;
  }

  private requireBucket(): string {
    if (!this.bucket) {
      throw new Error('S3-бакет не задан');
    }
    return this.bucket;
  }
}
