module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!@react-native|@react-navigation|react-native|@noble|js-tiktoken|pako)',
  ],
};
