import multer from "multer";
import { AppError } from "../common/errors/AppError";

export type ImageUploadOptions = {
  maxSizeKb?: number;
  allowedTypes?: string[];
};

export function imageUpload(options?: ImageUploadOptions) {
  const maxSizeKb = options?.maxSizeKb ?? 300;
  const allowedTypes = options?.allowedTypes ?? [
    "image/jpeg",
    "image/jpg",
    "image/png",
  ];

  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxSizeKb * 1024,
    },
    fileFilter: (_req, file, cb) => {
      if (!allowedTypes.includes(file.mimetype)) {
        return cb(
          new AppError(
            `Invalid file type. Allowed: ${allowedTypes.join(", ")}`,
            400,
            "INVALID_FILE_TYPE"
          ) as any,
          false
        );
      }
      cb(null, true);
    },
  });
}