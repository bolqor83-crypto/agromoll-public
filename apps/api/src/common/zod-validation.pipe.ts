import { BadRequestException, Injectable } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Пайп валидации на zod-схемах из @agromoll/validation.
 *
 * Единый источник валидации для API и (в будущем) мобильного клиента:
 * NestJS-контроллеры используют @Body(new ZodValidationPipe(Schema)).
 * Дженерик сохраняет тип результата схемы на уровне TypeScript.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new BadRequestException({ message: 'Ошибка валидации', issues });
    }
    return result.data;
  }
}
