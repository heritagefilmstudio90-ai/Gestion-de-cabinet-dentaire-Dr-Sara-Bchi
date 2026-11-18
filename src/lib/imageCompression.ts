export async function compressCanvasToSafeDataUrl(
  sourceCanvas: HTMLCanvasElement,
  maxDim = 1400,
  maxLength = 840000
): Promise<string> {
  const tryEncode = (dimLimit: number): string => {
    let targetCanvas = sourceCanvas;
    if (sourceCanvas.width > dimLimit || sourceCanvas.height > dimLimit) {
      const scale = Math.min(dimLimit / sourceCanvas.width, dimLimit / sourceCanvas.height);
      const resized = document.createElement('canvas');
      resized.width = Math.max(1, Math.round(sourceCanvas.width * scale));
      resized.height = Math.max(1, Math.round(sourceCanvas.height * scale));
      const ctx = resized.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sourceCanvas, 0, 0, resized.width, resized.height);
        targetCanvas = resized;
      }
    }

    const qualities = [0.85, 0.76, 0.66, 0.56, 0.45];
    let lastEncoded = '';
    for (const q of qualities) {
      lastEncoded = targetCanvas.toDataURL('image/jpeg', q);
      if (lastEncoded.length <= maxLength) {
        return lastEncoded;
      }
    }
    return lastEncoded;
  };

  let encoded = tryEncode(maxDim);
  if (encoded.length > maxLength) {
    encoded = tryEncode(1024);
  }
  if (encoded.length > maxLength) {
    encoded = tryEncode(800);
  }
  return encoded;
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de charger l'image pour l'édition."));
    img.src = src;
  });
}

export async function compressFileToSafeDataUrl(
  file: File,
  maxDim = 1400,
  maxLength = 840000
): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le fichier image.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  const img = await loadHtmlImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, img.naturalWidth || img.width);
  canvas.height = Math.max(1, img.naturalHeight || img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Contexte graphique indisponible.');
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return compressCanvasToSafeDataUrl(canvas, maxDim, maxLength);
}
