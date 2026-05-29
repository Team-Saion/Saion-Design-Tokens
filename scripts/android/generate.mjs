import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN_PATH = 'tokens/tokens.json';
const OUTPUT_ROOT = 'build/android/token';
const BASE_PACKAGE = 'com.saion.ds.core.token';

const loadJsonObject = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf-8');
  const text = raw.replace(/^\uFEFF/, '').trimStart();

  try {
    return JSON.parse(text);
  } catch (error) {
    const objectStart = text.indexOf('{');
    const arrayStart = text.indexOf('[');
    const firstJsonStart = [objectStart, arrayStart]
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];

    if (firstJsonStart > 0) {
      try {
        return JSON.parse(text.slice(firstJsonStart));
      } catch {
        // Fall through to the explicit error below.
      }
    }

    throw new Error(
      `Failed to parse JSON from ${filePath}: ${error.message}\n` +
        `First 120 chars: ${JSON.stringify(text.slice(0, 120))}`,
    );
  }
};

const tokens = await loadJsonObject(TOKEN_PATH);

const primitive = tokens['Primitive/Value'];
const semanticColor = tokens['Semantic/Color/Light'];
const semanticRadius = tokens['Semantic/Radius/Default'];
const semanticTypography = tokens['Semantic/Typography/Value'];

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isToken = (value) =>
  isObject(value) &&
  Object.prototype.hasOwnProperty.call(value, 'value') &&
  Object.prototype.hasOwnProperty.call(value, 'type');

const isTypographyStyle = (node) =>
  isObject(node) &&
  isToken(node['font-size']) &&
  isToken(node['font-weight']) &&
  isToken(node['line-height']) &&
  isToken(node['letter-spacing']);

const pascal = (value) =>
  String(value)
    .split(/[-_\s/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const camel = (value) => {
  const name = pascal(value);
  return name.charAt(0).toLowerCase() + name.slice(1);
};

const propertyName = (value) => {
  if (value === 'xsmall') return 'xSmall';
  if (value === 'xlarge') return 'xLarge';
  return camel(value);
};

const primitiveValueName = (value) =>
  `V${String(value).replace('-', 'Minus').replace('.', '_')}`;

const dp = (value) => {
  const text = String(value);
  return text.startsWith('-') ? `(${text}).dp` : `${text}.dp`;
};

const writeKotlinFile = async ({
  directory,
  fileName,
  packageName,
  content,
}) => {
  const filePath = path.join(
    OUTPUT_ROOT,
    directory,
    fileName,
  );

  await fs.mkdir(
    path.dirname(filePath),
    { recursive: true },
  );

  await fs.writeFile(
    filePath,
    `package ${packageName}
${content}
`,
  );
};

const fontWeight = (value) => {
  const map = {
    100: 'FontWeight.Thin',
    200: 'FontWeight.ExtraLight',
    300: 'FontWeight.Light',
    400: 'FontWeight.Normal',
    500: 'FontWeight.Medium',
    600: 'FontWeight.SemiBold',
    700: 'FontWeight.Bold',
    800: 'FontWeight.ExtraBold',
    900: 'FontWeight.Black',
  };

  return map[value] ?? `FontWeight(${value})`;
};

const hexToComposeColor = (raw) => {
  const hex = String(raw).replace('#', '').toUpperCase();

  if (hex.length === 6) {
    return `Color(0xFF${hex})`;
  }

  if (hex.length === 8) {
    const rgb = hex.slice(0, 6);
    const alpha = hex.slice(6, 8);
    return `Color(0x${alpha}${rgb})`;
  }

  throw new Error(`Unsupported color format: ${raw}`);
};

const resolvePrimitiveToken = (reference) => {
  const segments = reference.replace(/[{}]/g, '').split('.');
  let current = primitive;

  for (const segment of segments) {
    current = current?.[segment];
  }

  if (!current) {
    throw new Error(`Cannot resolve reference: ${reference}`);
  }

  return current;
};

const primitiveColorReference = (reference) => {
  const segments = reference.replace(/[{}]/g, '').split('.');
  return `PrimitiveColor.${pascal(segments.slice(1).join(' '))}`;
};

const primitiveRadiusReference = (reference) => {
  const segments = reference.replace(/[{}]/g, '').split('.');
  return `PrimitiveRadius.${primitiveValueName(segments.at(-1))}`;
};

const colorValue = (token) => {
  if (String(token.value).startsWith('{')) {
    return primitiveColorReference(token.value);
  }

  return hexToComposeColor(token.value);
};

const radiusValue = (token) => {
  if (String(token.value).startsWith('{')) {
    return primitiveRadiusReference(token.value);
  }

  return dp(token.value);
};

const typographyRawValue = (token) => {
  if (String(token.value).startsWith('{')) {
    return resolvePrimitiveToken(token.value).value;
  }

  return token.value;
};

const textStyleValue = (token, indent) => {
  const nextIndent = `${indent}    `;

  return `createSaionTextStyle(
${nextIndent}fontSize = ${dp(typographyRawValue(token['font-size']))},
${nextIndent}fontWeight = ${fontWeight(typographyRawValue(token['font-weight']))},
${nextIndent}lineHeight = ${dp(typographyRawValue(token['line-height']))},
${nextIndent}letterSpacing = ${dp(typographyRawValue(token['letter-spacing']))},
${indent})`;
};

const createPrimitiveColor = () => {
  const lines = ['internal object PrimitiveColor {'];

  for (const [groupName, group] of Object.entries(primitive.Color)) {
    for (const [name, token] of Object.entries(group)) {
      lines.push(`    val ${pascal(`${groupName} ${name}`)} = ${hexToComposeColor(token.value)}`);
    }
  }

  lines.push('}');
  return lines.join('\n');
};

const createPrimitiveRadius = () => {
  const lines = ['internal object PrimitiveRadius {'];

  for (const [name, token] of Object.entries(primitive.Radius)) {
    lines.push(`    val ${primitiveValueName(name)} = ${dp(token.value)}`);
  }

  lines.push('}');
  return lines.join('\n');
};

const createPrimitiveSpacing = () => {
  const lines = ['internal object PrimitiveSpacing {'];

  for (const [name, token] of Object.entries(primitive.Spacing)) {
    lines.push(`    val ${primitiveValueName(name)} = ${dp(token.value)}`);
  }

  lines.push('}');
  return lines.join('\n');
};

const createDataClass = ({
  className,
  node,
  leafType,
  leafPredicate,
  depth = 0,
}) => {
  const indent = '    '.repeat(depth);
  const propIndent = '    '.repeat(depth + 1);
  const props = [];
  const nestedClasses = [];

  for (const [key, value] of Object.entries(node)) {
    const prop = propertyName(key);

    if (leafPredicate(value)) {
      props.push(`${propIndent}val ${prop}: ${leafType},`);
      continue;
    }

    const nestedClassName = pascal(key);
    props.push(`${propIndent}val ${prop}: ${nestedClassName},`);

    nestedClasses.push(
      createDataClass({
        className: nestedClassName,
        node: value,
        leafType,
        leafPredicate,
        depth: depth + 1,
      }),
    );
  }

  const body = [
    `${indent}@Immutable`,
    `${indent}data class ${className}(`,
    props.join('\n'),
    `${indent})`,
  ];

  if (nestedClasses.length === 0) {
    return body.join('\n');
  }

  return `${body.join('\n')} {\n${nestedClasses.join('\n\n')}\n${indent}}`;
};

const createFactoryValue = ({
  className,
  node,
  leafValue,
  leafPredicate,
  depth = 1,
}) => {
  const indent = '    '.repeat(depth);
  const childIndent = '    '.repeat(depth + 1);

  const lines = [`${indent}${className}(`];

  for (const [key, value] of Object.entries(node)) {
    const prop = propertyName(key);

    if (leafPredicate(value)) {
      lines.push(`${childIndent}${prop} = ${leafValue(value, childIndent)},`);
      continue;
    }

    const nestedValue = createFactoryValue({
      className: `${className}.${pascal(key)}`,
      node: value,
      leafValue,
      leafPredicate,
      depth: depth + 1,
    });

    lines.push(`${childIndent}${prop} = ${nestedValue.trimStart()},`);
  }

  lines.push(`${indent})`);

  return lines.join('\n');
};

const filteredSemanticTypography = () =>
  Object.fromEntries(
    Object.entries(semanticTypography).filter(([key]) => key !== 'Typography'),
  );

const createSaionColorsClass = () =>
  createDataClass({
    className: 'SaionColors',
    node: semanticColor,
    leafType: 'Color',
    leafPredicate: isToken,
  });

const createSaionColorsFactory = () => `internal fun createSaionColors(): SaionColors =
    ${createFactoryValue({
      className: 'SaionColors',
      node: semanticColor,
      leafValue: colorValue,
      leafPredicate: isToken,
    })}`;

const createSaionRadiusClass = () =>
  createDataClass({
    className: 'SaionRadius',
    node: semanticRadius,
    leafType: 'Dp',
    leafPredicate: isToken,
  });

const createSaionRadiusFactory = () => `internal fun createSaionRadius(): SaionRadius =
    ${createFactoryValue({
      className: 'SaionRadius',
      node: semanticRadius,
      leafValue: radiusValue,
      leafPredicate: isToken,
    })}`;

const createSaionSpacingClass = () => {
  const props = Object.keys(primitive.Spacing)
    .map((name) => `    val ${propertyName(primitiveValueName(name))}: Dp,`)
    .join('\n');

  return `@Immutable
data class SaionSpacing(
${props}
)`;
};

const createSaionSpacingFactory = () => {
  const props = Object.keys(primitive.Spacing)
    .map((name) => `    ${propertyName(primitiveValueName(name))} = PrimitiveSpacing.${primitiveValueName(name)},`)
    .join('\n');

  return `internal fun createSaionSpacing(): SaionSpacing = SaionSpacing(
${props}
)`;
};

const createSaionTypographyClass = () =>
  createDataClass({
    className: 'SaionTypography',
    node: filteredSemanticTypography(),
    leafType: 'TextStyle',
    leafPredicate: isTypographyStyle,
  });

const createSaionTypographyFactory = () => `@Composable
internal fun createSaionTypography(): SaionTypography =
    ${createFactoryValue({
      className: 'SaionTypography',
      node: filteredSemanticTypography(),
      leafValue: textStyleValue,
      leafPredicate: isTypographyStyle,
    })}`;

// Create Files

await writeKotlinFile({
  directory: 'color',
  fileName: 'PrimitiveColor.kt',
  packageName: `${BASE_PACKAGE}.color`,
  content: `
import androidx.compose.ui.graphics.Color

${createPrimitiveColor()}`,
});

await writeKotlinFile({
  directory: 'color',
  fileName: 'SaionColors.kt',
  packageName: `${BASE_PACKAGE}.color`,
  content: `
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

${createSaionColorsClass()}

internal fun createSaionColors(): SaionColors =
${createFactoryValue({
  className: 'SaionColors',
  node: semanticColor,
  leafValue: colorValue,
  leafPredicate: isToken,
})}`,
});

await writeKotlinFile({
  directory: 'radius',
  fileName: 'PrimitiveRadius.kt',
  packageName: `${BASE_PACKAGE}.radius`,
  content: `
import androidx.compose.ui.unit.dp

${createPrimitiveRadius()}`,
});

await writeKotlinFile({
  directory: 'radius',
  fileName: 'SaionRadius.kt',
  packageName: `${BASE_PACKAGE}.radius`,
  content: `
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.Dp

${createSaionRadiusClass()}

internal fun createSaionRadius(): SaionRadius =
${createFactoryValue({
  className: 'SaionRadius',
  node: semanticRadius,
  leafValue: radiusValue,
  leafPredicate: isToken,
})}`,
});

await writeKotlinFile({
  directory: 'spacing',
  fileName: 'PrimitiveSpacing.kt',
  packageName: `${BASE_PACKAGE}.spacing`,
  content: `
import androidx.compose.ui.unit.dp

${createPrimitiveSpacing()}`,
});

await writeKotlinFile({
  directory: 'spacing',
  fileName: 'SaionSpacing.kt',
  packageName: `${BASE_PACKAGE}.spacing`,
  content: `
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.Dp

${createSaionSpacingClass()}

internal fun createSaionSpacing(): SaionSpacing =
    SaionSpacing(
${Object.keys(primitive.Spacing)
  .map(
    (name) =>
      `        ${propertyName(primitiveValueName(name))} = PrimitiveSpacing.${primitiveValueName(name)},`,
  )
  .join('\n')}
    )`,
});

await writeKotlinFile({
  directory: 'typography',
  fileName: 'SaionTypography.kt',
  packageName: `${BASE_PACKAGE}.typography`,
  content: `
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saion.ds.core.internal.createSaionTextStyle

${createSaionTypographyClass()}

@Composable
internal fun createSaionTypography(): SaionTypography =
${createFactoryValue({
  className: 'SaionTypography',
  node: filteredSemanticTypography(),
  leafValue: textStyleValue,
  leafPredicate: isTypographyStyle,
})}`,
});
