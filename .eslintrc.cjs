/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "@remix-run/eslint-config/jest-testing-library",
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
  settings: {
    // The template's jest-testing-library config needs a Jest version to lint
    // test files. We use Vitest (no Jest installed), so pin the version that
    // eslint-plugin-jest should assume.
    jest: {
      version: 29,
    },
  },
};
