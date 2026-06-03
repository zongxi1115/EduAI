declare module "html2pdf.js" {
  interface Html2PdfWorker {
    set(options: unknown): Html2PdfWorker;
    from(source: HTMLElement | string): Html2PdfWorker;
    save(): Promise<void>;
  }

  export default function html2pdf(): Html2PdfWorker;
}
