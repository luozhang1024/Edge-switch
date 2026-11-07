import { t } from "./i18n";
import React, { useRef, useState } from "react";

export function ProviderIconUpload({
  icon,
  fallback,
  onChange,
}: {
  icon?: string;
  fallback?: string;
  onChange: (icon: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return (
    <div className="provider-preview">
      <button
        type="button"
        className="icon-upload"
        title={t("上传供应商图标")}
        aria-label={t("上传供应商图标")}
        onClick={() => input.current?.click()}
      >
        {icon || fallback ? (
          <img src={icon || fallback} alt={t("供应商图标")} />
        ) : (
          "P"
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={t("选择供应商图标文件")}
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError("");
          try {
            if (
              !/^image\/(png|jpeg|webp)$/.test(file.type) ||
              file.size > 2 * 1024 * 1024
            )
              throw new Error("请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片");
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("无法读取图片文件"));
              reader.readAsDataURL(file);
            });
            const image = new Image();
            image.src = dataUrl;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext("2d")!;
            const ratio = Math.min(128 / image.width, 128 / image.height);
            const w = image.width * ratio,
              h = image.height * ratio;
            ctx.drawImage(image, (128 - w) / 2, (128 - h) / 2, w, h);
            onChange(canvas.toDataURL("image/png"));
          } catch (e) {
            setError(String(e instanceof Error ? e.message : "无法读取图片"));
          } finally {
            e.target.value = "";
          }
        }}
      />
      <small>{t("点击上传图标")}</small>
      {icon && (
        <button
          type="button"
          className="text-button"
          onClick={() => onChange("")}
        >
          {t("恢复默认图标")}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
