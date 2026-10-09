/** File formats supported by document intake; PPTX remains unavailable. */
export const KNOWLEDGE_FILE_FORMATS = {
  pdf: { media: "pdf", mime: "application/pdf", label: "PDF 文档" },
  png: { media: "image", mime: "image/png", label: "图片 PNG" },
  md: { media: "text", mime: "text/markdown", label: "Markdown 文档" },
  txt: { media: "text", mime: "text/plain", label: "TXT 文档" },
  mp4: { media: "video", mime: "video/mp4", label: "视频 MP4" },
  avi: { media: "video", mime: "video/x-msvideo", label: "视频 AVI" },
  jpg: { media: "image", mime: "image/jpeg", label: "图片 JPG" },
  jpeg: { media: "image", mime: "image/jpeg", label: "图片 JPEG" },
  gif: { media: "image", mime: "image/gif", label: "图片 GIF" },
  webp: { media: "image", mime: "image/webp", label: "图片 WebP" },
  mp3: { media: "audio", mime: "audio/mpeg", label: "音频 MP3" },
  wav: { media: "audio", mime: "audio/wav", label: "音频 WAV" },
  m4a: { media: "audio", mime: "audio/mp4", label: "音频 M4A" },
  aac: { media: "audio", mime: "audio/aac", label: "音频 AAC" },
  flac: { media: "audio", mime: "audio/flac", label: "音频 FLAC" },
  ogg: { media: "audio", mime: "audio/ogg", label: "音频 OGG" },
  opus: { media: "audio", mime: "audio/opus", label: "音频 OPUS" },
  mov: { media: "video", mime: "video/quicktime", label: "视频 MOV" },
  webm: { media: "video", mime: "video/webm", label: "视频 WebM" },
  mkv: { media: "video", mime: "video/x-matroska", label: "视频 MKV" },
} as const;

export type KnowledgeFileType = keyof typeof KNOWLEDGE_FILE_FORMATS;
export type KnowledgeMediaType = (typeof KNOWLEDGE_FILE_FORMATS)[KnowledgeFileType]["media"];
export type DocumentApplicability = { brands: string[]; stages: string[] };
export const KNOWLEDGE_FILE_TYPES = Object.keys(KNOWLEDGE_FILE_FORMATS) as KnowledgeFileType[];
export const KNOWLEDGE_FILE_ACCEPT = KNOWLEDGE_FILE_TYPES.map(ext => `.${ext}`).join(",");
export function knowledgeFileType(filename: string): string {
  const match = /\.([^.]+)$/.exec(filename);
  return match?.[1]?.toLowerCase() || "";
}
export function knowledgeFileLabel(filename: string): string {
  const ext = knowledgeFileType(filename);
  return KNOWLEDGE_FILE_FORMATS[ext as KnowledgeFileType]?.label || ext.toUpperCase() || "文件";
}
