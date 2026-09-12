// Keep images in the original DOCX. Markdown stores stable document-local
// references so indexing and Agent reads never include base64 image payloads.
export async function convertDocx(blob, { includeImages = false } = {}) {
  await import("./vendor/document-ingestion/mammoth.browser.js");
  const mammoth = globalThis.mammoth;
  if (!mammoth?.convertToHtml) throw new Error("DOCX 解析组件未加载");
  const images = new Map();
  let imageIndex = 0;
  const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() }, {
    externalFileAccess: false,
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => p:fresh"],
    convertImage: mammoth.images.imgElement(async image => {
      const reference = `document-image:${imageIndex++}`;
      if (includeImages && /^image\/(?:png|jpeg|gif|webp|avif)$/u.test(image.contentType)) {
        images.set(reference, `data:${image.contentType};base64,${await image.read("base64")}`);
      }
      return { src: reference };
    })
  });
  const warnings = result.messages.map(item => /^Unrecognised paragraph style:/u.test(item.message)
    ? "部分段落样式未完全还原，文字已保留，请对照原文档查看排版"
    : `文档解析提示：${item.message}`);
  return { html: result.value, images, warnings: [...new Set(warnings)] };
}

export function docxImageLoader(blob) {
  let pending;
  return async reference => {
    pending ??= convertDocx(blob, { includeImages: true });
    const image = (await pending).images.get(reference);
    if (!image) throw new Error("此内嵌图片暂不能预览，请下载原文档查看");
    return image;
  };
}
