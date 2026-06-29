const reactNativeConfig = require('@react-native/eslint-config/flat');

const withoutFlow = reactNativeConfig
  .filter(
    block =>
      !block ||
      !block.plugins ||
      !Object.prototype.hasOwnProperty.call(block.plugins, 'ft-flow'),
  )
  .map(block => {
    if (!block || !block.rules) {
      return block;
    }
    const rules = { ...block.rules };
    for (const key of Object.keys(rules)) {
      if (key.startsWith('ft-flow/')) {
        delete rules[key];
      }
    }
    return { ...block, rules };
  });

module.exports = [
  ...withoutFlow,
  {
    rules: {
      'react-native/no-inline-styles': 'off',
    },
  },
];
