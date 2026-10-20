import { pool } from "@manga/lib/db";
import { isAbsolute } from "path";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ siteKey: string }> }
) {
  const { siteKey } = await params;
  let body: {
    storeImagesLocally?: unknown;
    localImageStoragePath?: unknown;
  };

  try {
    body = (await request.json()) as {
      storeImagesLocally?: unknown;
      localImageStoragePath?: unknown;
    };
  } catch {
    return Response.json(
      { ok: false, message: "Invalid request" },
      { status: 400 }
    );
  }

  if (typeof body.storeImagesLocally !== "boolean") {
    return Response.json(
      { ok: false, message: "storeImagesLocally must be boolean" },
      { status: 400 }
    );
  }
  if (
    body.localImageStoragePath !== undefined &&
    body.localImageStoragePath !== null &&
    typeof body.localImageStoragePath !== "string"
  ) {
    return Response.json(
      { ok: false, message: "localImageStoragePath must be string" },
      { status: 400 }
    );
  }

  const localImageStoragePath =
    typeof body.localImageStoragePath === "string"
      ? body.localImageStoragePath.trim() || null
      : null;
  if (localImageStoragePath && !isAbsolute(localImageStoragePath)) {
    return Response.json(
      { ok: false, message: "保存先は絶対パスで入力してください。" },
      { status: 400 }
    );
  }

  const result = await pool.query(
    `UPDATE crawler_sites
     SET store_images_locally = $1,
         local_image_storage_path = $2,
         updated_at = NOW()
     WHERE site_key = $3
       AND crawl_status IS DISTINCT FROM 'crawling'
     RETURNING
       site_key,
       config,
       crawl_status,
       crawl_error,
       last_crawled_at,
       store_images_locally,
       local_image_storage_path`,
    [body.storeImagesLocally, localImageStoragePath, siteKey]
  );
  const site = result.rows[0];
  if (site) {
    return Response.json({ ok: true, site });
  }

  const existsResult = await pool.query<{ crawl_status: string }>(
    "SELECT crawl_status FROM crawler_sites WHERE site_key = $1",
    [siteKey]
  );
  if (!existsResult.rows[0]) {
    return Response.json(
      { ok: false, message: "Site config not found" },
      { status: 404 }
    );
  }
  return Response.json(
    { ok: false, message: "クローラーの実行中は保存設定を変更できません。" },
    { status: 409 }
  );
}
