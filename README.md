# Bucket

A React Native chat client for LLM roleplay and chat, built around single characters, group chats, and quick characters. All chat content and character data is stored encrypted in a local SQLite database (AES-256-GCM, key held in the OS keychain).

## Dependencies

- react / react-native: the app itself
- zustand: session, message, and settings state
- react-native-nitro-sqlite: encrypted local database
- react-native-keychain: stores the AES-GCM database key
- @react-navigation/native, bottom-tabs, native-stack: menu, chat, and settings screens
- react-native-reanimated (+ worklets/yoga-layout): sheet and picker animations
- react-native-image-picker: character and quick character icons
- react-native-safe-area-context / react-native-screens: window insets and screen transitions
- react-native-fs: .buk backup file handling
- react-native-get-random-values: random ids and keys
- react-native-clipboard/clipboard: copy
- @react-native-community/blur: frosted look behind the composer
- axios: non streaming provider calls (streaming runs over XMLHttpRequest in src/Endpoint.ts)
- js-tiktoken: token counting for prompt and history cutting
- jszip / pako: .buk backup export and import

## Prerequisites

- Node.js >= 22.11.0
- React Native development environment ([setup guide](https://reactnative.dev/docs/set-up-your-environment))

## Build

```sh
npm install

# Start Metro
npm start

# In a new terminal:
npm run android
```

## Test

```sh
npm test
```

## Lint

```sh
npm run lint
```
