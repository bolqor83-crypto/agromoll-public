#!/usr/bin/env node
/**
 * Ручной деплой web-версии на Vercel одной командой (v0.6.0-B, ADR-032).
 *
 *   pnpm deploy:vercel
 *
 * Что делает:
 *  1. Читает VERCEL_TOKEN из .env (НЕ из окружения репозитория — токен
 *     никогда не коммитится);
 *  2. Находит проект agromoll-web через Vercel API (orgId/projectId
 *     подтягиваются сами — отдельные секреты не нужны);
 *  3. Записывает временный линк .vercel/project.json в apps/mobile;
 *  4. Собирает (turbo build) и деплоит в прод (vercel deploy --prod);
 *  5. Проверяет ответ 200 главной страницы.
 *
 * Откат: `npx vercel rollback agromoll-web --token=$VERCEL_TOKEN`
 * (или Deployments → ... → Promote to Production в консоли).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Проект agromoll-web в Vercel имеет rootDirectory = apps/mobile:
// CLI запускается из КОРНЯ репозитория, путь внутри Vercel подставит сам.
// (Запуск из apps/mobile удваивает путь: apps/mobile/apps/mobile.)
const VERCEL_DIR = resolve(ROOT, '.vercel');
const LINK_FILE = resolve(VERCEL_DIR, 'project.json');
const PROJECT_NAME = 'agromoll-web';
const PROD_URL = 'https://agromoll-web.vercel.app';

/** Простой парсер .env: KEY=VALUE построчно, # — комментарий. */
function readEnvToken() {
  if (process.env.VERCEL_TOKEN) {
    return process.env.VERCEL_TOKEN;
  }
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) {
    return null;
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*VERCEL_TOKEN\s*=\s*(\S+)\s*$/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd ?? ROOT,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    fail(`Команда не удалась: ${command} ${args.join(' ')}`);
  }
}

async function main() {
  const token = readEnvToken();
  if (!token) {
    fail(
      'VERCEL_TOKEN не найден. Добавьте его в .env (см. .env.example) ' +
        'или экспортируйте: export VERCEL_TOKEN=vcp_...',
    );
  }

  // 1. Проект и организация через API — секреты кроме токена не нужны.
  console.log(`→ Ищем проект ${PROJECT_NAME} в Vercel…`);
  const response = await fetch(`https://api.vercel.com/v1/projects/${PROJECT_NAME}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    fail(
      `Проект ${PROJECT_NAME} не найден (HTTP ${response.status}). ` +
        `Проверьте токен и название проекта. Ответ: ${body.slice(0, 200)}`,
    );
  }
  const project = await response.json();
  console.log(`  ✓ ${project.name} (org ${project.accountId})`);

  // 2. Линк проекта для CLI в корне (.vercel в .gitignore — не в коммит).
  mkdirSync(VERCEL_DIR, { recursive: true });
  const hadLink = existsSync(LINK_FILE);
  writeFileSync(
    LINK_FILE,
    `${JSON.stringify({ orgId: project.accountId, projectId: project.id }, null, 2)}\n`,
  );

  try {
    // 3. Сборка — тот же turbo build, что и в CI (гейт качества).
    console.log('\n→ Сборка (turbo run build)…');
    run('pnpm', ['turbo', 'run', 'build']);

    // 4. Деплой в прод. Vercel сам выполнит buildCommand из vercel.json
    //    (сборка идёт на серверах Vercel в чистом окружении).
    console.log('\n→ Деплой на Vercel (production)…');
    run('npx', ['--yes', 'vercel@latest', 'deploy', '--prod', '--yes', `--token=${token}`]);
  } finally {
    // Временный линк убираем: каталог .vercel создаётся только этим скриптом.
    if (!hadLink) {
      rmSync(VERCEL_DIR, { recursive: true, force: true });
    }
  }

  // 5. Smoke-проверка: главная отвечает 200.
  console.log(`\n→ Проверка ${PROD_URL}…`);
  let ok = false;
  for (let attempt = 1; attempt <= 6 && !ok; attempt += 1) {
    try {
      const check = await fetch(PROD_URL, { method: 'HEAD', redirect: 'follow' });
      if (check.ok) {
        ok = true;
        break;
      }
      console.log(`  попытка ${attempt}: HTTP ${check.status}`);
    } catch {
      console.log(`  попытка ${attempt}: сеть/CDN ещё прогревается`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!ok) {
    fail(`Главная страница не ответила 200 за 30 с. Проверьте вручную: ${PROD_URL}`);
  }
  console.log(`  ✓ 200 OK\n\n✓ Деплой завершён: ${PROD_URL}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
