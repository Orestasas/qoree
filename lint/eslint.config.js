import globals from 'globals';
export default [{
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
  rules: {
    'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
    'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error', 'no-redeclare': 'error', 'no-shadow': 'off',
    'no-self-assign': 'error', 'no-cond-assign': 'error', 'eqeqeq': ['warn', 'smart'], 'no-unsafe-finally': 'error', 'require-await': 'off',
  },
}];
