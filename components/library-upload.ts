const AUDIO_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  aac: "audio/aac",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

const MAX_STORAGE_BASENAME_LENGTH = 120;

function fileExtension(fileName: string) {
  const extensionIndex = fileName.lastIndexOf(".");

  if (extensionIndex <= 0 || extensionIndex === fileName.length - 1) {
    return "";
  }

  return fileName.slice(extensionIndex + 1).toLowerCase();
}

function safeStorageBasename(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, MAX_STORAGE_BASENAME_LENGTH)
    .replace(/[._-]+$/g, "");
}

export function storageSafeAudioFileName(fileName: string) {
  const extensionIndex = fileName.lastIndexOf(".");
  const rawExtension = extensionIndex > 0 ? fileName.slice(extensionIndex + 1) : "";
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const extensionSuffix = extension ? `.${extension}` : "";
  const basename = extensionIndex > 0
    ? fileName.slice(0, extensionIndex)
    : fileName;
  const safeBasename = safeStorageBasename(basename) || "track";

  return `${safeBasename}${extensionSuffix}`;
}

export function audioMimeTypeForUpload(file: Pick<File, "name" | "type">) {
  const declaredMimeType = file.type.trim().toLowerCase();

  if (declaredMimeType.startsWith("audio/")) {
    return declaredMimeType;
  }

  return AUDIO_MIME_TYPES_BY_EXTENSION[fileExtension(file.name)] ?? null;
}
