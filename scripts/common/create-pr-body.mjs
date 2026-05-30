import fs from 'node:fs/promises';

const [, , changelogPath] = process.argv;

const templatePath = '.github/template/token-pr.md';

if (!changelogPath) {
  throw new Error(
    'Usage: node scripts/common/create-pr-body.mjs <changelog-path>',
  );
}

const template = await fs.readFile(templatePath, 'utf-8');
const changelog = await fs.readFile(changelogPath, 'utf-8');

const content = `${template.trim()}

${changelog.trim()}
`;

process.stdout.write(content);
