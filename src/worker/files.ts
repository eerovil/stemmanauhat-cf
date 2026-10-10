/** Serving song files out of R2, with the Range requests audio seeking needs. */

export type ByteRange = { offset: number; length?: number } | { suffix: number };

/** Parses a single-range `Range: bytes=...` header. null means "send it all". */
export function parseRange(header: string | null): ByteRange | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, start, end] = match;
  if (start === "" && end === "") return "invalid";
  if (start === "") return { suffix: Number(end) };
  const offset = Number(start);
  if (end === "") return { offset };
  const last = Number(end);
  if (last < offset) return "invalid";
  return { offset, length: last - offset + 1 };
}

/** A path inside one song's folder: no escaping it, no absolute paths. */
export function safeSongPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

const TYPES: Record<string, string> = {
  mid: "audio/midi",
  sf3: "application/octet-stream",
  mp3: "audio/mpeg",
  json: "application/json",
  musicxml: "application/vnd.recordare.musicxml+xml",
  xml: "application/xml",
};

export async function serveObject(bucket: R2Bucket, key: string, request: Request,
  cacheControl = "private, max-age=31536000, immutable"): Promise<Response> {
  const range = parseRange(request.headers.get("Range"));
  if (range === "invalid") return new Response("Bad range", { status: 416 });

  const object = await bucket.get(key, range ? { range } : {});
  if (object === null) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  if (!headers.has("Content-Type")) headers.set("Content-Type", TYPES[extension] ?? "application/octet-stream");
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  // Every published version has its own folder (and the piano its own versioned
  // name), so a file never changes.
  headers.set("Cache-Control", cacheControl);

  if (!range || !("body" in object)) {
    headers.set("Content-Length", String(object.size));
    return new Response("body" in object ? object.body : null, { status: 200, headers });
  }
  let start: number;
  let end: number;
  if ("suffix" in range) {
    start = Math.max(object.size - range.suffix, 0);
    end = object.size - 1;
  } else {
    start = range.offset;
    end = range.length === undefined ? object.size - 1 : Math.min(range.offset + range.length, object.size) - 1;
  }
  if (start >= object.size) {
    return new Response("Range not satisfiable", { status: 416, headers: { "Content-Range": `bytes */${object.size}` } });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(object.body, { status: 206, headers });
}
