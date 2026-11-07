/**
 * Юнит-тест датасета сида (v0.8.0-C): инварианты «живого демо-рынка»
 * проверяются ДО попадания в БД. Полная идемпотентность прогона
 * (повторный запуск не создаёт дублей) дополнительно проверяется двойным
 * прогоном db:seed на локальном стенде — v0.8.0-F, docs/DEMO.md.
 */
import {
  ARBITRATOR,
  BUYERS,
  DRIVERS,
  LISTINGS,
  SELLERS,
  photoBytes,
  photoUrl,
} from '../../prisma/seed.dataset';

const PHONE_RE = /^\+79\d{9}$/;

describe('seed.dataset (демо-рынок v0.8.0)', () => {
  it('роли в заданном составе: 15 продавцов, 5 покупателей, 2 водителя, 1 арбитр', () => {
    expect(SELLERS).toHaveLength(15);
    expect(BUYERS).toHaveLength(5);
    expect(DRIVERS).toHaveLength(2);
    expect(ARBITRATOR.phone).toBe('+79000000023');
  });

  it('продавцы покрывают линии 1–15 без пропусков и дублей', () => {
    const lines = SELLERS.map((s) => s.line).sort((a, b) => a - b);
    expect(lines).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it('телефоны всех демо-пользователей валидны и уникальны', () => {
    const all = [
      ...SELLERS.map((s) => s.phone),
      ...BUYERS.map((b) => b.phone),
      ...DRIVERS.map((d) => d.phone),
      ARBITRATOR.phone,
    ];
    expect(all).toHaveLength(23);
    for (const phone of all) {
      expect(phone).toMatch(PHONE_RE);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('телефоны идут подряд +79000000001..23 — удобно для демо-справочника', () => {
    const nums = [
      ...SELLERS.map((s) => s.phone),
      ...BUYERS.map((b) => b.phone),
      ...DRIVERS.map((d) => d.phone),
      ARBITRATOR.phone,
    ]
      .map((p) => Number(p.slice(2)))
      .sort((a, b) => a - b);
    expect(nums[0]).toBe(9000000001);
    expect(nums[nums.length - 1]).toBe(9000000023);
    expect(new Set(nums).size).toBe(23);
  });

  it('30–40 лотов, все с корректными полями и в диапазоне цен', () => {
    expect(LISTINGS.length).toBeGreaterThanOrEqual(30);
    expect(LISTINGS.length).toBeLessThanOrEqual(40);
    for (const l of LISTINGS) {
      expect(l.sellerIdx).toBeGreaterThanOrEqual(0);
      expect(l.sellerIdx).toBeLessThan(SELLERS.length);
      expect(l.title.length).toBeGreaterThan(3);
      expect(l.pricePerUnit).toBeGreaterThan(0);
      expect(l.quantityAvailable).toBeGreaterThan(0);
      expect(['vegetables', 'fruits', 'grocery', 'snacks', 'other']).toContain(l.category);
      expect(['kg', 'box', 'piece']).toContain(l.unit);
    }
  });

  it('заголовки лотов уникальны в рамках продавца (ключ идемпотентности)', () => {
    const seen = new Set<string>();
    for (const l of LISTINGS) {
      const key = `${l.sellerIdx}:${l.title}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('у каждого продавца есть хотя бы один лот — рынок выглядит живым', () => {
    const sellersWithListings = new Set(LISTINGS.map((l) => l.sellerIdx));
    expect(sellersWithListings.size).toBe(SELLERS.length);
  });

  it('10–15 лотов с фото: детерминированные picsum-URL, https', () => {
    const withPhotos = LISTINGS.filter((l) => l.photoSlug);
    expect(withPhotos.length).toBeGreaterThanOrEqual(10);
    expect(withPhotos.length).toBeLessThanOrEqual(15);
    const slugs = new Set<string>();
    for (const l of withPhotos) {
      const slug = l.photoSlug!;
      expect(slug.length).toBeGreaterThan(2);
      expect(slugs.has(slug)).toBe(false);
      slugs.add(slug);
      expect(photoUrl(slug)).toMatch(
        /^https:\/\/picsum\.photos\/seed\/agromoll-[a-z0-9-]+\/800\/600$/,
      );
      expect(photoBytes(slug)).toBeGreaterThan(0);
      expect(photoBytes(slug)).toBeLessThan(500_000);
    }
  });

  it('фото идемпотентны по слагу: одинаковый слаг — одинаковый URL и размер', () => {
    expect(photoUrl('tomato-pink')).toBe(photoUrl('tomato-pink'));
    expect(photoBytes('tomato-pink')).toBe(photoBytes('tomato-pink'));
    expect(photoUrl('a')).not.toBe(photoUrl('b'));
  });

  it('репутация в диапазоне 4.0–5.0 (демо-реалистично)', () => {
    for (const u of [...SELLERS, ...BUYERS, ...DRIVERS]) {
      expect(u.rep).toBeGreaterThanOrEqual(4);
      expect(u.rep).toBeLessThanOrEqual(5);
    }
  });
});
