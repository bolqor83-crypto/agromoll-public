/**
 * Статический a11y-скан (v0.6.1-C, ADR-025): все иконочные кнопки
 * (Pressable с <Icon> и без текстовых детей) обязаны иметь
 * accessibilityLabel — скринридер иначе назовёт их «кнопка».
 *
 * Это сторожевой тест поверх исходников: рендерить каждый экран в jest
 * дороже и хрупче, чем проверить правила на уровне кода.
 */
import fs from 'fs';
import path from 'path';

/** Каталоги с компонентами UI (относительно этого файла). */
const SCAN_DIRS = ['../app', '../src/components', '../src/screens'];

/** Имя Pressable-компонента — стартовая точка разбора. */
const PRESSABLE = '<Pressable';

interface Violation {
  file: string;
  line: number;
}

function scanFile(filePath: string): Violation[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const violations: Violation[] = [];

  let cursor = 0;
  while (true) {
    const start = source.indexOf(PRESSABLE, cursor);
    if (start === -1) break;
    // Конец открывающего тега
    const tagEnd = source.indexOf('>', start);
    const openingTag = source.slice(start, tagEnd);
    // Тело Pressable — до закрывающего тега (первый уровень достаточно:
    // вложенные Pressable внутри иконок в проекте не встречаются)
    const close = source.indexOf('</Pressable', start);
    const body = source.slice(tagEnd, close === -1 ? source.length : close);
    const line = source.slice(0, start).split('\n').length;

    const isIconOnly =
      body.includes('<Icon') &&
      !body.includes('<Text') &&
      !body.includes('title=');
    const hasLabel =
      openingTag.includes('accessibilityLabel') ||
      openingTag.includes('accessibilityRole="checkbox"');

    if (isIconOnly && !hasLabel) {
      violations.push({ file: path.basename(filePath), line });
    }
    cursor = tagEnd;
  }
  return violations;
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('a11y: иконочные кнопки имеют accessibilityLabel (ADR-025)', () => {
  it('нарушений нет', () => {
    const violations: Violation[] = [];
    for (const dir of SCAN_DIRS) {
      const absDir = path.resolve(__dirname, dir);
      if (!fs.existsSync(absDir)) continue;
      for (const file of collectFiles(absDir)) {
        violations.push(...scanFile(file));
      }
    }
    const report = violations.map((v) => `${v.file}:${v.line}`).join(', ');
    if (violations.length > 0) {
      throw new Error(`Pressable с <Icon> без accessibilityLabel: ${report}`);
    }
    expect(violations).toEqual([]);
  });
});
