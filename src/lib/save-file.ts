/**
 * ذخیرهٔ فایل در دستگاه کاربر — با امکان انتخاب پوشهٔ دلخواه
 *
 * در مرورگرهای پشتیبانی‌شده (کروم، اج، اُپرا) از File System Access API
 * (window.showSaveFilePicker) استفاده می‌شود؛ پنجرهٔ «ذخیره در...» سیستم‌عامل
 * باز می‌شود و کاربر پوشه و نام فایل را خودش انتخاب می‌کند.
 *
 * در مرورگرهای بدون پشتیبانی (فایرفاکس/سافاری) به روش استاندارد دانلود
 * (anchor download) برمی‌گردیم و فایل در پوشهٔ Downloads ذخیره می‌شود.
 */

export type SaveToDeviceResult = "saved" | "downloaded" | "cancelled";

// ─── تایپ‌های حداقلی File System Access API (در همهٔ DOM lib ها نیست) ───

interface FSWritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface FSFileHandle {
  createWritable(): Promise<FSWritableFileStream>;
}

interface FSSavePickerOptions {
  suggestedName?: string;
  startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
  types?: { description?: string; accept: Record<string, string[]> }[];
}

type FSSaveFilePicker = (options?: FSSavePickerOptions) => Promise<FSFileHandle>;

function getSavePicker(): FSSaveFilePicker | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { showSaveFilePicker?: FSSaveFilePicker };
  return typeof w.showSaveFilePicker === "function" ? w.showSaveFilePicker : null;
}

/** روش استاندارد دانلود — فایل به پوشهٔ Downloads مرورگر می‌رود */
function fallbackDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * فایل (Blob) را در دستگاه کاربر ذخیره می‌کند.
 *
 * - "saved"     → کاربر پوشه را انتخاب کرد و فایل داخل آن ذخیره شد
 * - "downloaded"→ مرورگر انتخاب پوشه را پشتیبانی نمی‌کند؛ فایل به Downloads رفت
 * - "cancelled" → کاربر پنجرهٔ انتخاب پوشه را بست (هیچ ذخیره‌ای انجام نشد)
 */
export async function saveBlobToDevice(
  blob: Blob,
  filename: string,
  options: { description?: string; extensions?: string[] } = {}
): Promise<SaveToDeviceResult> {
  const picker = getSavePicker();
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        startIn: "downloads",
        types: [
          {
            description: options.description ?? "فایل",
            accept: { "application/octet-stream": options.extensions ?? [".db"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (e) {
      // کاربر پنجرهٔ «ذخیره در...» را بست — هیچ ذخیره‌ای انجام نمی‌شود
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // NotAllowedError (بدون کاربر فعال) یا خطای دیگر → روش استاندارد دانلود
    }
  }
  fallbackDownload(blob, filename);
  return "downloaded";
}
