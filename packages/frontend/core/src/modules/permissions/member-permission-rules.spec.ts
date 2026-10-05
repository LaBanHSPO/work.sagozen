import { expect, test } from 'vitest';

import { parseMemberPermissionRules } from './member-permission-rules';

test('accepts every editable role and an empty member list', () => {
  for (const defaultRole of [
    'none',
    'reader',
    'commenter',
    'editor',
    'manager',
  ]) {
    const rules = { defaultRole, members: [] };
    expect(parseMemberPermissionRules(JSON.stringify(rules))).toEqual(rules);
  }
  const rules = {
    defaultRole: 'reader',
    members: ['reader', 'commenter', 'editor', 'manager'].map(role => ({
      userId: `user-${role}`,
      role,
    })),
  };
  expect(parseMemberPermissionRules(JSON.stringify(rules))).toEqual(rules);
});

test.each([
  '',
  '{',
  'null',
  '[]',
  '{"defaultRole":"reader"}',
  '{"defaultRole":"reader","members":{},"extra":true}',
  '{"defaultRole":"reader","members":[],"revision":"1"}',
  '{"defaultRole":"owner","members":[]}',
  '{"defaultRole":"toString","members":[]}',
  '{"defaultRole":"reader","members":[{"userId":"u","role":"none"}]}',
  '{"defaultRole":"reader","members":[{"userId":"u","role":"owner"}]}',
  '{"defaultRole":"reader","members":[{"userId":"u","role":"toString"}]}',
  '{"defaultRole":"reader","members":[{"userId":" ","role":"reader"}]}',
  '{"defaultRole":"reader","members":[{"userId":"u","role":"reader","extra":true}]}',
  '{"defaultRole":"reader","members":[{"userId":"u","role":"reader"},{"userId":"u","role":"editor"}]}',
  '{"defaultRole":"reader","defaultRole":"editor","members":[]}',
  '{"defaultRole":"reader","members":[{"userId":"u","role":"reader","role":"editor"}]}',
  '{"defaultRole":"reader","members":[{"userId":"u","\\u0075serId":"v","role":"reader"}]}',
])('rejects malformed, unknown or duplicate input: %s', text => {
  expect(() => parseMemberPermissionRules(text)).toThrow();
});

test('does not confuse keys with punctuation in user IDs or other objects', () => {
  const rules = {
    defaultRole: 'reader',
    members: [
      { userId: 'quotes" and {brackets}:,', role: 'reader' },
      { userId: 'second', role: 'editor' },
    ],
  };
  expect(parseMemberPermissionRules(JSON.stringify(rules))).toEqual(rules);
});
