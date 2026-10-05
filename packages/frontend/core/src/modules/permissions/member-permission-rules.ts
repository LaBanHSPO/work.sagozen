import type { DocMemberPermissionRules } from '@affine/realtime';

const memberRoles: Record<string, true | undefined> = {
  reader: true,
  commenter: true,
  editor: true,
  manager: true,
};

function objectWithKeys(
  value: unknown,
  keys: string[],
  location: string
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every(key => Object.hasOwn(value, key))
  ) {
    throw new Error(`${location} must contain only ${keys.join(' and ')}.`);
  }
}

// JSON.parse discards duplicate object keys. Inspect the validated JSON tokens
// first so a second (even escaped) key cannot silently replace the user's rule.
function rejectDuplicateKeys(text: string) {
  const stack: { keys: Set<string> | null; expectingKey: boolean }[] = [];
  for (const [token] of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}[\]:,]/g)) {
    const current = stack[stack.length - 1];
    if (token === '{' || token === '[') {
      stack.push({
        keys: token === '{' ? new Set() : null,
        expectingKey: token === '{',
      });
    } else if (token === '}' || token === ']') {
      stack.pop();
    } else if (token === ',' && current?.keys) {
      current.expectingKey = true;
    } else if (token === ':' && current) {
      current.expectingKey = false;
    } else if (token.startsWith('"') && current?.keys && current.expectingKey) {
      const key: string = JSON.parse(token);
      if (current.keys.has(key)) {
        throw new Error(`Duplicate JSON key: ${key}.`);
      }
      current.keys.add(key);
    }
  }
}

export function parseMemberPermissionRules(
  text: string
): DocMemberPermissionRules {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON. Check quotes, commas and brackets.');
  }
  rejectDuplicateKeys(text);
  objectWithKeys(value, ['defaultRole', 'members'], 'Rules');
  if (
    typeof value.defaultRole !== 'string' ||
    (value.defaultRole !== 'none' &&
      !Object.hasOwn(memberRoles, value.defaultRole))
  ) {
    throw new Error(
      'defaultRole must be none, reader, commenter, editor or manager.'
    );
  }
  if (!Array.isArray(value.members)) {
    throw new Error('members must be an array.');
  }
  const ids = new Set<string>();
  const members = value.members.map((member: unknown, index: number) => {
    objectWithKeys(member, ['userId', 'role'], `members[${index}]`);
    if (typeof member.userId !== 'string' || !member.userId.trim()) {
      throw new Error(`members[${index}].userId must be a nonempty string.`);
    }
    if (ids.has(member.userId)) {
      throw new Error(`Duplicate member userId: ${member.userId}.`);
    }
    ids.add(member.userId);
    if (
      typeof member.role !== 'string' ||
      !Object.hasOwn(memberRoles, member.role)
    ) {
      throw new Error(
        `members[${index}].role must be reader, commenter, editor or manager.`
      );
    }
    return {
      userId: member.userId,
      role: member.role as DocMemberPermissionRules['members'][number]['role'],
    };
  });
  return {
    defaultRole: value.defaultRole as DocMemberPermissionRules['defaultRole'],
    members,
  };
}
