import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerURL from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerURL;

export default function LibraryPDF({ url, title }: { url: string; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const task = getDocument({ url, withCredentials: true, enableXfa: false });
    task.promise.then(pdf => { if (active) setDoc(pdf); }).catch(() => {
      if (active) setError("This PDF could not be opened. You can download the original below.");
    });
    return () => { active = false; void task.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!doc) return;
    let active = true;
    let render: RenderTask | undefined;
    doc.getPage(page).then(async pdfPage => {
      const element = canvas.current;
      if (!active || !element) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.min(2, 1400 / Math.max(natural.width, natural.height)) });
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      render = pdfPage.render({ canvas: element, viewport });
      await render.promise;
    }).catch(err => { if (active) { console.warn("PDF page render failed", err); setError("This page could not be displayed."); } });
    return () => { active = false; render?.cancel(); };
  }, [doc, page]);
  if (error) return <p role="alert">{error}</p>;
  return <section aria-label={title}>
    {doc ? <div className="mb-3 flex justify-between gap-3">
      <button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} of {doc.numPages}</span>
      <button disabled={page === doc.numPages} onClick={() => setPage(page + 1)}>Next</button>
    </div> : <p role="status">Opening PDF…</p>}
    <canvas ref={canvas} aria-label={`${title}, page ${page}`} className="mx-auto h-auto max-w-full" />
  </section>;
}
