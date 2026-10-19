import { defineConfig, type Plugin } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * The commit this build came from: BUILD_ID when set (the deploy host builds from an archive with no
 * .git), else the CI commit, else the checked-out commit.
 */
function resolveBuildId(): string {
  for (const key of ["BUILD_ID", "GITHUB_SHA"]) {
    const value = (process.env[key] || "").trim();
    if (value) return value;
  }
  try {
    return execSync("git rev-parse HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const BUILD_ID = resolveBuildId();

/** Write dist/build-id so the server can report the commit in every page it serves. */
function buildIdPlugin(): Plugin {
  let outDir = path.resolve(__dirname, "dist");
  return {
    name: "precedent-build-id",
    configResolved(config) {
      outDir = path.resolve(__dirname, config.build.outDir);
    },
    closeBundle() {
      if (!BUILD_ID) return;
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "build-id"), `${BUILD_ID}\n`);
    },
  };
}

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [dyadComponentTagger(), react(), buildIdPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
