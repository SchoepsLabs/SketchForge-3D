import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  resolvePrintOutboxDir,
  sanitizePrintName,
  uniquePrintFileName,
  PRINT_OUTBOX_DISABLED_MESSAGE,
  PRINT_OUTBOX_ENV,
} from "@/lib/printOutbox";

/**
 * Print handoff: writes an STL into the watched outbox folder the slicer reads.
 *
 * Same shape as the shared-projects route — same-origin only, size-capped, and
 * written to a temp file then renamed, so a watcher never sees a half-written
 * STL and start slicing it.
 */

export const runtime = "nodejs";
export const revalidate = false;

const MAX_STL_BYTES = 256 * 1024 * 1024;

function outboxDirectory() {
  return resolvePrintOutboxDir({
    outboxDir: process.env[PRINT_OUTBOX_ENV],
    sharedProjectsDir: process.env.SKETCHFORGE_SHARED_PROJECTS_DIR,
    join: (...parts) => path.join(...parts),
  });
}

function sameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host") || requestUrl.host;
    const protocol = forwardedProtocol || requestUrl.protocol.replace(/:$/, "");
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

export async function GET() {
  const root = outboxDirectory();
  if (!root) return NextResponse.json({ enabled: false, error: PRINT_OUTBOX_DISABLED_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ enabled: true, directory: root }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const root = outboxDirectory();
  if (!root) return NextResponse.json({ error: PRINT_OUTBOX_DISABLED_MESSAGE, reason: "disabled" }, { status: 404 });
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "The print outbox only accepts same-origin sends." }, { status: 403 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_STL_BYTES) {
    return NextResponse.json({ error: "That STL is too large for the print outbox." }, { status: 413 });
  }

  let temporaryPath = "";
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return NextResponse.json({ error: "The STL was empty." }, { status: 400 });
    if (bytes.byteLength > MAX_STL_BYTES) return NextResponse.json({ error: "That STL is too large for the print outbox." }, { status: 413 });

    const requested = new URL(request.url).searchParams.get("fileName") ?? "";
    // Rebuild the name from its stem: never trust a path from the client.
    const safeStem = sanitizePrintName(path.basename(requested));
    await fs.mkdir(root, { recursive: true });
    const fileName = uniquePrintFileName(`${safeStem}.stl`, (candidate) => existsSync(path.join(root, candidate)));
    const filePath = path.join(root, fileName);
    temporaryPath = path.join(root, `.${fileName}.${randomUUID()}.tmp`);

    const handle = await fs.open(temporaryPath, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Rename is atomic, so a folder watcher never picks up a partial STL.
    await fs.rename(temporaryPath, filePath);
    temporaryPath = "";

    return NextResponse.json(
      { fileName, directory: root, bytes: bytes.byteLength },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not write to the print outbox." }, { status: 500 });
  } finally {
    if (temporaryPath) await fs.unlink(temporaryPath).catch(() => undefined);
  }
}
