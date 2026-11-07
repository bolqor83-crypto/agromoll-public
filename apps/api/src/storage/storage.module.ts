/**
 * Модуль S3-хранилища (v0.7.0-B, ADR-036).
 *
 * Инициализация из env происходит в onModuleInit — после сборки графа
 * зависимостей: логи старта идут единым потоком, а конструкторы модулей
 * остаются синхронными. Экспортируется для DisputesModule (доказательства)
 * и ListingsModule (фото товаров, v0.7.0-D).
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule implements OnModuleInit {
  constructor(
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env: Record<string, string | undefined> = {};
    for (const key of [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'S3_REGION',
      'S3_FORCE_PATH_STYLE',
    ]) {
      env[key] = this.config.get<string>(key);
    }
    await this.storage.configureFromEnv(env);
  }
}
