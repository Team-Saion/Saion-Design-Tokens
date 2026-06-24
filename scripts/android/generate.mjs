import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG = {
  tokenFilePath: 'tokens/tokens.json',
  outputRoot: 'build/android/token',
  basePackage: 'com.saion.ds',
  outputPackage: 'com.saion.ds.token',
  primitiveSegment: 'Primitive',
  semanticSegment: 'Semantic',
  primitiveValueSegment: 'Value',
  roles: ['Color', 'Typography', 'Spacing', 'Radius'],
  typographyFields: [
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
  ],
  primitiveSemanticFallbackRoles: ['Spacing'],
};

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

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isToken = (value) =>
  isObject(value) &&
  Object.prototype.hasOwnProperty.call(value, 'value') &&
  Object.prototype.hasOwnProperty.call(value, 'type');

const isColorToken = (value) => isToken(value) && value.type === 'color';
const isNumberToken = (value) => isToken(value) && value.type === 'number';

const isTypographyStyle = (node) =>
  isObject(node) &&
  CONFIG.typographyFields.every((field) => isToken(node[field]));

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

const writeKotlinFile = async ({
  directory,
  fileName,
  packageName,
  content,
}) => {
  const filePath = path.join(CONFIG.outputRoot, directory, fileName);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `package ${packageName}
${content}
`,
  );
};

const removeOutputFile = async (directory, fileName) => {
  const filePath = path.join(CONFIG.outputRoot, directory, fileName);
  await fs.rm(filePath, { force: true });
};

const getOutputTarget = (layer, role) => ({
  directory: role.toLowerCase(),
  fileName: `${layer}${role}.kt`,
  packageName: `${CONFIG.outputPackage}.${role.toLowerCase()}`,
});

const collectLeaves = (node, predicate, leaves = []) => {
  if (predicate(node)) {
    leaves.push(node);
    return leaves;
  }

  if (!isObject(node)) {
    return leaves;
  }

  for (const value of Object.values(node)) {
    collectLeaves(value, predicate, leaves);
  }

  return leaves;
};

const collectTokens = (node) => collectLeaves(node, isToken);

const unwrapSingleObjectChild = (node) => {
  if (!isObject(node)) {
    return null;
  }

  const entries = Object.entries(node).filter(([, value]) => isObject(value));
  if (entries.length !== 1) {
    return null;
  }

  const [key, value] = entries[0];
  if (isToken(value)) {
    return null;
  }

  return { key, value };
};

const countTypographyStyles = (node) => {
  if (isTypographyStyle(node)) {
    return 1;
  }

  if (!isObject(node)) {
    return 0;
  }

  return Object.values(node).reduce(
    (count, value) => count + countTypographyStyles(value),
    0,
  );
};

const getReferenceGroup = (token) => {
  if (!isToken(token) || typeof token.value !== 'string' || !token.value.startsWith('{')) {
    return null;
  }

  return token.value.replace(/[{}]/g, '').split('.')[0] ?? null;
};

const getSetOrder = (tokens) => {
  const orderedKeys = tokens.$metadata?.tokenSetOrder;
  if (!Array.isArray(orderedKeys)) {
    return new Map();
  }

  return new Map(orderedKeys.map((key, index) => [key, index]));
};

const createSetEntries = (tokens) => {
  const order = getSetOrder(tokens);

  return Object.entries(tokens)
    .filter(([key, value]) => !key.startsWith('$') && isObject(value))
    .map(([key, value], index) => ({
      key,
      value,
      metadataIndex: order.get(key) ?? index,
    }));
};

const parseSetKey = (setKey) => {
  const segments = setKey.split('/').filter(Boolean);
  if (segments.length !== 3) {
    throw new Error(`Invalid token set path: ${setKey}`);
  }

  const [layer, role, variant] = segments;
  return { layer, role, variant };
};

const normalizeSemanticNode = (node, matcher) => {
  if (!isObject(node)) {
    return null;
  }

  const wrapped = unwrapSingleObjectChild(node);
  if (wrapped && matcher(wrapped.value)) {
    return wrapped.value;
  }

  if (matcher(node)) {
    return node;
  }

  return null;
};

const expect = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectPrimitiveShape = (role, rootName, node) => {
  expect(rootName === role, `Primitive set root must match role: expected ${role}, got ${rootName}`);

  if (role === 'Color') {
    const leaves = collectLeaves(node, isColorToken);
    const tokens = collectTokens(node);
    expect(leaves.length > 0 && leaves.length === tokens.length, 'Primitive/Color/Value must contain only color tokens');
    return;
  }

  if (role === 'Typography') {
    expect(
      CONFIG.typographyFields.every((field) => isObject(node[field])),
      'Primitive/Typography/Value must contain typography axis groups',
    );
    return;
  }

  if (role === 'Spacing' || role === 'Radius') {
    const leaves = collectLeaves(node, isNumberToken);
    const tokens = collectTokens(node);
    expect(leaves.length > 0 && leaves.length === tokens.length, `Primitive/${role}/Value must contain only number tokens`);
    return;
  }

  throw new Error(`Unsupported primitive role: ${role}`);
};

const matchesSemanticColorTree = (node) => {
  const leaves = collectLeaves(node, isColorToken);
  const tokens = collectTokens(node);
  return leaves.length > 0 && leaves.length === tokens.length;
};

const matchesSemanticTypographyTree = (node) =>
  countTypographyStyles(node) > 0;

const matchesSemanticNumberTree = (node, primitiveRoot) => {
  const leaves = collectLeaves(node, isNumberToken);
  const tokens = collectTokens(node);

  if (leaves.length === 0 || leaves.length !== tokens.length) {
    return false;
  }

  const referenceGroups = new Set(leaves.map(getReferenceGroup).filter(Boolean));
  return (
    referenceGroups.size === 0 ||
    (referenceGroups.size === 1 && referenceGroups.has(primitiveRoot))
  );
};

const createModeName = (variant) => propertyName(variant);
const createFactoryFunctionName = (className, modeName) => `create${className}${pascal(modeName)}`;

const tokens = await loadJsonObject(CONFIG.tokenFilePath);
const setEntries = createSetEntries(tokens);

const primitiveByRole = new Map();
const semanticByRole = new Map(CONFIG.roles.map((role) => [role, []]));

for (const entry of setEntries) {
  const { layer, role, variant } = parseSetKey(entry.key);
  expect(CONFIG.roles.includes(role), `Unsupported token role in set path: ${entry.key}`);

  if (layer === CONFIG.primitiveSegment) {
    expect(
      variant === CONFIG.primitiveValueSegment,
      `Primitive set must use ${CONFIG.primitiveValueSegment} as the third segment: ${entry.key}`,
    );

    const unwrapped = unwrapSingleObjectChild(entry.value);
    expect(unwrapped, `Primitive set must have a single object root: ${entry.key}`);
    expectPrimitiveShape(role, unwrapped.key, unwrapped.value);
    expect(!primitiveByRole.has(role), `Duplicate primitive set for role ${role}: ${entry.key}`);

    primitiveByRole.set(role, {
      ...entry,
      role,
      rootName: unwrapped.key,
      node: unwrapped.value,
    });
    continue;
  }

  if (layer === CONFIG.semanticSegment) {
    semanticByRole.get(role).push({
      ...entry,
      role,
      variant,
      modeName: createModeName(variant),
    });
    continue;
  }

  throw new Error(`Unsupported token layer in set path: ${entry.key}`);
}

for (const role of CONFIG.roles) {
  expect(primitiveByRole.has(role), `Missing primitive set for role ${role}`);
}

const primitiveColorSet = primitiveByRole.get('Color');
const primitiveTypographySet = primitiveByRole.get('Typography');
const primitiveSpacingSet = primitiveByRole.get('Spacing');
const primitiveRadiusSet = primitiveByRole.get('Radius');

const primitiveColor = primitiveColorSet.node;
const primitiveTypography = primitiveTypographySet.node;
const primitiveSpacing = primitiveSpacingSet.node;
const primitiveRadius = primitiveRadiusSet.node;

const validateSemanticRole = (role, entries, matcher) => {
  expect(entries.length > 0, `Missing semantic set for role ${role}`);

  const byMode = [];
  const seenModes = new Map();
  for (const entry of entries) {
    const normalizedNode = normalizeSemanticNode(entry.value, matcher);
    expect(normalizedNode, `Semantic/${role}/${entry.variant} does not match expected shape`);

    if (seenModes.has(entry.modeName)) {
      throw new Error(
        `Duplicate mode "${entry.modeName}" for semantic ${role}: ${seenModes.get(entry.modeName).key}, ${entry.key}`,
      );
    }

    const modeEntry = {
      ...entry,
      node: normalizedNode,
    };

    seenModes.set(entry.modeName, modeEntry);
    byMode.push(modeEntry);
  }

  return byMode.sort((a, b) => a.metadataIndex - b.metadataIndex);
};

const createPrimitiveFallbackReferenceToken = (primitiveRootName, tokenKey, token) => ({
  ...token,
  value: `{${primitiveRootName}.${tokenKey}}`,
});

const normalizePrimitiveFallbackNode = (primitiveRootName, node) => {
  if (isToken(node)) {
    throw new Error(`Fallback leaf normalization requires parent key for ${primitiveRootName}`);
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      if (isToken(value)) {
        return [
          primitiveValueName(key),
          createPrimitiveFallbackReferenceToken(primitiveRootName, key, value),
        ];
      }

      return [key, normalizePrimitiveFallbackNode(primitiveRootName, value)];
    }),
  );
};

const resolvePrimitiveSemanticFallback = (role, primitiveSet, entries, matcher) => {
  if (entries.length > 0) {
    return validateSemanticRole(role, entries, matcher);
  }

  expect(
    CONFIG.primitiveSemanticFallbackRoles.includes(role),
    `Missing semantic set for role ${role}`,
  );

  return [{
    key: `Primitive/${role}/Default`,
    role,
    variant: 'Default',
    modeName: createModeName('Default'),
    metadataIndex: Number.MAX_SAFE_INTEGER,
    node: normalizePrimitiveFallbackNode(primitiveSet.rootName, primitiveSet.node),
  }];
};

const semanticColorModes = validateSemanticRole(
  'Color',
  semanticByRole.get('Color'),
  matchesSemanticColorTree,
);

const semanticTypographyModes = validateSemanticRole(
  'Typography',
  semanticByRole.get('Typography'),
  matchesSemanticTypographyTree,
);

const semanticRadiusModes = validateSemanticRole(
  'Radius',
  semanticByRole.get('Radius'),
  (node) => matchesSemanticNumberTree(node, primitiveRadiusSet.rootName),
);

const semanticSpacingModes = resolvePrimitiveSemanticFallback(
  'Spacing',
  primitiveSpacingSet,
  semanticByRole.get('Spacing'),
  (node) => matchesSemanticNumberTree(node, primitiveSpacingSet.rootName),
);

const primitiveRoots = new Map([
  [primitiveColorSet.rootName, { role: 'color', node: primitiveColor }],
  [primitiveTypographySet.rootName, { role: 'typography', node: primitiveTypography }],
  [primitiveSpacingSet.rootName, { role: 'spacing', node: primitiveSpacing }],
  [primitiveRadiusSet.rootName, { role: 'radius', node: primitiveRadius }],
]);

const resolveReferencePath = (rootNode, segments) => {
  let current = rootNode;

  for (const segment of segments) {
    current = current?.[segment];
  }

  return current;
};

const resolvePrimitiveToken = (reference) => {
  const segments = reference.replace(/[{}]/g, '').split('.');
  const [group, ...rest] = segments;
  const primitive = primitiveRoots.get(group);

  if (!primitive) {
    throw new Error(`Unsupported primitive reference group: ${reference}`);
  }

  const token = resolveReferencePath(primitive.node, rest);
  if (!token) {
    throw new Error(`Cannot resolve reference: ${reference}`);
  }

  return { primitive, token, segments };
};

const primitiveColorReference = (reference) => {
  const { primitive, segments } = resolvePrimitiveToken(reference);

  if (primitive.role !== 'color') {
    throw new Error(`Expected color reference but got: ${reference}`);
  }

  return `PrimitiveColor.${pascal(segments.slice(1).join(' '))}`;
};

const primitiveRadiusReference = (reference) => {
  const { primitive, segments } = resolvePrimitiveToken(reference);

  if (primitive.role !== 'radius') {
    throw new Error(`Expected radius reference but got: ${reference}`);
  }

  return `PrimitiveRadius.${primitiveValueName(segments.at(-1))}`;
};

const primitiveSpacingReference = (reference) => {
  const { primitive, segments } = resolvePrimitiveToken(reference);

  if (primitive.role !== 'spacing') {
    throw new Error(`Expected spacing reference but got: ${reference}`);
  }

  return `PrimitiveSpacing.${primitiveValueName(segments.at(-1))}`;
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

const spacingValue = (token) => {
  if (String(token.value).startsWith('{')) {
    return primitiveSpacingReference(token.value);
  }

  return dp(token.value);
};

const typographyRawValue = (token) => {
  if (String(token.value).startsWith('{')) {
    return resolvePrimitiveToken(token.value).token.value;
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

const createNodeShape = (node, leafPredicate) => {
  if (leafPredicate(node)) {
    return '__leaf__';
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, createNodeShape(value, leafPredicate)]),
  );
};

const validateConsistentSemanticShape = (role, modes, leafPredicate) => {
  expect(modes.length > 0, `Missing semantic modes for role ${role}`);

  const [firstMode, ...restModes] = modes;
  const expectedShape = JSON.stringify(createNodeShape(firstMode.node, leafPredicate));

  for (const mode of restModes) {
    const actualShape = JSON.stringify(createNodeShape(mode.node, leafPredicate));
    expect(
      actualShape === expectedShape,
      `Semantic/${role} mode "${mode.variant}" must match the shape of "${firstMode.variant}"`,
    );
  }

  return firstMode.node;
};

const pruneRedundantRadiusNode = (node) => {
  if (!isObject(node) || !isObject(node.Radius)) {
    return node;
  }

  const radiusNode = node.Radius;
  const topLevelComponentShape = JSON.stringify(createNodeShape(node.Component, isToken));
  const topLevelContainerShape = JSON.stringify(createNodeShape(node.Container, isToken));
  const nestedComponentShape = JSON.stringify(createNodeShape(radiusNode.Component, isToken));
  const nestedContainerShape = JSON.stringify(createNodeShape(radiusNode.Container, isToken));

  if (
    topLevelComponentShape === nestedComponentShape &&
    topLevelContainerShape === nestedContainerShape
  ) {
    const { Radius: _radius, ...prunedNode } = node;
    return prunedNode;
  }

  return node;
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

const createModeFactories = ({
  className,
  modes,
  leafValue,
  leafPredicate,
  composable = false,
}) =>
  modes.map((mode) => {
    const signature = `${composable ? '@Composable\n' : ''}internal fun ${createFactoryFunctionName(className, mode.modeName)}(): ${className} =`;
    return `${signature}
${createFactoryValue({
  className,
  node: mode.node,
  leafValue,
  leafPredicate,
})}`;
  }).join('\n\n');

const createPrimitiveColor = () => {
  const lines = ['internal object PrimitiveColor {'];

  for (const [groupName, group] of Object.entries(primitiveColor)) {
    for (const [name, token] of Object.entries(group)) {
      lines.push(
        `    val ${pascal(`${groupName} ${name}`)} = ${hexToComposeColor(token.value)}`,
      );
    }
  }

  lines.push('}');
  return lines.join('\n');
};

const createPrimitiveRadius = () => {
  const lines = ['internal object PrimitiveRadius {'];

  for (const [name, token] of Object.entries(primitiveRadius)) {
    lines.push(`    val ${primitiveValueName(name)} = ${dp(token.value)}`);
  }

  lines.push('}');
  return lines.join('\n');
};

const createPrimitiveSpacing = () => {
  const lines = ['internal object PrimitiveSpacing {'];

  for (const [name, token] of Object.entries(primitiveSpacing)) {
    lines.push(`    val ${primitiveValueName(name)} = ${dp(token.value)}`);
  }

  lines.push('}');
  return lines.join('\n');
};

await writeKotlinFile({
  ...getOutputTarget('Primitive', 'Color'),
  content: `
import androidx.compose.ui.graphics.Color

${createPrimitiveColor()}`,
});

await writeKotlinFile({
  ...getOutputTarget('Semantic', 'Color'),
  content: `
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

${createDataClass({
  className: 'SemanticColor',
  node: validateConsistentSemanticShape('Color', semanticColorModes, isToken),
  leafType: 'Color',
  leafPredicate: isToken,
})}

${createModeFactories({
  className: 'SemanticColor',
  modes: semanticColorModes,
  leafValue: colorValue,
  leafPredicate: isToken,
})}`,
});

await writeKotlinFile({
  ...getOutputTarget('Primitive', 'Radius'),
  content: `
import androidx.compose.ui.unit.dp

${createPrimitiveRadius()}`,
});

await writeKotlinFile({
  ...getOutputTarget('Semantic', 'Radius'),
  content: `
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.Dp

${createDataClass({
  className: 'SemanticRadius',
  node: pruneRedundantRadiusNode(
    validateConsistentSemanticShape('Radius', semanticRadiusModes, isToken),
  ),
  leafType: 'Dp',
  leafPredicate: isToken,
})}

${createModeFactories({
  className: 'SemanticRadius',
  modes: semanticRadiusModes.map((mode) => ({
    ...mode,
    node: pruneRedundantRadiusNode(mode.node),
  })),
  leafValue: radiusValue,
  leafPredicate: isToken,
})}`,
});

await writeKotlinFile({
  ...getOutputTarget('Primitive', 'Spacing'),
  content: `
import androidx.compose.ui.unit.dp

${createPrimitiveSpacing()}`,
});

await removeOutputFile('spacing', 'SaionSpacing.kt');

await writeKotlinFile({
  directory: 'spacing',
  fileName: 'SemanticSpacing.kt',
  packageName: `${CONFIG.outputPackage}.spacing`,
  content: `
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.Dp

${createDataClass({
  className: 'SemanticSpacing',
  node: validateConsistentSemanticShape('Spacing', semanticSpacingModes, isToken),
  leafType: 'Dp',
  leafPredicate: isToken,
})}

${createModeFactories({
  className: 'SemanticSpacing',
  modes: semanticSpacingModes,
  leafValue: spacingValue,
  leafPredicate: isToken,
})}`,
});

await writeKotlinFile({
  ...getOutputTarget('Semantic', 'Typography'),
  content: `
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ${CONFIG.basePackage}.internal.createSaionTextStyle

${createDataClass({
  className: 'SemanticTypography',
  node: validateConsistentSemanticShape('Typography', semanticTypographyModes, isTypographyStyle),
  leafType: 'TextStyle',
  leafPredicate: isTypographyStyle,
})}

${createModeFactories({
  className: 'SemanticTypography',
  modes: semanticTypographyModes,
  leafValue: textStyleValue,
  leafPredicate: isTypographyStyle,
  composable: true,
})}`,
});
