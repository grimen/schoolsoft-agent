/** Split quality bar (spec: Testing and CI): plumbing at 100%, screens tested without a threshold. */
module.exports = {
  // "jest-expo/web" (jsdom + react-native-web) was tried first to match the app's
  // web-only target, but @testing-library/react-native's queries only recognize the
  // native host component names ("Text"/"View"), never the "div"/"h1" tags
  // react-native-web renders to under jsdom, so getByText/getByRole can never match.
  // The plain "jest-expo" (native) preset renders through react-native's own mocked
  // host components, which keep those names, so component tests use it regardless of
  // web being the only shipped target; Metro still bundles the real app for web.
  preset: "jest-expo",
  testPathIgnorePatterns: ["/node_modules/", "/e2e/", "/scripts/"],
  collectCoverageFrom: ["src/connection/**/*.{ts,tsx}", "src/messages.ts", "src/use-children.ts"],
  coverageThreshold: { global: { lines: 100, branches: 100, functions: 100, statements: 100 } },
};
