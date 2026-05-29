import fs from 'node:fs/promises';

const [, , platform, changelogPath, outputPath] = process.argv;

const templatePath = '.github/template/token-pr.md';

const template = await fs.readFile(templatePath, 'utf-8');
const changelog = await fs.readFile(changelogPath, 'utf-8');

const content = `${template.trim()}

${changelog.trim()}
`;

if (outputPath) {
  await fs.writeFile(outputPath, content);
} else {
  process.stdout.write(content);
}
