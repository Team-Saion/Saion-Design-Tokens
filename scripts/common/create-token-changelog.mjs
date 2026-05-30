import fs from 'node:fs/promises';

const [, , previousPath, currentPath, outputPath] = process.argv;

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

const content = [
  '## Token Changes',
  '',
  added.length === 0 && updated.length === 0 && removed.length === 0
    ? 'No token changes detected.'
    : [
        section('Added Tokens', added),
        section('Updated Tokens', updated),
        section('Removed Tokens', removed),
      ]
        .filter(Boolean)
        .join('\n'),
].join('\n');

await fs.writeFile(outputPath, content);
