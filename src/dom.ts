// Every element the code touches, looked up once. Ids are in public/index.html.

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html has no #${id}`);
  return el as T;
}

export const ui = {
  cardsInput: byId<HTMLTextAreaElement>("cards"),
  lookupButton: byId<HTMLButtonElement>("go"),
  copyButton: byId<HTMLButtonElement>("copy"),
  scanButton: byId<HTMLButtonElement>("scan"),
  scanFile: byId<HTMLInputElement>("scan-file"),
  cameraButton: byId<HTMLButtonElement>("cam-open"),

  totalUsd: byId("t-usd"),
  totalCount: byId("t-count"),
  status: byId("status"),
  rows: byId<HTMLTableSectionElement>("rows"),
  loadingBar: byId("loading-bar"),

  camera: {
    root: byId("cam"),
    video: byId<HTMLVideoElement>("cam-video"),
    guide: byId("cam-guide"),
    ring: byId("cam-ring"),
    hint: byId("cam-hint"),
    flash: byId("cam-flash"),
    message: byId("cam-msg"),
    tray: byId<HTMLOListElement>("cam-tray"),
    torchButton: byId<HTMLButtonElement>("cam-torch"),
    autoButton: byId<HTMLButtonElement>("cam-auto"),
    shutter: byId<HTMLButtonElement>("cam-shutter"),
    doneButton: byId<HTMLButtonElement>("cam-done"),
  },
};

export const setStatus = (text: string) => {
  ui.status.textContent = text;
};
