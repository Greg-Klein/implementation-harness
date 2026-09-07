module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests/unit"],
  testMatch: ["**/*.test.ts"],
  // The server modules import each other with the ESM ".js" suffix.
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": ["@swc/jest", {
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" },
    }],
  },
  clearMocks: true,
};
