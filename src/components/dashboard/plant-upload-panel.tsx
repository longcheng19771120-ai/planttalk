import { usePlantExperienceStore } from "@/stores/plant/experience-store";

export function PlantUploadPanel() {
  const imageFile = usePlantExperienceStore((s) => s.imageFile);
  const previewUrl = usePlantExperienceStore((s) => s.previewUrl);
  const errorMessage = usePlantExperienceStore((s) => s.errorMessage);
  const isSubmitting = usePlantExperienceStore((s) => s.isSubmitting);
  const setImageFile = usePlantExperienceStore((s) => s.setImageFile);
  const analyzePlantImage = usePlantExperienceStore((s) => s.analyzePlantImage);

  return (
    <article>
      <header>
        <strong>植物照片上传</strong>
      </header>

      <p>
        <small>
          请使用一张清晰的单株植物照片。如果画面里有多株，模型会分析最主要的那一株。
        </small>
      </p>

      <label>
        植物照片（JPG、PNG 或 WebP，最大 8 MB）
        <input type="file" accept="image/*" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} />
      </label>

      {previewUrl && <img src={previewUrl} alt="所选植物预览" />}

      <footer>
        <button
          type="button"
          disabled={!imageFile || isSubmitting}
          aria-busy={isSubmitting}
          onClick={analyzePlantImage}
        >
          {isSubmitting ? "正在分析照片…" : "分析植物照片"}
        </button>

        {errorMessage && (
          <p>
            <mark>{errorMessage}</mark>
          </p>
        )}
      </footer>
    </article>
  );
}
