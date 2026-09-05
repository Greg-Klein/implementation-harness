module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests/unit"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["@swc/jest", {
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" },
    }],
  },
  clearMocks: true,
};
