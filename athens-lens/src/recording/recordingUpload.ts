/** Resumable GCS PUT used by the service worker and the offscreen recorder. */
export async function putResumable(uploadUrl: string, blob: Blob): Promise<void> {
  const chunkSize = 8 * 1024 * 1024;
  let offset = 0;
  while (offset < blob.size) {
    const end = Math.min(offset + chunkSize, blob.size);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - offset),
        "Content-Range": `bytes ${offset}-${end - 1}/${blob.size}`,
      },
      body: blob.slice(offset, end),
    });
    if (response.status !== 308 && !response.ok) {
      throw new Error(`Storage upload failed (${response.status})`);
    }
    offset = end;
  }
}
