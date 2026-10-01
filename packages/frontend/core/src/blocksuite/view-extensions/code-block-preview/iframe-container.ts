export function linkIframe(iframe: HTMLIFrameElement, html: string) {
  // force reload iframe
  iframe.sandbox.add(
    'allow-pointer-lock',
    'allow-popups',
    'allow-forms',
    'allow-popups-to-escape-sandbox',
    'allow-downloads',
    'allow-scripts'
  );
  iframe.srcdoc = html;
}
