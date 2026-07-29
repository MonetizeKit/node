import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/otel.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["@monetizekit/types", "@opentelemetry/api"],
});
