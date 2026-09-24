import { describe, expect, it } from 'vitest';
import { pickLang } from '../src/core/i18n';

describe('pickLang', () => {
  it('保存済みの設定を最優先する', () => {
    expect(pickLang('en', ['ja-JP'])).toBe('en');
    expect(pickLang('ja', ['en-US'])).toBe('ja');
  });

  it('未設定ならブラウザの第一言語が日本語かどうかで決める', () => {
    expect(pickLang(null, ['ja-JP', 'en'])).toBe('ja');
    expect(pickLang(null, ['en-US', 'ja'])).toBe('en');
    expect(pickLang(null, ['fr'])).toBe('en');
    expect(pickLang(null, [])).toBe('en');
  });

  it('不正な保存値は無視する', () => {
    expect(pickLang('de', ['ja'])).toBe('ja');
  });
});
