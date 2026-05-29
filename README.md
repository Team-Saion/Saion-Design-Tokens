# design-tokens

Design tokens for iOS and Android — synced from Figma via Tokens Studio, transformed to
native platform code with [Style Dictionary v4](https://styledictionary.com) +
[`@tokens-studio/sd-transforms`](https://github.com/tokens-studio/sd-transforms).

## Pipeline

```
tokens/tokens.json  ──►  build.mjs (Style Dictionary)  ──►  build/android/DesignTokens.kt
(Tokens Studio export)                                  └─►  build/ios/DesignTokens.swift
```

| Output | Platform | Colors | Sizes |
| --- | --- | --- | --- |
| `build/android/DesignTokens.kt` | Jetpack Compose | `Color(0xAARRGGBB)` | `.dp` (dimension) / `.sp` (font size) |
| `build/ios/DesignTokens.swift` | SwiftUI **and** UIKit | SwiftUI `Color` + UIKit `UIColor` | `CGFloat` (shared) |

## Build locally

```bash
npm install        # first time
npm run build      # writes build/android and build/ios
npm run clean      # removes build/
```

Requires Node 18+.

## Usage

**Jetpack Compose** (`com.example.designtokens.DesignTokens`):

```kotlin
Surface(color = DesignTokens.colorBrandPrimary) {
    Text("Hi", fontSize = DesignTokens.fontSizeHeading)   // .sp
}
Spacer(Modifier.height(DesignTokens.spacingMd))           // .dp
```

**SwiftUI:**

```swift
Text("Hi")
    .foregroundStyle(DesignTokens.Colors.colorBrandPrimary)   // SwiftUI.Color
    .font(.system(size: DesignTokens.fontSizeHeading))        // CGFloat
    .padding(DesignTokens.spacingMd)
```

**UIKit:**

```swift
view.backgroundColor = DesignTokens.UIColors.colorBrandPrimary   // UIColor
let pad = DesignTokens.spacingMd                                 // CGFloat
```

## Customizing

Output package / type names live at the top of `build.mjs`:

```js
const KOTLIN_PACKAGE = 'com.example.designtokens';
const KOTLIN_OBJECT  = 'DesignTokens';
const SWIFT_ENUM     = 'DesignTokens';
```

Sizes map **1:1** from the px numbers authored in Tokens Studio (`16` → `16.dp` / `16.sp` /
`16` CGFloat). The stock Style Dictionary rem-based size transforms are intentionally
replaced with custom `compose/size/dp`, `compose/size/sp`, and `swift/size/cgfloat`
transforms to avoid the rem×16 assumption.

## CI

`.github/workflows/build-tokens.yml` rebuilds on every change to `tokens/**` (and on
`workflow_dispatch`), uploads the generated files as a build artifact, and — on pushes to
`main` — commits the regenerated `build/` back to the repo so the apps can consume tokens
directly from git.

> **Note:** `tokens/tokens.json` currently contains a representative sample token set so the
> pipeline is runnable end-to-end. The Tokens Studio → Figma sync overwrites this file with
> the real tokens; no config changes are needed as long as token `type`s stay standard
> (`color`, `spacing`, `sizing`, `borderRadius`, `fontSizes`, `fontWeights`).
