import fs from 'node:fs/promises';

const [, , previousPath, currentPath, sourceUrl] = process.argv;

if (!previousPath || !currentPath || !sourceUrl) {
  throw new Error(
    'Usage: node scripts/common/create-pr-body.mjs <previous-tokens-path> <current-tokens-path> <source-url>',
  );
}

const previous = JSON.parse(await fs.readFile(previousPath, 'utf-8'));
const current = JSON.parse(await fs.readFile(currentPath, 'utf-8'));

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isToken = (value) =>
  isObject(value) &&
  Object.prototype.hasOwnProperty.call(value, 'value') &&
  Object.prototype.hasOwnProperty.call(value, 'type');

const flattenTokens = (node, prefix = '') => {
  const result = {};

  if (!isObject(node)) {
    return result;
  }

  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (isToken(value)) {
      result[path] = {
        value: value.value,
        type: value.type,
      };
      continue;
    }

    Object.assign(result, flattenTokens(value, path));
  }

  return result;
};

const previousTokens = flattenTokens(previous);
const currentTokens = flattenTokens(current);

const added = [];
const updated = [];
const removed = [];

for (const [key, value] of Object.entries(currentTokens)) {
  if (!previousTokens[key]) {
    added.push(key);
    continue;
  }

  if (JSON.stringify(previousTokens[key]) !== JSON.stringify(value)) {
    updated.push(key);
  }
}

for (const key of Object.keys(previousTokens)) {
  if (!currentTokens[key]) {
    removed.push(key);
  }
}

const section = (title, items) => {
  if (items.length === 0) {
    return '';
  }

  return [
    `### ${title}`,
    '',
    ...items.sort().map((item) => `- \`${item}\``),
    '',
  ].join('\n');
};

const totalChanges = added.length + updated.length + removed.length;
const sourceLink = `[tokens/tokens.json](${sourceUrl})`;

const summary =
  totalChanges === 0
    ? `자동 생성 PR입니다. source: ${sourceLink}\n\nNo token changes detected.`
    : [
        `자동 생성 PR입니다. source: ${sourceLink}`,
        '',
        `Added ${added.length} / Updated ${updated.length} / Removed ${removed.length}`,
      ].join('\n\n');

const details =
  totalChanges === 0
    ? ''
    : [
        section('Added', added),
        section('Updated', updated),
        section('Removed', removed),
      ]
        .filter(Boolean)
        .join('\n');

const content = [summary.trim(), details.trim()].filter(Boolean).join('\n\n');

process.stdout.write(`${content.trim()}\n`);
