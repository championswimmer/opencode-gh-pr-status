import { transformFileAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import solid from "babel-preset-solid"
import { build } from "esbuild"

// Compile JSX ahead of time. Never bundle a second copy of the host's Solid or OpenTUI.
await build({
  entryPoints: ["src/tui.tsx"],
  outfile: "dist/tui.js",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "es2023",
  plugins: [
    {
      name: "opentui-solid",
      setup(builder) {
        builder.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
          const result = await transformFileAsync(path, {
            babelrc: false,
            configFile: false,
            presets: [typescript, [solid, { generate: "universal", moduleName: "@opentui/solid" }]],
          })
          if (!result?.code) throw new Error(`Failed to compile ${path}`)
          return { contents: result.code, loader: "js" }
        })
      },
    },
  ],
})
