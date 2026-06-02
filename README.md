# design-tokens

Saion 디자인 토큰 저장소입니다. 디자이너가 Tokens Studio에서 동기화한 결과를 `tokens/tokens.json`에 반영하면, 이 저장소의 자동화가 이를 기준으로 각 플랫폼 디자인 시스템 저장소에 반영할 변경을 생성합니다.

<br>

## 전체 플로우

```text
Designer updates Tokens Studio
        ↓
Commit tokens/tokens.json to this repository
        ↓
GitHub Actions: Generate Design Tokens
        ↓
Platform build jobs run
        ↓
Generated token changes are copied to downstream DS repositories
        ↓
Platform PRs are created automatically
```
<br>

## 디자이너 커밋 이후 플로우

디자이너가 `tokens/tokens.json`을 커밋하면 이 저장소는 다음 순서로 동작합니다.

1. `tokens/**` 변경을 감지해 `Generate Design Tokens` workflow가 실행됩니다.
2. 플랫폼별 빌드 작업이 실행됩니다.
3. 이전 토큰과 현재 토큰을 비교해 changelog와 PR 본문을 생성합니다.
4. 생성 결과를 각 플랫폼 디자인 시스템 저장소로 복사합니다.
5. 플랫폼별 자동 PR을 생성합니다.

현재 확인되는 workflow:

- `.github/workflows/sync-design-tokens.yml`
- `.github/workflows/sync-android-design-tokens.yml`
- `.github/workflows/sync-ios-design-tokens.yml`

현재 메인 진입점 workflow인 `Generate Design Tokens`는 다음 상황에서 실행됩니다.

- `main` 브랜치에 `tokens/**` 파일 변경이 push될 때
- 수동 `workflow_dispatch` 실행 시

실패 시에는 Discord 알림이 전송됩니다.
<br>

## `tokens.json` 구조

`tokens/tokens.json`이 현재 기준 원본입니다. 이 파일은 Tokens Studio의 single-file export
형식이며, 최상위는 하나의 병합된 트리가 아니라 여러 token set으로 구성됩니다.

현재 최상위 token set:

```text
Primitive/Color/Value
Primitive/Typography/Value
Primitive/Spacing/Value
Primitive/Radius/Value
Semantic/Color/Light
Semantic/Radius/Default
Semantic/Typography/Default
$themes
$metadata
```

### 구조 개념

- `Primitive/*`: 실제 값(value scale) 정의
- `Semantic/*`: primitive를 참조해 의미를 부여한 alias/token 정의
- `$themes`, `$metadata`: export 메타데이터

#### Primitive 예시:

```text
Primitive/Color/Value
└─ Color
   ├─ common.0, common.100
   ├─ grey.50 ... grey.900
   └─ ...

Primitive/Typography/Value
└─ Typography
   ├─ font-family.type
   ├─ font-size.10 ... font-size.48
   ├─ font-weight.thin ... font-weight.bold
   ├─ line-height.14 ... line-height.48
   └─ letter-spacing.tighter ... letter-spacing.widest

Primitive/Spacing/Value
└─ Spacing
   └─ 2, 4, 6, 8, 10, 12, 14, 16, ...

Primitive/Radius/Value
└─ Radius
   └─ 2, 4, 6, 8, 10, 12, 16, 20, 24, 999
```

#### Semantic 예시:

```text
Semantic/Color/Light
├─ Primary.default | pressed | subtle | disabled
├─ Label.default | strong | subtle | disabled
├─ Background.default | subtle | muted
├─ Line.default | strong | subtle
├─ Status.positive|cautionary|negative.default|subtle
├─ Fill.default | subtle | disabled
└─ Overlay.dimmer | pressed

Semantic/Radius/Default
├─ Component.xsmall | small | medium | large | full
├─ Container.small | medium | large | xlarge
└─ Radius.Component / Radius.Container

Semantic/Typography/Default
└─ Typography
   ├─ display1, display2
   ├─ heading1, heading2
   ├─ title1, title2, title3
   ├─ body1, body2, body3
   ├─ label1, label2
   ├─ caption1, caption2
   └─ strong/subtle variants
```
<br>

### Leaf Token 형식

대부분의 leaf node는 Tokens Studio 표준 token object 형식을 사용합니다.

```json
{
  "value": "#ffffff",
  "type": "color",
  "$extensions": {
    "com.figma.hiddenFromPublishing": false
  }
}
```

현재 파일에서 실제로 확인되는 주요 `type` 값:

- `color`
- `number`
- `text`

`$extensions`는 Figma/Tokens Studio export 메타데이터이므로 일반적으로 그대로 유지합니다.

<br>

### Reference 규칙

Semantic token은 가능한 한 raw value를 직접 중복 선언하지 말고 primitive token을 참조해야 합니다.

#### 참조 형식:

```text
{Group.path.to.token}
```

#### 현재 파일 예시:

```text
{Color.green.500}
{Color.grey.300}
{Typography.font-size.40}
{Typography.font-weight.bold}
{Typography.line-height.48}
{Typography.letter-spacing.tight}
```

#### 작성 규칙:

- Semantic color token은 raw hex 값보다 primitive color alias를 우선 사용합니다.
- Semantic spacing/radius token은 primitive 숫자 스케일 참조를 우선 사용합니다.
- Semantic typography style은 primitive typography 축을 조합해서 구성합니다.
- 새 reference는 반드시 해당 primitive set 내부의 dotted path를 그대로 따릅니다.
<br>

### Typography 컨벤션

Primitive typography token은 axis 기반입니다. Semantic typography style은 
단일 leaf token이 아니라, 아래 4개의 하위 token을 반드시 가지는 composite object입니다.

```json
{
  "font-size": { "value": "{Typography.font-size.40}", "type": "number" },
  "font-weight": { "value": "{Typography.font-weight.bold}", "type": "number" },
  "line-height": { "value": "{Typography.line-height.48}", "type": "number" },
  "letter-spacing": { "value": "{Typography.letter-spacing.tight}", "type": "number" }
}
```

즉, semantic typography를 추가할 때는 항상 위 4개 필드를 함께 정의해야 합니다.

<br>

## 로컬 확인

```bash
npm install        # 최초 1회
npm run build:android
npm run clean
```

Node 18 이상이 필요합니다.

로컬 빌드는 토큰 변경이 downstream 반영 전에 어떤 결과를 낼지 빠르게 점검하는 용도로 사용합니다.

<br>

## 운영 가이드

- `tokens/tokens.json`은 Tokens Studio sync/export 시 덮어써질 수 있습니다.
- 수동 수정은 예외적으로만 하고, 다음 export에도 구조가 유지되는지 확인해야 합니다.
- `$themes`, `$metadata`는 제품 토큰 그룹이 아니라 export 메타데이터입니다.
- 이 저장소에서 관리하는 핵심 산출물은 `tokens/tokens.json`과 그 변경을 downstream 저장소로 전달하는 자동화 흐름입니다.
- 플랫폼별 generator 구현 세부사항은 README 범위에서 다루지 않습니다.
- iOS 관련 문서는 아직 작업 중입니다.

<br>

## CI

현재 자동화는 다음 역할을 가집니다.

- `Generate Design Tokens`
  - 토큰 변경 감지
  - 플랫폼별 reusable workflow 호출
- Android/iOS workflow
  - 의존성 설치
  - 이전 토큰 준비
  - 플랫폼별 빌드 실행
  - downstream 디자인 시스템 저장소 checkout
  - 생성 결과 복사
  - changelog / PR body 생성
  - 자동 PR 생성

즉, 디자이너가 `tokens/tokens.json`을 커밋한 뒤에는 이 저장소가 단순 파일 저장소가 아니라,
플랫폼 디자인 시스템 저장소로 변경을 전달하는 자동화 진입점 역할을 합니다.

<br>

> 참고: 현재 `tokens/tokens.json`에는 파이프라인을 확인할 수 있는 예시 토큰이 들어 있을 수
> 있습니다. 실제 sync가 수행되면 이 파일은 실데이터로 덮어써집니다.
