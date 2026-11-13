// Writes a small, valid PDF (Helvetica text, optional outline) so tests need no binary fixtures.

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export interface PdfSpec {
  title?: string;
  author?: string;
  /** One string per page; "\n" starts a new line. ASCII only. */
  pages: string[];
  outline?: Array<{ title: string; page: number }>;
}

export function makePdf(spec: PdfSpec): Uint8Array {
  const objects: string[] = []; // index 0 = object 1
  const add = (body: string) => objects.push(body) as number; // returns object number
  const reserve = () => add("");

  const catalog = reserve();
  const pagesObj = reserve();
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const pageRefs: number[] = [];
  for (const text of spec.pages) {
    const lines = text
      .split("\n")
      .map((l) => `(${esc(l)}) Tj T*`)
      .join(" ");
    const stream = `BT /F1 12 Tf 14 TL 72 720 Td ${lines} ET`;
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageRefs.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objects[pagesObj - 1] =
    `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;

  let outlinesRef: number | undefined;
  if (spec.outline?.length) {
    outlinesRef = reserve();
    const itemRefs = spec.outline.map(() => reserve());
    spec.outline.forEach((o, i) => {
      const prev = i > 0 ? ` /Prev ${itemRefs[i - 1]} 0 R` : "";
      const next = i < itemRefs.length - 1 ? ` /Next ${itemRefs[i + 1]} 0 R` : "";
      objects[(itemRefs[i] as number) - 1] =
        `<< /Title (${esc(o.title)}) /Parent ${outlinesRef} 0 R /Dest [${pageRefs[o.page - 1]} 0 R /Fit]${prev}${next} >>`;
    });
    objects[outlinesRef - 1] =
      `<< /Type /Outlines /First ${itemRefs[0]} 0 R /Last ${itemRefs.at(-1)} 0 R /Count ${itemRefs.length} >>`;
  }
  objects[catalog - 1] =
    `<< /Type /Catalog /Pages ${pagesObj} 0 R${outlinesRef ? ` /Outlines ${outlinesRef} 0 R` : ""} >>`;

  const info = add(
    `<< ${spec.title ? `/Title (${esc(spec.title)}) ` : ""}${spec.author ? `/Author (${esc(spec.author)}) ` : ""}/Producer (kortex-test) >>`,
  );

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
