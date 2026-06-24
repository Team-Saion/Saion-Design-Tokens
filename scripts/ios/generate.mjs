/**
 * Style Dictionary v4 build pipeline for Tokens Studio tokens.
 *
 * Reads tokens/tokens.json (Tokens Studio single-file export) and emits:
 *   - build/ios/DesignTokens.swift    — SwiftUI (Color) + UIKit (UIColor), shared CGFloat dimensions
 *
 * sd-transforms handles the Tokens Studio specifics (composite token expansion,
 * math, references, type mapping). We add platform-native size/color transforms
 * because the stock rem-based size transforms assume rem input, while Tokens
 * Studio emits raw px numbers that map 1:1 to dp / sp / pt.
 */
import StyleDictionary from 'style-dictionary';
import { register, getTransforms } from '@tokens-studio/sd-transforms';

// ---- Editable output identifiers -------------------------------------------
const SWIFT_ENUM = 'DesignTokens';
// ----------------------------------------------------------------------------

register(StyleDictionary, {
  // Tokens Studio single-file exports wrap every set in a top-level key
  // ("global"). Strip it so intra-set references like {color.brand.primary}
  // resolve correctly.
  excludeParentKeys: true,
});

const numeric = (value) => parseFloat(value);

/** "12px" / "1.5" -> trimmed string with no trailing zeros ("12", "1.5"). */
const cgFloat = (value) => {
  const n = numeric(value);
  return Number.isNaN(n) ? '0' : String(n);
};

/** Parse #rgb / #rgba / #rrggbb / #rrggbbaa / rgb()/rgba() into 0..1 components. */
function parseColor(raw) {
  const value = String(raw).trim();

  const rgbFn = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbFn) {
    const parts = rgbFn[1].split(',').map((p) => p.trim());
    const [r, g, b] = parts.map((p) => parseFloat(p));
    const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
    return { r: r / 255, g: g / 255, b: b / 255, a };
  }

  let hex = value.replace('#', '');
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (hex.length !== 6 && hex.length !== 8) {
    throw new Error(`Cannot parse color value "${raw}"`);
  }
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

const f3 = (n) => n.toFixed(3);

// ---- Custom transforms ------------------------------------------------------
StyleDictionary.registerTransform({
  name: 'compose/size/dp',
  type: 'value',
  transitive: true,
  filter: (token) => token.type === 'dimension',
  transform: (token) => `${cgFloat(token.value)}.dp`,
});

StyleDictionary.registerTransform({
  name: 'compose/size/sp',
  type: 'value',
  transitive: true,
  filter: (token) => token.type === 'fontSize',
  transform: (token) => `${cgFloat(token.value)}.sp`,
});

StyleDictionary.registerTransform({
  name: 'swift/size/cgfloat',
  type: 'value',
  transitive: true,
  filter: (token) => token.type === 'dimension' || token.type === 'fontSize',
  transform: (token) => cgFloat(token.value),
});

// ---- Deterministic file header (no timestamp -> clean diffs) -----------------
StyleDictionary.registerFileHeader({
  name: 'tokens-header',
  fileHeader: () => [
    'Design Tokens — DO NOT EDIT.',
    'Generated from Tokens Studio via Style Dictionary.',
  ],
});

// ---- Custom SwiftUI + UIKit format ------------------------------------------
StyleDictionary.registerFormat({
  name: 'ios-swift/design-tokens',
  format: ({ dictionary, options }) => {
    const enumName = options.className ?? 'DesignTokens';
    const byType = (t) => dictionary.allTokens.filter((tok) => tok.type === t);
    const doc = (tok, pad) => (tok.comment ? `${pad}/// ${tok.comment}\n` : '');

    const colors = byType('color');
    const dimensions = byType('dimension');
    const fontSizes = byType('fontSize');
    const fontWeights = byType('fontWeight');

    const swiftUIColor = (tok) => {
      const { r, g, b, a } = parseColor(tok.value);
      return `${doc(tok, '        ')}        public static let ${tok.name} = Color(red: ${f3(r)}, green: ${f3(g)}, blue: ${f3(b)}, opacity: ${f3(a)})`;
    };
    const uiColor = (tok) => {
      const { r, g, b, a } = parseColor(tok.value);
      return `        public static let ${tok.name} = UIColor(red: ${f3(r)}, green: ${f3(g)}, blue: ${f3(b)}, alpha: ${f3(a)})`;
    };
    const cgFloatLet = (tok) =>
      `${doc(tok, '    ')}    public static let ${tok.name}: CGFloat = ${cgFloat(tok.value)}`;

    const section = (title, items) =>
      items.length ? `\n    // MARK: - ${title}\n${items.join('\n')}\n` : '';

    return `//
// ${enumName}.swift
// Design Tokens — DO NOT EDIT.
// Generated from Tokens Studio via Style Dictionary.
//
// Usage:
//   SwiftUI -> ${enumName}.Colors.colorBrandPrimary  (SwiftUI.Color)
//   UIKit   -> ${enumName}.UIColors.colorBrandPrimary (UIColor)
//   Sizes   -> ${enumName}.spacingMd                  (CGFloat, shared)
//

import SwiftUI
import UIKit

public enum ${enumName} {

    // MARK: - Colors (SwiftUI)
    public enum Colors {
${colors.map(swiftUIColor).join('\n')}
    }

    // MARK: - Colors (UIKit)
    public enum UIColors {
${colors.map(uiColor).join('\n')}
    }
${section('Spacing & Radius', dimensions.map(cgFloatLet))}${section('Font Sizes', fontSizes.map(cgFloatLet))}${section('Font Weights', fontWeights.map(cgFloatLet))}}
`;
  },
});

// ---- Style Dictionary configuration -----------------------------------------
const sd = new StyleDictionary({
  source: ['tokens/tokens.json'],
  preprocessors: ['tokens-studio'],
  platforms: {
    ios: {
      transforms: [
        ...getTransforms({ platform: 'js' }),
        'attribute/cti',
        'name/camel',
        'swift/size/cgfloat',
      ],
      buildPath: 'build/ios/',
      files: [
        {
          destination: 'DesignTokens.swift',
          format: 'ios-swift/design-tokens',
          options: {
            fileHeader: 'tokens-header',
            className: SWIFT_ENUM,
          },
        },
      ],
    },
  },
});

await sd.hasInitialized;
await sd.buildAllPlatforms();
