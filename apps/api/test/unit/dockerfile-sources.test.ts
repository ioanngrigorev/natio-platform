import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every path a Dockerfile copies out of the repository must exist in a clean
 * checkout.
 *
 * This test exists because that was not true and it cost a production deploy.
 * `apps/web/public` was in every working tree and in no clone — git does not
 * store empty directories — so `docker build` succeeded on every machine it
 * was ever run on and failed the first time it ran against a fresh clone,
 * which is to say on the server and nowhere else.
 *
 * The honest reason it took a failed deploy to find: this sandbox cannot reach
 * a container registry, so the image build cannot be exercised here at all.
 * When you cannot run the thing, check the thing's assumptions instead. The
 * assumption a COPY makes is "this path exists", and `git ls-files` is an
 * exact description of what a clone will contain.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

/** Exactly what a fresh clone contains — not what happens to be on this disk. */
const trackedFiles = new Set(
  execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean),
);

function existsInCleanCheckout(repoPath: string): boolean {
  if (trackedFiles.has(repoPath)) return true;
  // A directory counts as present only if it will actually materialise, which
  // means at least one tracked file lives under it.
  const prefix = repoPath.endsWith("/") ? repoPath : `${repoPath}/`;
  for (const f of trackedFiles) if (f.startsWith(prefix)) return true;
  return false;
}

/**
 * Paths produced by a build step rather than checked out. These legitimately
 * do not exist in the repository, so they are out of scope here.
 */
const BUILD_OUTPUTS = [/(^|\/)\.next(\/|$)/, /(^|\/)dist(\/|$)/, /^\/out(\/|$)/, /(^|\/)node_modules(\/|$)/];

function isBuildOutput(p: string): boolean {
  return BUILD_OUTPUTS.some((re) => re.test(p));
}

interface CopySource {
  dockerfile: string;
  line: number;
  raw: string;
  repoPath: string;
}

/** Collect every COPY source that is supposed to come from the repository. */
function repoSourcesOf(dockerfile: string): CopySource[] {
  const abs = path.join(repoRoot, dockerfile);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const out: CopySource[] = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!/^COPY\s/i.test(trimmed)) return;

    const tokens = trimmed.split(/\s+/).slice(1);
    const flags = tokens.filter((t) => t.startsWith("--"));
    const operands = tokens.filter((t) => !t.startsWith("--"));
    if (operands.length < 2) return;

    // Everything but the last operand is a source; the last is the destination.
    const sources = operands.slice(0, -1);
    // `--from` copies out of an earlier stage. Those sources are absolute
    // inside that stage, and the ones under /repo are the checkout.
    const fromStage = flags.some((f) => f.startsWith("--from="));

    for (const src of sources) {
      let repoPath: string;
      if (fromStage) {
        if (!src.startsWith("/repo/")) continue; // e.g. /out — a build artefact
        repoPath = src.slice("/repo/".length);
      } else {
        if (src.startsWith("/")) continue;
        repoPath = src;
      }
      if (isBuildOutput(repoPath)) continue;
      out.push({ dockerfile, line: i + 1, raw: src, repoPath: repoPath.replace(/\/$/, "") });
    }
  });

  return out;
}

const DOCKERFILES = ["apps/api/Dockerfile", "apps/web/Dockerfile"];

describe("Dockerfile COPY sources exist in a clean checkout", () => {
  it("finds the Dockerfiles and some sources to check", () => {
    const all = DOCKERFILES.flatMap(repoSourcesOf);
    // A parser that silently matches nothing would make this whole file a
    // no-op that reports success, which is worse than having no test.
    expect(all.length).toBeGreaterThan(4);
  });

  for (const dockerfile of DOCKERFILES) {
    it(`${dockerfile}: every repository path it copies is tracked by git`, () => {
      const missing = repoSourcesOf(dockerfile)
        .filter((s) => {
          if (s.repoPath.includes("*")) {
            // A glob is satisfied by any match; pnpm-lock.yaml* is the case here.
            const dir = path.posix.dirname(s.repoPath);
            const base = path.posix.basename(s.repoPath).replace(/\*/g, "");
            for (const f of trackedFiles) {
              const fDir = path.posix.dirname(f);
              if ((dir === "." ? fDir === "." : fDir === dir) && path.posix.basename(f).startsWith(base)) return false;
            }
            return true;
          }
          return !existsInCleanCheckout(s.repoPath);
        })
        .map((s) => `${s.dockerfile}:${s.line} copies "${s.raw}" but nothing under "${s.repoPath}" is tracked by git`);

      expect(missing).toEqual([]);
    });
  }

  it("would have caught the directory that broke the first deploy", () => {
    // apps/web/public is empty apart from a deliberately tracked file. If that
    // file is ever removed as "unused", this fails here rather than on a
    // server 40 minutes into a build.
    expect(existsInCleanCheckout("apps/web/public")).toBe(true);
  });
});
